"use strict";

const {
  getProjectOperationsStatus,
  runProjectOperation
} = require("./project-operation-coordinator");
const { validateExplicitSlug } = require("./project-store");

function normalizeGenerationLockSlug(slug) {
  return validateExplicitSlug(slug);
}

function getGenerationMutationLock(slug, projectsRoot) {
  const status = getProjectOperationsStatus({
    slug,
    projectsRoot,
    limit: 1
  });
  return status.active_operation
    ? { operation: status.active_operation.operation_type || status.active_operation.operation_id }
    : null;
}

async function withGenerationMutationLock(slug, operation, handler, options) {
  const result = await runProjectOperation({
    slug,
    projectsRoot: options && options.projectsRoot,
    operationType: "controlled_generate",
    idempotencyKey: options && options.idempotencyKey,
    fingerprintInput: options && options.fingerprintInput || { operation: String(operation || "controlled_generate") },
    metadata: options && options.metadata || {},
    execute: async (context) => {
      const businessResult = await handler(context);
      return {
        result: businessResult,
        proofRef: businessResult && businessResult.proofPath || null,
        resultSummary: {
          status: businessResult && businessResult.executeData && businessResult.executeData.status || "ok",
          code: businessResult && businessResult.executeData && businessResult.executeData.code || "controlled_generate_completed",
          proof_ref: businessResult && businessResult.proofPath || null
        }
      };
    }
  });
  return result.result;
}

module.exports = {
  getGenerationMutationLock,
  normalizeGenerationLockSlug,
  withGenerationMutationLock
};
