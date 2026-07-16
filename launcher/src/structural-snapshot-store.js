"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  ensureDirectory,
  readProjectBySlug,
  resolveProjectsRoot,
  validateExplicitSlug
} = require("./project-store");

const MANIFEST_SCHEMA_VERSION = 1;
const RECOVERY_ROOT_DIRECTORY = ".factory-recovery";
const SNAPSHOT_DIRECTORY = "snapshots";
const MANIFEST_FILE_NAME = "manifest.json";
const SNAPSHOT_ID_PREFIX = "snapshot";
const DEFAULT_CUSTOMER_LABEL = "Recovery Point";
const SNAPSHOT_TIERS = new Set(["local_rescue", "portable_structural"]);
const STATUSES = new Set([
  "creating",
  "complete",
  "verified",
  "incomplete",
  "corrupt",
  "restoring",
  "restored",
  "restore_failed"
]);
const STATUS_TRANSITIONS = new Map([
  ["creating", new Set(["complete", "incomplete"])],
  ["complete", new Set(["verified", "corrupt", "incomplete"])],
  ["verified", new Set(["restoring"])],
  ["restoring", new Set(["restored", "restore_failed"])]
]);
const REQUIRED_STRUCTURAL_COMPONENTS = [
  "logical_database_dump",
  "wordpress_filesystem",
  "sanitized_project_metadata",
  "dependency_theme_plugin_identities",
  "agent_version_binding"
];
const REQUIRED_RESTORABLE_ARTIFACT_TYPES = [
  "database_dump",
  "wordpress_filesystem",
  "project_metadata"
];
const SAFE_ARTIFACT_TYPES = new Set([
  "database_dump",
  "wordpress_filesystem",
  "wordpress_filesystem_archive",
  "project_metadata",
  "dependency_identity_manifest",
  "agent_binding_manifest"
]);
const SAFE_DIGEST_ALGORITHMS = new Set(["sha256", "sha384", "sha512"]);
const SAFE_CAPTURE_STATUSES = new Set(["pending", "captured", "verified", "missing", "failed"]);
const ALLOWED_MANIFEST_FIELDS = new Set([
  "schema_version",
  "snapshot_id",
  "project_slug",
  "project_identity_fingerprint",
  "project_binding_key",
  "project_binding_basis",
  "status",
  "created_at",
  "updated_at",
  "snapshot_tier",
  "customer_label",
  "source_operation_id",
  "consistency_mode",
  "captured_components",
  "excluded_components",
  "artifacts",
  "software",
  "verification",
  "restore_compatibility",
  "restore_result",
  "provenance"
]);
const REQUIRED_MANIFEST_FIELDS = [
  "schema_version",
  "snapshot_id",
  "project_slug",
  "project_identity_fingerprint",
  "status",
  "created_at",
  "updated_at",
  "snapshot_tier",
  "customer_label",
  "source_operation_id",
  "consistency_mode",
  "captured_components",
  "excluded_components",
  "artifacts",
  "software",
  "verification",
  "restore_compatibility",
  "provenance"
];
const FORBIDDEN_KEY_PATTERNS = [
  "signing_secret",
  "password",
  "database_password",
  "application_password",
  "authorization",
  "bearer",
  "access_token",
  "refresh_token",
  "provider_token",
  "license_key",
  "sublicense",
  "cookie",
  "package_url",
  "signed_url",
  "headers",
  "credential",
  "env_content",
  "sql_content",
  "package_bytes",
  "lock_data",
  "absolute_path"
];
const FORBIDDEN_VALUE_PATTERNS = [
  /\bAuthorization\b/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /(?:access_token|refresh_token|provider_token|license_key|password)=/i,
  /X-Amz-Signature=/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/i
];

function nowIso() {
  return new Date().toISOString();
}

function timestampCompact(date) {
  return (date || new Date()).toISOString().replace(/[:.]/g, "-");
}

function createStoreError(message, code, statusCode, extras) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode || 400;
  if (extras && typeof extras === "object") {
    Object.assign(error, extras);
  }
  return error;
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

function hashObject(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  return child === parent || child.startsWith(parent + path.sep);
}

function assertNoControlCharacters(value, code) {
  if (/[\u0000-\u001f\u007f]/.test(String(value || ""))) {
    throw createStoreError("Recovery metadata contains unsafe control characters.", code || "unsafe_control_character", 400);
  }
}

