"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  LOCK_SCHEMA,
  LOCK_VERSION,
  createOperationId,
  createRequestedOperation,
  findOperationByIdempotencyHash,
  getLockDirectory,
  getProjectState,
  hashValue,
  listOperations,
  listSafeOperations,
  nowIso,
  quarantineLock,
  readLock,
  removeLock,
  updateOperation,
  writeLockMetadata
} = require("./project-operation-store");

const PROCESS_INSTANCE_ID = "launcher-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
const DEFAULT_STALE_LOCK_HEARTBEAT_MS = 60000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 2000;
const ALLOWED_OPERATION_TYPES = new Set([
  "provision",
  "install_agent",
  "install_dependency",
  "controlled_generate",
  "state_apply",
  "state_rollback",
  "structural_snapshot_create",
  "structural_restore_execute",
  "agent_auth_rotate",
  "agent_auth_revoke",
  "create_website"
]);

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

function validateOperationType(operationType) {
  const safeType = String(operationType || "").trim();
  if (!ALLOWED_OPERATION_TYPES.has(safeType)) {
    const error = new Error("Unsupported project operation type.");
    error.code = "unsupported_project_operation_type";
    error.statusCode = 400;
    throw error;
  }
  return safeType;
}

function validateIdempotencyKey(input) {
  const key = String(input || "").trim();
  if (!key) {
    return {
      raw: "server:" + crypto.randomUUID(),
      generated: true
    };
  }

  if (key.length < 16 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    const error = new Error("Idempotency-Key is invalid.");
    error.code = "invalid_idempotency_key";
    error.statusCode = 400;
    throw error;
  }

  return {
    raw: key,
    generated: false
  };
}

function safeCurrentOperation(operation) {
  if (!operation) {
    return null;
  }
  return {
    operation_id: operation.operation_id || null,
    operation_type: operation.operation_type || null,
    status: operation.status || "unknown",
    stage: operation.stage || null,
    requested_at: operation.requested_at || null,
    started_at: operation.started_at || null
  };
}

function createCoordinatorError(message, code, statusCode, extras) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (extras && typeof extras === "object") {
    Object.assign(error, extras);
  }
  return error;
}

function createConflictError(operation) {
  return createCoordinatorError(
    "A project operation is already in progress.",
    "project_operation_in_progress",
    409,
    {
      current_operation: safeCurrentOperation(operation)
    }
  );
}

function sanitizeFailure(error, stage) {
  return {
    code: error && error.code ? String(error.code) : "project_operation_failed",
    message: error && error.message ? String(error.message).replace(/\s+\(proof: .+\)$/i, "") : "Project operation failed.",
    stage: stage || null
  };
}

