"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const {
  assertSafeRuntimePath,
  ensureDirectory,
  readProjectBySlug,
  resolveProjectsRoot,
  validateExplicitSlug,
  writeJsonFile
} = require("./project-store");
const {
  computeRequestFingerprint,
  runProjectOperation
} = require("./project-operation-coordinator");
const {
  fetchJsonWithSignedAuth,
  waitForUrl
} = require("./agent-client");
const {
  requireAgentSigningCredential,
  redactAgentSigningCredential
} = require("./agent-credential-store");
const {
  bootstrapAgentSignedAuth
} = require("./install-agent");
const {
  executeFullCapture,
  enterMaintenanceMode,
  listTarEntries,
  validateArchiveEntries
} = require("./structural-snapshot-capture");
const {
  captureDatabaseArtifact,
  DB_SERVICE,
  sanitizeDiagnosticText
} = require("./structural-snapshot-db-capture");
const {
  loadRestorePlanForExecution,
  validateRestorePlanId
} = require("./structural-restore-plan");
const {
  createRestoreJournal,
  JOURNAL_FILENAME,
  updateRestoreJournal
} = require("./structural-restore-reconciliation");

const OPERATION_TYPE = "structural_restore_execute";
const WORDPRESS_SERVICE = "wordpress";
const MYSQL_IMPORT_TIMEOUT_MS = 180000;
const SERVICE_TIMEOUT_MS = 90000;
const HEALTH_TIMEOUT_MS = 120000;
const RESTORE_WORK_DIRECTORY = path.join("runs", "restore-work");
const LIGHTWEIGHT_DB_RESCUE_FILENAME = "lightweight-database-rescue.sql";
const FORBIDDEN_EXECUTION_KEYS = new Set([
  "plan",
  "snapshotPath",
  "snapshot_path",
  "artifactPath",
  "artifact_path",
  "archiveFilename",
  "archive_filename",
  "databaseFilename",
  "database_filename",
  "projectPath",
  "project_path",
  "components",
  "componentMap",
  "component_map",
  "rescueStrategy",
  "rescue_strategy",
  "credential",
  "credentials",
  "dockerService",
  "docker_service",
  "executable",
  "command",
  "commandArgs",
  "command_args",
  "stagingPath",
  "staging_path",
  "backupPath",
  "backup_path",
  "rescuePath",
  "rescue_path",
  "rollbackPath",
  "rollback_path",
  "dbDumpPath",
  "db_dump_path",
  "confirmationPhrase",
  "confirmation_phrase",
  "confirmationPhraseOverride",
  "confirmation_phrase_override"
]);

function nowIso(clock) {
  return new Date(clock ? clock() : Date.now()).toISOString();
}

function timestampCompact(clock) {
  return nowIso(clock).replace(/[:.]/g, "-");
}

function createRestoreExecutionError(code, message, statusCode, extras) {
  const error = new Error(message || "Managed website restore failed.");
  error.code = code;
  error.statusCode = statusCode || 500;
  if (extras && typeof extras === "object") {
    Object.assign(error, extras);
  }
  return error;
}

function sanitizeError(error) {
  return {
    code: error && error.code ? String(error.code) : "restore_execution_failed",
    message: "Managed website restore did not complete."
  };
}

function validateExecutionInput(input) {
  const options = input || {};
  for (const key of Object.keys(options)) {
    if (FORBIDDEN_EXECUTION_KEYS.has(key)) {
      throw createRestoreExecutionError("restore_execution_input_rejected", "Restore execution input is not allowed.", 400);
    }
  }
  const projectSlug = validateExplicitSlug(options.projectSlug || options.slug);
  const planId = validateRestorePlanId(options.planId);
  const exactConfirmation = String(options.exactConfirmation || "");
  if (!exactConfirmation.trim()) {
    throw createRestoreExecutionError("restore_confirmation_required", "Restore confirmation text is required.", 400);
  }
  return {
    projectSlug,
    planId,
    exactConfirmation,
    idempotencyKey: options.idempotencyKey
  };
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  return child === parent || child.startsWith(parent + path.sep);
}

function assertInside(parentPath, childPath, code) {
  if (!isPathInside(parentPath, childPath)) {
    throw createRestoreExecutionError(code || "restore_path_escape", "Restore path escaped its allowed directory.", 500);
  }
  return childPath;
}

