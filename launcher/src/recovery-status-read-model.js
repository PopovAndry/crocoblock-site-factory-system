"use strict";

const fs = require("fs");
const path = require("path");
const {
  assertSafeRuntimePath,
  readProjectBySlug,
  resolveProjectsRoot,
  validateExplicitSlug
} = require("./project-store");
const {
  deriveProjectBinding,
  listManifests
} = require("./structural-snapshot-store");
const {
  RESTORE_PLAN_DIRECTORY,
  validateRestorePlanId
} = require("./structural-restore-plan");
const {
  readRestoreJournal
} = require("./structural-restore-reconciliation");
const {
  getOperationsDirectory,
  normalizeOperationRecord
} = require("./project-operation-store");
const {
  evaluateRecoveryStorageGovernance
} = require("./recovery-storage-governance");

const SCHEMA_VERSION = 1;
const RESTORE_OPERATION_TYPE = "structural_restore_execute";

const SAFE_MESSAGES = Object.freeze({
  recovery_point_not_available: "No usable Recovery Point is available.",
  newer_recovery_point_unusable: "A newer Recovery Point needs review before it can be used.",
  storage_approaching_limit: "Recovery storage is approaching its limit.",
  storage_cleanup_recommended: "Recovery storage needs attention.",
  new_capture_blocked: "New Recovery Points are temporarily blocked by storage limits.",
  restore_only_emergency: "Recovery storage is critically low.",
  restore_plan_ready: "A restore review is ready.",
  restore_awaiting_confirmation: "A restore is waiting for confirmation.",
  expired_restore_plan_ignored: "An expired restore review was ignored.",
  restore_running: "A restore is currently running.",
  restore_interrupted: "A restore was interrupted.",
  restore_reconciliation_required: "Restore recovery needs to be resumed.",
  restore_failed: "The latest restore did not complete.",
  restore_completed: "The latest restore completed.",
  restore_state_conflict: "Recovery status needs support review.",
  recovery_metadata_unreadable: "Recovery metadata could not be read safely.",
  recovery_state_unknown: "Recovery status could not be determined safely.",
  unsupported_recovery_metadata: "Recovery metadata is not supported by this Launcher version.",
  cross_project_recovery_state: "Recovery state does not belong to this project."
});

const WARNING_CODES = new Set([
  "newer_recovery_point_unusable",
  "storage_approaching_limit",
  "storage_cleanup_recommended",
  "new_capture_blocked",
  "restore_only_emergency",
  "restore_plan_ready",
  "restore_awaiting_confirmation",
  "expired_restore_plan_ignored",
  "restore_running",
  "restore_interrupted",
  "restore_reconciliation_required",
  "restore_failed",
  "restore_completed"
]);

const BLOCKER_CODES = new Set([
  "recovery_point_not_available",
  "restore_state_conflict",
  "recovery_metadata_unreadable",
  "recovery_state_unknown",
  "unsupported_recovery_metadata",
  "cross_project_recovery_state"
]);

const STORAGE_ACTIONS = Object.freeze({
  healthy: "none",
  approaching_limit: "review_storage",
  cleanup_recommended: "review_storage",
  capture_blocked: "review_storage",
  restore_only_emergency: "review_storage",
  unknown: "contact_support"
});

function nowIso(clock) {
  const value = typeof clock === "function" ? clock() : new Date();
  return new Date(value).toISOString();
}

function safeIssue(code) {
  const safeCode = String(code || "recovery_state_unknown");
  const knownCode = SAFE_MESSAGES[safeCode] ? safeCode : "recovery_state_unknown";
  return {
    code: knownCode,
    message: SAFE_MESSAGES[knownCode]
  };
}

function addIssue(target, code, allowed) {
  if (!allowed.has(code)) {
    code = "recovery_state_unknown";
  }
  if (!target.some((entry) => entry.code === code)) {
    target.push(safeIssue(code));
  }
}

