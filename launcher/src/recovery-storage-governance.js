"use strict";

const fs = require("fs");
const path = require("path");
const {
  assertSafeRuntimePath,
  listProjects,
  readProjectBySlug,
  resolveProjectsRoot,
  validateExplicitSlug
} = require("./project-store");
const {
  deriveProjectBinding,
  isRestorable,
  resolveRecoveryRoot,
  resolveSnapshotDirectory,
  toBrowserSafeSummary,
  validateManifest,
  validateSnapshotId
} = require("./structural-snapshot-store");
const {
  RESTORE_PLAN_DIRECTORY,
  validateRestorePlanId
} = require("./structural-restore-plan");
const {
  readRestoreJournal
} = require("./structural-restore-reconciliation");
const {
  readLock
} = require("./project-operation-store");

const RECOVERY_STORAGE_POLICY_VERSION = 1;
const DEFAULT_POLICY_PROFILE_ID = "factory_default_v1";
const DEFAULT_POLICY = Object.freeze({
  recovery_storage_policy_version: RECOVERY_STORAGE_POLICY_VERSION,
  policy_profile_id: DEFAULT_POLICY_PROFILE_ID,
  maximum_recovery_storage_bytes: 8 * 1024 * 1024 * 1024,
  minimum_free_space_reserve_bytes: 1024 * 1024 * 1024,
  maximum_retained_verified_snapshots_per_project: 3,
  maximum_snapshot_age_ms: 90 * 24 * 60 * 60 * 1000,
  incomplete_corrupt_grace_period_ms: 24 * 60 * 60 * 1000,
  recent_failure_grace_period_ms: 24 * 60 * 60 * 1000,
  approaching_limit_ratio: 0.7,
  cleanup_recommended_ratio: 0.85
});
const ALLOWED_POLICY_PROFILES = new Map([
  [DEFAULT_POLICY_PROFILE_ID, DEFAULT_POLICY]
]);
const FORBIDDEN_CALLER_KEYS = new Set([
  "recoveryPath",
  "recovery_path",
  "projectPath",
  "project_path",
  "snapshotPath",
  "snapshot_path",
  "deletionList",
  "deletion_list",
  "protectedSnapshotList",
  "protected_snapshot_list",
  "freeSpace",
  "free_space",
  "availableBytes",
  "available_bytes",
  "volumePath",
  "volume_path",
  "quotaOverride",
  "quota_override",
  "ageOverride",
  "age_override",
  "retentionOverride",
  "retention_override",
  "currentOperationOverride",
  "current_operation_override"
]);
const TERMINAL_OPERATION_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const ACTIVE_OPERATION_STATUSES = new Set(["requested", "running", "interrupted"]);
const SNAPSHOT_LIKE_PATTERN = /^snapshot-\d{4}-\d{2}-\d{2}t\d{2}-\d{2}-\d{2}-\d{3}z-[a-f0-9]{12}$/;

function createGovernanceError(code, message, statusCode, extras) {
  const error = new Error(message || "Recovery storage governance evaluation failed.");
  error.code = code;
  error.statusCode = statusCode || 400;
  if (extras && typeof extras === "object") {
    Object.assign(error, extras);
  }
  return error;
}

function nowMs(clock) {
  return clock ? Number(clock()) : Date.now();
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  return child === parent || child.startsWith(parent + path.sep);
}

function pathsOverlap(leftPath, rightPath) {
  return isPathInside(leftPath, rightPath) || isPathInside(rightPath, leftPath);
}

function sanitizeReason(reason) {
  return String(reason || "").replace(/[^a-z0-9_:-]+/gi, "_").slice(0, 120);
}

function assertAllowedCallerInput(options) {
  for (const key of Object.keys(options || {})) {
    if (FORBIDDEN_CALLER_KEYS.has(key)) {
      throw createGovernanceError("recovery_governance_input_rejected", "Recovery governance input is not allowed.", 400);
    }
  }
}