function cleanupTree(targetPath) {
  if (targetPath && fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function isRestoreWorkRootClean(workRoot) {
  if (!fs.existsSync(workRoot)) {
    return true;
  }
  return fs.readdirSync(workRoot).every((entry) => entry === JOURNAL_FILENAME);
}

function safeMkdir(dirPath) {
  ensureDirectory(dirPath);
  const stat = fs.lstatSync(dirPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw createRestoreExecutionError("restore_path_unsafe", "Restore directory path is unsafe.", 500);
  }
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

function preserveWpConfig(options) {
  const liveConfig = path.join(options.liveWordPressRoot, "wp-config.php");
  const stagedConfig = path.join(options.stagedWordPressRoot, "wp-config.php");
  assertInside(options.liveWordPressRoot, liveConfig, "restore_wp_config_path_unsafe");
  assertInside(options.stagedWordPressRoot, stagedConfig, "restore_wp_config_path_unsafe");
  if (!fs.existsSync(liveConfig) || !fs.lstatSync(liveConfig).isFile()) {
    throw createRestoreExecutionError("restore_wp_config_missing", "Current wp-config.php could not be preserved.", 409);
  }
  if (fs.existsSync(stagedConfig)) {
    throw createRestoreExecutionError("restore_wp_config_snapshot_forbidden", "Source archive unexpectedly contained wp-config.php.", 422);
  }
  const before = sha256File(liveConfig);
  fs.copyFileSync(liveConfig, stagedConfig);
  const staged = sha256File(stagedConfig);
  if (before !== staged) {
    throw createRestoreExecutionError("restore_wp_config_preserve_failed", "Current wp-config.php preservation failed.", 500);
  }
  return {
    fingerprint_abbrev: before.slice(0, 12)
  };
}

function normalizeTarName(name) {
  let value = String(name || "");
  if (!value || value.startsWith("/") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) {
    throw createRestoreExecutionError("restore_archive_invalid_entry", "Archive contains an unsafe entry.", 422);
  }
  if (value.endsWith("/")) {
    value = value.slice(0, -1);
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw createRestoreExecutionError("restore_archive_invalid_entry", "Archive contains an unsafe entry.", 422);
  }
  if (value !== "wordpress" && !value.startsWith("wordpress/")) {
    throw createRestoreExecutionError("restore_archive_invalid_entry", "Archive entry is outside the expected root.", 422);
  }
  return value;
}

function readTarString(buffer, start, length) {
  const slice = buffer.slice(start, start + length);
  const end = slice.indexOf(0);
  return slice.slice(0, end === -1 ? slice.length : end).toString("utf8");
}

function readTarOctal(buffer, start, length) {
  const text = readTarString(buffer, start, length).trim();
  return text ? parseInt(text, 8) : 0;
}

function extractTarArchive(options) {
  const archivePath = options.archivePath;
  const stagingRoot = options.stagingRoot;
  cleanupTree(stagingRoot);
  safeMkdir(stagingRoot);
  const entries = listTarEntries(archivePath);
  validateArchiveEntries(entries, { requireAgentPlugin: options.requireAgentPlugin === true });
  const fd = fs.openSync(archivePath, "r");
  const header = Buffer.alloc(512);
  try {
    let offset = 0;
    while (true) {
      const bytes = fs.readSync(fd, header, 0, 512, offset);
      if (bytes !== 512) {
        throw createRestoreExecutionError("restore_archive_invalid", "Archive header is incomplete.", 422);
      }
      if (header.every((byte) => byte === 0)) {
        break;
      }
      const name = normalizeTarName((readTarString(header, 345, 155) ? readTarString(header, 345, 155) + "/" : "") + readTarString(header, 0, 100));
      const size = readTarOctal(header, 124, 12);
      const type = readTarString(header, 156, 1) || "0";
      if (type !== "0" && type !== "5") {
        throw createRestoreExecutionError("restore_archive_unsupported_entry", "Archive contains an unsupported entry.", 422);
      }
      const target = assertInside(stagingRoot, path.join(stagingRoot, ...name.split("/")), "restore_archive_extract_escape");
      if (type === "5") {
        safeMkdir(target);
      } else {
        safeMkdir(path.dirname(target));
        if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
          throw createRestoreExecutionError("restore_archive_extract_escape", "Archive target is unsafe.", 422);
        }
        const output = fs.openSync(target, "wx");
        try {
          let remaining = size;
          let sourceOffset = offset + 512;
          const buffer = Buffer.alloc(64 * 1024);
          while (remaining > 0) {
            const toRead = Math.min(buffer.length, remaining);
            const read = fs.readSync(fd, buffer, 0, toRead, sourceOffset);
            if (!read) {
              throw createRestoreExecutionError("restore_archive_invalid", "Archive file body is incomplete.", 422);
            }
            fs.writeSync(output, buffer, 0, read);
            remaining -= read;
            sourceOffset += read;
          }
        } finally {
          fs.closeSync(output);
        }
      }
      offset += 512 + Math.ceil(size / 512) * 512;
    }
  } finally {
    fs.closeSync(fd);
  }
  return {
    stagedWordPressRoot: assertInside(stagingRoot, path.join(stagingRoot, "wordpress"), "restore_archive_extract_escape"),
    entryCount: entries.length
  };
}

function validateExtractedTree(options) {
  const root = options.stagedWordPressRoot;
  const required = [
    "index.php",
    path.join("wp-admin"),
    path.join("wp-includes"),
    path.join("wp-content", "plugins"),
    path.join("wp-content", "themes")
  ];
  for (const relative of required) {
    const target = assertInside(root, path.join(root, relative), "restore_staging_path_escape");
    if (!fs.existsSync(target)) {
      throw createRestoreExecutionError("restore_staging_required_missing", "Restored WordPress tree is missing required structure.", 422);
    }
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      throw createRestoreExecutionError("restore_staging_reparse_rejected", "Restored WordPress tree contains an unsafe link.", 422);
    }
  }
  const forbidden = [
    "wp-config.php",
    ".maintenance",
    path.join("wp-content", "debug.log")
  ];
  for (const relative of forbidden) {
    const target = assertInside(root, path.join(root, relative), "restore_staging_path_escape");
    if (fs.existsSync(target)) {
      throw createRestoreExecutionError("restore_staging_forbidden_entry", "Restored WordPress tree contains a forbidden entry.", 422);
    }
  }
  return { successful: true };
}

function promoteFilesystem(options) {
  const liveRoot = options.liveWordPressRoot;
  const stagedRoot = options.stagedWordPressRoot;
  const rollbackRoot = options.rollbackRoot;
  assertInside(options.runtimePath, liveRoot, "restore_live_path_unsafe");
  assertInside(options.runtimePath, stagedRoot, "restore_staging_path_escape");
  assertInside(options.runtimePath, rollbackRoot, "restore_rollback_path_unsafe");
  if (!fs.existsSync(liveRoot) || !fs.lstatSync(liveRoot).isDirectory()) {
    throw createRestoreExecutionError("restore_live_wordpress_missing", "Live WordPress directory is missing.", 409);
  }
  if (!fs.existsSync(stagedRoot) || !fs.lstatSync(stagedRoot).isDirectory()) {
    throw createRestoreExecutionError("restore_staging_required_missing", "Staged WordPress directory is missing.", 422);
  }
  if (fs.existsSync(rollbackRoot)) {
    throw createRestoreExecutionError("restore_rollback_conflict", "Restore rollback directory already exists.", 409);
  }
  try {
    fs.renameSync(liveRoot, rollbackRoot);
    fs.renameSync(stagedRoot, liveRoot);
    return { liveFilesystemChanged: true };
  } catch (error) {
    try {
      if (!fs.existsSync(liveRoot) && fs.existsSync(rollbackRoot)) {
        fs.renameSync(rollbackRoot, liveRoot);
      }
    } catch (rollbackError) {
      throw createRestoreExecutionError("restore_promotion_rollback_failed", "Filesystem promotion rollback failed.", 500, {
        manualRecoveryRequired: true
      });
    }
    throw createRestoreExecutionError("restore_filesystem_promotion_failed", "Filesystem promotion failed.", 500);
  }
}

function rollbackPromotedFilesystem(options) {
  if (!options.liveFilesystemChanged || !fs.existsSync(options.rollbackRoot)) {
    return false;
  }
  const failedLive = options.liveWordPressRoot + ".failed-" + process.pid + "-" + crypto.randomBytes(3).toString("hex");
  if (fs.existsSync(options.liveWordPressRoot)) {
    fs.renameSync(options.liveWordPressRoot, failedLive);
  }
  fs.renameSync(options.rollbackRoot, options.liveWordPressRoot);
  cleanupTree(failedLive);
  return true;
}

function ensureSameVolumeRename(options) {
  const liveRoot = path.resolve(options.liveWordPressRoot);
  const rollbackRoot = path.resolve(options.rollbackRoot);
  if (typeof options.sameVolumeProbe === "function") {
    if (options.sameVolumeProbe({ liveWordPressRoot: liveRoot, rollbackRoot }) !== true) {
      throw createRestoreExecutionError("restore_rollback_cross_volume_unsafe", "Restore rollback must stay on the same volume.", 409);
    }
    return true;
  }
  if (path.parse(liveRoot).root.toLowerCase() !== path.parse(rollbackRoot).root.toLowerCase()) {
    throw createRestoreExecutionError("restore_rollback_cross_volume_unsafe", "Restore rollback must stay on the same volume.", 409);
  }
  return true;
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
      reject(createRestoreExecutionError("restore_docker_timeout", "Docker Compose command timed out.", 504));
    }, options && options.timeoutMs || SERVICE_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(createRestoreExecutionError("restore_docker_unavailable", "Docker Compose command failed to start.", 502));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(createRestoreExecutionError("restore_docker_failed", "Docker Compose command failed.", 502, {
          diagnostic: sanitizeDiagnosticText(stdout + "\n" + stderr)
        }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function defaultServiceController(action, context) {
  if (action === "isWordPressRunning") {
    const result = await runDockerCompose(context.runtimePath, ["ps", "--status", "running", WORDPRESS_SERVICE], { timeoutMs: SERVICE_TIMEOUT_MS });
    return { service: WORDPRESS_SERVICE, running: result.stdout.includes(WORDPRESS_SERVICE) };
  }
  if (action === "stopWordPress") {
    await runDockerCompose(context.runtimePath, ["stop", WORDPRESS_SERVICE], { timeoutMs: SERVICE_TIMEOUT_MS });
    return { service: WORDPRESS_SERVICE, stopped: true };
  }
  if (action === "startWordPress") {
    await runDockerCompose(context.runtimePath, ["start", WORDPRESS_SERVICE], { timeoutMs: SERVICE_TIMEOUT_MS });
    return { service: WORDPRESS_SERVICE, running: true };
  }
  if (action === "mysqlRunning") {
    await runDockerCompose(context.runtimePath, ["ps", "--status", "running", DB_SERVICE], { timeoutMs: SERVICE_TIMEOUT_MS });
    return { service: DB_SERVICE, running: true };
  }
  throw createRestoreExecutionError("restore_service_action_invalid", "Restore service action is invalid.", 500);
}

function importDatabaseArtifact(options) {
  return new Promise((resolve, reject) => {
    const script = [
      "set -eu;",
      "mysql",
      "-u\"$MYSQL_USER\"",
      "-p\"$MYSQL_PASSWORD\"",
      "\"$MYSQL_DATABASE\""
    ].join(" ");
    const child = spawn("docker", ["compose", "exec", "-T", DB_SERVICE, "sh", "-lc", script], {
      cwd: options.runtimePath,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(createRestoreExecutionError("restore_db_import_timeout", "Database import timed out.", 504));
    }, options.timeoutMs || MYSQL_IMPORT_TIMEOUT_MS);
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", () => {
      clearTimeout(timeout);
      reject(createRestoreExecutionError("restore_db_import_failed", "Database import could not start.", 502));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(createRestoreExecutionError("restore_db_import_failed", "Database import failed.", 502, {
          diagnostic: sanitizeDiagnosticText(stderr)
        }));
        return;
      }
      resolve({ successful: true, service: DB_SERVICE, streamed: true });
    });
    fs.createReadStream(options.databasePath).on("error", reject).pipe(child.stdin);
  });
}