function decodedPathLooksUnsafe(value) {
  let decoded = String(value || "");
  for (let index = 0; index < 2; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        break;
      }
      decoded = next;
    } catch (error) {
      break;
    }
  }
  return decoded !== value && /(?:^|[\\/])\.\.(?:[\\/]|$)|[\\/]|:/.test(decoded);
}

function resolveRecoveryRoot(projectsRoot) {
  const root = resolveProjectsRoot(projectsRoot);
  const recoveryRoot = path.join(root, RECOVERY_ROOT_DIRECTORY, SNAPSHOT_DIRECTORY);
  if (!isPathInside(root, recoveryRoot)) {
    throw createStoreError("Recovery root escaped the projects root.", "recovery_root_escape", 500);
  }
  return recoveryRoot;
}

function resolveKnownProject(slug, projectsRoot) {
  let safeSlug;
  try {
    safeSlug = validateExplicitSlug(slug);
  } catch (error) {
    throw createStoreError("Project slug is invalid.", "invalid_project_slug", 400);
  }

  try {
    return readProjectBySlug(safeSlug, projectsRoot);
  } catch (error) {
    throw createStoreError("Project not found.", "project_not_found", 404);
  }
}

function deriveProjectBinding(project) {
  const safeProject = safeObject(project);
  const slug = validateExplicitSlug(safeProject.slug);
  const hasProjectId = typeof safeProject.project_id === "string" && safeProject.project_id.trim() !== "";
  const bindingBasis = hasProjectId
    ? {
      kind: "local_rescue_project_id_v1",
      project_id: safeProject.project_id,
      slug
    }
    : {
      kind: "local_rescue_legacy_project_metadata_v1",
      slug,
      site_name: String(safeProject.site_name || ""),
      wp_port: Number(safeProject.wp_port || 0),
      created_at: String(safeProject.created_at || "")
    };
  const fingerprint = hashObject(bindingBasis);
  return {
    slug,
    fingerprint,
    binding_key: slug + "-" + fingerprint.slice(0, 16),
    basis: bindingBasis.kind
  };
}

function generateSnapshotId(date) {
  return SNAPSHOT_ID_PREFIX + "-" + timestampCompact(date).toLowerCase() + "-" + crypto.randomBytes(6).toString("hex");
}

function validateSnapshotId(snapshotId) {
  const value = String(snapshotId || "").trim();
  assertNoControlCharacters(value, "invalid_snapshot_id");
  if (decodedPathLooksUnsafe(value)) {
    throw createStoreError("Snapshot ID is invalid.", "invalid_snapshot_id", 400);
  }
  if (!/^snapshot-\d{4}-\d{2}-\d{2}t\d{2}-\d{2}-\d{2}-\d{3}z-[a-f0-9]{12}$/.test(value)) {
    throw createStoreError("Snapshot ID is invalid.", "invalid_snapshot_id", 400);
  }
  if (/[\\/:\s.]/.test(value)) {
    throw createStoreError("Snapshot ID is invalid.", "invalid_snapshot_id", 400);
  }
  return value;
}

function resolveSnapshotDirectory(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = resolveKnownProject(options.slug, projectsRoot);
  const binding = deriveProjectBinding(projectState.project);
  const recoveryRoot = resolveRecoveryRoot(projectsRoot);
  const projectDirectory = path.join(recoveryRoot, binding.binding_key);
  const snapshotId = options.snapshotId == null ? null : validateSnapshotId(options.snapshotId);
  const snapshotDirectory = snapshotId ? path.join(projectDirectory, snapshotId) : null;

  if (!isPathInside(recoveryRoot, projectDirectory)) {
    throw createStoreError("Project recovery binding escaped the recovery root.", "recovery_binding_escape", 500);
  }
  if (snapshotDirectory && !isPathInside(projectDirectory, snapshotDirectory)) {
    throw createStoreError("Snapshot directory escaped the project recovery binding.", "snapshot_directory_escape", 400);
  }
  if (isPathInside(projectState.runtimePath, projectDirectory) || isPathInside(path.join(projectState.runtimePath, "wordpress"), projectDirectory)) {
    throw createStoreError("Recovery storage cannot be placed inside a project directory.", "recovery_storage_inside_project", 500);
  }

  return {
    projectsRoot,
    projectState,
    project: projectState.project,
    binding,
    recoveryRoot,
    projectDirectory,
    snapshotId,
    snapshotDirectory,
    manifestPath: snapshotDirectory ? path.join(snapshotDirectory, MANIFEST_FILE_NAME) : null
  };
}

function normalizeStringArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw createStoreError("Snapshot manifest field is invalid.", "snapshot_manifest_invalid", 400, { field: fieldName });
  }
  return value.map((entry) => {
    const safeEntry = String(entry || "").trim();
    if (!safeEntry || !/^[a-z0-9_:-]+$/.test(safeEntry)) {
      throw createStoreError("Snapshot manifest field is invalid.", "snapshot_manifest_invalid", 400, { field: fieldName });
    }
    return safeEntry;
  });
}

function normalizeRelativeArtifactFilename(filename) {
  const raw = String(filename || "").trim();
  assertNoControlCharacters(raw, "invalid_artifact_path");
  if (decodedPathLooksUnsafe(raw)) {
    throw createStoreError("Artifact path is unsafe.", "invalid_artifact_path", 400);
  }
  if (!raw || raw.includes("\\") || raw.includes(":") || raw.startsWith("/") || raw.startsWith("~")) {
    throw createStoreError("Artifact path is unsafe.", "invalid_artifact_path", 400);
  }
  if (path.win32.isAbsolute(raw) || path.posix.isAbsolute(raw) || raw.startsWith("//")) {
    throw createStoreError("Artifact path is unsafe.", "invalid_artifact_path", 400);
  }
  const parts = raw.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw createStoreError("Artifact path is unsafe.", "invalid_artifact_path", 400);
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw createStoreError("Artifact path is unsafe.", "invalid_artifact_path", 400);
  }
  return normalized;
}

function urlContainsCredentials(value) {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      return true;
    }
    for (const key of parsed.searchParams.keys()) {
      if (/(?:token|signature|password|secret|credential|license|key)$/i.test(key)) {
        return true;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

function assertNoForbiddenMetadata(value, trail) {
  const safeTrail = Array.isArray(trail) ? trail : [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenMetadata(entry, safeTrail.concat(String(index))));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      const normalizedKey = String(key || "").toLowerCase();
      if (FORBIDDEN_KEY_PATTERNS.some((pattern) => normalizedKey.includes(pattern))) {
        throw createStoreError("Snapshot manifest contains forbidden metadata.", "snapshot_manifest_forbidden_metadata", 400, {
          field: safeTrail.concat(key).join(".")
        });
      }
      assertNoForbiddenMetadata(entry, safeTrail.concat(key));
    }
    return;
  }
  if (typeof value === "string") {
    if (FORBIDDEN_VALUE_PATTERNS.some((pattern) => pattern.test(value)) || urlContainsCredentials(value)) {
      throw createStoreError("Snapshot manifest contains forbidden metadata.", "snapshot_manifest_forbidden_metadata", 400, {
        field: safeTrail.join(".")
      });
    }
  }
}

function normalizeArtifact(artifact) {
  const item = safeObject(artifact);
  const type = String(item.type || "").trim();
  const digestAlgorithm = String(item.digest_algorithm || "").trim().toLowerCase();
  const digest = String(item.digest || "").trim().toLowerCase();
  const sizeBytes = Number(item.size_bytes);
  const captureStatus = String(item.capture_status || "").trim();
  if (!SAFE_ARTIFACT_TYPES.has(type)) {
    throw createStoreError("Artifact metadata is invalid.", "snapshot_manifest_invalid_artifact", 400);
  }
  if (!SAFE_DIGEST_ALGORITHMS.has(digestAlgorithm) || !/^[a-f0-9]{64,128}$/.test(digest)) {
    throw createStoreError("Artifact digest metadata is invalid.", "snapshot_manifest_invalid_artifact", 400);
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw createStoreError("Artifact size metadata is invalid.", "snapshot_manifest_invalid_artifact", 400);
  }
  if (!SAFE_CAPTURE_STATUSES.has(captureStatus)) {
    throw createStoreError("Artifact capture status is invalid.", "snapshot_manifest_invalid_artifact", 400);
  }
  return {
    type,
    relative_filename: normalizeRelativeArtifactFilename(item.relative_filename),
    digest_algorithm: digestAlgorithm,
    digest,
    size_bytes: sizeBytes,
    capture_status: captureStatus
  };
}

