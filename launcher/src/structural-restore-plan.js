"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  assertSafeRuntimePath,
  ensureDirectory,
  readProjectBySlug,
  resolveProjectsRoot,
  validateExplicitSlug
} = require("./project-store");
const {
  deriveProjectBinding,
  isRestorable,
  readManifest,
  resolveSnapshotDirectory,
  toBrowserSafeSummary,
  validateManifest,
  validateSnapshotId
} = require("./structural-snapshot-store");
const {
  listTarEntries,
  validateArchiveEntries
} = require("./structural-snapshot-capture");
const {
  verifyDumpArtifact
} = require("./structural-snapshot-db-capture");
const {
  getLockDirectory,
  hashValue,
  listOperations,
  readLock
} = require("./project-operation-store");

const RESTORE_PLAN_SCHEMA = "factory_structural_restore_plan";
const RESTORE_PLAN_SCHEMA_VERSION = 1;
const RESTORE_PLAN_POLICY_VERSION = 1;
const RESTORE_PLAN_TTL_MS = 10 * 60 * 1000;
const RESTORE_PLAN_DIRECTORY = path.join("runs", "restore-plans");
const RESTORE_PLAN_ID_PREFIX = "restore-plan";
const FIXED_SAFETY_RESERVE_BYTES = 64 * 1024 * 1024;
const DATABASE_IMPORT_MULTIPLIER = 3;
const FILESYSTEM_REPLACEMENT_MULTIPLIER = 2;
const LIGHTWEIGHT_METADATA_ALLOWANCE_BYTES = 16 * 1024 * 1024;
const LIGHTWEIGHT_RESCUE_MAX_BYTES = 512 * 1024 * 1024;
const FORBIDDEN_CALLER_KEYS = new Set([
  "artifactPath",
  "artifact_path",
  "projectPath",
  "project_path",
  "recoveryRoot",
  "recovery_root",
  "archiveFilename",
  "archive_filename",
  "databaseFilename",
  "database_filename",
  "components",
  "componentMap",
  "component_map",
  "restoreComponents",
  "restore_components",
  "filesystemTarget",
  "filesystem_target",
  "dbTarget",
  "db_target",
  "credentialPolicy",
  "credential_policy",
  "rescueMode",
  "rescue_mode",
  "executable",
  "command",
  "commandArgs",
  "command_args",
  "confirmationPhrase",
  "confirmation_phrase",
  "compatibility",
  "compatibilityResult",
  "compatibility_result",
  "diskEstimate",
  "disk_estimate"
]);
const SECRET_OR_PATH_PATTERN = /signing_secret|database_password|application_password|authorization|bearer|access_token|refresh_token|provider_token|license_key|sublicense|cookie|package_url|signed_url|password\s*[=:]|[A-Za-z]:[\\/]|\\\\|\/var\/|\/tmp\/|sf-factory-projects/i;
const REQUIRED_ARTIFACTS = ["database_dump", "wordpress_filesystem", "project_metadata"];
const RESTORE_COMPONENTS = [
  "WordPress database",
  "Managed WordPress filesystem",
  "Generated site assets",
  "Snapshot-contained themes and plugins",
  "Factory-managed structural state",
  "Snapshot dependency and component state"
];
const PRESERVED_CATEGORIES = [
  "Current Launcher installation",
  "Current Docker/runtime installation",
  "Current project credentials",
  "Current Agent signing identity or repaired current identity",
  "Machine-specific runtime configuration"
];
const EXCLUDED_CATEGORIES = [
  "Launcher installation",
  "Docker Desktop or container engine",
  "Host operating-system configuration",
  "Ports or machine networking",
  "Current project credentials",
  "Agent signing secrets",
  "Provider accounts, licenses or external services",
  "Files explicitly excluded by snapshot policy",
  "Other Factory projects",
  "External hosting",
  "Remote services",
  "Unrelated machine files"
];

function nowIso(clock) {
  return new Date(clock ? clock() : Date.now()).toISOString();
}

function timestampCompact(date) {
  return (date || new Date()).toISOString().replace(/[:.]/g, "-");
}

function createRestoreError(code, message, statusCode, extras) {
  const error = new Error(message || "Restore plan request failed.");
  error.code = code;
  error.statusCode = statusCode || 400;
  if (extras && typeof extras === "object") {
    Object.assign(error, extras);
  }
  return error;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((entry) => stableStringify(entry)).join(",") + "]";
  }
  return "{" + Object.keys(value).sort().map((key) => {
    return JSON.stringify(key) + ":" + stableStringify(value[key]);
  }).join(",") + "}";
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashObject(value) {
  return sha256(Buffer.from(stableStringify(value), "utf8"));
}

function digestFile(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  return child === parent || child.startsWith(parent + path.sep);
}

function validateAllowedCallerInput(options) {
  for (const key of Object.keys(options || {})) {
    if (FORBIDDEN_CALLER_KEYS.has(key)) {
      throw createRestoreError("restore_caller_input_rejected", "Restore planning input is not allowed.", 400);
    }
  }
}