function pidIsAlive(pid) {
  const numericPid = Number(pid || 0);
  if (!numericPid) {
    return false;
  }
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function lockIsStale(lockMetadata, options) {
  const heartbeatAt = Date.parse(lockMetadata && lockMetadata.heartbeat_at || lockMetadata && lockMetadata.acquired_at || "");
  const heartbeatAge = Number.isFinite(heartbeatAt) ? Date.now() - heartbeatAt : Number.POSITIVE_INFINITY;
  const heartbeatExpired = heartbeatAge > (options.staleLockHeartbeatMs || DEFAULT_STALE_LOCK_HEARTBEAT_MS);
  const ownerAlive = pidIsAlive(lockMetadata && lockMetadata.pid);

  return !ownerAlive || heartbeatExpired;
}

function markOperationInterrupted(options) {
  const lockMetadata = options.lockMetadata || {};
  const operationId = String(lockMetadata.operation_id || "").trim();
  if (!operationId) {
    return null;
  }

  const existing = listOperations({
    slug: options.slug,
    projectsRoot: options.projectsRoot,
    includeRaw: true
  }).find((operation) => operation.operation_id === operationId);

  if (!existing || existing.status !== "requested" && existing.status !== "running") {
    return existing || null;
  }

  return updateOperation({
    slug: options.slug,
    projectsRoot: options.projectsRoot,
    operationId,
    patch: {
      status: "interrupted",
      stage: existing.stage || "interrupted",
      completed_at: nowIso(),
      error: {
        code: "operation_interrupted",
        message: "The operation was interrupted before completion.",
        stage: existing.stage || "interrupted"
      }
    }
  }).operation;
}

function reconcileInterruptedOperations(options) {
  const { runtimePath, slug } = getProjectState(options);
  const lock = readLock(runtimePath);
  let activeLockOperationId = lock && lock.metadata ? String(lock.metadata.operation_id || "") : "";
  if (lock && lock.metadata && lockIsStale(lock.metadata, options)) {
    const stalePath = quarantineLock(runtimePath);
    try {
      markOperationInterrupted({
        slug,
        projectsRoot: options.projectsRoot,
        lockMetadata: lock.metadata
      });
      activeLockOperationId = "";
    } finally {
      if (stalePath && fs.existsSync(stalePath)) {
        fs.rmSync(stalePath, { recursive: true, force: true });
      }
    }
  }
  const operations = listOperations({
    slug,
    projectsRoot: options.projectsRoot,
    includeRaw: true
  });
  const reconciled = [];

  for (const operation of operations) {
    if (operation.legacy || operation.status !== "requested" && operation.status !== "running") {
      continue;
    }
    if (activeLockOperationId && operation.operation_id === activeLockOperationId) {
      continue;
    }
    const updated = updateOperation({
      slug,
      projectsRoot: options.projectsRoot,
      operationId: operation.operation_id,
      patch: {
        status: "interrupted",
        stage: operation.stage || "interrupted",
        completed_at: nowIso(),
        error: {
          code: "operation_interrupted",
          message: "The operation was interrupted before completion.",
          stage: operation.stage || "interrupted"
        }
      }
    }).operation;
    reconciled.push(updated);
  }

  return reconciled;
}

function acquireProjectLock(options) {
  const { runtimePath, slug } = getProjectState(options);
  const lockDir = getLockDirectory(runtimePath);
  const acquiredAt = nowIso();
  const metadata = {
    schema: LOCK_SCHEMA,
    version: LOCK_VERSION,
    operation_id: options.operationId,
    operation_type: options.operationType,
    project_slug: slug,
    pid: process.pid,
    process_instance_id: PROCESS_INSTANCE_ID,
    acquired_at: acquiredAt,
    heartbeat_at: acquiredAt
  };

  try {
    fs.mkdirSync(lockDir);
    writeLockMetadata(runtimePath, metadata);
    return {
      metadata,
      release() {
        const current = readLock(runtimePath);
        if (current && current.metadata && current.metadata.operation_id === metadata.operation_id) {
          removeLock(runtimePath);
        }
      },
      heartbeat() {
        const current = readLock(runtimePath);
        if (!current || !current.metadata || current.metadata.operation_id !== metadata.operation_id) {
          return false;
        }
        metadata.heartbeat_at = nowIso();
        writeLockMetadata(runtimePath, metadata);
        return true;
      }
    };
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }

    const existing = readLock(runtimePath);
    if (existing && existing.metadata && lockIsStale(existing.metadata, options)) {
      const stalePath = quarantineLock(runtimePath);
      try {
        markOperationInterrupted({
          slug,
          projectsRoot: options.projectsRoot,
          lockMetadata: existing.metadata
        });
      } finally {
        if (stalePath && fs.existsSync(stalePath)) {
          fs.rmSync(stalePath, { recursive: true, force: true });
        }
      }
      return acquireProjectLock(options);
    }

    throw createConflictError(existing && existing.metadata
      ? {
        operation_id: existing.metadata.operation_id,
        operation_type: existing.metadata.operation_type,
        status: "running",
        stage: "executing",
        requested_at: existing.metadata.acquired_at,
        started_at: existing.metadata.acquired_at
      }
      : null);
  }
}

