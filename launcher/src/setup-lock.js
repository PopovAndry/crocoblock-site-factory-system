"use strict";

const {
  getProjectOperationsStatus,
  runProjectOperation
} = require("./project-operation-coordinator");
const { validateExplicitSlug } = require("./project-store");

function normalizeSetupLockSlug(slug) {
  return validateExplicitSlug(slug);
}

function getSetupMutationLock(slug, projectsRoot) {
  const status = getProjectOperationsStatus({
    slug,
    projectsRoot,
    limit: 1
  });
  return status.active_operation
    ? { operation: status.active_operation.operation_type || status.active_operation.operation_id }
    : null;
}

async function withSetupMutationLock(slug, operation, handler, options) {
  const safeOperation = String(operation || "setup_operation");
  const operationType = safeOperation === "provision"
    ? "provision"
    : (safeOperation === "install-agent" ? "install_agent" : "install_dependency");
  const result = await runProjectOperation({
    slug,
    projectsRoot: options && options.projectsRoot,
    operationType,
    idempotencyKey: options && options.idempotencyKey,
    fingerprintInput: options && options.fingerprintInput || { operation: safeOperation },
    metadata: options && options.metadata || {},
    execute: async () => {
      const businessResult = await handler();
      return {
        result: businessResult,
        proofRef: businessResult && businessResult.proofPath || null,
        resultSummary: {
          status: "ok",
          proof_ref: businessResult && businessResult.proofPath || null
        }
      };
    }
  });
  return result.result;
}

module.exports = {
  getSetupMutationLock,
  normalizeSetupLockSlug,
  withSetupMutationLock
};