function normalizeProject(projectsRoot, slug) {
  let safeSlug;
  try {
    safeSlug = validateExplicitSlug(slug);
  } catch (error) {
    throw createRestoreError("restore_project_not_found", "Project was not found.", 404);
  }
  try {
    return readProjectBySlug(safeSlug, projectsRoot);
  } catch (error) {
    throw createRestoreError("restore_project_not_found", "Project was not found.", 404);
  }
}

function generateRestorePlanId(date, randomBytes) {
  const random = randomBytes || crypto.randomBytes(3).toString("hex");
  return RESTORE_PLAN_ID_PREFIX + "-" + timestampCompact(date).toLowerCase() + "-" + random;
}

function validateRestorePlanId(planId) {
  const value = String(planId || "").trim();
  if (!/^restore-plan-\d{4}-\d{2}-\d{2}t\d{2}-\d{2}-\d{2}-\d{3}z-[a-f0-9]{6}$/.test(value)) {
    throw createRestoreError("restore_plan_not_found", "Restore plan was not found.", 404);
  }
  return value;
}

function getRestorePlanDirectory(runtimePath) {
  const directory = path.join(runtimePath, RESTORE_PLAN_DIRECTORY);
  if (!isPathInside(runtimePath, directory)) {
    throw createRestoreError("restore_plan_storage_failed", "Restore plan storage is unavailable.", 500);
  }
  return directory;
}

function getRestorePlanPath(runtimePath, planId) {
  const safePlanId = validateRestorePlanId(planId);
  const directory = getRestorePlanDirectory(runtimePath);
  const filePath = path.join(directory, safePlanId + ".json");
  if (!isPathInside(directory, filePath)) {
    throw createRestoreError("restore_plan_storage_failed", "Restore plan storage is unavailable.", 500);
  }
  return filePath;
}