async function captureLightweightDatabaseRescue(options) {
  const workRoot = assertInside(options.runtimePath, options.workRoot, "restore_work_path_unsafe");
  ensureDirectory(workRoot);
  const artifact = await captureDatabaseArtifact({
    projectsRoot: options.projectsRoot,
    runtimePath: options.runtimePath,
    snapshotDirectory: workRoot,
    artifactFilename: LIGHTWEIGHT_DB_RESCUE_FILENAME,
    dumpRunner: options.dumpRunner,
    timeoutMs: options.timeoutMs
  });
  return {
    verified: true,
    databasePath: assertInside(workRoot, path.join(workRoot, artifact.relative_filename), "restore_lightweight_db_path_unsafe"),
    relativeFilename: artifact.relative_filename,
    sizeBytes: artifact.size_bytes,
    digest: artifact.digest
  };
}

async function repairAgentBinding(options) {
  const credential = requireAgentSigningCredential(options.projectState);
  const restBase = options.projectState.project.wp_url + "/wp-json/factory/v1";
  const warnings = [];
  const bootstrap = await bootstrapAgentSignedAuth(options.projectState, restBase, credential, options.proofId, warnings);
  const health = (await fetchJsonWithSignedAuth(restBase + "/agent/health", credential, { timeoutMs: 10000 })).json;
  if (String(health && health.status || "") !== "ok") {
    throw createRestoreExecutionError("restore_agent_health_failed", "Signed Agent health check failed.", 502);
  }
  return {
    successful: true,
    bootstrap_code: bootstrap && bootstrap.code || null,
    key_id: credential.key_id,
    credential: redactAgentSigningCredential(credential),
    health_status: health.status,
    warnings
  };
}