function createStatusError(code, message, statusCode) {
  const error = new Error(message || "Recovery status could not be read.");
  error.code = code || "recovery_status_failed";
  error.statusCode = statusCode || 400;
  return error;
}

function safeReadDir(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory, { withFileTypes: true });
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseTime(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortByRelevantTime(left, right) {
  const leftTime = parseTime(left.completed_at || left.started_at || left.requested_at);
  const rightTime = parseTime(right.completed_at || right.started_at || right.requested_at);
  if (rightTime !== leftTime) {
    return rightTime - leftTime;
  }
  return String(right.operation_id || "").localeCompare(String(left.operation_id || ""));
}

function isSuccessfulVerifiedRestore(operation) {
  return operation && operation.status === "succeeded"
    && operation.result_summary && operation.result_summary.restore_verified === true;
}

function readOperationsReadOnly(runtimePath) {
  const operationsDirectory = getOperationsDirectory(runtimePath);
  const operations = [];
  for (const entry of safeReadDir(operationsDirectory)) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(operationsDirectory, entry.name), "utf8"));
      operations.push(normalizeOperationRecord(raw));
    } catch (error) {
      operations.push({ unreadable: true });
    }
  }
  return operations.sort(sortByRelevantTime);
}

function readRestorePlansReadOnly(runtimePath, nowMs) {
  const directory = path.join(runtimePath, RESTORE_PLAN_DIRECTORY);
  const plans = [];
  for (const entry of safeReadDir(directory)) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    try {
      const record = JSON.parse(fs.readFileSync(path.join(directory, entry.name), "utf8"));
      validateRestorePlanId(record.plan_id);
      plans.push({
        plan_id: record.plan_id,
        snapshot_id: record.snapshot_id || null,
        project_slug: record.project_slug || null,
        readiness: record.readiness || "unknown",
        expires_at: record.expires_at || null,
        created_at: record.created_at || null,
        expired: !(Date.parse(record.expires_at || "") > nowMs)
      });
    } catch (error) {
      plans.push({ invalid: true });
    }
  }
  return plans.sort((left, right) => {
    const timeDiff = parseTime(right.created_at || right.expires_at) - parseTime(left.created_at || left.expires_at);
    return timeDiff || String(right.plan_id || "").localeCompare(String(left.plan_id || ""));
  });
}

function readJournalForOperation(projectsRoot, projectState, operation) {
  if (!operation || !operation.operation_id) {
    return { missing: true };
  }
  try {
    const journal = readRestoreJournal({
      projectsRoot,
      runtimePath: projectState.runtimePath,
      operationId: operation.operation_id
    });
    const binding = deriveProjectBinding(projectState.project);
    if (
      journal.project_slug !== projectState.project.slug ||
      journal.operation_id !== operation.operation_id ||
      !journal.project_binding ||
      journal.project_binding.slug !== binding.slug ||
      journal.project_binding.fingerprint !== binding.fingerprint
    ) {
      return { conflict: true, code: "cross_project_recovery_state" };
    }
    return { journal };
  } catch (error) {
    return { missing: true };
  }
}

function normalizeSnapshotType(snapshot) {
  const tier = String(snapshot && snapshot.snapshot_tier || "");
  if (tier === "portable_structural") {
    return "structural";
  }
  if (tier === "local_rescue") {
    return "full";
  }
  return "unknown";
}

function getGovernanceProject(governance, slug) {
  const projects = Array.isArray(governance.projects) ? governance.projects : [];
  return projects.find((project) => project.project_slug === slug) || {
    project_slug: slug,
    snapshots: [],
    snapshot_counts_by_classification: {}
  };
}

function snapshotProtectionMap(governanceProject) {
  const map = new Map();
  for (const snapshot of governanceProject.snapshots || []) {
    map.set(snapshot.snapshot_id, {
      protected: snapshot.protected === true,
      classification: snapshot.classification || "unknown",
      status: snapshot.status || "unknown"
    });
  }
  return map;
}