function writeJsonAtomic(filePath, value, options) {
  const writer = options && options.writeJsonAtomic;
  if (writer) {
    return writer(filePath, value);
  }
  ensureDirectory(path.dirname(filePath));
  const tmpPath = filePath + ".tmp-" + process.pid + "-" + crypto.randomBytes(3).toString("hex");
  const payload = JSON.stringify(value, null, 2) + "\n";
  const fd = fs.openSync(tmpPath, "wx");
  try {
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
  } catch (error) {
    try {
      fs.closeSync(fd);
    } catch (closeError) {
      // Preserve the original storage failure.
    }
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch (cleanupError) {
      // Preserve the original storage failure.
    }
    throw createRestoreError("restore_plan_storage_failed", "Restore plan storage failed.", 500);
  }
  fs.closeSync(fd);
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch (cleanupError) {
      // Preserve the original storage failure.
    }
    throw createRestoreError("restore_plan_storage_failed", "Restore plan storage failed.", 500);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function safePlanRecord(record) {
  return record && typeof record === "object" && !Array.isArray(record) ? record : null;
}

function listRestorePlanRecords(options) {
  if (options.planPersistenceAdapter && options.planPersistenceAdapter.list) {
    return options.planPersistenceAdapter.list(options);
  }
  const directory = getRestorePlanDirectory(options.runtimePath);
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(RESTORE_PLAN_ID_PREFIX + "-") && entry.name.endsWith(".json"))
    .map((entry) => {
      try {
        return safePlanRecord(readJson(path.join(directory, entry.name)));
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

function listRestorePlanRecordsAcrossProjects(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  if (!fs.existsSync(projectsRoot)) {
    return [];
  }
  const records = [];
  for (const entry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    const runtimePath = path.join(projectsRoot, entry.name);
    const planDirectory = path.join(runtimePath, RESTORE_PLAN_DIRECTORY);
    if (!isPathInside(projectsRoot, planDirectory) || !fs.existsSync(planDirectory)) {
      continue;
    }
    for (const planEntry of fs.readdirSync(planDirectory, { withFileTypes: true })) {
      if (!planEntry.isFile() || !planEntry.name.startsWith(RESTORE_PLAN_ID_PREFIX + "-") || !planEntry.name.endsWith(".json")) {
        continue;
      }
      try {
        const record = safePlanRecord(readJson(path.join(planDirectory, planEntry.name)));
        if (record) {
          records.push(record);
        }
      } catch (error) {
        // Corrupt records are ignored for lookup; direct reads still fail closed.
      }
    }
  }
  return records;
}

function readPlanRecord(options) {
  if (options.planPersistenceAdapter && options.planPersistenceAdapter.read) {
    return options.planPersistenceAdapter.read(options);
  }
  const filePath = getRestorePlanPath(options.runtimePath, options.planId);
  if (!fs.existsSync(filePath)) {
    throw createRestoreError("restore_plan_not_found", "Restore plan was not found.", 404);
  }
  try {
    return readJson(filePath);
  } catch (error) {
    throw createRestoreError("restore_plan_not_found", "Restore plan was not found.", 404);
  }
}

function writePlanRecord(options) {
  if (options.planPersistenceAdapter && options.planPersistenceAdapter.write) {
    return options.planPersistenceAdapter.write(options);
  }
  const filePath = getRestorePlanPath(options.runtimePath, options.plan.plan_id);
  if (fs.existsSync(filePath)) {
    throw createRestoreError("restore_plan_storage_failed", "Restore plan already exists.", 409);
  }
  try {
    writeJsonAtomic(filePath, options.plan, options);
  } catch (error) {
    if (error && error.code === "restore_plan_storage_failed") {
      throw error;
    }
    throw createRestoreError("restore_plan_storage_failed", "Restore plan storage failed.", 500);
  }
  return filePath;
}

function assertPlanSafe(value, trail) {
  const label = trail || "plan";
  if (typeof value === "string") {
    if (SECRET_OR_PATH_PATTERN.test(value)) {
      throw createRestoreError("restore_plan_storage_failed", "Restore plan contains unsafe metadata.", 500, {
        field: label
      });
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPlanSafe(entry, label + "[" + String(index) + "]"));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_OR_PATH_PATTERN.test(key)) {
      throw createRestoreError("restore_plan_storage_failed", "Restore plan contains unsafe metadata.", 500, {
        field: label + "." + key
      });
    }
    assertPlanSafe(entry, label + "." + key);
  }
}

function resolveArtifactPath(snapshotDirectory, artifact) {
  const filePath = path.join(snapshotDirectory, artifact.relative_filename);
  if (!isPathInside(snapshotDirectory, filePath)) {
    throw createRestoreError("restore_manifest_invalid", "Recovery Point artifact metadata is invalid.", 422);
  }
  return filePath;
}

function getArtifact(manifest, type) {
  const artifact = manifest.artifacts.find((entry) => entry.type === type);
  if (!artifact) {
    throw createRestoreError("restore_artifact_missing", "Recovery Point artifact is missing.", 422);
  }
  return artifact;
}

function verifyArtifactBytes(artifact, filePath, options) {
  if (!fs.existsSync(filePath)) {
    throw createRestoreError("restore_artifact_missing", "Recovery Point artifact is missing.", 422);
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0) {
    throw createRestoreError("restore_artifact_missing", "Recovery Point artifact is missing.", 422);
  }
  if (stat.size !== artifact.size_bytes) {
    throw createRestoreError("restore_artifact_size_mismatch", "Recovery Point artifact size changed.", 422);
  }
  const digest = options.digestVerifier ? options.digestVerifier(filePath, artifact) : digestFile(filePath);
  if (digest !== artifact.digest) {
    throw createRestoreError("restore_artifact_digest_mismatch", "Recovery Point artifact digest changed.", 422);
  }
  return stat.size;
}

async function verifyDatabaseArtifact(artifact, filePath, options) {
  verifyArtifactBytes(artifact, filePath, options);
  try {
    if (options.databaseVerifier) {
      return await options.databaseVerifier(filePath, artifact);
    }
    return await verifyDumpArtifact(filePath, {
      sizeBytes: artifact.size_bytes,
      digest: artifact.digest
    });
  } catch (error) {
    throw createRestoreError("restore_database_verification_failed", "Recovery Point database artifact is not valid.", 422);
  }
}

function verifyFilesystemArtifact(artifact, filePath, options) {
  verifyArtifactBytes(artifact, filePath, options);
  try {
    const entries = options.archiveVerifier
      ? options.archiveVerifier(filePath, artifact)
      : listTarEntries(filePath);
    const validation = Array.isArray(entries)
      ? validateArchiveEntries(entries, { requireAgentPlugin: options.requireAgentPlugin === true })
      : entries;
    const archiveEntries = Array.isArray(entries) ? entries : [];
    return {
      validation,
      uncompressedBytes: archiveEntries.reduce((total, entry) => total + (entry.type === "0" ? Number(entry.size || 0) : 0), 0),
      entryCount: validation.entry_count || archiveEntries.length
    };
  } catch (error) {
    throw createRestoreError("restore_archive_verification_failed", "Recovery Point filesystem artifact is not valid.", 422);
  }
}

function verifyMetadataArtifact(artifact, filePath, options) {
  verifyArtifactBytes(artifact, filePath, options);
  try {
    const content = fs.readFileSync(filePath, "utf8");
    if (SECRET_OR_PATH_PATTERN.test(content)) {
      throw new Error("unsafe metadata");
    }
    return true;
  } catch (error) {
    throw createRestoreError("restore_metadata_verification_failed", "Recovery Point metadata artifact is not valid.", 422);
  }
}

function countCurrentWordPressBytes(runtimePath) {
  const root = path.join(runtimePath, "wordpress");
  if (!fs.existsSync(root)) {
    return 0;
  }
  let total = 0;
  function visit(filePath) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(filePath)) {
        visit(path.join(filePath, entry));
      }
      return;
    }
    if (stat.isFile()) {
      total += stat.size;
    }
  }
  visit(root);
  return total;
}

function probeFreeSpace(targetPath, options) {
  if (options.freeSpaceProbe) {
    return options.freeSpaceProbe(targetPath);
  }
  if (typeof fs.statfsSync === "function") {
    const stat = fs.statfsSync(targetPath);
    return Number(stat.bavail) * Number(stat.bsize);
  }
  return Number.MAX_SAFE_INTEGER;
}