async function verifyHealth(options) {
  await waitForUrl(options.projectState.project.wp_url, { timeoutMs: HEALTH_TIMEOUT_MS, intervalMs: 3000 });
  await waitForUrl(options.projectState.project.wp_url + "/wp-json/", { timeoutMs: HEALTH_TIMEOUT_MS, intervalMs: 3000 });
  await (options.serviceController || defaultServiceController)("mysqlRunning", { runtimePath: options.runtimePath });
  const credential = requireAgentSigningCredential(options.projectState);
  const restBase = options.projectState.project.wp_url + "/wp-json/factory/v1";
  const health = (await fetchJsonWithSignedAuth(restBase + "/agent/health", credential, { timeoutMs: 10000 })).json;
  if (String(health && health.status || "") !== "ok") {
    throw createRestoreExecutionError("restore_agent_health_failed", "Signed Agent health check failed.", 502);
  }
  return {
    wordpress: "ok",
    wp_json: "ok",
    mysql: "running",
    signed_agent: "ok"
  };
}

function writeRestoreProof(options) {
  const proofId = "restore-execute-" + timestampCompact(options.clock) + "-" + crypto.randomBytes(3).toString("hex");
  const proof = {
    proof_id: proofId,
    schema: "factory_structural_restore_execution_proof",
    schema_version: 1,
    project_slug: options.projectSlug,
    operation_id: options.operationId,
    plan_id: options.planId,
    source_snapshot_id: options.sourceSnapshotId,
    rescue_snapshot_id: options.rescueSnapshotId,
    rescue_strategy: options.rescueStrategy,
    full_recovery_point_created: options.fullRecoveryPointCreated === true,
    lightweight_db_rescue_verified: options.lightweightDbRescueVerified === true,
    filesystem_rollback_retained: options.filesystemRollbackRetained === true,
    status: options.status,
    stages: options.stages.slice(),
    filesystem: options.filesystem,
    database: options.database,
    agent: options.agent,
    health: options.health,
    maintenance: options.maintenance,
    cleanup: options.cleanup,
    duration_ms: options.durationMs,
    created_at: nowIso(options.clock)
  };
  const proofPath = path.join(options.runtimePath, "proofs", proofId + ".json");
  writeJsonFile(proofPath, proof);
  return {
    proof,
    proofRef: "proofs/" + proofId + ".json"
  };
}

function browserSafeResult(result) {
  return {
    project_slug: result.project_slug,
    operation_id: result.operation_id,
    plan_id: result.plan_id,
    source_snapshot_id: result.source_snapshot_id,
    rescue_snapshot_id: result.rescue_snapshot_id,
    snapshot_id: result.rescue_snapshot_id,
    rescue_strategy: result.rescue_strategy || null,
    full_recovery_point_created: result.full_recovery_point_created === true,
    temporary_safety_copy_removed: result.temporary_safety_copy_removed === true,
    status: result.status,
    manifest_status: "verified",
    restorable: true,
    restore_verified: result.verification && result.verification.successful === true,
    restored_components: result.restored_components.slice(),
    stages: Array.isArray(result.stages) ? result.stages.slice() : [],
    filesystem: Object.assign({}, result.filesystem || {}),
    database: Object.assign({}, result.database || {}),
    agent: Object.assign({}, result.agent || {}),
    maintenance: Object.assign({}, result.maintenance || {}),
    service: Object.assign({}, result.service || {}),
    cleanup: Object.assign({}, result.cleanup || {}),
    manual_recovery_required: result.manual_recovery_required === true,
    verification: result.verification,
    duration_ms: result.duration_ms,
    warnings: result.warnings.slice()
  };
}

function resultFromSummary(summary) {
  const safe = summary && typeof summary === "object" ? summary : {};
  if (safe.status !== "succeeded") {
    return null;
  }
  return {
    project_slug: safe.project_slug || null,
    operation_id: safe.operation_id || null,
    plan_id: safe.plan_id || null,
    source_snapshot_id: safe.source_snapshot_id || null,
    rescue_snapshot_id: safe.rescue_snapshot_id || null,
    rescue_strategy: safe.rescue_strategy || null,
    full_recovery_point_created: safe.full_recovery_point_created === true,
    temporary_safety_copy_removed: safe.temporary_safety_copy_removed === true,
    status: safe.status,
    restored_components: Array.isArray(safe.restored_components) ? safe.restored_components.slice() : [],
    stages: Array.isArray(safe.stages) ? safe.stages.slice() : [],
    filesystem: Object.assign({}, safe.filesystem || {}),
    database: Object.assign({}, safe.database || {}),
    agent: Object.assign({}, safe.agent || {}),
    maintenance: Object.assign({}, safe.maintenance || {}),
    service: Object.assign({}, safe.service || {}),
    cleanup: Object.assign({}, safe.cleanup || {}),
    manual_recovery_required: safe.manual_recovery_required === true,
    verification: Object.assign({}, safe.verification || {}),
    duration_ms: safe.duration_ms || null,
    warnings: Array.isArray(safe.warnings) ? safe.warnings.slice() : []
  };
}

