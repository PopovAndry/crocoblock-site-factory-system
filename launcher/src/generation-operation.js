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
  findSuccessfulControlledGenerateByPlanId,
  listOperations
} = require("./project-operation-store");

const OPERATION_SCHEMA = "factory_generation_operation";
const OPERATION_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

function timestampCompact() {
  return nowIso().replace(/[:.]/g, "-");
}

function createOperationId() {
  return "genop-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
}

function normalizePlanId(planId) {
  const safePlanId = String(planId || "").trim();
  if (!safePlanId) {
    const error = new Error("Generation requires a server-issued plan_id.");
    error.code = "generation_plan_id_required";
    error.statusCode = 400;
    throw error;
  }

  if (!/^run-[a-z0-9-]+$/i.test(safePlanId)) {
    const error = new Error("Generation plan_id format is invalid.");
    error.code = "generation_plan_id_invalid";
    error.statusCode = 400;
    throw error;
  }

  return safePlanId;
}

function getOperationsDirectory(runtimePath) {
  return path.join(runtimePath, "runs", "operations");
}

function getOperationPath(runtimePath, operationId) {
  return path.join(getOperationsDirectory(runtimePath), operationId + ".json");
}

function writeJsonAtomic(filePath, value) {
  const tmpPath = filePath + ".tmp-" + process.pid + "-" + crypto.randomBytes(3).toString("hex");
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmpPath, filePath);
}