function checkIdempotency(options) {
  const existing = findOperationByIdempotencyHash({
    slug: options.slug,
    projectsRoot: options.projectsRoot,
    idempotencyKeyHash: options.idempotencyKeyHash
  });
  if (!existing) {
    return null;
  }

  if (options.ignoreOperationId && existing.operation_id === options.ignoreOperationId) {
    return null;
  }

  const raw = existing.raw || {};
  if (String(raw.request_fingerprint || "") !== String(options.requestFingerprint || "")) {
    throw createCoordinatorError(
      "Idempotency-Key was already used for a different request.",
      "idempotency_key_conflict",
      409
    );
  }

  if (existing.status === "succeeded") {
    const replayOperation = Object.assign({}, existing, {
      idempotent_replay: true
    });
    delete replayOperation.raw;
    delete replayOperation._filePath;
    delete replayOperation._mtimeMs;

    return {
      replay: true,
      operation: replayOperation
    };
  }

  if (existing.status === "requested" || existing.status === "running") {
    throw createConflictError(existing);
  }

  const resumeStatuses = new Set(Array.isArray(options.resumeStatuses)
    ? options.resumeStatuses.map((status) => String(status || ""))
    : (options.allowInterruptedResume === true ? ["interrupted"] : []));

  if (resumeStatuses.has(existing.status)) {
    const resumeOperation = Object.assign({}, existing, {
      idempotent_replay: false
    });
    delete resumeOperation.raw;
    delete resumeOperation._filePath;
    delete resumeOperation._mtimeMs;

    return {
      replay: false,
      resume: true,
      operation: resumeOperation
    };
  }

  if (existing.status === "failed" || existing.status === "interrupted") {
    throw createCoordinatorError(
      "Retry requires a new Idempotency-Key.",
      "operation_retry_requires_new_idempotency_key",
      409,
      {
        current_operation: safeCurrentOperation(existing)
      }
    );
  }

  return null;
}

function computeRequestFingerprint(input) {
  return hashValue(stableStringify(input));
}