async function executeRestoreInCoordinator(context, options) {
  const startedAt = Date.now();
  const projectState = context.projectState;
  const projectsRoot = context.projectsRoot;
  const runtimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const liveWordPressRoot = assertInside(runtimePath, path.join(runtimePath, "wordpress"), "restore_live_path_unsafe");
  const workRoot = assertInside(runtimePath, path.join(runtimePath, RESTORE_WORK_DIRECTORY, context.operationId), "restore_work_path_unsafe");
  const stagingRoot = path.join(workRoot, "staging");
  const rollbackRoot = path.join(workRoot, "rollback-wordpress");
  const stages = [];
  const serviceController = options.serviceController || defaultServiceController;
  const state = {
    stage: "validating_plan",
    liveFilesystemChanged: false,
    dbImportBegan: false,
    dbImportCompleted: false,
    wordpressStopped: false,
    rescueSnapshotId: null,
    maintenance: null,
    rescueStrategy: null,
    lightweightDbRescue: null,
    lightweightDbRollbackCompleted: false,
    lightweightFilesystemRollbackCompleted: false
  };
  let journalCreated = false;

  async function stage(name, patch) {
    state.stage = name;
    stages.push(name);
    await context.setStage(name, patch || {});
  }

  function journalOptions() {
    return {
      projectsRoot,
      runtimePath,
      operationId: context.operationId,
      clock: options.clock
    };
  }

  function updateJournal(patch) {
    if (!journalCreated) {
      return null;
    }
    return updateRestoreJournal(journalOptions(), patch);
  }

  async function cleanupBeforeThrow(error) {
    try {
      if (state.rescueStrategy === "lightweight_required" && state.dbImportBegan && !state.dbImportCompleted) {
        updateJournal({
          manual_recovery_required: true
        });
        error.manualRecoveryRequired = true;
        throw error;
      }
      if (state.rescueStrategy === "lightweight_required" && state.dbImportCompleted && state.lightweightDbRescue) {
        if (!state.wordpressStopped) {
          await serviceController("stopWordPress", { runtimePath });
          state.wordpressStopped = true;
        }
        updateJournal({
          current_stage: "rolling_back_lightweight_database",
          lightweight_database_rollback_started: true
        });
        await (options.dbImporter || importDatabaseArtifact)({
          databasePath: state.lightweightDbRescue.databasePath,
          runtimePath,
          rollback: true
        });
        state.lightweightDbRollbackCompleted = true;
        updateJournal({
          current_stage: "rolling_back_lightweight_database",
          lightweight_database_rollback_completed: true
        });
      }
      if (state.liveFilesystemChanged && (state.rescueStrategy === "lightweight_required" || !state.dbImportCompleted)) {
        const rolledBack = rollbackPromotedFilesystem({
          liveFilesystemChanged: state.liveFilesystemChanged,
          liveWordPressRoot,
          rollbackRoot
        });
        state.liveFilesystemChanged = false;
        if (rolledBack && state.rescueStrategy === "lightweight_required") {
          state.lightweightFilesystemRollbackCompleted = true;
          updateJournal({
            current_stage: "rolling_back_lightweight_filesystem",
            lightweight_filesystem_rollback_completed: true
          });
        }
      }
      if (state.wordpressStopped) {
        await serviceController("startWordPress", { runtimePath });
        state.wordpressStopped = false;
      }
      if (state.rescueStrategy === "lightweight_required" && (state.lightweightDbRollbackCompleted || !state.dbImportBegan)) {
        const proofId = "restore-agent-rollback-" + timestampCompact(options.clock);
        const repairer = options.rollbackAgentRepairer || options.agentRepairer || repairAgentBinding;
        await repairer({ projectState, runtimePath, proofId, rollback: true });
        const verifier = options.rollbackHealthVerifier || options.healthVerifier || verifyHealth;
        await verifier({ projectState, runtimePath, liveWordPressRoot, serviceController: options.serviceController, rollback: true });
      }
      if (state.maintenance && state.maintenance.created === true) {
        state.maintenance.cleanup();
      }
      if (!state.liveFilesystemChanged && (state.rescueStrategy !== "lightweight_required" || !state.dbImportBegan || state.lightweightDbRollbackCompleted)) {
        cleanupTree(workRoot);
      }
    } catch (cleanupError) {
      error.manualRecoveryRequired = true;
    }
    if (error.result_summary && typeof error.result_summary === "object") {
      error.result_summary.lightweight_database_rollback_completed = state.lightweightDbRollbackCompleted === true;
      error.result_summary.lightweight_filesystem_rollback_completed = state.lightweightFilesystemRollbackCompleted === true;
      error.result_summary.manual_recovery_required = error.manualRecoveryRequired === true || (state.dbImportCompleted === true && state.lightweightDbRollbackCompleted !== true);
    }
    throw error;
  }

  try {
    await stage("validating_plan");
    const loaded = options.planLoader
      ? await options.planLoader({
        projectsRoot,
        slug: projectState.project.slug,
        planId: options.planId,
        exactConfirmation: options.exactConfirmation
      })
      : await loadRestorePlanForExecution({
        projectsRoot,
        slug: projectState.project.slug,
        planId: options.planId,
        exactConfirmation: options.exactConfirmation,
        freeSpaceProbe: options.freeSpaceProbe,
        clock: options.clock
      });
    if (!loaded || !loaded.plan || loaded.plan.project_slug !== projectState.project.slug || loaded.plan.plan_id !== options.planId) {
      throw createRestoreExecutionError("restore_plan_not_found", "Restore plan was not found.", 404);
    }
    if (loaded.plan.readiness !== "ready") {
      throw createRestoreExecutionError("restore_plan_not_ready", "Restore plan is not ready for execution.", 409);
    }
    state.rescueStrategy = loaded.plan.rescue_strategy;
    if (loaded.plan.rescue_strategy === "none_emergency") {
      throw createRestoreExecutionError("restore_emergency_not_supported", "Emergency no-rescue restore execution is not available yet.", 409);
    }
    if (loaded.plan.rescue_strategy !== "full_required" && loaded.plan.rescue_strategy !== "lightweight_required") {
      throw createRestoreExecutionError("restore_rescue_strategy_unsupported", "This restore executor does not support the requested rescue strategy.", 409);
    }
    if (String(loaded.plan.confirmation && loaded.plan.confirmation.phrase || "") !== String(options.exactConfirmation || "")) {
      throw createRestoreExecutionError("restore_confirmation_mismatch", "Restore confirmation text does not match.", 409);
    }
    createRestoreJournal({
      projectsRoot,
      runtimePath,
      projectState,
      operationId: context.operationId,
      planId: loaded.plan.plan_id,
      sourceSnapshotId: loaded.plan.snapshot_id,
      rescueStrategy: loaded.plan.rescue_strategy,
      requestFingerprint: options.requestFingerprint,
      stage: "validating_source",
      clock: options.clock
    });
    journalCreated = true;

    await stage("validating_source", {
      result_summary: {
        plan_id: loaded.plan.plan_id,
        source_snapshot_id: loaded.plan.snapshot_id,
        rescue_snapshot_id: null,
        restore_verified: false
      }
    });

    if (loaded.plan.rescue_strategy === "full_required") {
      await stage("creating_rescue");
      const capturePrimitive = options.rescueCapture || executeFullCapture;
      const rescue = await capturePrimitive({
        projectState,
        projectsRoot,
        operationId: context.operationId,
        setStage: context.setStage
      }, Object.assign({}, options.rescueOptions || {}, {
        maintenanceController: options.rescueMaintenanceController || (() => ({
          existedBefore: fs.existsSync(path.join(liveWordPressRoot, ".maintenance")),
          created: false,
          cleanup: () => false
        }))
      }));
      state.rescueSnapshotId = rescue.result && rescue.result.snapshot_id || null;
      if (!state.rescueSnapshotId || !rescue.result || !rescue.result.summary || rescue.result.summary.restorable !== true) {
        throw createRestoreExecutionError("restore_rescue_not_restorable", "Rescue Recovery Point was not verified as restorable.", 500);
      }
      updateJournal({
        current_stage: "creating_rescue",
        rescue_snapshot_id: state.rescueSnapshotId,
        rescue_verified: true,
        full_recovery_point_created: true
      });
    } else {
      await stage("creating_lightweight_rescue");
      updateJournal({
        current_stage: "creating_lightweight_rescue",
        lightweight_db_rescue_started: true,
        rescue_verified: false,
        full_recovery_point_created: false
      });
      state.lightweightDbRescue = await (options.lightweightDbRescueCapture || captureLightweightDatabaseRescue)({
        projectsRoot,
        runtimePath,
        workRoot,
        dumpRunner: options.lightweightDumpRunner,
        timeoutMs: options.lightweightDumpTimeoutMs
      });
      updateJournal({
        current_stage: "creating_lightweight_rescue",
        rescue_verified: true,
        lightweight_db_rescue_completed: true,
        lightweight_db_rescue_size: state.lightweightDbRescue.sizeBytes,
        lightweight_db_rescue_digest: state.lightweightDbRescue.digest,
        paths: {
          lightweight_db_rescue: path.relative(runtimePath, state.lightweightDbRescue.databasePath).split(path.sep).join("/")
        },
        full_recovery_point_created: false
      });
    }

    await stage("entering_maintenance", {
      result_summary: {
        plan_id: loaded.plan.plan_id,
        source_snapshot_id: loaded.plan.snapshot_id,
        rescue_snapshot_id: state.rescueSnapshotId,
        restore_verified: false
      }
    });
    state.maintenance = options.maintenanceController
      ? options.maintenanceController({ wordpressRoot: liveWordPressRoot, now: options.now })
      : enterMaintenanceMode(liveWordPressRoot, { now: options.now });
    updateJournal({
      current_stage: "entering_maintenance",
      maintenance_preexisting: state.maintenance ? state.maintenance.existedBefore === true : false,
      maintenance_created_by_operation: state.maintenance ? state.maintenance.created === true : false
    });

    await stage("staging_filesystem");
    const extracted = options.archiveExtractor
      ? await options.archiveExtractor({
        archivePath: loaded.source.artifacts.filesystem.path,
        stagingRoot,
        requireAgentPlugin: projectState.project.agent && projectState.project.agent.status === "installed"
      })
      : extractTarArchive({
        archivePath: loaded.source.artifacts.filesystem.path,
        stagingRoot,
        requireAgentPlugin: projectState.project.agent && projectState.project.agent.status === "installed"
      });
    const stagedWordPressRoot = extracted.stagedWordPressRoot;
    if (options.extractedTreeValidator) {
      await options.extractedTreeValidator({ stagedWordPressRoot });
    } else {
      validateExtractedTree({ stagedWordPressRoot });
    }
    const wpConfig = preserveWpConfig({ liveWordPressRoot, stagedWordPressRoot });
    ensureSameVolumeRename({
      liveWordPressRoot,
      rollbackRoot,
      sameVolumeProbe: options.sameVolumeProbe
    });
    const serviceState = await serviceController("isWordPressRunning", { runtimePath });
    updateJournal({
      current_stage: "staging_filesystem",
      wordpress_service_was_running: serviceState && serviceState.running === true,
      staging_validated: true,
      rollback_tree_ready: true,
      lightweight_filesystem_retained: loaded.plan.rescue_strategy === "lightweight_required",
      wp_config_fingerprint_abbrev: wpConfig.fingerprint_abbrev
    });

    await stage("stopping_wordpress");
    await serviceController("stopWordPress", { runtimePath });
    state.wordpressStopped = true;

    await stage("promoting_filesystem");
    updateJournal({
      current_stage: "promoting_filesystem",
      filesystem_promotion_started: true
    });
    const promotion = options.filesystemPromoter
      ? await options.filesystemPromoter({ runtimePath, liveWordPressRoot, stagedWordPressRoot, rollbackRoot })
      : promoteFilesystem({ runtimePath, liveWordPressRoot, stagedWordPressRoot, rollbackRoot });
    state.liveFilesystemChanged = promotion.liveFilesystemChanged !== false;
    const finalConfig = sha256File(path.join(liveWordPressRoot, "wp-config.php"));
    if (finalConfig.slice(0, 12) !== wpConfig.fingerprint_abbrev) {
      throw createRestoreExecutionError("restore_wp_config_preserve_failed", "Current wp-config.php was not preserved.", 500);
    }
    updateJournal({
      current_stage: "promoting_filesystem",
      filesystem_promotion_completed: true,
      database_import_started: false
    });
    if (typeof options.internalInterruptionHook === "function") {
      await options.internalInterruptionHook({
        checkpoint: "after_filesystem_promotion_before_database",
        projectSlug: projectState.project.slug,
        operationId: context.operationId,
        planId: loaded.plan.plan_id,
        sourceSnapshotId: loaded.plan.snapshot_id,
        rescueSnapshotId: state.rescueSnapshotId
      });
    }

    await stage("importing_database");
    updateJournal({
      current_stage: "importing_database",
      database_import_started: true,
      source_database_import_started: true
    });
    state.dbImportBegan = true;
    const dbResult = options.dbImporter
      ? await options.dbImporter({ databasePath: loaded.source.artifacts.database.path, runtimePath })
      : await importDatabaseArtifact({ databasePath: loaded.source.artifacts.database.path, runtimePath });
    state.dbImportCompleted = true;
    updateJournal({
      current_stage: "importing_database",
      database_import_completed: true,
      source_database_import_completed: true
    });

    await stage("starting_wordpress");
    await serviceController("startWordPress", { runtimePath });
    state.wordpressStopped = false;

    await stage("repairing_agent_binding");
    const proofId = "restore-agent-repair-" + timestampCompact(options.clock);
    const agent = options.agentRepairer
      ? await options.agentRepairer({ projectState, runtimePath, proofId })
      : await repairAgentBinding({ projectState, runtimePath, proofId });
    updateJournal({
      current_stage: "repairing_agent_binding",
      agent_repair_completed: true
    });

    await stage("verifying_restore");
    const health = options.healthVerifier
      ? await options.healthVerifier({ projectState, runtimePath, liveWordPressRoot, serviceController: options.serviceController })
      : await verifyHealth({ projectState, runtimePath, liveWordPressRoot, serviceController: options.serviceController });
    updateJournal({
      current_stage: "verifying_restore",
      verification_completed: true
    });

    if (state.maintenance && state.maintenance.created === true) {
      state.maintenance.cleanup();
    }
    if (fs.existsSync(path.join(liveWordPressRoot, ".maintenance")) && (!state.maintenance || state.maintenance.created === true)) {
      throw createRestoreExecutionError("restore_maintenance_cleanup_failed", "Restore maintenance marker remains.", 500);
    }

    await stage("cleanup");
    cleanupTree(rollbackRoot);
    cleanupTree(stagingRoot);
    if (state.lightweightDbRescue && state.lightweightDbRescue.databasePath && fs.existsSync(state.lightweightDbRescue.databasePath)) {
      fs.rmSync(state.lightweightDbRescue.databasePath, { force: true });
    }
    try {
      if (fs.existsSync(workRoot) && fs.readdirSync(workRoot).length === 0) {
        fs.rmdirSync(workRoot);
      }
    } catch (cleanupError) {
      throw createRestoreExecutionError("restore_cleanup_failed", "Restore cleanup failed.", 500);
    }
    const cleanupOk = !fs.existsSync(rollbackRoot) && !fs.existsSync(stagingRoot) && isRestoreWorkRootClean(workRoot);
    if (!cleanupOk) {
      throw createRestoreExecutionError("restore_cleanup_failed", "Restore cleanup failed.", 500);
    }
    updateJournal({
      current_stage: "cleanup",
      cleanup_completed: true,
      final_restore_verified: true,
      temporary_safety_copy_removed: !state.lightweightDbRescue || !fs.existsSync(state.lightweightDbRescue.databasePath)
    });

    await stage("succeeded");
    const durationMs = Date.now() - startedAt;
    const proof = writeRestoreProof({
      runtimePath,
      projectSlug: projectState.project.slug,
      operationId: context.operationId,
      planId: loaded.plan.plan_id,
      sourceSnapshotId: loaded.plan.snapshot_id,
      rescueSnapshotId: state.rescueSnapshotId,
      rescueStrategy: loaded.plan.rescue_strategy,
      fullRecoveryPointCreated: loaded.plan.rescue_strategy === "full_required",
      lightweightDbRescueVerified: loaded.plan.rescue_strategy === "lightweight_required" && state.lightweightDbRescue && state.lightweightDbRescue.verified === true,
      filesystemRollbackRetained: true,
      status: "succeeded",
      stages,
      filesystem: {
        restored: true,
        wp_config_fingerprint_abbrev: wpConfig.fingerprint_abbrev,
        staging_removed: !fs.existsSync(stagingRoot),
        rollback_removed: !fs.existsSync(rollbackRoot)
      },
      database: {
        imported: dbResult && dbResult.successful === true,
        streamed: true
      },
      agent: {
        repaired: agent && agent.successful === true,
        key_id: agent && agent.key_id || null,
        health_status: agent && agent.health_status || null
      },
      health,
      maintenance: {
        existed_before: state.maintenance ? state.maintenance.existedBefore === true : false,
        created_by_operation: state.maintenance ? state.maintenance.created === true : false,
        removed_by_operation: state.maintenance ? state.maintenance.created === true : false
      },
      cleanup: {
        staging_removed: !fs.existsSync(stagingRoot),
        rollback_removed: !fs.existsSync(rollbackRoot),
        work_dir_removed: !fs.existsSync(workRoot),
        journal_retained: fs.existsSync(path.join(workRoot, JOURNAL_FILENAME)),
        temporary_safety_copy_removed: !state.lightweightDbRescue || !fs.existsSync(state.lightweightDbRescue.databasePath)
      },
      durationMs,
      clock: options.clock
    });
    const filesystemResult = {
      restored: true,
      wp_config_fingerprint_abbrev: wpConfig.fingerprint_abbrev,
      staging_removed: !fs.existsSync(stagingRoot),
      rollback_removed: !fs.existsSync(rollbackRoot),
      work_dir_removed: !fs.existsSync(workRoot),
      journal_retained: fs.existsSync(path.join(workRoot, JOURNAL_FILENAME)),
      temporary_safety_copy_removed: !state.lightweightDbRescue || !fs.existsSync(state.lightweightDbRescue.databasePath)
    };
    const databaseResult = {
      imported: dbResult && dbResult.successful === true,
      streamed: true
    };
    const agentResult = {
      repaired: agent && agent.successful === true,
      key_id: agent && agent.key_id || null,
      health_status: agent && agent.health_status || null
    };
    const maintenanceResult = {
      existed_before: state.maintenance ? state.maintenance.existedBefore === true : false,
      created_by_operation: state.maintenance ? state.maintenance.created === true : false,
      removed_by_operation: state.maintenance ? state.maintenance.created === true : false,
      remaining: false
    };
    const cleanupResult = {
      staging_removed: !fs.existsSync(stagingRoot),
      rollback_removed: !fs.existsSync(rollbackRoot),
      work_dir_removed: !fs.existsSync(workRoot),
      journal_retained: fs.existsSync(path.join(workRoot, JOURNAL_FILENAME)),
      temporary_safety_copy_removed: !state.lightweightDbRescue || !fs.existsSync(state.lightweightDbRescue.databasePath)
    };
    const result = {
      project_slug: projectState.project.slug,
      operation_id: context.operationId,
      plan_id: loaded.plan.plan_id,
      source_snapshot_id: loaded.plan.snapshot_id,
      rescue_snapshot_id: state.rescueSnapshotId,
      rescue_strategy: loaded.plan.rescue_strategy,
      full_recovery_point_created: loaded.plan.rescue_strategy === "full_required",
      temporary_safety_copy_removed: cleanupResult.temporary_safety_copy_removed,
      status: "succeeded",
      restored_components: ["database", "wordpress_filesystem"],
      stages: stages.slice(),
      filesystem: filesystemResult,
      database: databaseResult,
      agent: agentResult,
      maintenance: maintenanceResult,
      service: {
        wordpress_running: true,
        mysql_running: health && health.mysql === "running"
      },
      cleanup: cleanupResult,
      manual_recovery_required: false,
      verification: {
        successful: true,
        health
      },
      duration_ms: durationMs,
      warnings: []
    };
    return {
      result,
      proofRef: proof.proofRef,
      resultSummary: browserSafeResult(result)
    };
  } catch (error) {
    const failure = sanitizeError(error);
    failure.stage = state.stage;
    failure.live_filesystem_changed = state.liveFilesystemChanged === true;
    failure.db_import_began = state.dbImportBegan === true;
    failure.db_import_completed = state.dbImportCompleted === true;
    failure.wordpress_service_stopped = state.wordpressStopped === true;
    failure.rescue_snapshot_id = state.rescueSnapshotId;
    failure.rescue_strategy = state.rescueStrategy;
    failure.full_recovery_point_created = state.rescueStrategy === "full_required" && Boolean(state.rescueSnapshotId);
    failure.lightweight_db_rescue_completed = state.lightweightDbRescue && state.lightweightDbRescue.verified === true;
    failure.lightweight_database_rollback_completed = state.lightweightDbRollbackCompleted === true;
    failure.lightweight_filesystem_rollback_completed = state.lightweightFilesystemRollbackCompleted === true;
    failure.manual_recovery_required = error && error.manualRecoveryRequired === true || (state.dbImportCompleted === true && state.lightweightDbRollbackCompleted !== true);
    error.result_summary = failure;
    await cleanupBeforeThrow(error);
  }
}