function safeJsonRead(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeProjectState(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const safeSlug = validateExplicitSlug(options.slug);
  const projectState = readProjectBySlug(safeSlug, projectsRoot);
  assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  ensureDirectory(getOperationsDirectory(projectState.runtimePath));
  return {
    projectsRoot,
    projectState,
    slug: safeSlug
  };
}

function listOperationEntries(runtimePath) {
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
        mtimeMs: fs.statSync(filePath).mtimeMs
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function sanitizeOperation(operation, operationPath) {
  const safeOperation = operation && typeof operation === "object" ? operation : {};
  return {
    schema: safeOperation.schema || OPERATION_SCHEMA,
    version: Number(safeOperation.version || OPERATION_VERSION),
    operation_id: safeOperation.operation_id || null,
    project_slug: safeOperation.project_slug || null,
    operation_type: safeOperation.operation_type || "controlled_generate",
    status: safeOperation.status || "unknown",
    status_detail: safeOperation.status_detail || null,
    plan_id: safeOperation.plan_id || null,
    prompt_hash: safeOperation.prompt_hash || null,
    requested_at: safeOperation.requested_at || null,
    started_at: safeOperation.started_at || null,
    completed_at: safeOperation.completed_at || null,
    proof_path: safeOperation.proof_path || null,
    result_summary: safeOperation.result_summary && typeof safeOperation.result_summary === "object"
      ? safeOperation.result_summary
      : {},
    error: safeOperation.error && typeof safeOperation.error === "object"
      ? safeOperation.error
      : {},
    safety: safeOperation.safety && typeof safeOperation.safety === "object"
      ? safeOperation.safety
      : {
        live_ai_used: false,
        apply_used: false,
        rollback_used: false
      },
    operation_path: operationPath || null
  };
}

function createGenerationOperation(options) {
  const { projectState, slug } = normalizeProjectState(options);
  const operationId = options.operationId ? String(options.operationId) : createOperationId();
  const planId = normalizePlanId(options.planId);
  const createdAt = nowIso();
  const operation = {
    schema: OPERATION_SCHEMA,
    version: OPERATION_VERSION,
    operation_id: operationId,
    project_slug: slug,
    operation_type: "controlled_generate",
    status: "requested",
    status_detail: String(options.statusDetail || "preparing"),
    plan_id: planId,
    prompt_hash: String(options.promptHash || ""),
    requested_at: createdAt,
    started_at: null,
    completed_at: null,
    proof_path: null,
    result_summary: {},
    error: {},
    safety: {
      live_ai_used: false,
      apply_used: false,
      rollback_used: false
    }
  };
  const operationPath = getOperationPath(projectState.runtimePath, operationId);
  writeJsonAtomic(operationPath, operation);
  return {
    project: projectState.project,
    operation: sanitizeOperation(operation, operationPath),
    operationPath
  };
}

function readGenerationOperation(options) {
  const { projectState } = normalizeProjectState(options);
  const operationId = String(options.operationId || "").trim();
  if (!operationId) {
    return null;
  }

  const operationPath = getOperationPath(projectState.runtimePath, operationId);
  if (!fs.existsSync(operationPath)) {
    return null;
  }

  return {
    operationPath,
    operation: sanitizeOperation(safeJsonRead(operationPath), operationPath)
  };
}

function updateGenerationOperation(options) {
  const { projectState } = normalizeProjectState(options);
  const existing = readGenerationOperation({
    slug: projectState.project.slug,
    projectsRoot: options.projectsRoot,
    operationId: options.operationId
  });

  if (!existing) {
    const error = new Error("Generation operation not found: " + String(options.operationId || ""));
    error.code = "generation_operation_not_found";
    error.statusCode = 404;
    throw error;
  }

  const patch = options.patch && typeof options.patch === "object" ? options.patch : {};
  const nextOperation = Object.assign({}, existing.operation, patch, {
    result_summary: Object.assign({}, existing.operation.result_summary || {}, patch.result_summary || {}),
    error: Object.assign({}, existing.operation.error || {}, patch.error || {}),
    safety: Object.assign({}, existing.operation.safety || {}, patch.safety || {})
  });

  writeJsonAtomic(existing.operationPath, nextOperation);
  return {
    operationPath: existing.operationPath,
    operation: sanitizeOperation(nextOperation, existing.operationPath)
  };
}

function getLatestGenerationOperation(options) {
  const operations = listOperations({
    slug: options.slug,
    projectsRoot: options.projectsRoot
  });
  if (!operations.length) {
    return null;
  }

  return {
    operationPath: operations[0]._filePath || null,
    operation: operations[0]
  };
}

function findSuccessfulOperationByPlanId(options) {
  const planId = normalizePlanId(options.planId);
  const canonical = findSuccessfulControlledGenerateByPlanId({
    slug: options.slug,
    projectsRoot: options.projectsRoot,
    planId
  });

  if (canonical) {
    return {
      operationPath: canonical._filePath || null,
      operation: Object.assign({}, canonical, {
        proof_path: canonical.proof_ref || null,
        plan_id: canonical.metadata && canonical.metadata.plan_id || null,
        prompt_hash: canonical.metadata && canonical.metadata.prompt_hash || null
      })
    };
  }

  const { projectState } = normalizeProjectState(options);
  for (const entry of listOperationEntries(projectState.runtimePath)) {
    const operation = sanitizeOperation(safeJsonRead(entry.filePath), entry.filePath);
    if (operation.plan_id === planId && operation.status === "succeeded") {
      return {
        operationPath: entry.filePath,
        operation
      };
    }
  }

  return null;
}

function interruptOperationIfStale(options) {
  const latest = getLatestGenerationOperation(options);
  if (!latest) {
    return null;
  }

  if (latest.operation.status !== "requested" && latest.operation.status !== "running") {
    return latest;
  }

  if (options.hasActiveLock === true) {
    return latest;
  }

  return updateGenerationOperation({
    slug: options.slug,
    projectsRoot: options.projectsRoot,
    operationId: latest.operation.operation_id,
    patch: {
      status: "interrupted",
      status_detail: "interrupted",
      completed_at: nowIso(),
      error: {
        code: "generation_operation_interrupted",
        message: "Launcher restarted or the in-memory operation lock was lost before completion."
      }
    }
  });
}

module.exports = {
  OPERATION_SCHEMA,
  OPERATION_VERSION,
  createGenerationOperation,
  findSuccessfulOperationByPlanId,
  getLatestGenerationOperation,
  getOperationPath,
  interruptOperationIfStale,
  normalizePlanId,
  readGenerationOperation,
  sanitizeOperation,
  updateGenerationOperation
};