function selectLatestRecoveryPoint(summaries, protection) {
  const restorable = summaries
    .filter((summary) => summary && summary.verified === true && summary.restorable === true)
    .sort((left, right) => {
      const timeDiff = parseTime(right.created_at) - parseTime(left.created_at);
      return timeDiff || String(right.snapshot_id || "").localeCompare(String(left.snapshot_id || ""));
    });
  const selected = restorable[0] || null;
  if (!selected) {
    return null;
  }
  const governance = protection.get(selected.snapshot_id) || {};
  return {
    available: true,
    snapshot_id: selected.snapshot_id,
    created_at: selected.created_at,
    verified: true,
    restorable: true,
    protected: governance.protected === true,
    type: normalizeSnapshotType(selected)
  };
}

function normalizeManifestSummaries(projectsRoot, slug) {
  return listManifests({ projectsRoot, slug })
    .map((summary) => ({
      snapshot_id: summary.snapshot_id,
      created_at: summary.created_at,
      status: summary.status,
      snapshot_tier: summary.snapshot_tier,
      verified: summary.verification_state === "verified",
      restorable: summary.restorable === true,
      corrupt: summary.corrupt === true
    }));
}

function hasNewerUnusableSnapshot(summaries, latestRecoveryPoint) {
  if (!latestRecoveryPoint) {
    return false;
  }
  const selectedTime = parseTime(latestRecoveryPoint.created_at);
  return summaries.some((summary) => {
    if (summary.snapshot_id === latestRecoveryPoint.snapshot_id) {
      return false;
    }
    const candidateTime = parseTime(summary.created_at);
    if (candidateTime < selectedTime) {
      return false;
    }
    if (candidateTime === selectedTime && String(summary.snapshot_id || "") <= String(latestRecoveryPoint.snapshot_id || "")) {
      return false;
    }
    return !(summary.verified === true && summary.restorable === true);
  });
}

function hasUnknownClassification(governanceProject) {
  return (governanceProject.snapshots || []).some((snapshot) => snapshot.classification === "unknown_requires_review");
}