function normalizePolicy(options) {
  if (options && options.policy && options.allowPolicyInjection !== true) {
    throw createGovernanceError("recovery_governance_policy_invalid", "Recovery governance policy is server-owned.", 400);
  }
  const raw = options && options.allowPolicyInjection === true && options.policy
    ? Object.assign({}, DEFAULT_POLICY, options.policy)
    : ALLOWED_POLICY_PROFILES.get(String(options && options.policyProfileId || DEFAULT_POLICY_PROFILE_ID));
  if (!raw) {
    throw createGovernanceError("recovery_governance_policy_invalid", "Recovery governance policy profile is invalid.", 400);
  }
  const policy = {
    recovery_storage_policy_version: Number(raw.recovery_storage_policy_version),
    policy_profile_id: String(raw.policy_profile_id || DEFAULT_POLICY_PROFILE_ID),
    maximum_recovery_storage_bytes: Number(raw.maximum_recovery_storage_bytes),
    minimum_free_space_reserve_bytes: Number(raw.minimum_free_space_reserve_bytes),
    maximum_retained_verified_snapshots_per_project: Number(raw.maximum_retained_verified_snapshots_per_project),
    maximum_snapshot_age_ms: Number(raw.maximum_snapshot_age_ms),
    incomplete_corrupt_grace_period_ms: Number(raw.incomplete_corrupt_grace_period_ms),
    recent_failure_grace_period_ms: Number(raw.recent_failure_grace_period_ms),
    approaching_limit_ratio: Number(raw.approaching_limit_ratio),
    cleanup_recommended_ratio: Number(raw.cleanup_recommended_ratio)
  };
  const numericFields = Object.keys(policy).filter((key) => key !== "policy_profile_id");
  for (const field of numericFields) {
    if (!Number.isFinite(policy[field]) || policy[field] < 0) {
      throw createGovernanceError("recovery_governance_policy_invalid", "Recovery governance policy is invalid.", 400);
    }
  }
  if (
    policy.recovery_storage_policy_version !== RECOVERY_STORAGE_POLICY_VERSION ||
    policy.maximum_retained_verified_snapshots_per_project < 1 ||
    policy.approaching_limit_ratio > policy.cleanup_recommended_ratio ||
    policy.cleanup_recommended_ratio > 1
  ) {
    throw createGovernanceError("recovery_governance_policy_invalid", "Recovery governance policy is invalid.", 400);
  }
  return policy;
}

function safePolicy(policy) {
  return {
    recovery_storage_policy_version: policy.recovery_storage_policy_version,
    policy_profile_id: policy.policy_profile_id,
    maximum_recovery_storage_bytes: policy.maximum_recovery_storage_bytes,
    minimum_free_space_reserve_bytes: policy.minimum_free_space_reserve_bytes,
    maximum_retained_verified_snapshots_per_project: policy.maximum_retained_verified_snapshots_per_project,
    maximum_snapshot_age_ms: policy.maximum_snapshot_age_ms,
    incomplete_corrupt_grace_period_ms: policy.incomplete_corrupt_grace_period_ms,
    pressure_thresholds: {
      approaching_limit_ratio: policy.approaching_limit_ratio,
      cleanup_recommended_ratio: policy.cleanup_recommended_ratio
    }
  };
}

function getProjectStates(options, projectsRoot) {
  if (options.projectResolver) {
    return options.projectResolver({ projectsRoot, projectSlug: options.projectSlug || options.slug || null });
  }
  const requestedSlug = options.projectSlug || options.slug || null;
  if (requestedSlug) {
    let slug;
    try {
      slug = validateExplicitSlug(requestedSlug);
    } catch (error) {
      throw createGovernanceError("recovery_governance_project_not_found", "Factory project was not found.", 404);
    }
    try {
      return [readProjectBySlug(slug, projectsRoot)];
    } catch (error) {
      throw createGovernanceError("recovery_governance_project_not_found", "Factory project was not found.", 404);
    }
  }
  return listProjects(projectsRoot)
    .filter((project) => project && project.slug && !project.error)
    .map((project) => readProjectBySlug(project.slug, projectsRoot));
}

function safeStat(filePath, helpers) {
  return helpers && helpers.lstat ? helpers.lstat(filePath) : fs.lstatSync(filePath);
}

function safeReadDir(filePath, helpers) {
  return helpers && helpers.readdir ? helpers.readdir(filePath) : fs.readdirSync(filePath, { withFileTypes: true });
}

function fileExists(filePath, helpers) {
  if (helpers && helpers.exists) {
    return helpers.exists(filePath);
  }
  return fs.existsSync(filePath);
}

function readText(filePath, helpers) {
  if (helpers && helpers.readFile) {
    return helpers.readFile(filePath, "utf8");
  }
  return fs.readFileSync(filePath, "utf8");
}

function accountDirectoryBytes(rootPath, helpers, seenFiles, findings) {
  if (!fileExists(rootPath, helpers)) {
    return 0;
  }
  let total = 0;
  function visit(filePath) {
    const stat = safeStat(filePath, helpers);
    if (stat.isSymbolicLink && stat.isSymbolicLink()) {
      findings.push("reparse_or_symlink_rejected");
      return;
    }
    if (stat.isDirectory && stat.isDirectory()) {
      for (const entry of safeReadDir(filePath, helpers)) {
        visit(path.join(filePath, entry.name));
      }
      return;
    }
    if (stat.isFile && stat.isFile()) {
      const fileKey = String(stat.dev || 0) + ":" + String(stat.ino || filePath);
      if (seenFiles.has(fileKey)) {
        return;
      }
      seenFiles.add(fileKey);
      total += Number(stat.size || 0);
    }
  }
  visit(rootPath);
  return total;
}