function calculateDiskPlan(options) {
  const sourceValidationBytes = options.artifactBytes;
  const restoreStagingBytes = options.artifactBytes + options.filesystemUncompressedBytes;
  const filesystemReplacementBytes = options.filesystemUncompressedBytes * FILESYSTEM_REPLACEMENT_MULTIPLIER;
  const databaseImportOverheadBytes = options.databaseBytes * DATABASE_IMPORT_MULTIPLIER;
  const currentDatabaseRescueBytes = Math.max(Number(options.currentDatabaseBytes || options.databaseBytes || 0), 1);
  const rescueBytes = options.currentWordPressBytes + options.filesystemUncompressedBytes + options.databaseBytes;
  const lightweightRescueBytes = currentDatabaseRescueBytes + LIGHTWEIGHT_METADATA_ALLOWANCE_BYTES + FIXED_SAFETY_RESERVE_BYTES;
  const requiredRestoreBytes = sourceValidationBytes +
    restoreStagingBytes +
    filesystemReplacementBytes +
    databaseImportOverheadBytes +
    FIXED_SAFETY_RESERVE_BYTES;
  const requiredFullRescueBytes = requiredRestoreBytes + rescueBytes;
  const availableBytes = options.availableBytes;
  const estimatedPostOperationReserveBytes = availableBytes - requiredRestoreBytes;

  return {
    available_bytes: availableBytes,
    source_validation_bytes: sourceValidationBytes,
    restore_staging_bytes: restoreStagingBytes,
    filesystem_replacement_bytes: filesystemReplacementBytes,
    database_import_overhead_bytes: databaseImportOverheadBytes,
    rescue_bytes: rescueBytes,
    current_database_rescue_bytes: currentDatabaseRescueBytes,
    lightweight_metadata_allowance_bytes: LIGHTWEIGHT_METADATA_ALLOWANCE_BYTES,
    lightweight_rescue_bytes: lightweightRescueBytes,
    required_restore_bytes: requiredRestoreBytes,
    required_full_rescue_bytes: requiredFullRescueBytes,
    minimum_reserve_bytes: FIXED_SAFETY_RESERVE_BYTES,
    estimated_post_operation_reserve_bytes: estimatedPostOperationReserveBytes
  };
}

function evaluateRescueStrategy(disk) {
  if (disk.available_bytes >= disk.required_full_rescue_bytes) {
    return {
      readiness: "ready",
      rescue_strategy: "full_required",
      confirmation_mode: "normal",
      warnings: [],
      blockers: []
    };
  }
  if (disk.available_bytes >= disk.required_restore_bytes + disk.lightweight_rescue_bytes) {
    return {
      readiness: "ready",
      rescue_strategy: "lightweight_required",
      confirmation_mode: "normal",
      warnings: ["full_recovery_point_unavailable_temporary_safety_copy_used"],
      blockers: []
    };
  }
  if (disk.available_bytes >= disk.required_restore_bytes) {
    return {
      readiness: "ready_with_emergency_confirmation",
      rescue_strategy: "none_emergency",
      confirmation_mode: "emergency",
      warnings: ["current_damaged_state_may_not_be_recoverable"],
      blockers: []
    };
  }
  return {
    readiness: "blocked",
    rescue_strategy: "blocked",
    confirmation_mode: "normal",
    warnings: [],
    blockers: ["insufficient_restore_space"]
  };
}

function detectActiveOperation(options) {
  if (options.currentOperationReader) {
    return options.currentOperationReader(options);
  }
  const lock = readLock(options.runtimePath);
  if (lock && lock.metadata) {
    return {
      operation_id: lock.metadata.operation_id || null,
      operation_type: lock.metadata.operation_type || null,
      status: "running",
      stage: "locked"
    };
  }
  return listOperations({ projectsRoot: options.projectsRoot, slug: options.slug })
    .find((operation) => operation.status === "requested" || operation.status === "running") || null;
}

function buildBoundarySummary() {
  return {
    product_term: "Restore Website",
    internal_term: "Managed Website Restore",
    restores: RESTORE_COMPONENTS.slice(),
    preserves: PRESERVED_CATEGORIES.slice(),
    does_not_restore: EXCLUDED_CATEGORIES.slice(),
    invariant: "Website content and managed structure return to the Recovery Point state while current machine identity and current credentials are preserved."
  };
}

function buildImpactSummary(options) {
  return {
    action: "Restore Website",
    replaces: [
      "Managed WordPress database state",
      "Managed WordPress filesystem state",
      "Generated site assets",
      "Snapshot-managed plugin, theme, and component state"
    ],
    preserves: PRESERVED_CATEGORIES.slice(),
    does_not_affect: [
      "Other Factory projects",
      "External hosting",
      "Remote services",
      "Unrelated machine files"
    ],
    expected_temporary_downtime: "The website may be temporarily unavailable while restore execution runs in a later phase.",
    recovery_point_created_at: options.snapshotCreatedAt,
    components: RESTORE_COMPONENTS.slice(),
    rescue_strategy: options.rescueStrategy,
    disk: options.disk,
    warnings: options.warnings.slice(),
    blockers: options.blockers.slice(),
    exact_confirmation_required: true
  };
}

