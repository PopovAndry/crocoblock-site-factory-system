"use strict";

const { validateExplicitSlug } = require("./project-store");

const generationLocks = new Map();

function normalizeGenerationLockSlug(slug) {
  return validateExplicitSlug(slug);
}

function acquireGenerationMutationLock(slug, operation) {
  const lockKey = normalizeGenerationLockSlug(slug);
  const existing = generationLocks.get(lockKey);

  if (existing) {
    const error = new Error(
      "A generation operation is already in progress for project " + lockKey + "."
    );
    error.code = "generation_operation_in_progress";
    error.statusCode = 409;
    error.current_operation = existing.operation;
    error.project_slug = lockKey;
    throw error;
  }

  const lockRecord = {
    operation: String(operation || "controlled_generate"),
    acquired_at: new Date().toISOString()
  };
  generationLocks.set(lockKey, lockRecord);

  let released = false;
  return function releaseGenerationMutationLock() {
    if (released) {
      return;
    }
    released = true;
    const current = generationLocks.get(lockKey);
    if (current === lockRecord) {
      generationLocks.delete(lockKey);
    }
  };
}

async function withGenerationMutationLock(slug, operation, handler) {
  const release = acquireGenerationMutationLock(slug, operation);
  try {
    return await handler();
  } finally {
    release();
  }
}

function getGenerationMutationLock(slug) {
  const lockKey = normalizeGenerationLockSlug(slug);
  return generationLocks.get(lockKey) || null;
}

module.exports = {
  acquireGenerationMutationLock,
  getGenerationMutationLock,
  normalizeGenerationLockSlug,
  withGenerationMutationLock
};