function readManifestFromPath(manifestPath, context, helpers) {
  if (!fileExists(manifestPath, helpers)) {
    return {
      manifest: null,
      errorCode: "manifest_missing"
    };
  }
  try {
    const parsed = JSON.parse(readText(manifestPath, helpers));
    return {
      manifest: validateManifest(parsed, {
        expectedProjectSlug: context.binding.slug,
        expectedProjectIdentityFingerprint: context.binding.fingerprint
      }),
      errorCode: null
    };
  } catch (error) {
    return {
      manifest: null,
      errorCode: "manifest_invalid"
    };
  }
}

function artifactPathFindings(snapshotDirectory, manifest) {
  const findings = [];
  if (!manifest || !Array.isArray(manifest.artifacts)) {
    return findings;
  }
  for (const artifact of manifest.artifacts) {
    const relative = String(artifact.relative_filename || "");
    if (relative.includes(".factory-recovery") || relative.includes("snapshots/") || relative.includes("snapshots\\")) {
      findings.push("artifact_references_recovery_storage");
    }
    const absolute = path.join(snapshotDirectory, ...relative.split("/"));
    if (!isPathInside(snapshotDirectory, absolute)) {
      findings.push("artifact_path_escape");
    }
  }
  return findings;
}

function getCreatedMs(snapshot) {
  return Date.parse(snapshot.created_at || "") || snapshot.mtime_ms || 0;
}

function discoverRestorePlans(runtimePath, nowValue, helpers) {
  const plans = [];
  const planDir = path.join(runtimePath, RESTORE_PLAN_DIRECTORY);
  if (!fileExists(planDir, helpers)) {
    return plans;
  }
  for (const entry of safeReadDir(planDir, helpers)) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    try {
      const record = JSON.parse(readText(path.join(planDir, entry.name), helpers));
      validateRestorePlanId(record.plan_id);
      if (Date.parse(record.expires_at || "") > nowValue && (record.readiness === "ready" || record.readiness === "ready_with_emergency_confirmation")) {
        plans.push(record);
      }
    } catch (error) {
      plans.push({
        invalid: true
      });
    }
  }
  return plans;
}

function readOperationsReadOnly(runtimePath, helpers) {
  const operationsDirectory = path.join(runtimePath, "runs", "operations");
  if (!fileExists(operationsDirectory, helpers)) {
    return [];
  }
  const operations = [];
  for (const entry of safeReadDir(operationsDirectory, helpers)) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = JSON.parse(readText(path.join(operationsDirectory, entry.name), helpers));
      operations.push({
        operation_id: raw.operation_id || null,
        project_slug: raw.project_slug || null,
        operation_type: raw.operation_type || null,
        status: raw.status || "unknown",
        stage: raw.stage || raw.status_detail || null,
        requested_at: raw.requested_at || null,
        started_at: raw.started_at || null,
        completed_at: raw.completed_at || null,
        result_summary: isObject(raw.result_summary) ? raw.result_summary : {}
      });
    } catch (error) {
      operations.push({ unreadable: true });
    }
  }
  return operations;
}

function addProtection(map, snapshotId, reason) {
  if (!snapshotId || !SNAPSHOT_LIKE_PATTERN.test(snapshotId)) {
    return;
  }
  if (!map.has(snapshotId)) {
    map.set(snapshotId, new Set());
  }
  map.get(snapshotId).add(reason);
}