function normalizeVerification(value) {
  const verification = safeObject(value);
  return {
    status: String(verification.status || "not_verified"),
    successful: verification.successful === true,
    verified_at: verification.verified_at || null,
    checks: Array.isArray(verification.checks) ? verification.checks.map((entry) => String(entry || "")).filter(Boolean) : [],
    warnings: Array.isArray(verification.warnings) ? verification.warnings.map((entry) => String(entry || "")).filter(Boolean) : []
  };
}

function normalizeRestoreCompatibility(value) {
  const compatibility = safeObject(value);
  return {
    status: String(compatibility.status || "not_evaluated"),
    blocking: compatibility.blocking === true,
    blockers: Array.isArray(compatibility.blockers) ? compatibility.blockers.map((entry) => String(entry || "")).filter(Boolean) : [],
    warnings: Array.isArray(compatibility.warnings) ? compatibility.warnings.map((entry) => String(entry || "")).filter(Boolean) : []
  };
}

function normalizeRestoreResult(value) {
  if (value == null) {
    return null;
  }
  const result = safeObject(value);
  return {
    status: String(result.status || ""),
    successful: result.successful === true,
    restored_at: result.restored_at || null,
    restore_plan_id: result.restore_plan_id || null
  };
}

function buildManifest(projectState, binding, input) {
  const now = input.created_at || nowIso();
  const snapshotId = validateSnapshotId(input.snapshot_id || generateSnapshotId());
  const tier = String(input.snapshot_tier || "local_rescue").trim();
  if (!SNAPSHOT_TIERS.has(tier)) {
    throw createStoreError("Snapshot tier is unsupported.", "unsupported_snapshot_tier", 400);
  }
  const status = String(input.status || "creating").trim();
  if (status !== "creating") {
    throw createStoreError("New structural snapshot records must begin as creating.", "snapshot_initial_status_invalid", 400);
  }

  return validateManifest({
    schema_version: MANIFEST_SCHEMA_VERSION,
    snapshot_id: snapshotId,
    project_slug: binding.slug,
    project_identity_fingerprint: binding.fingerprint,
    project_binding_key: binding.binding_key,
    project_binding_basis: binding.basis,
    status,
    created_at: now,
    updated_at: input.updated_at || now,
    snapshot_tier: tier,
    customer_label: String(input.customer_label || DEFAULT_CUSTOMER_LABEL),
    source_operation_id: input.source_operation_id || null,
    consistency_mode: String(input.consistency_mode || "metadata_only_no_artifacts"),
    captured_components: normalizeStringArray(input.captured_components || [], "captured_components"),
    excluded_components: normalizeStringArray(input.excluded_components || [], "excluded_components"),
    artifacts: Array.isArray(input.artifacts) ? input.artifacts.map(normalizeArtifact) : [],
    software: safeObject(input.software),
    verification: normalizeVerification(input.verification),
    restore_compatibility: normalizeRestoreCompatibility(input.restore_compatibility),
    restore_result: normalizeRestoreResult(input.restore_result),
    provenance: Object.assign({
      source: "launcher_structural_snapshot_store_20a2"
    }, safeObject(input.provenance))
  }, {
    expectedProjectSlug: projectState.project.slug,
    expectedProjectIdentityFingerprint: binding.fingerprint,
    requireCreatingStatus: true
  });
}

function requireManifestFields(raw) {
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, field)) {
      throw createStoreError("Snapshot manifest is missing a required field.", "snapshot_manifest_missing_field", 400, {
        field
      });
    }
  }
}