function resolveRestoreStatus(input) {
  const warnings = [];
  const blockers = [];
  const operations = input.operations.filter((operation) => operation.operation_type === RESTORE_OPERATION_TYPE);
  const slug = input.projectState.project.slug;
  if (input.operations.some((operation) => operation.unreadable)) {
    addIssue(blockers, "recovery_metadata_unreadable", BLOCKER_CODES);
    return { restore_status: "unknown", recommended_action: "contact_support", warnings, blockers };
  }
  if (operations.some((operation) => operation.project_slug && operation.project_slug !== slug)) {
    addIssue(blockers, "cross_project_recovery_state", BLOCKER_CODES);
    return { restore_status: "unknown", recommended_action: "contact_support", warnings, blockers };
  }
  if (input.plans.some((plan) => plan.invalid)) {
    addIssue(blockers, "recovery_metadata_unreadable", BLOCKER_CODES);
    return { restore_status: "unknown", recommended_action: "contact_support", warnings, blockers };
  }
  if (input.plans.some((plan) => plan.project_slug && plan.project_slug !== slug)) {
    addIssue(blockers, "cross_project_recovery_state", BLOCKER_CODES);
    return { restore_status: "unknown", recommended_action: "contact_support", warnings, blockers };
  }
  const active = operations.filter((operation) => ["requested", "running", "interrupted"].includes(operation.status));
  if (active.length > 1) {
    addIssue(blockers, "restore_state_conflict", BLOCKER_CODES);
    return { restore_status: "unknown", recommended_action: "contact_support", warnings, blockers };
  }
  const reconciliation = operations.filter((operation) => operation.stage === "interrupted_recovery_required");
  if (reconciliation.length > 1) {
    addIssue(blockers, "restore_state_conflict", BLOCKER_CODES);
    return { restore_status: "unknown", recommended_action: "contact_support", warnings, blockers };
  }
  const activeOperation = active[0] || null;
  const reconciliationOperation = reconciliation[0] || null;
  if (activeOperation && reconciliationOperation && activeOperation.operation_id !== reconciliationOperation.operation_id) {
    addIssue(blockers, "restore_state_conflict", BLOCKER_CODES);
    return { restore_status: "unknown", recommended_action: "contact_support", warnings, blockers };
  }
  const journalOperation = reconciliationOperation || activeOperation;
  if (journalOperation) {
    const journalRead = readJournalForOperation(input.projectsRoot, input.projectState, journalOperation);
    if (journalRead.conflict) {
      addIssue(blockers, journalRead.code, BLOCKER_CODES);
      return { restore_status: "unknown", recommended_action: "contact_support", warnings, blockers };
    }
  }
  const nonExpiredPlans = input.plans.filter((plan) => !plan.expired);
  const newestActionablePlan = nonExpiredPlans
    .filter((plan) => plan.readiness === "ready" || plan.readiness === "ready_with_emergency_confirmation")
    .sort((left, right) => parseTime(right.created_at || right.expires_at) - parseTime(left.created_at || left.expires_at))[0] || null;
  const latestRestoreOperation = operations.slice().sort(sortByRelevantTime)[0] || null;
  const planIsNewer = newestActionablePlan && (
    !latestRestoreOperation
    || parseTime(newestActionablePlan.created_at || newestActionablePlan.expires_at)
      > parseTime(latestRestoreOperation.completed_at || latestRestoreOperation.started_at || latestRestoreOperation.requested_at)
  );

  if (!planIsNewer && latestRestoreOperation && latestRestoreOperation.stage === "interrupted_recovery_required") {
    addIssue(warnings, "restore_reconciliation_required", WARNING_CODES);
    return { restore_status: "reconciliation_required", recommended_action: "resume_reconciliation", warnings, blockers };
  }
  if (!planIsNewer && latestRestoreOperation && latestRestoreOperation.status === "interrupted") {
    addIssue(warnings, "restore_interrupted", WARNING_CODES);
    return { restore_status: "interrupted", recommended_action: "resume_reconciliation", warnings, blockers };
  }
  if (!planIsNewer && latestRestoreOperation && (latestRestoreOperation.status === "requested" || latestRestoreOperation.status === "running")) {
    addIssue(warnings, "restore_running", WARNING_CODES);
    return { restore_status: "running", recommended_action: "review_restore", warnings, blockers };
  }
  if (!planIsNewer && isSuccessfulVerifiedRestore(latestRestoreOperation)) {
    addIssue(warnings, "restore_completed", WARNING_CODES);
    return { restore_status: "completed", recommended_action: "none", warnings, blockers };
  }
  if (!planIsNewer && latestRestoreOperation && latestRestoreOperation.status === "failed") {
    addIssue(warnings, "restore_failed", WARNING_CODES);
    return { restore_status: "failed", recommended_action: "review_restore", warnings, blockers };
  }
  if (!planIsNewer && latestRestoreOperation && latestRestoreOperation.status === "succeeded") {
    addIssue(warnings, "restore_failed", WARNING_CODES);
    return { restore_status: "failed", recommended_action: "review_restore", warnings, blockers };
  }
  const awaiting = planIsNewer && newestActionablePlan.readiness === "ready_with_emergency_confirmation"
    ? newestActionablePlan
    : null;
  if (awaiting) {
    addIssue(warnings, "restore_awaiting_confirmation", WARNING_CODES);
    return { restore_status: "awaiting_confirmation", recommended_action: "review_restore", warnings, blockers };
  }
  const ready = planIsNewer && newestActionablePlan.readiness === "ready"
    ? newestActionablePlan
    : null;
  if (ready) {
    addIssue(warnings, "restore_plan_ready", WARNING_CODES);
    return { restore_status: "plan_ready", recommended_action: "review_restore", warnings, blockers };
  }
  if (input.plans.some((plan) => plan.expired)) {
    addIssue(warnings, "expired_restore_plan_ignored", WARNING_CODES);
  }
  return { restore_status: "idle", recommended_action: "none", warnings, blockers };
}