async function executeManagedWebsiteRestore(options) {
  const input = validateExecutionInput(options);
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const projectState = readProjectBySlug(input.projectSlug, projectsRoot);
  const fingerprintInput = {
    action: "managed_website_restore_execute",
    schema_version: 1,
    project_slug: input.projectSlug,
    plan_id: input.planId,
    confirmation_hash: crypto.createHash("sha256").update(input.exactConfirmation, "utf8").digest("hex")
  };
  const requestFingerprint = computeRequestFingerprint({
    project_slug: input.projectSlug,
    operation_type: OPERATION_TYPE,
    input: fingerprintInput
  });
  const operationResult = await runProjectOperation({
    projectsRoot,
    slug: input.projectSlug,
    operationType: OPERATION_TYPE,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint,
    fingerprintInput,
    metadata: {
      restore_scope: "managed_website_same_project",
      plan_id: input.planId
    },
    safety: {
      live_ai_used: false,
      apply_used: false,
      rollback_used: false,
      database_import_used: true,
      filesystem_restore_used: true,
      restore_used: true
    },
    execute: async (context) => executeRestoreInCoordinator(context, Object.assign({}, options || {}, {
      planId: input.planId,
      exactConfirmation: input.exactConfirmation,
      projectState,
      requestFingerprint
    }))
  });
  if (operationResult.idempotentReplay && !operationResult.result) {
    return Object.assign({}, operationResult, {
      result: resultFromSummary(operationResult.operation && operationResult.operation.result_summary)
    });
  }
  return operationResult;
}

module.exports = {
  OPERATION_TYPE,
  RESTORE_WORK_DIRECTORY,
  WORDPRESS_SERVICE,
  browserSafeResult,
  captureLightweightDatabaseRescue,
  createRestoreExecutionError,
  executeManagedWebsiteRestore,
  executeRestoreInCoordinator,
  extractTarArchive,
  importDatabaseArtifact,
  promoteFilesystem,
  resultFromSummary,
  validateExecutionInput,
  validateExtractedTree
};