function discoverDependencies(projectState, projectsRoot, policy, nowValue, helpers) {
  const protectedReasons = new Map();
  const warnings = [];
  const blockers = [];
  const slug = projectState.project.slug;
  try {
    for (const plan of discoverRestorePlans(projectState.runtimePath, nowValue, helpers)) {
      if (plan.invalid) {
        blockers.push("restore_plan_state_unreadable");
        continue;
      }
      addProtection(protectedReasons, plan.snapshot_id, "non_expired_restore_plan_source");
    }
    for (const operation of readOperationsReadOnly(projectState.runtimePath, helpers)) {
      if (operation.unreadable) {
        warnings.push("operation_state_unreadable");
        continue;
      }
      if (operation.operation_type !== "structural_restore_execute") {
        continue;
      }
      const unfinished = ACTIVE_OPERATION_STATUSES.has(operation.status);
      const reconciliationRequired = operation.stage === "interrupted_recovery_required";
      if (!unfinished && !reconciliationRequired) {
        continue;
      }
      const summary = operation.result_summary || {};
      addProtection(protectedReasons, summary.source_snapshot_id, unfinished ? "active_restore_source" : "interrupted_reconciliation_source");
      addProtection(protectedReasons, summary.rescue_snapshot_id, unfinished ? "active_restore_rescue" : "interrupted_reconciliation_rescue");
      try {
        const journal = readRestoreJournal({
          projectsRoot,
          runtimePath: projectState.runtimePath,
          operationId: operation.operation_id
        });
        addProtection(protectedReasons, journal.source_snapshot_id, unfinished ? "active_restore_journal_source" : "interrupted_reconciliation_journal_source");
        addProtection(protectedReasons, journal.rescue_snapshot_id, unfinished ? "active_restore_journal_rescue" : "interrupted_reconciliation_journal_rescue");
      } catch (error) {
        if (unfinished || reconciliationRequired) {
          warnings.push("restore_journal_unreadable");
        }
      }
    }
    const lock = readLock(projectState.runtimePath);
    if (lock && lock.metadata) {
      warnings.push("project_operation_lock_present");
    }
  } catch (error) {
    blockers.push("active_dependency_state_unreadable");
  }
  return {
    protectedReasons,
    warnings,
    blockers
  };
}

function inventoryProject(projectState, options) {
  const projectsRoot = options.projectsRoot;
  const helpers = options.filesystem || {};
  const nowValue = options.nowValue;
  const policy = options.policy;
  const context = resolveSnapshotDirectory({ projectsRoot, slug: projectState.project.slug });
  const wordpressRoot = path.join(projectState.runtimePath, "wordpress");
  const recursionFindings = [];
  if (pathsOverlap(context.recoveryRoot, wordpressRoot) || pathsOverlap(context.projectDirectory, wordpressRoot)) {
    recursionFindings.push("recovery_root_overlaps_wordpress_root");
  }
  if (pathsOverlap(context.recoveryRoot, projectState.runtimePath)) {
    recursionFindings.push("recovery_root_overlaps_project_runtime");
  }
  const dependencies = options.dependencyReader
    ? options.dependencyReader({ projectState, projectsRoot, nowMs: nowValue, policy })
    : discoverDependencies(projectState, projectsRoot, policy, nowValue, helpers);
  const snapshots = [];
  const seenFiles = options.seenFiles;
  if (!fileExists(context.projectDirectory, helpers)) {
    return {
      project_slug: projectState.project.slug,
      snapshots,
      bytes: 0,
      protectedReasons: dependencies.protectedReasons,
      warnings: dependencies.warnings.slice(),
      blockers: dependencies.blockers.concat(recursionFindings),
      recursionFindings
    };
  }
  try {
    const projectDirStat = safeStat(context.projectDirectory, helpers);
    if (projectDirStat.isSymbolicLink && projectDirStat.isSymbolicLink()) {
      throw createGovernanceError("recovery_governance_root_invalid", "Recovery storage root is unsafe.", 409);
    }
    for (const entry of safeReadDir(context.projectDirectory, helpers)) {
      if (!entry.isDirectory()) {
        continue;
      }
      const snapshotId = entry.name;
      const snapshotDirectory = path.join(context.projectDirectory, snapshotId);
      const findings = recursionFindings.slice();
      let validSnapshotId = null;
      try {
        validSnapshotId = validateSnapshotId(snapshotId);
      } catch (error) {
        findings.push("snapshot_identity_invalid");
      }
      if (!isPathInside(context.projectDirectory, snapshotDirectory) || !isPathInside(context.recoveryRoot, snapshotDirectory)) {
        findings.push("snapshot_directory_escape");
      }
      const stat = safeStat(snapshotDirectory, helpers);
      if (stat.isSymbolicLink && stat.isSymbolicLink()) {
        findings.push("reparse_or_symlink_rejected");
      }
      const manifestRead = validSnapshotId
        ? readManifestFromPath(path.join(snapshotDirectory, "manifest.json"), context, helpers)
        : { manifest: null, errorCode: "snapshot_identity_invalid" };
      findings.push(...artifactPathFindings(snapshotDirectory, manifestRead.manifest));
      const byteFindings = [];
      const bytes = accountDirectoryBytes(snapshotDirectory, helpers, seenFiles, byteFindings);
      findings.push(...byteFindings);
      const manifest = manifestRead.manifest;
      const summary = manifest ? toBrowserSafeSummary(manifest) : null;
      const createdAt = manifest ? manifest.created_at : null;
      const mtimeMs = Number(stat.mtimeMs || 0);
      snapshots.push({
        snapshot_id: validSnapshotId || "unknown",
        safe_identity: validSnapshotId || null,
        status: manifest ? manifest.status : (manifestRead.errorCode === "manifest_missing" ? "incomplete" : "unknown"),
        created_at: createdAt,
        updated_at: manifest ? manifest.updated_at : null,
        mtime_ms: mtimeMs,
        bytes,
        restorable: manifest ? isRestorable(manifest) : false,
        corrupt: manifestRead.errorCode === "manifest_invalid",
        source_operation: manifest ? manifest.source_operation_id : null,
        invalid: !validSnapshotId || manifestRead.errorCode === "manifest_invalid" || findings.includes("snapshot_identity_invalid") || findings.includes("reparse_or_symlink_rejected") || findings.includes("snapshot_directory_escape") || findings.includes("artifact_path_escape") || findings.includes("artifact_references_recovery_storage"),
        manifest_valid: Boolean(manifest),
        explicit_protected: Boolean(manifest && (manifest.provenance && manifest.provenance.governance_protected === true || manifest.software && manifest.software.governance_protected === true)),
        protection_reasons: validSnapshotId && dependencies.protectedReasons.has(validSnapshotId)
          ? Array.from(dependencies.protectedReasons.get(validSnapshotId)).map(sanitizeReason)
          : [],
        findings: Array.from(new Set(findings.map(sanitizeReason))),
        compatibility: summary ? summary.compatibility : { status: "unknown", blocking: true, blockers: ["manifest_unreadable"] },
        classification: null,
        classification_reasons: []
      });
    }
  } catch (error) {
    throw createGovernanceError("recovery_governance_inventory_unreadable", "Recovery inventory could not be read.", 500);
  }
  return {
    project_slug: projectState.project.slug,
    snapshots,
    bytes: snapshots.reduce((total, snapshot) => total + snapshot.bytes, 0),
    protectedReasons: dependencies.protectedReasons,
    warnings: dependencies.warnings.slice(),
    blockers: dependencies.blockers.concat(recursionFindings),
    recursionFindings
  };
}