function validateManifest(manifest, options) {
  const raw = safeObject(manifest);
  requireManifestFields(raw);
  for (const field of Object.keys(raw)) {
    if (!ALLOWED_MANIFEST_FIELDS.has(field)) {
      throw createStoreError("Snapshot manifest contains an unsupported field.", "snapshot_manifest_unsupported_field", 400, {
        field
      });
    }
  }
  assertNoForbiddenMetadata(raw, []);
  if (Number(raw.schema_version) !== MANIFEST_SCHEMA_VERSION) {
    throw createStoreError("Snapshot manifest schema is unsupported.", "snapshot_manifest_unsupported_schema", 400);
  }

  const snapshotId = validateSnapshotId(raw.snapshot_id);
  const projectSlug = validateExplicitSlug(raw.project_slug);
  if (options && options.expectedProjectSlug && projectSlug !== options.expectedProjectSlug) {
    throw createStoreError("Snapshot manifest does not belong to this project.", "snapshot_project_mismatch", 409);
  }
  const fingerprint = String(raw.project_identity_fingerprint || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw createStoreError("Snapshot project identity fingerprint is invalid.", "snapshot_manifest_invalid", 400);
  }
  if (options && options.expectedProjectIdentityFingerprint && fingerprint !== options.expectedProjectIdentityFingerprint) {
    throw createStoreError("Snapshot project binding does not match this project.", "snapshot_project_binding_mismatch", 409);
  }
  const status = String(raw.status || "").trim();
  if (!STATUSES.has(status)) {
    throw createStoreError("Snapshot status is unsupported.", "snapshot_status_invalid", 400);
  }
  if (options && options.requireCreatingStatus === true && status !== "creating") {
    throw createStoreError("New structural snapshot records must begin as creating.", "snapshot_initial_status_invalid", 400);
  }
  const tier = String(raw.snapshot_tier || "").trim();
  if (!SNAPSHOT_TIERS.has(tier)) {
    throw createStoreError("Snapshot tier is unsupported.", "unsupported_snapshot_tier", 400);
  }
  if (!Array.isArray(raw.artifacts)) {
    throw createStoreError("Snapshot artifact metadata must be a list.", "snapshot_manifest_invalid_artifact", 400);
  }

  const verification = normalizeVerification(raw.verification);
  const restoreCompatibility = normalizeRestoreCompatibility(raw.restore_compatibility);
  const restoreResult = normalizeRestoreResult(raw.restore_result);
  if (status === "verified" && verification.successful !== true) {
    throw createStoreError("Verified snapshots require successful verification metadata.", "snapshot_verified_requires_verification", 409);
  }
  if (status === "restored" && (!restoreResult || restoreResult.successful !== true)) {
    throw createStoreError("Restored snapshots require successful restore metadata.", "snapshot_restored_requires_restore_metadata", 409);
  }

  return Object.assign({}, raw, {
    snapshot_id: snapshotId,
    project_slug: projectSlug,
    project_identity_fingerprint: fingerprint,
    status,
    snapshot_tier: tier,
    customer_label: String(raw.customer_label || DEFAULT_CUSTOMER_LABEL),
    source_operation_id: raw.source_operation_id || null,
    captured_components: normalizeStringArray(raw.captured_components, "captured_components"),
    excluded_components: normalizeStringArray(raw.excluded_components, "excluded_components"),
    artifacts: raw.artifacts.map(normalizeArtifact),
    software: safeObject(raw.software),
    verification,
    restore_compatibility: restoreCompatibility,
    restore_result: restoreResult,
    provenance: safeObject(raw.provenance)
  });
}

function ensureNoReparsePoint(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    throw createStoreError("Recovery store path cannot be a symbolic link.", "recovery_reparse_point_rejected", 409);
  }
}

function writeJsonAtomic(filePath, value, options) {
  ensureDirectory(path.dirname(filePath));
  ensureNoReparsePoint(path.dirname(filePath));
  const tmpPath = filePath + ".tmp-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
  const payload = JSON.stringify(value, null, 2) + "\n";
  let fd = null;
  try {
    fd = fs.openSync(tmpPath, "wx");
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    if (options && options.failBeforePromotion === true) {
      throw createStoreError("Simulated manifest promotion failure.", "snapshot_manifest_write_failed", 500);
    }
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (closeError) {
        // Preserve the original write failure.
      }
    }
    try {
      if (fs.existsSync(tmpPath)) {
        fs.rmSync(tmpPath, { force: true });
      }
    } catch (cleanupError) {
      // A leftover temp file is not a valid manifest.
    }
    throw error;
  }
}

