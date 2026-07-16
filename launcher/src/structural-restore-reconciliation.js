"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const {
  assertSafeRuntimePath,
  ensureDirectory,
  listProjects,
  readProjectBySlug,
  resolveProjectsRoot,
  writeJsonFile
} = require("./project-store");
const {
  acquireProjectLock
} = require("./project-operation-coordinator");
const {
  DB_SERVICE
} = require("./structural-snapshot-db-capture");
const {
  deriveProjectBinding,
  readManifest,
  toBrowserSafeSummary
} = require("./structural-snapshot-store");
const {
  listOperations,
  readOperationById,
  updateOperation,
  writeJsonAtomic
} = require("./project-operation-store");

const JOURNAL_SCHEMA_VERSION = 1;
const JOURNAL_FILENAME = "restore-journal.json";
const RECONCILIATION_PROOF_SCHEMA = "factory_structural_restore_reconciliation_proof";
const RECONCILIATION_PROOF_SCHEMA_VERSION = 1;
const RESTORE_WORK_DIRECTORY = path.join("runs", "restore-work");
const WORDPRESS_SERVICE = "wordpress";
const SERVICE_TIMEOUT_MS = 90000;
const REQUIRED_WORDPRESS_ENTRIES = [
  "index.php",
  "wp-admin",
  "wp-includes",
  path.join("wp-content", "plugins"),
  path.join("wp-content", "themes"),
  "wp-config.php"
];

function nowIso(clock) {
  return new Date(clock ? clock() : Date.now()).toISOString();
}

function timestampCompact(clock) {
  return nowIso(clock).replace(/[:.]/g, "-");
}

function createReconciliationError(code, message, statusCode, extras) {
  const error = new Error(message || "Structural restore reconciliation failed.");
  error.code = code;
  error.statusCode = statusCode || 500;
  if (extras && typeof extras === "object") {
    Object.assign(error, extras);
  }
  return error;
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  return child === parent || child.startsWith(parent + path.sep);
}

function assertInside(parentPath, childPath, code) {
  if (!isPathInside(parentPath, childPath)) {
    throw createReconciliationError(code || "restore_reconciliation_path_escape", "Restore reconciliation path escaped its boundary.", 500);
  }
  return childPath;
}

function safeRelative(runtimePath, absolutePath) {
  const relative = path.relative(runtimePath, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw createReconciliationError("restore_reconciliation_path_escape", "Restore reconciliation path escaped its boundary.", 500);
  }
  return relative.split(path.sep).join("/");
}