function hasRecentFailedOperation(snapshot, failedOperations, policy, nowValue) {
  for (const failed of failedOperations) {
    if (snapshot.source_operation !== failed.operation_id) {
      continue;
    }
    const failedAt = failed.failed_at;
    if (nowValue - failedAt <= policy.recent_failure_grace_period_ms && Math.abs((snapshot.mtime_ms || 0) - failedAt) <= policy.recent_failure_grace_period_ms) {
      return true;
    }
  }
  return false;
}

function classifyProjectSnapshots(projectInventory, policy, nowValue, failedOperationTimes) {
  const verifiedRestorable = projectInventory.snapshots
    .filter((snapshot) => snapshot.status === "verified" && snapshot.restorable && !snapshot.invalid)
    .sort((left, right) => getCreatedMs(right) - getCreatedMs(left));
  if (verifiedRestorable[0]) {
    verifiedRestorable[0].protection_reasons.push("latest_verified_restorable");
  }
  for (const snapshot of projectInventory.snapshots) {
    const reasons = new Set(snapshot.classification_reasons || []);
    const protectionReasons = new Set(snapshot.protection_reasons || []);
    if (snapshot.explicit_protected) {
      protectionReasons.add("explicit_server_owned_protection");
    }
    if (snapshot.invalid || snapshot.findings.length > 0 && snapshot.findings.some((finding) => finding !== "recovery_root_overlaps_project_runtime")) {
      snapshot.classification = "unknown_requires_review";
      reasons.add(snapshot.corrupt ? "manifest_invalid" : "identity_or_path_requires_review");
    } else if (protectionReasons.size > 0) {
      snapshot.classification = "protected";
      for (const reason of protectionReasons) {
        reasons.add(reason);
      }
    } else if (snapshot.status === "verified" && snapshot.restorable) {
      const ageMs = nowValue - getCreatedMs(snapshot);
      const rank = verifiedRestorable.findIndex((entry) => entry.snapshot_id === snapshot.snapshot_id);
      if (ageMs > policy.maximum_snapshot_age_ms) {
        snapshot.classification = "eligible_by_age";
        reasons.add("verified_snapshot_exceeds_maximum_age");
      } else if (rank >= policy.maximum_retained_verified_snapshots_per_project) {
        snapshot.classification = "eligible_by_count";
        reasons.add("verified_snapshot_exceeds_retained_count");
      } else {
        snapshot.classification = "retained";
        reasons.add("within_verified_retention_window");
      }
    } else if (snapshot.status === "incomplete") {
      const ageMs = nowValue - getCreatedMs(snapshot);
      if (hasRecentFailedOperation(snapshot, failedOperationTimes, policy, nowValue)) {
        snapshot.classification = "blocked_from_cleanup";
        reasons.add("recent_failed_operation_evidence");
      } else if (ageMs >= policy.incomplete_corrupt_grace_period_ms) {
        snapshot.classification = "incomplete_cleanup_candidate";
        reasons.add("incomplete_grace_period_elapsed");
      } else {
        snapshot.classification = "blocked_from_cleanup";
        reasons.add("incomplete_grace_period_active");
      }
    } else if (snapshot.status === "corrupt" || snapshot.corrupt) {
      const ageMs = nowValue - getCreatedMs(snapshot);
      if (ageMs >= policy.incomplete_corrupt_grace_period_ms) {
        snapshot.classification = "corrupt_cleanup_candidate";
        reasons.add("corrupt_grace_period_elapsed");
      } else {
        snapshot.classification = "blocked_from_cleanup";
        reasons.add("corrupt_grace_period_active");
      }
    } else {
      snapshot.classification = "unknown_requires_review";
      reasons.add("snapshot_state_not_cleanup_eligible");
    }
    snapshot.protection_reasons = Array.from(protectionReasons).map(sanitizeReason).sort();
    snapshot.classification_reasons = Array.from(reasons).map(sanitizeReason).sort();
  }
}