function createManifestRecord(options) {
  const context = resolveSnapshotDirectory({
    projectsRoot: options.projectsRoot,
    slug: options.slug,
    snapshotId: options.snapshotId || generateSnapshotId()
  });
  const manifest = buildManifest(context.projectState, context.binding, Object.assign({}, safeObject(options.manifest), {
    snapshot_id: context.snapshotId
  }));

  ensureDirectory(context.projectDirectory);
  try {
    fs.mkdirSync(context.snapshotDirectory);
  } catch (error) {
    if (error && error.code === "EEXIST") {
      throw createStoreError("Snapshot ID already exists for this project.", "snapshot_id_conflict", 409);
    }
    throw createStoreError("Snapshot directory could not be created.", "snapshot_store_write_failed", 500);
  }

  try {
    writeJsonAtomic(context.manifestPath, manifest, {
      failBeforePromotion: options.failBeforePromotion === true
    });
  } catch (error) {
    try {
      fs.rmSync(context.snapshotDirectory, { recursive: true, force: true });
    } catch (cleanupError) {
      // A snapshot directory without manifest.json is never restorable.
    }
    if (error && error.code) {
      throw error;
    }
    throw createStoreError("Snapshot manifest could not be written.", "snapshot_store_write_failed", 500);
  }

  return {
    manifest,
    summary: toBrowserSafeSummary(manifest)
  };
}

function readManifest(options) {
  const context = resolveSnapshotDirectory(options);
  if (!fs.existsSync(context.manifestPath)) {
    throw createStoreError("Snapshot was not found.", "snapshot_not_found", 404);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(context.manifestPath, "utf8"));
  } catch (error) {
    throw createStoreError("Snapshot manifest is malformed.", "snapshot_manifest_malformed", 409);
  }
  return validateManifest(parsed, {
    expectedProjectSlug: context.binding.slug,
    expectedProjectIdentityFingerprint: context.binding.fingerprint
  });
}

function readManifestForList(context, snapshotId) {
  const manifestPath = path.join(context.projectDirectory, snapshotId, MANIFEST_FILE_NAME);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return {
      manifest: validateManifest(parsed, {
        expectedProjectSlug: context.binding.slug,
        expectedProjectIdentityFingerprint: context.binding.fingerprint
      }),
      mtimeMs: fs.statSync(manifestPath).mtimeMs,
      corrupt: false
    };
  } catch (error) {
    return {
      snapshotId,
      mtimeMs: fs.existsSync(manifestPath) ? fs.statSync(manifestPath).mtimeMs : 0,
      corrupt: true
    };
  }
}

function listManifests(options) {
  const context = resolveSnapshotDirectory({
    projectsRoot: options.projectsRoot,
    slug: options.slug
  });
  if (!fs.existsSync(context.projectDirectory)) {
    return [];
  }

  return fs.readdirSync(context.projectDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      try {
        validateSnapshotId(entry.name);
        return true;
      } catch (error) {
        return false;
      }
    })
    .map((entry) => readManifestForList(context, entry.name))
    .filter(Boolean)
    .map((entry) => entry.corrupt
      ? {
        snapshot_id: entry.snapshotId,
        customer_label: DEFAULT_CUSTOMER_LABEL,
        created_at: null,
        status: "corrupt",
        snapshot_tier: null,
        captured_components: [],
        verification_state: "corrupt",
        restorable: false,
        total_size_bytes: 0,
        compatibility: {
          status: "blocked",
          blocking: true,
          blockers: ["manifest_corrupt"]
        },
        source_operation: null,
        corrupt: true,
        _sortTime: entry.mtimeMs
      }
      : Object.assign(toBrowserSafeSummary(entry.manifest), {
        _sortTime: Date.parse(entry.manifest.created_at || "") || entry.mtimeMs
      }))
    .sort((left, right) => Number(right._sortTime || 0) - Number(left._sortTime || 0))
    .map((entry) => {
      const safe = Object.assign({}, entry);
      delete safe._sortTime;
      return safe;
    });
}

function statusTransitionAllowed(fromStatus, toStatus) {
  if (fromStatus === toStatus) {
    return true;
  }
  const allowed = STATUS_TRANSITIONS.get(fromStatus);
  return Boolean(allowed && allowed.has(toStatus));
}