function resolveRelative(runtimePath, relativePath, code) {
  const value = String(relativePath || "");
  if (!value || value.includes("\0") || value.includes("\\") || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw createReconciliationError(code || "restore_journal_invalid_path", "Restore journal path is invalid.", 409);
  }
  return assertInside(runtimePath, path.join(runtimePath, ...value.split("/")), code || "restore_journal_path_escape");
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(64 * 1024);
  try {
    while (true) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) {
        break;
      }
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function cleanupTree(targetPath) {
  if (targetPath && fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function getRestoreWorkRoot(runtimePath, operationId) {
  return assertInside(runtimePath, path.join(runtimePath, RESTORE_WORK_DIRECTORY, String(operationId || "")), "restore_work_path_unsafe");
}

function getJournalPath(runtimePath, operationId) {
  return path.join(getRestoreWorkRoot(runtimePath, operationId), JOURNAL_FILENAME);
}

function normalizeBoolean(value) {
  return value === true;
}

function normalizeJournal(raw) {
  const journal = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return Object.assign({}, journal, {
    journal_schema_version: Number(journal.journal_schema_version || 0),
    rescue_verified: normalizeBoolean(journal.rescue_verified),
    maintenance_preexisting: normalizeBoolean(journal.maintenance_preexisting),
    maintenance_created_by_operation: normalizeBoolean(journal.maintenance_created_by_operation),
    wordpress_service_was_running: normalizeBoolean(journal.wordpress_service_was_running),
    staging_validated: normalizeBoolean(journal.staging_validated),
    rollback_tree_ready: normalizeBoolean(journal.rollback_tree_ready),
    filesystem_promotion_started: normalizeBoolean(journal.filesystem_promotion_started),
    filesystem_promotion_completed: normalizeBoolean(journal.filesystem_promotion_completed),
    database_import_started: normalizeBoolean(journal.database_import_started),
    database_import_completed: normalizeBoolean(journal.database_import_completed),
    agent_repair_completed: normalizeBoolean(journal.agent_repair_completed),
    verification_completed: normalizeBoolean(journal.verification_completed),
    cleanup_completed: normalizeBoolean(journal.cleanup_completed),
    manual_recovery_required: normalizeBoolean(journal.manual_recovery_required)
  });
}

function validateJournalIdentity(journal, context) {
  if (journal.journal_schema_version !== JOURNAL_SCHEMA_VERSION) {
    throw createReconciliationError("restore_journal_schema_unsupported", "Restore journal schema is unsupported.", 409);
  }
  if (journal.project_slug !== context.slug || journal.operation_id !== context.operationId) {
    throw createReconciliationError("restore_journal_identity_mismatch", "Restore journal identity does not match the operation.", 409);
  }
  const binding = deriveProjectBinding(context.projectState.project);
  if (!journal.project_binding || journal.project_binding.fingerprint !== binding.fingerprint || journal.project_binding.slug !== binding.slug) {
    throw createReconciliationError("restore_journal_project_binding_mismatch", "Restore journal project binding does not match.", 409);
  }
  return binding;
}

function createRestoreJournal(options) {
  const runtimePath = assertSafeRuntimePath(options.runtimePath, options.projectsRoot);
  const workRoot = getRestoreWorkRoot(runtimePath, options.operationId);
  ensureDirectory(workRoot);
  const binding = deriveProjectBinding(options.projectState.project);
  const journal = normalizeJournal({
    journal_schema_version: JOURNAL_SCHEMA_VERSION,
    project_slug: options.projectState.project.slug,
    project_binding: {
      slug: binding.slug,
      binding_key: binding.binding_key,
      fingerprint: binding.fingerprint
    },
    operation_id: options.operationId,
    restore_plan_id: options.planId,
    source_snapshot_id: options.sourceSnapshotId,
    rescue_snapshot_id: options.rescueSnapshotId || null,
    operation_request_fingerprint: options.requestFingerprint || null,
    created_at: nowIso(options.clock),
    updated_at: nowIso(options.clock),
    current_stage: options.stage || "validating_plan",
    rescue_verified: false,
    maintenance_preexisting: false,
    maintenance_created_by_operation: false,
    wordpress_service_was_running: false,
    staging_validated: false,
    rollback_tree_ready: false,
    filesystem_promotion_started: false,
    filesystem_promotion_completed: false,
    database_import_started: false,
    database_import_completed: false,
    agent_repair_completed: false,
    verification_completed: false,
    cleanup_completed: false,
    manual_recovery_required: false,
    paths: {
      work_root: safeRelative(runtimePath, workRoot),
      staging_root: safeRelative(runtimePath, path.join(workRoot, "staging")),
      rollback_root: safeRelative(runtimePath, path.join(workRoot, "rollback-wordpress")),
      promoted_source_root: safeRelative(runtimePath, path.join(workRoot, "promoted-source-wordpress")),
      live_wordpress_root: "wordpress"
    },
    wp_config_fingerprint_abbrev: null
  });
  writeRestoreJournal({ projectsRoot: options.projectsRoot, runtimePath, operationId: options.operationId, journal, clock: options.clock });
  return journal;
}

function readRestoreJournal(options) {
  const runtimePath = assertSafeRuntimePath(options.runtimePath, options.projectsRoot);
  const journalPath = getJournalPath(runtimePath, options.operationId);
  const parsed = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  return normalizeJournal(parsed);
}

function writeRestoreJournal(options) {
  const runtimePath = assertSafeRuntimePath(options.runtimePath, options.projectsRoot);
  const journalPath = getJournalPath(runtimePath, options.operationId);
  const existing = options.journal || {};
  const journal = normalizeJournal(Object.assign({}, existing, {
    updated_at: nowIso(options.clock)
  }));
  writeJsonAtomic(journalPath, journal);
  return journal;
}

function updateRestoreJournal(options, patch) {
  const current = readRestoreJournal(options);
  const next = normalizeJournal(Object.assign({}, current, patch || {}, {
    updated_at: nowIso(options.clock)
  }));
  writeRestoreJournal(Object.assign({}, options, { journal: next }));
  return next;
}

function safeProofRef(proofId) {
  return "proofs/" + proofId + ".json";
}

function writeReconciliationProof(options) {
  const proofId = "restore-reconcile-" + timestampCompact(options.clock) + "-" + crypto.randomBytes(3).toString("hex");
  const proof = {
    proof_id: proofId,
    schema: RECONCILIATION_PROOF_SCHEMA,
    schema_version: RECONCILIATION_PROOF_SCHEMA_VERSION,
    project_slug: options.projectSlug,
    operation_id: options.operationId,
    restore_plan_id: options.planId || null,
    source_snapshot_id: options.sourceSnapshotId || null,
    rescue_snapshot_id: options.rescueSnapshotId || null,
    interrupted_stage: options.interruptedStage || null,
    selected_policy: options.policy,
    actual_state_checks: options.actualStateChecks || {},
    service: options.service || {},
    maintenance: options.maintenance || {},
    filesystem_rollback_completed: options.filesystemRollbackCompleted === true,
    database_import_started: options.databaseImportStarted === true,
    manual_recovery_required: options.manualRecoveryRequired === true,
    final_operation_status: options.finalOperationStatus,
    duration_ms: options.durationMs,
    created_at: nowIso(options.clock)
  };
  const proofPath = path.join(options.runtimePath, "proofs", proofId + ".json");
  writeJsonFile(proofPath, proof);
  return {
    proof,
    proofRef: safeProofRef(proofId)
  };
}

function validateWordPressTree(rootPath) {
  for (const relative of REQUIRED_WORDPRESS_ENTRIES) {
    const target = assertInside(rootPath, path.join(rootPath, relative), "restore_reconciliation_tree_escape");
    if (!fs.existsSync(target)) {
      throw createReconciliationError("restore_reconciliation_invalid_wordpress_tree", "WordPress rollback tree is incomplete.", 409);
    }
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      throw createReconciliationError("restore_reconciliation_reparse_rejected", "WordPress rollback tree contains an unsafe link.", 409);
    }
  }
  return true;
}

function resolveJournalPaths(runtimePath, journal) {
  const paths = journal.paths && typeof journal.paths === "object" ? journal.paths : {};
  return {
    workRoot: resolveRelative(runtimePath, paths.work_root, "restore_work_path_unsafe"),
    stagingRoot: resolveRelative(runtimePath, paths.staging_root, "restore_staging_path_unsafe"),
    rollbackRoot: resolveRelative(runtimePath, paths.rollback_root, "restore_rollback_path_unsafe"),
    promotedSourceRoot: resolveRelative(runtimePath, paths.promoted_source_root, "restore_promoted_path_unsafe"),
    liveWordPressRoot: resolveRelative(runtimePath, paths.live_wordpress_root || "wordpress", "restore_live_path_unsafe")
  };
}

function runDockerCompose(runtimePath, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose"].concat(args), {
      cwd: runtimePath,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(createReconciliationError("restore_reconciliation_service_timeout", "Restore reconciliation service command timed out.", 504));
    }, options && options.timeoutMs || SERVICE_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", () => {
      clearTimeout(timeout);
      reject(createReconciliationError("restore_reconciliation_service_unavailable", "Restore reconciliation service command failed to start.", 502));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

async function defaultServiceController(action, context) {
  if (action === "isWordPressRunning") {
    const result = await runDockerCompose(context.runtimePath, ["ps", "--status", "running", WORDPRESS_SERVICE], { timeoutMs: SERVICE_TIMEOUT_MS });
    return { running: result.code === 0 && result.stdout.includes(WORDPRESS_SERVICE) };
  }
  if (action === "stopWordPress") {
    const result = await runDockerCompose(context.runtimePath, ["stop", WORDPRESS_SERVICE], { timeoutMs: SERVICE_TIMEOUT_MS });
    if (result.code !== 0) {
      throw createReconciliationError("restore_reconciliation_service_stop_failed", "Unable to stop WordPress service for reconciliation.", 502);
    }
    return { running: false };
  }
  if (action === "startWordPress") {
    const result = await runDockerCompose(context.runtimePath, ["start", WORDPRESS_SERVICE], { timeoutMs: SERVICE_TIMEOUT_MS });
    if (result.code !== 0) {
      throw createReconciliationError("restore_reconciliation_service_start_failed", "Unable to start WordPress service after reconciliation.", 502);
    }
    return { running: true };
  }
  if (action === "isMysqlRunning") {
    const result = await runDockerCompose(context.runtimePath, ["ps", "--status", "running", DB_SERVICE], { timeoutMs: SERVICE_TIMEOUT_MS });
    return { running: result.code === 0 && result.stdout.includes(DB_SERVICE) };
  }
  throw createReconciliationError("restore_reconciliation_service_action_invalid", "Restore reconciliation service action is invalid.", 500);
}

function removeOperationMaintenance(liveWordPressRoot, journal) {
  const markerPath = assertInside(liveWordPressRoot, path.join(liveWordPressRoot, ".maintenance"), "restore_reconciliation_maintenance_path_unsafe");
  if (journal.maintenance_created_by_operation && fs.existsSync(markerPath)) {
    fs.rmSync(markerPath, { force: true });
    return true;
  }
  return false;
}

function buildFailureSummary(options) {
  return {
    restore_state: options.restoreState,
    interruption_detected: true,
    reconciliation_attempted: true,
    reconciliation_succeeded: options.reconciliationSucceeded === true,
    auto_rollback_completed: options.autoRollbackCompleted === true,
    database_import_started: options.databaseImportStarted === true,
    database_import_completed: options.databaseImportCompleted === true,
    filesystem_restored_to_pre_operation_state: options.filesystemRestored === true,
    wordpress_service_running: options.wordpressServiceRunning === true,
    maintenance_remaining: options.maintenanceRemaining === true,
    rescue_snapshot_id: options.rescueSnapshotId || null,
    manual_recovery_required: options.manualRecoveryRequired === true,
    reconciliation_code: options.code,
    restore_verified: false
  };
}

function validateSnapshotStillAvailable(projectsRoot, slug, snapshotId) {
  if (!snapshotId) {
    return null;
  }
  const manifest = readManifest({ projectsRoot, slug, snapshotId });
  const summary = toBrowserSafeSummary(manifest);
  return {
    status: manifest.status,
    restorable: summary.restorable
  };
}

async function classifyManualRecovery(context, details) {
  const startedAt = Date.now();
  const proof = writeReconciliationProof({
    runtimePath: context.runtimePath,
    projectSlug: context.slug,
    operationId: context.operation.operation_id,
    planId: context.journal && context.journal.restore_plan_id,
    sourceSnapshotId: context.journal && context.journal.source_snapshot_id,
    rescueSnapshotId: context.journal && context.journal.rescue_snapshot_id,
    interruptedStage: context.operation.stage,
    policy: details.policy,
    actualStateChecks: details.actualStateChecks || {},
    service: details.service || {},
    maintenance: details.maintenance || {},
    filesystemRollbackCompleted: false,
    databaseImportStarted: details.databaseImportStarted === true,
    manualRecoveryRequired: true,
    finalOperationStatus: "failed",
    durationMs: Date.now() - startedAt,
    clock: context.clock
  });
  const updated = updateOperation({
    slug: context.slug,
    projectsRoot: context.projectsRoot,
    operationId: context.operation.operation_id,
    patch: {
      status: "failed",
      stage: "interrupted_recovery_required",
      completed_at: nowIso(context.clock),
      proof_ref: proof.proofRef,
      result_summary: buildFailureSummary({
        restoreState: "interrupted_recovery_required",
        reconciliationSucceeded: false,
        autoRollbackCompleted: false,
        databaseImportStarted: details.databaseImportStarted === true,
        databaseImportCompleted: details.databaseImportCompleted === true,
        filesystemRestored: false,
        wordpressServiceRunning: details.wordpressServiceRunning === true,
        maintenanceRemaining: details.maintenanceRemaining === true,
        rescueSnapshotId: context.journal && context.journal.rescue_snapshot_id,
        manualRecoveryRequired: true,
        code: details.code || "restore_reconciliation_manual_required"
      }),
      error: {
        code: details.code || "restore_reconciliation_manual_required",
        message: "Interrupted restore requires manual recovery.",
        stage: context.operation.stage || "interrupted"
      }
    }
  }).operation;
  return {
    action: "manual_recovery_required",
    operation: updated,
    proof: proof.proof,
    proofRef: proof.proofRef
  };
}

async function reconcilePrePromotion(context) {
  const startedAt = Date.now();
  const paths = context.paths;
  cleanupTree(paths.stagingRoot);
  removeOperationMaintenance(paths.liveWordPressRoot, context.journal);
  if (context.journal.wordpress_service_was_running) {
    await context.serviceController("startWordPress", { runtimePath: context.runtimePath });
  }
  cleanupTree(paths.workRoot);
  const service = await context.serviceController("isWordPressRunning", { runtimePath: context.runtimePath });
  const proof = writeReconciliationProof({
    runtimePath: context.runtimePath,
    projectSlug: context.slug,
    operationId: context.operation.operation_id,
    planId: context.journal.restore_plan_id,
    sourceSnapshotId: context.journal.source_snapshot_id,
    rescueSnapshotId: context.journal.rescue_snapshot_id,
    interruptedStage: context.operation.stage,
    policy: "pre_promotion_cleanup",
    actualStateChecks: { filesystem_promotion_completed: false, database_import_started: false },
    service: { wordpress_running: service.running === true },
    maintenance: { removed_operation_marker: true, remaining: fs.existsSync(path.join(paths.liveWordPressRoot, ".maintenance")) },
    filesystemRollbackCompleted: false,
    databaseImportStarted: false,
    manualRecoveryRequired: false,
    finalOperationStatus: "failed",
    durationMs: Date.now() - startedAt,
    clock: context.clock
  });
  const updated = updateOperation({
    slug: context.slug,
    projectsRoot: context.projectsRoot,
    operationId: context.operation.operation_id,
    patch: {
      status: "failed",
      stage: "interrupted_reconciled",
      completed_at: nowIso(context.clock),
      proof_ref: proof.proofRef,
      result_summary: buildFailureSummary({
        restoreState: "interrupted_reconciled",
        reconciliationSucceeded: true,
        autoRollbackCompleted: false,
        databaseImportStarted: false,
        databaseImportCompleted: false,
        filesystemRestored: true,
        wordpressServiceRunning: service.running === true,
        maintenanceRemaining: fs.existsSync(path.join(paths.liveWordPressRoot, ".maintenance")),
        rescueSnapshotId: context.journal.rescue_snapshot_id,
        manualRecoveryRequired: false,
        code: "restore_interrupted_before_promotion_reconciled"
      }),
      error: {
        code: "restore_interrupted_before_promotion_reconciled",
        message: "Interrupted restore was safely reconciled before filesystem promotion.",
        stage: context.operation.stage || "interrupted"
      }
    }
  }).operation;
  return { action: "pre_promotion_cleanup", operation: updated, proof: proof.proof, proofRef: proof.proofRef };
}

async function reconcilePromotedBeforeDb(context) {
  const startedAt = Date.now();
  const paths = context.paths;
  validateWordPressTree(paths.rollbackRoot);
  validateWordPressTree(paths.liveWordPressRoot);
  const rollbackFingerprint = sha256File(path.join(paths.rollbackRoot, "wp-config.php")).slice(0, 12);
  if (context.journal.wp_config_fingerprint_abbrev && rollbackFingerprint !== context.journal.wp_config_fingerprint_abbrev) {
    return classifyManualRecovery(context, {
      policy: "promoted_before_db_rollback",
      code: "restore_reconciliation_wp_config_mismatch",
      databaseImportStarted: false,
      databaseImportCompleted: false,
      manualRecoveryRequired: true
    });
  }
  await context.serviceController("stopWordPress", { runtimePath: context.runtimePath });
  if (fs.existsSync(paths.promotedSourceRoot)) {
    cleanupTree(paths.promotedSourceRoot);
  }
  fs.renameSync(paths.liveWordPressRoot, paths.promotedSourceRoot);
  try {
    fs.renameSync(paths.rollbackRoot, paths.liveWordPressRoot);
  } catch (error) {
    if (!fs.existsSync(paths.liveWordPressRoot) && fs.existsSync(paths.promotedSourceRoot)) {
      fs.renameSync(paths.promotedSourceRoot, paths.liveWordPressRoot);
    }
    throw error;
  }
  validateWordPressTree(paths.liveWordPressRoot);
  const liveFingerprint = sha256File(path.join(paths.liveWordPressRoot, "wp-config.php")).slice(0, 12);
  if (context.journal.wp_config_fingerprint_abbrev && liveFingerprint !== context.journal.wp_config_fingerprint_abbrev) {
    return classifyManualRecovery(context, {
      policy: "promoted_before_db_rollback",
      code: "restore_reconciliation_live_wp_config_mismatch",
      databaseImportStarted: false,
      databaseImportCompleted: false,
      manualRecoveryRequired: true
    });
  }
  cleanupTree(paths.promotedSourceRoot);
  cleanupTree(paths.stagingRoot);
  removeOperationMaintenance(paths.liveWordPressRoot, context.journal);
  if (context.journal.wordpress_service_was_running) {
    await context.serviceController("startWordPress", { runtimePath: context.runtimePath });
  }
  const service = await context.serviceController("isWordPressRunning", { runtimePath: context.runtimePath });
  if (fs.existsSync(paths.workRoot) && fs.readdirSync(paths.workRoot).filter((entry) => entry !== JOURNAL_FILENAME).length === 0) {
    fs.rmSync(paths.workRoot, { recursive: true, force: true });
  }
  const proof = writeReconciliationProof({
    runtimePath: context.runtimePath,
    projectSlug: context.slug,
    operationId: context.operation.operation_id,
    planId: context.journal.restore_plan_id,
    sourceSnapshotId: context.journal.source_snapshot_id,
    rescueSnapshotId: context.journal.rescue_snapshot_id,
    interruptedStage: context.operation.stage,
    policy: "promoted_before_db_rollback",
    actualStateChecks: {
      filesystem_promotion_completed: true,
      database_import_started: false,
      rollback_tree_valid: true,
      wp_config_fingerprint_abbrev: liveFingerprint
    },
    service: { wordpress_running: service.running === true },
    maintenance: { removed_operation_marker: true, remaining: fs.existsSync(path.join(paths.liveWordPressRoot, ".maintenance")) },
    filesystemRollbackCompleted: true,
    databaseImportStarted: false,
    manualRecoveryRequired: false,
    finalOperationStatus: "failed",
    durationMs: Date.now() - startedAt,
    clock: context.clock
  });
  const updated = updateOperation({
    slug: context.slug,
    projectsRoot: context.projectsRoot,
    operationId: context.operation.operation_id,
    patch: {
      status: "failed",
      stage: "interrupted_reconciled",
      completed_at: nowIso(context.clock),
      proof_ref: proof.proofRef,
      result_summary: buildFailureSummary({
        restoreState: "interrupted_reconciled",
        reconciliationSucceeded: true,
        autoRollbackCompleted: true,
        databaseImportStarted: false,
        databaseImportCompleted: false,
        filesystemRestored: true,
        wordpressServiceRunning: service.running === true,
        maintenanceRemaining: fs.existsSync(path.join(paths.liveWordPressRoot, ".maintenance")),
        rescueSnapshotId: context.journal.rescue_snapshot_id,
        manualRecoveryRequired: false,
        code: "restore_interrupted_promoted_before_db_reconciled"
      }),
      error: {
        code: "restore_interrupted_promoted_before_db_reconciled",
        message: "Interrupted restore was safely rolled back before database import.",
        stage: context.operation.stage || "interrupted"
      }
    }
  }).operation;
  return { action: "promoted_before_db_rollback", operation: updated, proof: proof.proof, proofRef: proof.proofRef };
}

async function reconcileJournalPolicy(context) {
  const journal = context.journal;
  try {
    validateSnapshotStillAvailable(context.projectsRoot, context.slug, journal.source_snapshot_id);
    validateSnapshotStillAvailable(context.projectsRoot, context.slug, journal.rescue_snapshot_id);
  } catch (error) {
    return classifyManualRecovery(context, {
      policy: "identity_validation",
      code: "restore_reconciliation_snapshot_unavailable",
      databaseImportStarted: journal.database_import_started,
      databaseImportCompleted: journal.database_import_completed,
      manualRecoveryRequired: true
    });
  }

  if (journal.database_import_started && !journal.database_import_completed) {
    return classifyManualRecovery(context, {
      policy: "db_import_started_incomplete",
      code: "restore_reconciliation_db_import_incomplete",
      databaseImportStarted: true,
      databaseImportCompleted: false,
      manualRecoveryRequired: true
    });
  }
  if (journal.database_import_completed && !journal.verification_completed) {
    return classifyManualRecovery(context, {
      policy: "db_import_completed_unverified",
      code: "restore_reconciliation_db_completed_unverified",
      databaseImportStarted: true,
      databaseImportCompleted: true,
      manualRecoveryRequired: true
    });
  }
  if (journal.verification_completed && !journal.cleanup_completed) {
    return classifyManualRecovery(context, {
      policy: "verified_cleanup_incomplete",
      code: "restore_reconciliation_verified_cleanup_incomplete",
      databaseImportStarted: journal.database_import_started,
      databaseImportCompleted: journal.database_import_completed,
      manualRecoveryRequired: true
    });
  }
  if (!journal.filesystem_promotion_completed && !journal.database_import_started) {
    return reconcilePrePromotion(context);
  }
  if (journal.filesystem_promotion_completed && !journal.database_import_started) {
    return reconcilePromotedBeforeDb(context);
  }
  return classifyManualRecovery(context, {
    policy: "unsupported_interruption_state",
    code: "restore_reconciliation_unsupported_state",
    databaseImportStarted: journal.database_import_started,
    databaseImportCompleted: journal.database_import_completed,
    manualRecoveryRequired: true
  });
}

async function reconcileOperation(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const slug = options.slug;
  const projectState = readProjectBySlug(slug, projectsRoot);
  const runtimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const lock = options.lock || acquireProjectLock({
    projectsRoot,
    slug,
    operationId: options.operationId,
    operationType: "structural_restore_execute",
    staleLockHeartbeatMs: options.staleLockHeartbeatMs
  });
  try {
    const read = readOperationById({ projectsRoot, slug, operationId: options.operationId, includeRaw: true });
    const operation = read && read.operation;
    if (!operation || operation.operation_type !== "structural_restore_execute") {
      return { action: "ignored", operation: operation || null };
    }
    if (operation.status === "failed" && operation.result_summary && operation.result_summary.restore_state) {
      return { action: "already_terminal", operation };
    }
    let journal;
    try {
      journal = options.journal || readRestoreJournal({ projectsRoot, runtimePath, operationId: operation.operation_id });
      validateJournalIdentity(journal, { slug, projectState, operationId: operation.operation_id });
    } catch (error) {
      return classifyManualRecovery({
        projectsRoot,
        slug,
        runtimePath,
        operation,
        journal: journal || null,
        clock: options.clock
      }, {
        policy: "missing_or_invalid_journal",
        code: error && error.code || "restore_journal_missing",
        databaseImportStarted: journal && journal.database_import_started,
        databaseImportCompleted: journal && journal.database_import_completed,
        manualRecoveryRequired: true
      });
    }
    const paths = resolveJournalPaths(runtimePath, journal);
    return reconcileJournalPolicy({
      projectsRoot,
      slug,
      projectState,
      runtimePath,
      operation,
      journal,
      paths,
      serviceController: options.serviceController || defaultServiceController,
      clock: options.clock
    });
  } finally {
    if (!options.lock && lock && typeof lock.release === "function") {
      lock.release();
    }
  }
}

function discoverInterruptedStructuralRestores(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const projects = options && Array.isArray(options.projects)
    ? options.projects
    : listProjects(projectsRoot);
  const discovered = [];
  for (const project of projects) {
    const slug = project.slug;
    if (!slug) {
      continue;
    }
    for (const operation of listOperations({ projectsRoot, slug })) {
      if (operation.operation_type !== "structural_restore_execute") {
        continue;
      }
      if (operation.status === "requested" || operation.status === "running" || operation.status === "interrupted") {
        discovered.push({ slug, operation_id: operation.operation_id, status: operation.status, stage: operation.stage });
      }
    }
  }
  return discovered;
}

async function reconcileInterruptedStructuralRestores(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const discovered = options && Array.isArray(options.operations)
    ? options.operations
    : discoverInterruptedStructuralRestores({ projectsRoot, projects: options && options.projects });
  const results = [];
  for (const item of discovered) {
    try {
      const result = await reconcileOperation({
        projectsRoot,
        slug: item.slug,
        operationId: item.operation_id,
        serviceController: options && options.serviceController,
        clock: options && options.clock,
        staleLockHeartbeatMs: options && options.staleLockHeartbeatMs
      });
      results.push(Object.assign({ slug: item.slug, operation_id: item.operation_id }, result));
    } catch (error) {
      results.push({
        slug: item.slug,
        operation_id: item.operation_id,
        action: "error",
        error: {
          code: error && error.code || "restore_reconciliation_failed",
          message: "Structural restore reconciliation failed."
        }
      });
    }
  }
  return {
    checked: discovered.length,
    results
  };
}

module.exports = {
  JOURNAL_FILENAME,
  JOURNAL_SCHEMA_VERSION,
  createRestoreJournal,
  defaultServiceController,
  discoverInterruptedStructuralRestores,
  getJournalPath,
  getRestoreWorkRoot,
  readRestoreJournal,
  reconcileInterruptedStructuralRestores,
  reconcileOperation,
  resolveJournalPaths,
  updateRestoreJournal,
  validateWordPressTree,
  writeRestoreJournal
};