function buildConfirmation(projectSlug, mode) {
  if (mode === "emergency") {
    return {
      required: true,
      mode: "emergency",
      phrase: "EMERGENCY Restore Website for " + projectSlug + " without rescue",
      warning: "Current damaged state may not be recoverable because no full rescue is planned."
    };
  }
  return {
    required: true,
    mode: "normal",
    phrase: "Restore Website for " + projectSlug,
    warning: null
  };
}

function buildBrowserSafeSummary(plan) {
  return {
    plan_id: plan.plan_id,
    project_slug: plan.project_slug,
    snapshot_id: plan.snapshot_id,
    recovery_point_label: plan.recovery_point_label,
    recovery_point_created_at: plan.recovery_point_created_at,
    created_at: plan.created_at,
    expires_at: plan.expires_at,
    readiness: plan.readiness,
    restore_boundary: plan.restore_boundary,
    restore_components: plan.restore_components.slice(),
    preserved_state: plan.preserved_state.slice(),
    exclusions: plan.exclusions.slice(),
    warnings: plan.warnings.slice(),
    blockers: plan.blockers.slice(),
    disk: plan.disk,
    rescue_strategy: plan.rescue_strategy,
    confirmation: plan.confirmation,
    impact_summary: plan.impact_summary,
    immutable_fingerprint_abbrev: plan.immutable_source_fingerprint.digest.slice(0, 12)
  };
}

function buildFingerprint(options) {
  return {
    policy_version: RESTORE_PLAN_POLICY_VERSION,
    project_binding: options.projectBinding,
    snapshot_id: options.snapshotId,
    manifest_schema_version: options.manifest.schema_version,
    manifest_digest: hashObject(options.manifest),
    artifacts: REQUIRED_ARTIFACTS.map((type) => {
      const artifact = getArtifact(options.manifest, type);
      return {
        type,
        digest_algorithm: artifact.digest_algorithm,
        digest: artifact.digest,
        size_bytes: artifact.size_bytes
      };
    })
  };
}

function fingerprintDigest(fingerprint) {
  return hashObject(fingerprint);
}

function validateSourceRecoveryPoint(options) {
  let snapshotId;
  try {
    snapshotId = validateSnapshotId(options.snapshotId);
  } catch (error) {
    throw createRestoreError("restore_snapshot_not_found", "Recovery Point was not found.", 404);
  }

  let context;
  let manifest;
  try {
    context = resolveSnapshotDirectory({
      projectsRoot: options.projectsRoot,
      slug: options.slug,
      snapshotId
    });
    manifest = readManifest({
      projectsRoot: options.projectsRoot,
      slug: options.slug,
      snapshotId
    });
  } catch (error) {
    if (error.code === "snapshot_project_binding_mismatch") {
      throw createRestoreError("restore_project_binding_mismatch", "Recovery Point is not bound to this project.", 409);
    }
    if (error.code === "snapshot_not_found") {
      throw createRestoreError("restore_snapshot_not_found", "Recovery Point was not found.", 404);
    }
    throw createRestoreError("restore_manifest_invalid", "Recovery Point manifest is invalid.", 422);
  }

  const binding = deriveProjectBinding(context.projectState.project);
  const validated = validateManifest(manifest, {
    expectedProjectSlug: binding.slug,
    expectedProjectIdentityFingerprint: binding.fingerprint
  });

  if (validated.status !== "verified") {
    throw createRestoreError("restore_snapshot_not_verified", "Recovery Point is not verified.", 409);
  }
  if (!isRestorable(validated, {
    expectedProjectSlug: binding.slug,
    expectedProjectIdentityFingerprint: binding.fingerprint
  })) {
    throw createRestoreError("restore_snapshot_not_restorable", "Recovery Point is not restorable.", 409);
  }

  const summary = toBrowserSafeSummary(validated);
  const dbArtifact = getArtifact(validated, "database_dump");
  const fsArtifact = getArtifact(validated, "wordpress_filesystem");
  const metadataArtifact = getArtifact(validated, "project_metadata");
  const dbPath = resolveArtifactPath(context.snapshotDirectory, dbArtifact);
  const fsPath = resolveArtifactPath(context.snapshotDirectory, fsArtifact);
  const metadataPath = resolveArtifactPath(context.snapshotDirectory, metadataArtifact);

  return {
    context,
    manifest: validated,
    summary,
    binding,
    artifacts: {
      database: { artifact: dbArtifact, path: dbPath },
      filesystem: { artifact: fsArtifact, path: fsPath },
      metadata: { artifact: metadataArtifact, path: metadataPath }
    }
  };
}

