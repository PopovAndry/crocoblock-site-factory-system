"use strict";

const { validateExplicitSlug } = require("./project-store");

const setupLocks = new Map();

function normalizeSetupLockSlug(slug) {
  return validateExplicitSlug(slug);
}

function acquireSetupMutationLock(slug, operation) {
  const lockKey = normalizeSetupLockSlug(slug);
  const existing = setupLocks.get(lockKey);

  if (existing) {
    const error = new Error(
      "A setup operation is already in progress for project " + lockKey + "."
    );
    error.code = "setup_operation_in_progress";
    error.statusCode = 409;
    error.current_operation = existing.operation;
    error.project_slug = lockKey;
    throw error;
  }

  const lockRecord = {
    operation: String(operation || "setup_operation"),
    acquired_at: new Date().toISOString()
  };
  setupLocks.set(lockKey, lockRecord);

  let released = false;
  return function releaseSetupMutationLock() {
    if (released) {
      return;
    }
    released = true;
    const current = setupLocks.get(lockKey);
    if (current === lockRecord) {
      setupLocks.delete(lockKey);
    }
  };
}

async function withSetupMutationLock(slug, operation, handler) {
  const release = acquireSetupMutationLock(slug, operation);
  try {
    return await handler();
  } finally {
    release();
  }
}

function getSetupMutationLock(slug) {
  const lockKey = normalizeSetupLockSlug(slug);
  return setupLocks.get(lockKey) || null;
}

module.exports = {
  acquireSetupMutationLock,
  getSetupMutationLock,
  normalizeSetupLockSlug,
  withSetupMutationLock
};