function mapGovernanceWarnings(governance, warnings, blockers) {
  const storageStatus = governance.pressure_status || "unknown";
  if (storageStatus === "approaching_limit") {
    addIssue(warnings, "storage_approaching_limit", WARNING_CODES);
  } else if (storageStatus === "cleanup_recommended") {
    addIssue(warnings, "storage_cleanup_recommended", WARNING_CODES);
  } else if (storageStatus === "capture_blocked") {
    addIssue(warnings, "new_capture_blocked", WARNING_CODES);
  } else if (storageStatus === "restore_only_emergency") {
    addIssue(warnings, "restore_only_emergency", WARNING_CODES);
  } else if (storageStatus !== "healthy") {
    addIssue(blockers, "recovery_state_unknown", BLOCKER_CODES);
  }
  for (const code of governance.blockers || []) {
    if (code) {
      addIssue(blockers, "recovery_state_unknown", BLOCKER_CODES);
    }
  }
  for (const code of governance.warnings || []) {
    if (code) {
      addIssue(warnings, "recovery_state_unknown", WARNING_CODES);
    }
  }
}

function chooseRecommendedAction(current, next) {
  const priority = ["contact_support", "resume_reconciliation", "review_restore", "review_storage", "create_recovery_point", "none"];
  return priority.indexOf(next) < priority.indexOf(current) ? next : current;
}