async function validateRecoveryArtifacts(source, options) {
  const databaseVerification = await verifyDatabaseArtifact(source.artifacts.database.artifact, source.artifacts.database.path, options);
  const filesystemVerification = verifyFilesystemArtifact(source.artifacts.filesystem.artifact, source.artifacts.filesystem.path, {
    requireAgentPlugin: source.context.projectState.project.agent && source.context.projectState.project.agent.status === "installed",
    digestVerifier: options.digestVerifier,
    archiveVerifier: options.archiveVerifier
  });
  verifyMetadataArtifact(source.artifacts.metadata.artifact, source.artifacts.metadata.path, options);
  return {
    databaseVerification,
    filesystemVerification,
    artifactBytes: source.manifest.artifacts.reduce((total, artifact) => total + artifact.size_bytes, 0),
    filesystemUncompressedBytes: filesystemVerification.uncompressedBytes
  };
}

function buildRequestFingerprint(input) {
  return hashObject({
    schema_version: RESTORE_PLAN_SCHEMA_VERSION,
    policy_version: RESTORE_PLAN_POLICY_VERSION,
    action: "managed_website_restore_plan",
    project_slug: input.slug,
    snapshot_id: input.snapshotId
  });
}

function findIdempotentPlan(options) {
  const keyHash = hashValue(options.idempotencyKey);
  const records = listRestorePlanRecords(options)
    .concat(listRestorePlanRecordsAcrossProjects(options));
  const seenPlanIds = new Set();
  for (const record of records) {
    if (seenPlanIds.has(record.plan_id)) {
      continue;
    }
    seenPlanIds.add(record.plan_id);
    if (record.idempotency_key_hash !== keyHash) {
      continue;
    }
    if (record.request_fingerprint !== options.requestFingerprint) {
      throw createRestoreError("restore_plan_idempotency_conflict", "Restore plan idempotency key was reused for different input.", 409);
    }
    if (Date.parse(record.expires_at) <= options.nowMs) {
      throw createRestoreError("restore_plan_expired", "Restore plan has expired.", 410);
    }
    return record;
  }
  return null;
}

function makePlan(options) {
  const createdAt = nowIso(options.clock);
  const createdMs = Date.parse(createdAt);
  const expiresAt = new Date(createdMs + RESTORE_PLAN_TTL_MS).toISOString();
  const planId = options.idGenerator
    ? options.idGenerator()
    : generateRestorePlanId(new Date(createdAt));
  validateRestorePlanId(planId);
  const confirmation = buildConfirmation(options.slug, options.rescue.confirmation_mode);
  const warnings = Array.from(new Set(options.rescue.warnings.concat(options.advisoryWarnings || [])));
  const blockers = Array.from(new Set(options.rescue.blockers.concat(options.blockers || [])));
  const readiness = blockers.length && options.rescue.readiness === "ready" ? "blocked" : options.rescue.readiness;
  const boundary = buildBoundarySummary();
  const fingerprint = buildFingerprint({
    projectBinding: options.binding,
    snapshotId: options.snapshotId,
    manifest: options.manifest
  });
  const sourceFingerprint = {
    schema_version: RESTORE_PLAN_SCHEMA_VERSION,
    policy_version: RESTORE_PLAN_POLICY_VERSION,
    digest_algorithm: "sha256",
    digest: fingerprintDigest(fingerprint),
    canonical: fingerprint
  };
  const disk = Object.assign({}, options.disk, {
    classification: readiness === "blocked" && blockers.includes("insufficient_restore_space")
      ? "insufficient"
      : (options.rescue.rescue_strategy === "full_required" ? "full_rescue_available" : options.rescue.rescue_strategy)
  });
  const plan = {
    schema: RESTORE_PLAN_SCHEMA,
    schema_version: RESTORE_PLAN_SCHEMA_VERSION,
    policy_version: RESTORE_PLAN_POLICY_VERSION,
    plan_id: planId,
    project_slug: options.slug,
    project_binding_key: options.binding.binding_key,
    project_identity_fingerprint: options.binding.fingerprint,
    snapshot_id: options.snapshotId,
    recovery_point_label: options.summary.customer_label || "Recovery Point",
    recovery_point_created_at: options.manifest.created_at,
    created_at: createdAt,
    expires_at: expiresAt,
    readiness,
    restore_boundary: boundary,
    restore_components: RESTORE_COMPONENTS.slice(),
    preserved_state: PRESERVED_CATEGORIES.slice(),
    exclusions: EXCLUDED_CATEGORIES.slice(),
    warnings,
    blockers,
    disk,
    rescue_strategy: options.rescue.rescue_strategy,
    confirmation,
    impact_summary: buildImpactSummary({
      snapshotCreatedAt: options.manifest.created_at,
      rescueStrategy: options.rescue.rescue_strategy,
      disk,
      warnings,
      blockers
    }),
    immutable_source_fingerprint: sourceFingerprint,
    idempotency_key_hash: hashValue(options.idempotencyKey),
    request_fingerprint: options.requestFingerprint
  };
  plan.browser_safe_summary = buildBrowserSafeSummary(plan);
  assertPlanSafe(plan.browser_safe_summary);
  assertPlanSafe(plan);
  return plan;
}