function transitionManifestStatus(options) {
  const current = readManifest(options);
  const nextStatus = String(options.status || "").trim();
  if (!STATUSES.has(nextStatus)) {
    throw createStoreError("Snapshot status is unsupported.", "snapshot_status_invalid", 400);
  }
  if (!statusTransitionAllowed(current.status, nextStatus)) {
    throw createStoreError("Snapshot status transition is not allowed.", "snapshot_status_transition_invalid", 409);
  }

  const patch = safeObject(options.patch);
  const next = Object.assign({}, current, patch, {
    snapshot_id: current.snapshot_id,
    project_slug: current.project_slug,
    project_identity_fingerprint: current.project_identity_fingerprint,
    project_binding_key: current.project_binding_key,
    project_binding_basis: current.project_binding_basis,
    created_at: current.created_at,
    status: nextStatus,
    updated_at: nowIso(),
    verification: patch.verification ? normalizeVerification(patch.verification) : current.verification,
    restore_compatibility: patch.restore_compatibility
      ? normalizeRestoreCompatibility(patch.restore_compatibility)
      : current.restore_compatibility,
    restore_result: Object.prototype.hasOwnProperty.call(patch, "restore_result")
      ? normalizeRestoreResult(patch.restore_result)
      : current.restore_result
  });
  const context = resolveSnapshotDirectory(options);
  const validated = validateManifest(next, {
    expectedProjectSlug: context.binding.slug,
    expectedProjectIdentityFingerprint: context.binding.fingerprint
  });
  writeJsonAtomic(context.manifestPath, validated);
  return {
    manifest: validated,
    summary: toBrowserSafeSummary(validated)
  };
}

function isRestorable(manifest, options) {
  let checked;
  try {
    checked = validateManifest(manifest, options);
  } catch (error) {
    return false;
  }
  if (checked.status !== "verified" || checked.verification.successful !== true) {
    return false;
  }
  if (checked.status === "incomplete" || checked.status === "corrupt") {
    return false;
  }
  if (checked.restore_compatibility.blocking || checked.restore_compatibility.blockers.length > 0) {
    return false;
  }
  if (!REQUIRED_STRUCTURAL_COMPONENTS.every((component) => checked.captured_components.includes(component))) {
    return false;
  }

  const capturedArtifactTypes = new Set(
    checked.artifacts
      .filter((artifact) => artifact.capture_status === "captured" || artifact.capture_status === "verified")
      .map((artifact) => artifact.type)
  );
  if (capturedArtifactTypes.has("wordpress_filesystem_archive")) {
    capturedArtifactTypes.add("wordpress_filesystem");
  }
  return REQUIRED_RESTORABLE_ARTIFACT_TYPES.every((type) => capturedArtifactTypes.has(type));
}

function componentLabel(component) {
  const labels = {
    logical_database_dump: "Database",
    wordpress_filesystem: "WordPress files",
    sanitized_project_metadata: "Project metadata",
    dependency_theme_plugin_identities: "Dependencies",
    agent_version_binding: "Agent binding"
  };
  return labels[component] || component.replace(/_/g, " ");
}

function toBrowserSafeSummary(manifest) {
  const checked = validateManifest(manifest);
  return {
    snapshot_id: checked.snapshot_id,
    customer_label: checked.customer_label || DEFAULT_CUSTOMER_LABEL,
    created_at: checked.created_at,
    updated_at: checked.updated_at,
    status: checked.status,
    snapshot_tier: checked.snapshot_tier,
    captured_components: checked.captured_components.map(componentLabel),
    verification_state: checked.verification.successful ? "verified" : checked.verification.status,
    restorable: isRestorable(checked),
    total_size_bytes: checked.artifacts.reduce((total, artifact) => total + artifact.size_bytes, 0),
    compatibility: {
      status: checked.restore_compatibility.status,
      blocking: checked.restore_compatibility.blocking,
      blockers: checked.restore_compatibility.blockers.slice()
    },
    source_operation: checked.source_operation_id ? {
      operation_id: checked.source_operation_id
    } : null
  };
}

module.exports = {
  DEFAULT_CUSTOMER_LABEL,
  MANIFEST_SCHEMA_VERSION,
  REQUIRED_RESTORABLE_ARTIFACT_TYPES,
  REQUIRED_STRUCTURAL_COMPONENTS,
  STATUSES,
  createManifestRecord,
  deriveProjectBinding,
  generateSnapshotId,
  isRestorable,
  listManifests,
  normalizeRelativeArtifactFilename,
  readManifest,
  resolveRecoveryRoot,
  resolveSnapshotDirectory,
  toBrowserSafeSummary,
  transitionManifestStatus,
  validateManifest,
  validateSnapshotId
};