function assertSafeResult(result) {
  const text = JSON.stringify(result);
  const unsafe = /[A-Za-z]:[\\/]|(?:^|["\s])\/(?:tmp|var|home|Users|sf-factory-projects|crocoblock-site-factory-system)[/\w.-]*|wordpress\.tar|database\.sql|project-metadata\.json|manifest\.json|restore-journal\.json|op-\d{4}|Error:|at\s+[A-Za-z0-9_.<>]+\s*\(|password|Bearer|access_token|MYSQL_PASSWORD/i;
  if (unsafe.test(text)) {
    throw createStatusError("recovery_status_unsafe_output", "Recovery status contained unsafe metadata.", 500);
  }
}

function getRecoveryStatus(input) {
  const options = input || {};
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  let slug;
  try {
    slug = validateExplicitSlug(options.projectSlug);
  } catch (error) {
    throw createStatusError("invalid_project_slug", "Project slug is invalid.", 400);
  }
  let projectState;
  try {
    projectState = readProjectBySlug(slug, projectsRoot);
  } catch (error) {
    throw createStatusError("project_not_found", "Project not found.", 404);
  }
  const runtimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  projectState = Object.assign({}, projectState, { runtimePath });
  const observedAt = nowIso(options.clock);
  const nowMs = Date.parse(observedAt);
  const warnings = [];
  const blockers = [];
  let governance;
  try {
    governance = (options.governanceReader || evaluateRecoveryStorageGovernance)({
      projectsRoot,
      projectSlug: slug,
      clock: () => nowMs
    });
  } catch (error) {
    addIssue(blockers, error && /unsupported/i.test(String(error.code || error.message || ""))
      ? "unsupported_recovery_metadata"
      : "recovery_metadata_unreadable", BLOCKER_CODES);
    const result = {
      schema_version: SCHEMA_VERSION,
      project: { slug },
      availability: "unknown",
      protection_status: "unknown",
      latest_recovery_point: null,
      restore_status: "unknown",
      storage_status: "unknown",
      recommended_action: "contact_support",
      warnings,
      blockers,
      observed_at: observedAt
    };
    assertSafeResult(result);
    return result;
  }
  mapGovernanceWarnings(governance, warnings, blockers);
  const governanceProject = getGovernanceProject(governance, slug);
  const protection = snapshotProtectionMap(governanceProject);
  let summaries;
  try {
    summaries = (options.snapshotReader || normalizeManifestSummaries)(projectsRoot, slug);
  } catch (error) {
    addIssue(blockers, error && /unsupported/i.test(String(error.code || error.message || ""))
      ? "unsupported_recovery_metadata"
      : "recovery_metadata_unreadable", BLOCKER_CODES);
    summaries = [];
  }
  const latestRecoveryPoint = blockers.length ? null : selectLatestRecoveryPoint(summaries, protection);
  if (!latestRecoveryPoint && summaries.length === 0 && blockers.length === 0) {
    addIssue(blockers, "recovery_point_not_available", BLOCKER_CODES);
  } else if (!latestRecoveryPoint && blockers.length === 0) {
    addIssue(blockers, "recovery_point_not_available", BLOCKER_CODES);
  }
  if (latestRecoveryPoint && hasNewerUnusableSnapshot(summaries, latestRecoveryPoint)) {
    addIssue(warnings, "newer_recovery_point_unusable", WARNING_CODES);
  }
  if (hasUnknownClassification(governanceProject)) {
    addIssue(warnings, "newer_recovery_point_unusable", WARNING_CODES);
  }
  const operations = (options.operationReader || readOperationsReadOnly)(runtimePath);
  const plans = (options.planReader || readRestorePlansReadOnly)(runtimePath, nowMs);
  const restore = resolveRestoreStatus({ projectsRoot, projectState, operations, plans });
  for (const warning of restore.warnings) {
    addIssue(warnings, warning.code, WARNING_CODES);
  }
  for (const blocker of restore.blockers) {
    addIssue(blockers, blocker.code, BLOCKER_CODES);
  }
  const storageStatus = ["healthy", "approaching_limit", "cleanup_recommended", "capture_blocked", "restore_only_emergency"].includes(governance.pressure_status)
    ? governance.pressure_status
    : "unknown";
  let availability = "unknown";
  if (blockers.some((entry) => entry.code !== "recovery_point_not_available")) {
    availability = "unknown";
  } else if (!latestRecoveryPoint) {
    availability = "unavailable";
  } else if (
    storageStatus !== "healthy" ||
    restore.restore_status === "running" ||
    restore.restore_status === "interrupted" ||
    restore.restore_status === "reconciliation_required" ||
    warnings.some((entry) => entry.code === "newer_recovery_point_unusable")
  ) {
    availability = "limited";
  } else {
    availability = "available";
  }
  let protectionStatus = "unknown";
  if (blockers.some((entry) => entry.code !== "recovery_point_not_available")) {
    protectionStatus = "unknown";
  } else if (!latestRecoveryPoint) {
    protectionStatus = "not_protected";
  } else if (latestRecoveryPoint.protected && availability === "available") {
    protectionStatus = "protected";
  } else {
    protectionStatus = "partially_protected";
  }
  let recommendedAction = restore.recommended_action || "none";
  if (!latestRecoveryPoint && blockers.some((entry) => entry.code === "recovery_point_not_available")) {
    recommendedAction = chooseRecommendedAction(recommendedAction, "create_recovery_point");
  }
  recommendedAction = chooseRecommendedAction(recommendedAction, STORAGE_ACTIONS[storageStatus] || "contact_support");
  if (blockers.some((entry) => entry.code !== "recovery_point_not_available")) {
    recommendedAction = "contact_support";
  }
  const result = {
    schema_version: SCHEMA_VERSION,
    project: { slug },
    availability,
    protection_status: protectionStatus,
    latest_recovery_point: latestRecoveryPoint,
    restore_status: restore.restore_status,
    storage_status: storageStatus,
    recommended_action: recommendedAction,
    warnings,
    blockers,
    observed_at: observedAt
  };
  assertSafeResult(result);
  return result;
}

module.exports = {
  SCHEMA_VERSION,
  getRecoveryStatus
};