async function createRestorePlan(options) {
  validateAllowedCallerInput(options);
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const slug = validateExplicitSlug(options && options.slug);
  const projectState = normalizeProject(projectsRoot, slug);
  const runtimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const snapshotId = String(options && options.snapshotId || "").trim();
  const idempotencyKey = String(options && options.idempotencyKey || "").trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
    throw createRestoreError("restore_plan_idempotency_conflict", "Restore plan idempotency key is invalid.", 400);
  }

  const requestFingerprint = buildRequestFingerprint({ slug, snapshotId });
  const nowMs = options.clock ? options.clock() : Date.now();
  const replay = findIdempotentPlan({
    projectsRoot,
    runtimePath,
    planPersistenceAdapter: options.planPersistenceAdapter,
    idempotencyKey,
    requestFingerprint,
    nowMs
  });
  if (replay) {
    return {
      plan: replay,
      summary: replay.browser_safe_summary,
      idempotentReplay: true
    };
  }

  const active = detectActiveOperation({
    projectsRoot,
    slug,
    runtimePath,
    currentOperationReader: options.currentOperationReader
  });
  const source = validateSourceRecoveryPoint({ projectsRoot, slug, snapshotId });
  const artifactValidation = await validateRecoveryArtifacts(source, options || {});
  const currentWordPressBytes = options.currentSiteEstimator
    ? options.currentSiteEstimator({ runtimePath, slug })
    : countCurrentWordPressBytes(runtimePath);
  const availableBytes = probeFreeSpace(projectsRoot, options || {});
  const disk = calculateDiskPlan({
    artifactBytes: artifactValidation.artifactBytes,
    filesystemUncompressedBytes: artifactValidation.filesystemUncompressedBytes,
    databaseBytes: source.artifacts.database.artifact.size_bytes,
    currentDatabaseBytes: source.artifacts.database.artifact.size_bytes,
    currentWordPressBytes,
    availableBytes
  });
  const rescue = evaluateRescueStrategy(disk);
  const blockers = active
    ? ["active_mutation_operation"]
    : [];
  if (active) {
    rescue.readiness = "blocked";
    rescue.rescue_strategy = rescue.rescue_strategy === "full_required" ? "full_required" : rescue.rescue_strategy;
  }
  if (rescue.rescue_strategy === "blocked") {
    throw createRestoreError("restore_disk_space_insufficient", "Restore planning requires more disk space.", 507, {
      disk: {
        available_bytes: disk.available_bytes,
        required_restore_bytes: disk.required_restore_bytes,
        required_full_rescue_bytes: disk.required_full_rescue_bytes,
        minimum_reserve_bytes: disk.minimum_reserve_bytes
      }
    });
  }
  if (active) {
    throw createRestoreError("restore_active_operation", "A project mutation operation is active.", 409, {
      active_operation: {
        operation_id: active.operation_id || null,
        operation_type: active.operation_type || null,
        status: active.status || "unknown",
        stage: active.stage || null
      }
    });
  }

  const plan = makePlan({
    slug,
    snapshotId,
    manifest: source.manifest,
    summary: source.summary,
    binding: source.binding,
    disk,
    rescue,
    idempotencyKey,
    requestFingerprint,
    clock: options.clock,
    idGenerator: options.idGenerator
  });
  writePlanRecord({
    runtimePath,
    plan,
    planPersistenceAdapter: options.planPersistenceAdapter,
    writeJsonAtomic: options.writeJsonAtomic
  });
  return {
    plan,
    summary: plan.browser_safe_summary,
    idempotentReplay: false
  };
}

function readRestorePlan(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const slug = validateExplicitSlug(options && options.slug);
  const projectState = normalizeProject(projectsRoot, slug);
  const runtimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const planId = validateRestorePlanId(options && options.planId);
  const plan = readPlanRecord({
    runtimePath,
    planId,
    planPersistenceAdapter: options.planPersistenceAdapter
  });
  if (plan.schema !== RESTORE_PLAN_SCHEMA || plan.schema_version !== RESTORE_PLAN_SCHEMA_VERSION || plan.project_slug !== slug) {
    throw createRestoreError("restore_plan_not_found", "Restore plan was not found.", 404);
  }
  if (Date.parse(plan.expires_at) <= (options.clock ? options.clock() : Date.now())) {
    throw createRestoreError("restore_plan_expired", "Restore plan has expired.", 410);
  }
  if (options.validateSource === true) {
    const source = validateSourceRecoveryPoint({
      projectsRoot,
      slug,
      snapshotId: plan.snapshot_id
    });
    for (const type of REQUIRED_ARTIFACTS) {
      const artifact = getArtifact(source.manifest, type);
      const artifactPath = resolveArtifactPath(source.context.snapshotDirectory, artifact);
      verifyArtifactBytes(artifact, artifactPath, {});
    }
    const fingerprint = buildFingerprint({
      projectBinding: source.binding,
      snapshotId: plan.snapshot_id,
      manifest: source.manifest
    });
    if (fingerprintDigest(fingerprint) !== plan.immutable_source_fingerprint.digest) {
      throw createRestoreError("restore_artifact_digest_mismatch", "Recovery Point source changed after planning.", 409);
    }
  }
  return {
    plan,
    summary: plan.browser_safe_summary
  };
}