async function runProjectOperation(options) {
  const operationType = validateOperationType(options.operationType);
  const projectInfo = getProjectState({
    slug: options.slug,
    projectsRoot: options.projectsRoot
  });
  const idempotency = validateIdempotencyKey(options.idempotencyKey);
  const idempotencyKeyHash = hashValue(idempotency.raw);
  const requestFingerprint = options.requestFingerprint || computeRequestFingerprint({
    project_slug: projectInfo.slug,
    operation_type: operationType,
    input: options.fingerprintInput || {}
  });
  const metadata = options.metadata && typeof options.metadata === "object" ? options.metadata : {};
  const safety = options.safety && typeof options.safety === "object" ? options.safety : {};
  const resumeStatuses = Array.isArray(options.resumeStatuses)
    ? options.resumeStatuses.slice()
    : (options.allowInterruptedResume === true ? ["interrupted"] : []);

  reconcileInterruptedOperations({
    slug: projectInfo.slug,
    projectsRoot: projectInfo.projectsRoot
  });

  const replayBeforeLock = checkIdempotency({
    slug: projectInfo.slug,
    projectsRoot: projectInfo.projectsRoot,
    idempotencyKeyHash,
    requestFingerprint,
    resumeStatuses
  });
  if (replayBeforeLock && replayBeforeLock.replay) {
    return {
      idempotentReplay: true,
      operation: replayBeforeLock.operation,
      result: null
    };
  }
  const resumeOperation = replayBeforeLock && replayBeforeLock.resume
    ? replayBeforeLock.operation
    : null;

  const operationId = resumeOperation
    ? resumeOperation.operation_id
    : (options.operationId || createOperationId());
  const lock = acquireProjectLock({
    slug: projectInfo.slug,
    projectsRoot: projectInfo.projectsRoot,
    operationId,
    operationType,
    staleLockHeartbeatMs: options.staleLockHeartbeatMs
  });
  let heartbeatTimer = null;
  let currentStage = "validating";
  let requestedOperation = null;

  try {
    const replayAfterLock = checkIdempotency({
      slug: projectInfo.slug,
      projectsRoot: projectInfo.projectsRoot,
      idempotencyKeyHash,
      requestFingerprint,
      resumeStatuses,
      ignoreOperationId: resumeOperation ? operationId : null
    });
    if (replayAfterLock && replayAfterLock.replay) {
      return {
        idempotentReplay: true,
        operation: replayAfterLock.operation,
        result: null
      };
    }

    if (resumeOperation) {
      const resumed = updateOperation({
        slug: projectInfo.slug,
        projectsRoot: projectInfo.projectsRoot,
        operationId,
        patch: {
          status: "running",
          stage: resumeOperation.stage || "executing",
          heartbeat_at: nowIso(),
          completed_at: null,
          error: {
            code: null,
            message: null,
            stage: null
          }
        }
      });
      requestedOperation = {
        operation: resumed.operation
      };
    } else {
      requestedOperation = createRequestedOperation({
        slug: projectInfo.slug,
        projectsRoot: projectInfo.projectsRoot,
        operationId,
        operationType,
        idempotencyKeyHash,
        requestFingerprint,
        metadata,
        safety
      });
      updateOperation({
        slug: projectInfo.slug,
        projectsRoot: projectInfo.projectsRoot,
        operationId,
        patch: {
          status: "running",
          stage: "preparing",
          started_at: nowIso(),
          heartbeat_at: nowIso()
        }
      });
    }

    heartbeatTimer = setInterval(() => {
      try {
        const ok = lock.heartbeat();
        if (ok) {
          updateOperation({
            slug: projectInfo.slug,
            projectsRoot: projectInfo.projectsRoot,
            operationId,
            patch: {
              heartbeat_at: nowIso()
            }
          });
        }
      } catch (error) {
        // Best-effort heartbeat; the main operation path will still fail safely.
      }
    }, options.heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS);
    if (heartbeatTimer.unref) {
      heartbeatTimer.unref();
    }

    const setStage = async (stage, patch) => {
      currentStage = String(stage || currentStage || "executing");
      return updateOperation({
        slug: projectInfo.slug,
        projectsRoot: projectInfo.projectsRoot,
        operationId,
        patch: Object.assign({
          status: "running",
          stage: currentStage,
          heartbeat_at: nowIso()
        }, patch || {})
      }).operation;
    };

    await setStage("executing");
    const execution = await options.execute({
      operationId,
      operation: requestedOperation.operation,
      projectState: projectInfo.projectState,
      projectsRoot: projectInfo.projectsRoot,
      setStage
    });

    await setStage("verifying");
    const proofRef = execution && execution.proofRef || null;
    const resultSummary = execution && execution.resultSummary && typeof execution.resultSummary === "object"
      ? execution.resultSummary
      : {};
    const succeeded = updateOperation({
      slug: projectInfo.slug,
      projectsRoot: projectInfo.projectsRoot,
      operationId,
      patch: {
        status: "succeeded",
        stage: "completed",
        heartbeat_at: nowIso(),
        completed_at: nowIso(),
        proof_ref: proofRef,
        result_summary: resultSummary,
        error: {
          code: null,
          message: null,
          stage: null
        }
      }
    });

    return {
      idempotentReplay: false,
      operation: succeeded.operation,
      result: execution ? execution.result : null
    };
  } catch (error) {
    if (requestedOperation) {
      updateOperation({
        slug: projectInfo.slug,
        projectsRoot: projectInfo.projectsRoot,
        operationId,
        patch: {
          status: "failed",
          stage: currentStage || "failed",
          completed_at: nowIso(),
          result_summary: error && error.result_summary && typeof error.result_summary === "object"
            ? error.result_summary
            : {},
          error: sanitizeFailure(error, currentStage || "failed")
        }
      });
    }
    throw error;
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    lock.release();
  }
}

function getProjectOperationsStatus(options) {
  const projectInfo = getProjectState(options);
  reconcileInterruptedOperations({
    slug: projectInfo.slug,
    projectsRoot: projectInfo.projectsRoot
  });
  const operations = listSafeOperations({
    slug: projectInfo.slug,
    projectsRoot: projectInfo.projectsRoot,
    limit: options.limit || 20
  });
  const activeOperation = operations.find((operation) => operation.status === "requested" || operation.status === "running") || null;

  return {
    project: projectInfo.projectState.project,
    active_operation: activeOperation,
    operations
  };
}

module.exports = {
  PROCESS_INSTANCE_ID,
  computeRequestFingerprint,
  acquireProjectLock,
  getProjectOperationsStatus,
  reconcileInterruptedOperations,
  runProjectOperation,
  safeCurrentOperation,
  validateIdempotencyKey
};