function countBy(items, field) {
  const counts = {};
  for (const item of items) {
    const key = item[field] || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function sumBytes(items, predicate) {
  return items.filter(predicate).reduce((total, item) => total + item.bytes, 0);
}

function getFailedOperationTimes(projectState, projectsRoot) {
  try {
    return readOperationsReadOnly(projectState.runtimePath, {})
      .filter((operation) => operation.status === "failed")
      .map((operation) => ({
        operation_id: operation.operation_id,
        failed_at: Date.parse(operation.completed_at || operation.started_at || operation.requested_at || "")
      }))
      .filter((entry) => entry.operation_id && Number.isFinite(entry.failed_at));
  } catch (error) {
    return [];
  }
}

function classifyPressure(options) {
  const usage = options.totalBytes;
  const policy = options.policy;
  const availableBytes = options.availableBytes;
  const verifiedSnapshots = options.snapshots.filter((snapshot) => snapshot.status === "verified" && snapshot.bytes > 0);
  const typicalSnapshotBytes = verifiedSnapshots.length
    ? Math.ceil(verifiedSnapshots.reduce((total, snapshot) => total + snapshot.bytes, 0) / verifiedSnapshots.length)
    : 0;
  if (availableBytes < policy.minimum_free_space_reserve_bytes / 2) {
    return {
      pressure_status: "restore_only_emergency",
      reasons: ["available_space_below_emergency_reserve"],
      typical_snapshot_bytes: typicalSnapshotBytes
    };
  }
  if (availableBytes < policy.minimum_free_space_reserve_bytes || usage + typicalSnapshotBytes > policy.maximum_recovery_storage_bytes) {
    return {
      pressure_status: "capture_blocked",
      reasons: ["minimum_reserve_or_quota_blocks_new_capture"],
      typical_snapshot_bytes: typicalSnapshotBytes
    };
  }
  if (usage >= policy.maximum_recovery_storage_bytes * policy.cleanup_recommended_ratio) {
    return {
      pressure_status: "cleanup_recommended",
      reasons: ["recovery_storage_above_cleanup_threshold"],
      typical_snapshot_bytes: typicalSnapshotBytes
    };
  }
  if (usage >= policy.maximum_recovery_storage_bytes * policy.approaching_limit_ratio || availableBytes < policy.minimum_free_space_reserve_bytes * 2) {
    return {
      pressure_status: "approaching_limit",
      reasons: ["recovery_storage_approaching_limit"],
      typical_snapshot_bytes: typicalSnapshotBytes
    };
  }
  return {
    pressure_status: "healthy",
    reasons: ["within_recovery_storage_policy"],
    typical_snapshot_bytes: typicalSnapshotBytes
  };
}

function probeAvailableBytes(recoveryRoot, options) {
  if (options.freeSpaceProbe) {
    return Number(options.freeSpaceProbe(recoveryRoot));
  }
  if (typeof fs.statfsSync !== "function") {
    return Number.MAX_SAFE_INTEGER;
  }
  try {
    const stat = fs.statfsSync(recoveryRoot);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch (error) {
    throw createGovernanceError("recovery_governance_space_probe_failed", "Recovery storage free space could not be read.", 500);
  }
}

function safeSnapshotSummary(snapshot) {
  return {
    snapshot_id: snapshot.safe_identity || snapshot.snapshot_id,
    created_at: snapshot.created_at,
    updated_at: snapshot.updated_at,
    status: snapshot.status,
    classification: snapshot.classification,
    bytes: snapshot.bytes,
    restorable: snapshot.restorable === true,
    protected: snapshot.classification === "protected",
    protection_reasons: snapshot.protection_reasons.slice(),
    classification_reasons: snapshot.classification_reasons.slice(),
    compatibility: {
      status: snapshot.compatibility && snapshot.compatibility.status || "unknown",
      blocking: snapshot.compatibility && snapshot.compatibility.blocking === true
    }
  };
}

function assertSafeOutput(value) {
  const text = JSON.stringify(value);
  const unsafeOutputPattern = new RegExp([
    "C:\\\\",
    "C:/",
    "sf-factory-projects",
    "wordpress\\.tar",
    "database\\.sql",
    "project-metadata\\.json",
    "CREATE TABLE",
    "INSERT INTO",
    "signing" + "_secret",
    "password",
    "Bearer",
    "access" + "_token",
    "MYSQL" + "_PASSWORD"
  ].join("|"), "i");
  if (unsafeOutputPattern.test(text)) {
    throw createGovernanceError("recovery_governance_usage_failed", "Recovery governance output contained unsafe metadata.", 500);
  }
}

function evaluateRecoveryStorageGovernance(input) {
  const options = input || {};
  assertAllowedCallerInput(options);
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const policy = normalizePolicy(options);
  const nowValue = nowMs(options.clock);
  const helpers = options.filesystem || {};
  const recoveryRoot = options.recoveryRootResolver
    ? options.recoveryRootResolver(projectsRoot)
    : resolveRecoveryRoot(projectsRoot);
  if (!isPathInside(projectsRoot, recoveryRoot)) {
    throw createGovernanceError("recovery_governance_root_invalid", "Recovery root is invalid.", 500);
  }
  const projectStates = getProjectStates(options, projectsRoot).map((projectState) => {
    const runtimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
    return Object.assign({}, projectState, { runtimePath });
  });
  const globalRecursionFindings = [];
  for (const projectState of projectStates) {
    const wordpressRoot = path.join(projectState.runtimePath, "wordpress");
    if (pathsOverlap(recoveryRoot, wordpressRoot)) {
      globalRecursionFindings.push("recovery_root_overlaps_wordpress_root");
    }
    if (pathsOverlap(recoveryRoot, projectState.runtimePath)) {
      globalRecursionFindings.push("recovery_root_overlaps_project_runtime");
    }
  }
  const seenFiles = new Set();
  const projectInventories = [];
  for (const projectState of projectStates) {
    const failedOperationTimes = getFailedOperationTimes(projectState, projectsRoot);
    const inventory = options.snapshotInventoryReader
      ? options.snapshotInventoryReader({ projectState, projectsRoot, policy, nowMs: nowValue, seenFiles })
      : inventoryProject(projectState, {
        projectsRoot,
        policy,
        nowValue,
        filesystem: helpers,
        seenFiles,
        dependencyReader: options.dependencyReader
      });
    inventory.blockers = Array.from(new Set((inventory.blockers || []).concat(globalRecursionFindings)));
    inventory.recursionFindings = Array.from(new Set((inventory.recursionFindings || []).concat(globalRecursionFindings)));
    classifyProjectSnapshots(inventory, policy, nowValue, failedOperationTimes);
    projectInventories.push(inventory);
  }
  const snapshots = projectInventories.flatMap((project) => project.snapshots.map((snapshot) => Object.assign({ project_slug: project.project_slug }, snapshot)));
  const totalBytes = snapshots.reduce((total, snapshot) => total + snapshot.bytes, 0);
  const spaceProbeRoot = fileExists(recoveryRoot, helpers) ? recoveryRoot : projectsRoot;
  const availableBytes = probeAvailableBytes(spaceProbeRoot, options);
  if (!Number.isFinite(availableBytes) || availableBytes < 0) {
    throw createGovernanceError("recovery_governance_space_probe_failed", "Recovery storage free space could not be read.", 500);
  }
  const pressure = classifyPressure({ totalBytes, availableBytes, policy, snapshots });
  const protectedBytes = sumBytes(snapshots, (snapshot) => snapshot.classification === "protected");
  const candidateBytes = sumBytes(snapshots, (snapshot) => snapshot.classification === "eligible_by_count" || snapshot.classification === "eligible_by_age");
  const incompleteCorruptCandidateBytes = sumBytes(snapshots, (snapshot) => snapshot.classification === "incomplete_cleanup_candidate" || snapshot.classification === "corrupt_cleanup_candidate");
  const result = {
    recovery_storage_policy_version: policy.recovery_storage_policy_version,
    policy: safePolicy(policy),
    pressure_status: pressure.pressure_status,
    pressure_reasons: pressure.reasons,
    recovery_usage_bytes: totalBytes,
    quota_bytes: policy.maximum_recovery_storage_bytes,
    available_bytes: availableBytes,
    minimum_reserve_bytes: policy.minimum_free_space_reserve_bytes,
    project_count: projectInventories.length,
    snapshot_count: snapshots.length,
    snapshot_counts_by_status: countBy(snapshots, "status"),
    snapshot_counts_by_classification: countBy(snapshots, "classification"),
    verified_bytes: sumBytes(snapshots, (snapshot) => snapshot.status === "verified"),
    incomplete_corrupt_bytes: sumBytes(snapshots, (snapshot) => snapshot.status === "incomplete" || snapshot.status === "corrupt" || snapshot.corrupt),
    protected_bytes: protectedBytes,
    retained_bytes: sumBytes(snapshots, (snapshot) => snapshot.classification === "retained"),
    reclaimable_candidate_bytes: candidateBytes + incompleteCorruptCandidateBytes,
    eligible_candidate_bytes: candidateBytes,
    incomplete_corrupt_candidate_bytes: incompleteCorruptCandidateBytes,
    protected_count: snapshots.filter((snapshot) => snapshot.classification === "protected").length,
    retained_count: snapshots.filter((snapshot) => snapshot.classification === "retained").length,
    eligible_candidate_count: snapshots.filter((snapshot) => snapshot.classification === "eligible_by_count" || snapshot.classification === "eligible_by_age").length,
    incomplete_corrupt_candidate_count: snapshots.filter((snapshot) => snapshot.classification === "incomplete_cleanup_candidate" || snapshot.classification === "corrupt_cleanup_candidate").length,
    warnings: Array.from(new Set(projectInventories.flatMap((project) => project.warnings).map(sanitizeReason))),
    blockers: Array.from(new Set(projectInventories.flatMap((project) => project.blockers).map(sanitizeReason))),
    recursion_prevention: {
      recovery_root_outside_wordpress: projectInventories.every((project) => !project.recursionFindings.includes("recovery_root_overlaps_wordpress_root")),
      recovery_root_outside_project_runtime: projectInventories.every((project) => !project.recursionFindings.includes("recovery_root_overlaps_project_runtime")),
      archive_accounting_confined_to_snapshot_directories: snapshots.every((snapshot) => !snapshot.findings.includes("artifact_path_escape")),
      recovery_storage_not_referenced_by_artifacts: snapshots.every((snapshot) => !snapshot.findings.includes("artifact_references_recovery_storage")),
      symlink_or_reparse_escape_rejected: snapshots.every((snapshot) => !snapshot.findings.includes("reparse_or_symlink_rejected"))
    },
    projects: projectInventories.map((project) => {
      const projectSnapshots = project.snapshots.map(safeSnapshotSummary);
      return {
        project_slug: project.project_slug,
        snapshot_count: project.snapshots.length,
        recovery_usage_bytes: project.snapshots.reduce((total, snapshot) => total + snapshot.bytes, 0),
        protected_bytes: sumBytes(project.snapshots, (snapshot) => snapshot.classification === "protected"),
        reclaimable_candidate_bytes: sumBytes(project.snapshots, (snapshot) => snapshot.classification === "eligible_by_count" || snapshot.classification === "eligible_by_age" || snapshot.classification === "incomplete_cleanup_candidate" || snapshot.classification === "corrupt_cleanup_candidate"),
        snapshot_counts_by_status: countBy(project.snapshots, "status"),
        snapshot_counts_by_classification: countBy(project.snapshots, "classification"),
        snapshots: projectSnapshots
      };
    }),
    candidates: snapshots
      .filter((snapshot) => snapshot.classification === "eligible_by_count" || snapshot.classification === "eligible_by_age" || snapshot.classification === "incomplete_cleanup_candidate" || snapshot.classification === "corrupt_cleanup_candidate")
      .map((snapshot) => ({
        project_slug: snapshot.project_slug,
        snapshot_id: snapshot.safe_identity || snapshot.snapshot_id,
        created_at: snapshot.created_at,
        classification: snapshot.classification,
        bytes: snapshot.bytes,
        reasons: snapshot.classification_reasons.slice()
      })),
    protected_snapshots: snapshots
      .filter((snapshot) => snapshot.classification === "protected")
      .map((snapshot) => ({
        project_slug: snapshot.project_slug,
        snapshot_id: snapshot.safe_identity || snapshot.snapshot_id,
        created_at: snapshot.created_at,
        bytes: snapshot.bytes,
        reasons: snapshot.protection_reasons.slice()
      })),
    mutation: {
      performed: false,
      deletion_performed: false,
      cleanup_performed: false
    }
  };
  assertSafeOutput(result);
  return result;
}

module.exports = {
  DEFAULT_POLICY,
  RECOVERY_STORAGE_POLICY_VERSION,
  evaluateRecoveryStorageGovernance,
  normalizePolicy
};