async function loadRestorePlanForExecution(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const slug = validateExplicitSlug(options && options.slug);
  const projectState = normalizeProject(projectsRoot, slug);
  const runtimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const planId = validateRestorePlanId(options && options.planId);
  const plan = readPlanRecord({
    runtimePath,
    planId,
    planPersistenceAdapter: options && options.planPersistenceAdapter
  });
  if (plan.schema !== RESTORE_PLAN_SCHEMA || plan.schema_version !== RESTORE_PLAN_SCHEMA_VERSION || plan.project_slug !== slug) {
    throw createRestoreError("restore_plan_not_found", "Restore plan was not found.", 404);
  }
  if (Date.parse(plan.expires_at) <= (options && options.clock ? options.clock() : Date.now())) {
    throw createRestoreError("restore_plan_expired", "Restore plan has expired.", 410);
  }
  if (plan.readiness !== "ready") {
    throw createRestoreError("restore_plan_not_ready", "Restore plan is not ready for execution.", 409);
  }
  if (plan.rescue_strategy === "none_emergency") {
    throw createRestoreError("restore_emergency_not_supported", "Emergency no-rescue restore execution is not available yet.", 409);
  }
  if (plan.rescue_strategy !== "full_required" && plan.rescue_strategy !== "lightweight_required") {
    throw createRestoreError("restore_rescue_strategy_unsupported", "Restore plan rescue strategy is not supported for execution.", 409);
  }
  if (String(options && options.exactConfirmation || "") !== String(plan.confirmation && plan.confirmation.phrase || "")) {
    throw createRestoreError("restore_confirmation_mismatch", "Restore confirmation text does not match.", 409);
  }

  const source = validateSourceRecoveryPoint({
    projectsRoot,
    slug,
    snapshotId: plan.snapshot_id
  });
  const artifactValidation = await validateRecoveryArtifacts(source, options || {});
  const fingerprint = buildFingerprint({
    projectBinding: source.binding,
    snapshotId: plan.snapshot_id,
    manifest: source.manifest
  });
  if (fingerprintDigest(fingerprint) !== plan.immutable_source_fingerprint.digest) {
    throw createRestoreError("restore_artifact_digest_mismatch", "Recovery Point source changed after planning.", 409);
  }

  const currentWordPressBytes = options && options.currentSiteEstimator
    ? options.currentSiteEstimator({ runtimePath, slug })
    : countCurrentWordPressBytes(runtimePath);
  const availableBytes = probeFreeSpace(projectsRoot, options || {});
  const disk = calculateDiskPlan({
    artifactBytes: artifactValidation.artifactBytes,
    filesystemUncompressedBytes: artifactValidation.filesystemUncompressedBytes,
    databaseBytes: source.artifacts.database.artifact.size_bytes,
    currentDatabaseBytes: source.artifacts.database.artifact.size_bytes,
    currentWordPressBytes,
    availableBytes
  });
  const rescue = evaluateRescueStrategy(disk);
  const currentSupportsFull = rescue.readiness === "ready" && rescue.rescue_strategy === "full_required";
  const currentSupportsLightweight = disk.available_bytes >= disk.required_restore_bytes + disk.lightweight_rescue_bytes;
  if (plan.rescue_strategy === "full_required" && !currentSupportsFull) {
    throw createRestoreError("restore_disk_space_insufficient", "Restore execution requires current full-rescue disk space.", 507, {
      disk: {
        available_bytes: disk.available_bytes,
        required_full_rescue_bytes: disk.required_full_rescue_bytes,
        minimum_reserve_bytes: disk.minimum_reserve_bytes
      }
    });
  }
  if (plan.rescue_strategy === "lightweight_required" && !currentSupportsLightweight) {
    throw createRestoreError("restore_disk_space_insufficient", "Restore execution requires current lightweight rescue disk space.", 507, {
      disk: {
        available_bytes: disk.available_bytes,
        required_restore_bytes: disk.required_restore_bytes,
        lightweight_rescue_bytes: disk.lightweight_rescue_bytes,
        minimum_reserve_bytes: disk.minimum_reserve_bytes
      }
    });
  }

  return {
    plan,
    source,
    disk,
    artifactValidation,
    summary: plan.browser_safe_summary
  };
}

module.exports = {
  FIXED_SAFETY_RESERVE_BYTES,
  RESTORE_PLAN_DIRECTORY,
  RESTORE_PLAN_SCHEMA,
  RESTORE_PLAN_SCHEMA_VERSION,
  RESTORE_PLAN_TTL_MS,
  buildBrowserSafeSummary,
  buildRequestFingerprint,
  calculateDiskPlan,
  createRestorePlan,
  evaluateRescueStrategy,
  generateRestorePlanId,
  getRestorePlanDirectory,
  getRestorePlanPath,
  loadRestorePlanForExecution,
  readRestorePlan,
  validateRestorePlanId
};
