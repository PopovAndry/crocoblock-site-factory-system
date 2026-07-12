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

const PROJECT_OPERATION_SCHEMA = "factory_project_operation";
const PROJECT_OPERATION_VERSION = 1;
const LEGACY_GENERATION_OPERATION_SCHEMA = "factory_generation_operation";
const LOCK_SCHEMA = "factory_project_operation_lock";
const LOCK_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

function timestampCompact(date) {
  return (date || new Date()).toISOString().replace(/[:.]/g, "-");
}

function createOperationId() {
  return "op-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function getProjectState(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const slug = validateExplicitSlug(options.slug);
  const projectState = readProjectBySlug(slug, projectsRoot);
  const runtimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  ensureDirectory(getOperationsDirectory(runtimePath));
  return {
    projectsRoot,
    projectState,
    runtimePath,
    slug
  };
}

function getOperationsDirectory(runtimePath) {
  return path.join(runtimePath, "runs", "operations");
}

function getLockDirectory(runtimePath) {
  return path.join(getOperationsDirectory(runtimePath), ".project-operation.lock");
}

function getOperationPath(runtimePath, operationId) {
  return path.join(getOperationsDirectory(runtimePath), operationId + ".json");
}

function writeJsonAtomic(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  const tmpPath = filePath + ".tmp-" + process.pid + "-" + crypto.randomBytes(3).toString("hex");
  const payload = JSON.stringify(value, null, 2) + "\n";
  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function tryReadJsonFile(filePath) {
  try {
    return readJsonFile(filePath);
  } catch (error) {
    return null;
  }
}

function listOperationFiles(runtimePath) {
  const operationsPath = getOperationsDirectory(runtimePath);
  if (!fs.existsSync(operationsPath)) {
    return [];
  }

  return fs.readdirSync(operationsPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const filePath = path.join(operationsPath, entry.name);
      return {
        filePath,
        name: entry.name,
        mtimeMs: fs.statSync(filePath).mtimeMs
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sanitizeError(error) {
  const safeError = safeObject(error);
  return {
    code: safeError.code || null,
    message: safeError.message || null,
    stage: safeError.stage || null
  };
}

function sanitizeOperation(operation, options) {
  const raw = safeObject(operation);
  const legacy = Boolean(options && options.legacy);
  const metadata = safeObject(raw.metadata);
  const resultSummary = safeObject(raw.result_summary);
  const safety = Object.assign({
    live_ai_used: false,
    apply_used: false,
    rollback_used: false
  }, safeObject(raw.safety));

  return {
    schema: raw.schema || (legacy ? LEGACY_GENERATION_OPERATION_SCHEMA : PROJECT_OPERATION_SCHEMA),
    version: Number(raw.version || PROJECT_OPERATION_VERSION),
    legacy,
    operation_id: raw.operation_id || null,
    project_slug: raw.project_slug || null,
    operation_type: raw.operation_type || (legacy ? "controlled_generate" : null),
    status: raw.status || "unknown",
    stage: raw.stage || raw.status_detail || null,
    requested_at: raw.requested_at || null,
    started_at: raw.started_at || null,
    heartbeat_at: raw.heartbeat_at || null,
    completed_at: raw.completed_at || null,
    metadata,
    proof_ref: raw.proof_ref || raw.proof_path || null,
    result_summary: resultSummary,
    error: sanitizeError(raw.error),
    safety,
    idempotent_replay: raw.idempotent_replay === true
  };
}

function normalizeLegacyGenerationOperation(raw) {
  const operation = safeObject(raw);
  return sanitizeOperation({
    schema: PROJECT_OPERATION_SCHEMA,
    version: PROJECT_OPERATION_VERSION,
    operation_id: operation.operation_id || null,
    project_slug: operation.project_slug || null,
    operation_type: "controlled_generate",
    status: operation.status || "unknown",
    stage: operation.stage || operation.status_detail || null,
    requested_at: operation.requested_at || null,
    started_at: operation.started_at || null,
    heartbeat_at: operation.heartbeat_at || null,
    completed_at: operation.completed_at || null,
    metadata: {
      plan_id: operation.plan_id || null,
      prompt_hash: operation.prompt_hash || null
    },
    proof_ref: operation.proof_ref || operation.proof_path || null,
    result_summary: operation.result_summary || {},
    error: operation.error || {},
    safety: operation.safety || {
      live_ai_used: false,
      apply_used: false,
      rollback_used: false
    }
  }, { legacy: true });
}

function normalizeOperationRecord(raw) {
  const operation = safeObject(raw);
  if (operation.schema === LEGACY_GENERATION_OPERATION_SCHEMA) {
    return normalizeLegacyGenerationOperation(operation);
  }
  return sanitizeOperation(operation, { legacy: false });
}

function readOperationRecord(filePath, options) {
  const raw = tryReadJsonFile(filePath);
  if (!raw) {
    return null;
  }
  const normalized = normalizeOperationRecord(raw);
  if (options && options.includeRaw) {
    normalized.raw = raw;
  }
  return normalized;
}

function listOperations(options) {
  const { runtimePath } = getProjectState(options);
  const records = [];
  for (const entry of listOperationFiles(runtimePath)) {
    const record = readOperationRecord(entry.filePath, {
      includeRaw: Boolean(options.includeRaw)
    });
    if (!record) {
      continue;
    }
    records.push(Object.assign(record, {
      _filePath: entry.filePath,
      _mtimeMs: entry.mtimeMs
    }));
  }
  return records.sort((left, right) => {
    const leftTime = Date.parse(left.completed_at || left.started_at || left.requested_at || "") || left._mtimeMs || 0;
    const rightTime = Date.parse(right.completed_at || right.started_at || right.requested_at || "") || right._mtimeMs || 0;
    return rightTime - leftTime;
  });
}

function listSafeOperations(options) {
  return listOperations(options)
    .slice(0, options.limit || 20)
    .map((operation) => {
      const safe = Object.assign({}, operation);
      delete safe.raw;
      delete safe._filePath;
      delete safe._mtimeMs;
      return safe;
    });
}

function readOperationById(options) {
  const { runtimePath } = getProjectState(options);
  const operationId = String(options.operationId || "").trim();
  if (!operationId) {
    return null;
  }
  const filePath = getOperationPath(runtimePath, operationId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const operation = readOperationRecord(filePath, {
    includeRaw: Boolean(options.includeRaw)
  });
  return operation ? { operation, operationPath: filePath } : null;
}

function createRequestedOperation(options) {
  const { runtimePath, slug } = getProjectState(options);
  const operationId = String(options.operationId || createOperationId());
  const createdAt = options.requestedAt || nowIso();
  const operation = {
    schema: PROJECT_OPERATION_SCHEMA,
    version: PROJECT_OPERATION_VERSION,
    operation_id: operationId,
    project_slug: slug,
    operation_type: options.operationType,
    status: "requested",
    stage: "validating",
    idempotency_key_hash: options.idempotencyKeyHash || null,
    request_fingerprint: options.requestFingerprint || null,
    requested_at: createdAt,
    started_at: null,
    heartbeat_at: createdAt,
    completed_at: null,
    metadata: safeObject(options.metadata),
    proof_ref: null,
    result_summary: {},
    error: {},
    safety: Object.assign({
      live_ai_used: false,
      apply_used: false,
      rollback_used: false
    }, safeObject(options.safety))
  };
  const operationPath = getOperationPath(runtimePath, operationId);
  writeJsonAtomic(operationPath, operation);
  return {
    operationPath,
    operation: sanitizeOperation(operation)
  };
}

function updateOperation(options) {
  const existing = readOperationById({
    slug: options.slug,
    projectsRoot: options.projectsRoot,
    operationId: options.operationId,
    includeRaw: true
  });
  if (!existing) {
    const error = new Error("Project operation not found.");
    error.code = "project_operation_not_found";
    error.statusCode = 404;
    throw error;
  }

  const raw = safeObject(existing.operation.raw);
  if (raw.schema !== PROJECT_OPERATION_SCHEMA) {
    const error = new Error("Legacy operation records are read-only.");
    error.code = "legacy_operation_read_only";
    error.statusCode = 409;
    throw error;
  }

  const patch = safeObject(options.patch);
  const next = Object.assign({}, raw, patch, {
    metadata: Object.assign({}, safeObject(raw.metadata), safeObject(patch.metadata)),
    result_summary: Object.assign({}, safeObject(raw.result_summary), safeObject(patch.result_summary)),
    error: Object.assign({}, safeObject(raw.error), safeObject(patch.error)),
    safety: Object.assign({}, safeObject(raw.safety), safeObject(patch.safety))
  });
  writeJsonAtomic(existing.operationPath, next);
  return {
    operationPath: existing.operationPath,
    operation: sanitizeOperation(next)
  };
}

function findOperationByIdempotencyHash(options) {
  const targetHash = String(options.idempotencyKeyHash || "");
  if (!targetHash) {
    return null;
  }
  for (const operation of listOperations({
    slug: options.slug,
    projectsRoot: options.projectsRoot,
    includeRaw: true
  })) {
    if (!operation.raw || operation.raw.schema !== PROJECT_OPERATION_SCHEMA) {
      continue;
    }
    if (String(operation.raw.idempotency_key_hash || "") === targetHash) {
      return operation;
    }
  }
  return null;
}

function findSuccessfulControlledGenerateByPlanId(options) {
  const planId = String(options.planId || "").trim();
  if (!planId) {
    return null;
  }
  for (const operation of listOperations({
    slug: options.slug,
    projectsRoot: options.projectsRoot,
    includeRaw: false
  })) {
    if (operation.operation_type !== "controlled_generate" || operation.status !== "succeeded") {
      continue;
    }
    if (operation.metadata && operation.metadata.plan_id === planId) {
      return operation;
    }
  }
  return null;
}

function readLock(runtimePath) {
  const lockDir = getLockDirectory(runtimePath);
  const metadataPath = path.join(lockDir, "lock.json");
  if (!fs.existsSync(metadataPath)) {
    return null;
  }
  const metadata = tryReadJsonFile(metadataPath);
  if (!metadata) {
    return null;
  }
  return {
    lockDir,
    metadata
  };
}

function writeLockMetadata(runtimePath, metadata) {
  const lockDir = getLockDirectory(runtimePath);
  writeJsonAtomic(path.join(lockDir, "lock.json"), metadata);
}

function removeLock(runtimePath) {
  const lockDir = getLockDirectory(runtimePath);
  if (fs.existsSync(lockDir)) {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

function quarantineLock(runtimePath) {
  const lockDir = getLockDirectory(runtimePath);
  if (!fs.existsSync(lockDir)) {
    return null;
  }
  const target = lockDir + ".stale-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
  fs.renameSync(lockDir, target);
  return target;
}

module.exports = {
  LEGACY_GENERATION_OPERATION_SCHEMA,
  LOCK_SCHEMA,
  LOCK_VERSION,
  PROJECT_OPERATION_SCHEMA,
  PROJECT_OPERATION_VERSION,
  createOperationId,
  createRequestedOperation,
  findOperationByIdempotencyHash,
  findSuccessfulControlledGenerateByPlanId,
  getLockDirectory,
  getOperationPath,
  getOperationsDirectory,
  getProjectState,
  hashValue,
  listOperations,
  listSafeOperations,
  normalizeLegacyGenerationOperation,
  normalizeOperationRecord,
  nowIso,
  quarantineLock,
  readLock,
  readOperationById,
  removeLock,
  sanitizeOperation,
  updateOperation,
  writeJsonAtomic,
  writeLockMetadata
};
