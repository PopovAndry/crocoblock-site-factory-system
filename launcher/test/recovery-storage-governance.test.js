"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const test = require("node:test");
const { createProjectScaffold, ensureDirectory } = require("../src/project-store");
const {
  createRequestedOperation,
  updateOperation
} = require("../src/project-operation-store");
const {
  createManifestRecord,
  resolveSnapshotDirectory,
  transitionManifestStatus
} = require("../src/structural-snapshot-store");
const {
  createRestoreJournal
} = require("../src/structural-restore-reconciliation");
const {
  RECOVERY_STORAGE_POLICY_VERSION,
  evaluateRecoveryStorageGovernance
} = require("../src/recovery-storage-governance");

let portCounter = 39200;
const BASE_NOW = Date.parse("2026-07-17T12:00:00.000Z");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-recovery-governance-"));
}

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, content) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function createProject(projectsRoot, slug) {
  const scaffold = createProjectScaffold({
    name: slug,
    slug,
    port: portCounter += 1,
    projectsRoot
  });
  writeFile(path.join(scaffold.project.runtime_path, "wordpress", "index.php"), "<?php echo 'ok';\n");
  writeFile(path.join(scaffold.project.runtime_path, "wordpress", "wp-config.php"), "<?php // current config\n");
  return scaffold;
}

function snapshotId(index) {
  return "snapshot-2026-07-" + String(10 + index).padStart(2, "0") + "t00-00-00-000z-" + String(index).padStart(12, "a").slice(-12).replace(/[^a-f0-9]/g, "a");
}

function fixedSnapshotId(index) {
  return "snapshot-2026-07-" + String(10 + index).padStart(2, "0") + "t00-00-00-000z-" + String(index).padStart(12, "0");
}

function artifact(type, relativeFilename, content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
  return {
    type,
    relative_filename: relativeFilename,
    digest_algorithm: "sha256",
    digest: sha256(buffer),
    size_bytes: buffer.length,
    capture_status: "verified"
  };
}

function baseManifest(slug, createdAt, extra) {
  return Object.assign({
    snapshot_tier: "local_rescue",
    customer_label: "Recovery Point",
    source_operation_id: "op-test",
    consistency_mode: "test",
    captured_components: [],
    excluded_components: [],
    artifacts: [],
    software: {},
    verification: { status: "not_verified", successful: false },
    restore_compatibility: { status: "not_evaluated", blocking: true, blockers: ["creating"] },
    provenance: { source: "governance_test" },
    created_at: createdAt,
    updated_at: createdAt
  }, extra || {});
}

function createSnapshot(projectsRoot, slug, options) {
  const safe = options || {};
  const id = safe.snapshotId || fixedSnapshotId(safe.index || 1);
  const createdAt = safe.createdAt || new Date(BASE_NOW - 60 * 60 * 1000).toISOString();
  const created = createManifestRecord({
    projectsRoot,
    slug,
    snapshotId: id,
    manifest: baseManifest(slug, createdAt, safe.manifest)
  });
  const context = resolveSnapshotDirectory({ projectsRoot, slug, snapshotId: id });
  if (safe.status === "missing_manifest") {
    fs.rmSync(context.manifestPath, { force: true });
    return { snapshotId: id, context };
  }
  if (safe.status === "invalid_manifest") {
    fs.writeFileSync(context.manifestPath, "{not-json", "utf8");
    return { snapshotId: id, context };
  }
  const db = Buffer.alloc(safe.dbBytes || 11, "d");
  const archive = Buffer.alloc(safe.archiveBytes || 23, "w");
  const metadata = Buffer.alloc(safe.metadataBytes || 7, "m");
  writeFile(path.join(context.snapshotDirectory, "database.sql"), db);
  writeFile(path.join(context.snapshotDirectory, "wordpress.tar"), archive);
  writeFile(path.join(context.snapshotDirectory, "project-metadata.json"), metadata);
  const patch = {
    captured_components: [
      "logical_database_dump",
      "wordpress_filesystem",
      "sanitized_project_metadata",
      "dependency_theme_plugin_identities",
      "agent_version_binding"
    ],
    artifacts: [
      artifact("database_dump", "database.sql", db),
      artifact("wordpress_filesystem", "wordpress.tar", archive),
      artifact("project_metadata", "project-metadata.json", metadata)
    ],
    verification: {
      status: "artifacts_verified",
      successful: true,
      verified_at: createdAt,
      checks: ["database", "filesystem", "metadata"]
    },
    restore_compatibility: {
      status: "same_project_compatible",
      blocking: false,
      blockers: []
    },
    provenance: Object.assign({ source: "governance_test" }, safe.provenance || {}),
    software: Object.assign({}, safe.software || {})
  };
  if (safe.status === "verified" || !safe.status) {
    transitionManifestStatus({ projectsRoot, slug, snapshotId: id, status: "complete", patch });
    transitionManifestStatus({ projectsRoot, slug, snapshotId: id, status: "verified" });
  } else if (safe.status === "incomplete") {
    transitionManifestStatus({ projectsRoot, slug, snapshotId: id, status: "incomplete" });
  } else if (safe.status === "corrupt") {
    transitionManifestStatus({ projectsRoot, slug, snapshotId: id, status: "complete", patch });
    transitionManifestStatus({ projectsRoot, slug, snapshotId: id, status: "corrupt" });
  }
  return { snapshotId: id, context };
}

function evaluate(projectsRoot, options) {
  return evaluateRecoveryStorageGovernance(Object.assign({
    projectsRoot,
    clock: () => BASE_NOW,
    freeSpaceProbe: () => 10 * 1024 * 1024 * 1024
  }, options || {}));
}

function findSnapshot(result, snapshotId) {
  return result.projects.flatMap((project) => project.snapshots).find((snapshot) => snapshot.snapshot_id === snapshotId);
}

test("empty inventory evaluates safely with server-owned policy", () => {
  const projectsRoot = tempRoot();
  const result = evaluate(projectsRoot);
  assert.equal(result.recovery_storage_policy_version, RECOVERY_STORAGE_POLICY_VERSION);
  assert.equal(result.pressure_status, "healthy");
  assert.equal(result.project_count, 0);
  assert.equal(result.snapshot_count, 0);
  assert.equal(result.mutation.performed, false);
});

test("actual artifact bytes are counted without double-counting hard links", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "bytes-project");
  const first = createSnapshot(projectsRoot, "bytes-project", { index: 1, archiveBytes: 100, dbBytes: 50, metadataBytes: 25 });
  const duplicatePath = path.join(first.context.snapshotDirectory, "hardlink-copy.bin");
  try {
    fs.linkSync(path.join(first.context.snapshotDirectory, "wordpress.tar"), duplicatePath);
  } catch (error) {
    writeFile(duplicatePath, Buffer.alloc(0));
  }
  const result = evaluate(projectsRoot);
  const snapshot = findSnapshot(result, first.snapshotId);
  assert.ok(snapshot.bytes >= 175);
  assert.ok(snapshot.bytes < 5000);
  assert.equal(result.verified_bytes, snapshot.bytes);
});

test("verified incomplete and corrupt totals are separated", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "totals-project");
  createSnapshot(projectsRoot, "totals-project", { index: 1, status: "verified" });
  createSnapshot(projectsRoot, "totals-project", { index: 2, status: "incomplete" });
  createSnapshot(projectsRoot, "totals-project", { index: 3, status: "corrupt" });
  const result = evaluate(projectsRoot);
  assert.equal(result.snapshot_counts_by_status.verified, 1);
  assert.equal(result.snapshot_counts_by_status.incomplete, 1);
  assert.equal(result.snapshot_counts_by_status.corrupt, 1);
  assert.ok(result.verified_bytes > 0);
  assert.ok(result.incomplete_corrupt_bytes > 0);
});

test("latest verified restorable snapshot is protected and active dependencies protect source and rescue", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "protected-project");
  const old = createSnapshot(projectsRoot, "protected-project", { index: 1, createdAt: "2026-07-10T00:00:00.000Z" });
  const latest = createSnapshot(projectsRoot, "protected-project", { index: 2, createdAt: "2026-07-16T00:00:00.000Z" });
  const rescue = createSnapshot(projectsRoot, "protected-project", { index: 3, createdAt: "2026-07-11T00:00:00.000Z" });
  createRequestedOperation({
    projectsRoot,
    slug: "protected-project",
    operationId: "op-active-restore",
    operationType: "structural_restore_execute",
    idempotencyKeyHash: "hash",
    requestFingerprint: "fingerprint"
  });
  updateOperation({
    projectsRoot,
    slug: "protected-project",
    operationId: "op-active-restore",
    patch: {
      status: "running",
      stage: "importing_database",
      result_summary: {
        source_snapshot_id: old.snapshotId,
        rescue_snapshot_id: rescue.snapshotId
      }
    }
  });
  const result = evaluate(projectsRoot, {
    allowPolicyInjection: true,
    policy: { maximum_retained_verified_snapshots_per_project: 1 }
  });
  assert.equal(findSnapshot(result, latest.snapshotId).classification, "protected");
  assert.ok(findSnapshot(result, latest.snapshotId).protection_reasons.includes("latest_verified_restorable"));
  assert.equal(findSnapshot(result, old.snapshotId).classification, "protected");
  assert.ok(findSnapshot(result, old.snapshotId).protection_reasons.includes("active_restore_source"));
  assert.equal(findSnapshot(result, rescue.snapshotId).classification, "protected");
  assert.ok(findSnapshot(result, rescue.snapshotId).protection_reasons.includes("active_restore_rescue"));
});

test("non-expired restore plan protects source while expired plan does not", () => {
  const projectsRoot = tempRoot();
  const scaffold = createProject(projectsRoot, "plan-project");
  const source = createSnapshot(projectsRoot, "plan-project", { index: 1, createdAt: "2026-07-10T00:00:00.000Z" });
  const expired = createSnapshot(projectsRoot, "plan-project", { index: 2, createdAt: "2026-07-11T00:00:00.000Z" });
  const planDir = path.join(scaffold.project.runtime_path, "runs", "restore-plans");
  ensureDirectory(planDir);
  writeFile(path.join(planDir, "restore-plan-2026-07-17t11-00-00-000z-abc123.json"), JSON.stringify({
    plan_id: "restore-plan-2026-07-17t11-00-00-000z-abc123",
    snapshot_id: source.snapshotId,
    readiness: "ready",
    expires_at: "2026-07-17T13:00:00.000Z"
  }));
  writeFile(path.join(planDir, "restore-plan-2026-07-17t10-00-00-000z-def456.json"), JSON.stringify({
    plan_id: "restore-plan-2026-07-17t10-00-00-000z-def456",
    snapshot_id: expired.snapshotId,
    readiness: "ready",
    expires_at: "2026-07-17T10:30:00.000Z"
  }));
  const result = evaluate(projectsRoot, {
    allowPolicyInjection: true,
    policy: { maximum_retained_verified_snapshots_per_project: 1 }
  });
  assert.equal(findSnapshot(result, source.snapshotId).classification, "protected");
  assert.ok(findSnapshot(result, source.snapshotId).protection_reasons.includes("non_expired_restore_plan_source"));
  assert.equal(findSnapshot(result, expired.snapshotId).protection_reasons.includes("non_expired_restore_plan_source"), false);
});

test("interrupted reconciliation journal dependency and explicit server metadata protect snapshots", () => {
  const projectsRoot = tempRoot();
  const scaffold = createProject(projectsRoot, "journal-project");
  const source = createSnapshot(projectsRoot, "journal-project", { index: 1 });
  const explicit = createSnapshot(projectsRoot, "journal-project", { index: 2, provenance: { governance_protected: true } });
  createRequestedOperation({
    projectsRoot,
    slug: "journal-project",
    operationId: "op-journal",
    operationType: "structural_restore_execute",
    idempotencyKeyHash: "hash",
    requestFingerprint: "fingerprint"
  });
  updateOperation({
    projectsRoot,
    slug: "journal-project",
    operationId: "op-journal",
    patch: { status: "failed", stage: "interrupted_recovery_required" }
  });
  createRestoreJournal({
    projectsRoot,
    runtimePath: scaffold.project.runtime_path,
    projectState: { project: scaffold.project },
    operationId: "op-journal",
    planId: "restore-plan-test",
    sourceSnapshotId: source.snapshotId,
    rescueStrategy: "none_emergency"
  });
  const result = evaluate(projectsRoot);
  assert.equal(findSnapshot(result, source.snapshotId).classification, "protected");
  assert.ok(findSnapshot(result, source.snapshotId).protection_reasons.includes("interrupted_reconciliation_journal_source"));
  assert.equal(findSnapshot(result, explicit.snapshotId).classification, "protected");
  assert.ok(findSnapshot(result, explicit.snapshotId).protection_reasons.includes("explicit_server_owned_protection"));
});

test("retention count age incomplete corrupt and recent failure classifications are deterministic", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "retention-project");
  const latest = createSnapshot(projectsRoot, "retention-project", { index: 1, createdAt: "2026-07-17T11:00:00.000Z" });
  const countEligible = createSnapshot(projectsRoot, "retention-project", { index: 2, createdAt: "2026-07-16T11:00:00.000Z" });
  const ageEligible = createSnapshot(projectsRoot, "retention-project", { index: 3, createdAt: "2026-06-01T00:00:00.000Z" });
  const incompleteOld = createSnapshot(projectsRoot, "retention-project", { index: 4, status: "incomplete", createdAt: "2026-07-10T00:00:00.000Z" });
  const corruptOld = createSnapshot(projectsRoot, "retention-project", { index: 5, status: "corrupt", createdAt: "2026-07-10T00:00:00.000Z" });
  const incompleteRecent = createSnapshot(projectsRoot, "retention-project", {
    index: 6,
    status: "incomplete",
    createdAt: "2026-07-17T11:30:00.000Z",
    manifest: { source_operation_id: "op-recent-failed" }
  });
  createRequestedOperation({
    projectsRoot,
    slug: "retention-project",
    operationId: "op-recent-failed",
    operationType: "structural_snapshot_capture",
    idempotencyKeyHash: "hash",
    requestFingerprint: "fingerprint"
  });
  updateOperation({
    projectsRoot,
    slug: "retention-project",
    operationId: "op-recent-failed",
    patch: {
      status: "failed",
      completed_at: "2026-07-17T11:45:00.000Z"
    }
  });
  const result = evaluate(projectsRoot, {
    allowPolicyInjection: true,
    policy: {
      maximum_retained_verified_snapshots_per_project: 1,
      maximum_snapshot_age_ms: 30 * 24 * 60 * 60 * 1000,
      incomplete_corrupt_grace_period_ms: 24 * 60 * 60 * 1000,
      recent_failure_grace_period_ms: 24 * 60 * 60 * 1000
    }
  });
  assert.equal(findSnapshot(result, latest.snapshotId).classification, "protected");
  assert.equal(findSnapshot(result, countEligible.snapshotId).classification, "eligible_by_count");
  assert.equal(findSnapshot(result, ageEligible.snapshotId).classification, "eligible_by_age");
  assert.equal(findSnapshot(result, incompleteOld.snapshotId).classification, "incomplete_cleanup_candidate");
  assert.equal(findSnapshot(result, corruptOld.snapshotId).classification, "corrupt_cleanup_candidate");
  assert.equal(findSnapshot(result, incompleteRecent.snapshotId).classification, "blocked_from_cleanup");
  assert.ok(result.reclaimable_candidate_bytes > 0);
});

test("invalid manifest and unknown identity fail closed as review state", () => {
  const projectsRoot = tempRoot();
  const scaffold = createProject(projectsRoot, "invalid-project");
  const invalid = createSnapshot(projectsRoot, "invalid-project", { index: 1, status: "invalid_manifest" });
  const context = resolveSnapshotDirectory({ projectsRoot, slug: "invalid-project" });
  mkdirp(path.join(context.projectDirectory, "not-a-snapshot"));
  writeFile(path.join(context.projectDirectory, "not-a-snapshot", "leftover.tmp"), "x");
  const result = evaluate(projectsRoot);
  assert.equal(findSnapshot(result, invalid.snapshotId).classification, "unknown_requires_review");
  assert.ok(result.snapshot_counts_by_classification.unknown_requires_review >= 1);
  assert.equal(result.mutation.performed, false);
  assert.equal(fs.existsSync(path.join(context.projectDirectory, "not-a-snapshot", "leftover.tmp")), true);
  assert.equal(fs.existsSync(scaffold.project.runtime_path), true);
});

test("pressure classifications cover healthy approaching cleanup capture blocked and emergency", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "pressure-project");
  createSnapshot(projectsRoot, "pressure-project", { index: 1, archiveBytes: 1000, dbBytes: 100, metadataBytes: 100 });
  createSnapshot(projectsRoot, "pressure-project", { index: 2, archiveBytes: 1000, dbBytes: 100, metadataBytes: 100 });
  createSnapshot(projectsRoot, "pressure-project", { index: 3, archiveBytes: 1000, dbBytes: 100, metadataBytes: 100 });
  const baseline = evaluate(projectsRoot, { allowPolicyInjection: true, policy: { maximum_recovery_storage_bytes: 10 * 1024 * 1024 } });
  const cleanupQuota = Math.ceil(baseline.recovery_usage_bytes / 0.25);
  assert.equal(evaluate(projectsRoot, { allowPolicyInjection: true, policy: { maximum_recovery_storage_bytes: 10 * 1024 * 1024 } }).pressure_status, "healthy");
  assert.equal(evaluate(projectsRoot, { allowPolicyInjection: true, policy: { maximum_recovery_storage_bytes: 15000, approaching_limit_ratio: 0.2, cleanup_recommended_ratio: 0.9 } }).pressure_status, "approaching_limit");
  assert.equal(evaluate(projectsRoot, { allowPolicyInjection: true, policy: { maximum_recovery_storage_bytes: cleanupQuota, approaching_limit_ratio: 0.2, cleanup_recommended_ratio: 0.25 } }).pressure_status, "cleanup_recommended");
  assert.equal(evaluate(projectsRoot, { allowPolicyInjection: true, policy: { maximum_recovery_storage_bytes: 1200 } }).pressure_status, "capture_blocked");
  assert.equal(evaluate(projectsRoot, { freeSpaceProbe: () => 1, allowPolicyInjection: true, policy: { minimum_free_space_reserve_bytes: 10 } }).pressure_status, "restore_only_emergency");
});

test("recursion prevention rejects recovery root overlap and artifact references to recovery storage", () => {
  const projectsRoot = tempRoot();
  const scaffold = createProject(projectsRoot, "recursion-project");
  const source = createSnapshot(projectsRoot, "recursion-project", { index: 1 });
  const manifestPath = path.join(source.context.snapshotDirectory, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.artifacts[1].relative_filename = ".factory-recovery/wordpress.tar";
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const result = evaluate(projectsRoot, {
    recoveryRootResolver: () => path.join(scaffold.project.runtime_path, "wordpress", ".factory-recovery", "snapshots")
  });
  assert.equal(result.recursion_prevention.recovery_root_outside_wordpress, false);
  assert.equal(result.recursion_prevention.recovery_storage_not_referenced_by_artifacts, false);
  assert.ok(result.blockers.includes("recovery_root_overlaps_wordpress_root"));
  assert.equal(findSnapshot(result, source.snapshotId).classification, "unknown_requires_review");
});

test("symlink escape is rejected without following it", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "symlink-project");
  const source = createSnapshot(projectsRoot, "symlink-project", { index: 1 });
  const linkPath = path.join(source.context.snapshotDirectory, "linked");
  try {
    fs.symlinkSync(projectsRoot, linkPath, "junction");
  } catch (error) {
    fs.symlinkSync(source.context.snapshotDirectory, linkPath, "dir");
  }
  const result = evaluate(projectsRoot);
  assert.equal(findSnapshot(result, source.snapshotId).classification, "unknown_requires_review");
  assert.equal(result.recursion_prevention.symlink_or_reparse_escape_rejected, false);
});

test("caller paths and arbitrary production policy overrides are rejected", () => {
  const projectsRoot = tempRoot();
  assert.throws(
    () => evaluateRecoveryStorageGovernance({ projectsRoot, projectPath: "C:/secret" }),
    (error) => error.code === "recovery_governance_input_rejected"
  );
  assert.throws(
    () => evaluateRecoveryStorageGovernance({ projectsRoot, policy: { maximum_recovery_storage_bytes: 1 } }),
    (error) => error.code === "recovery_governance_policy_invalid"
  );
});

test("safe output contains no paths filenames secrets and evaluator performs no mutation", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "safe-project");
  createSnapshot(projectsRoot, "safe-project", { index: 1 });
  const before = fs.readdirSync(projectsRoot, { recursive: true }).sort();
  const result = evaluate(projectsRoot);
  const after = fs.readdirSync(projectsRoot, { recursive: true }).sort();
  const text = JSON.stringify(result);
  assert.deepEqual(after, before);
  assert.equal(result.mutation.performed, false);
  assert.equal(/C:\\|C:\/|factory-recovery|wordpress\.tar|database\.sql|project-metadata\.json|CREATE TABLE|password|Bearer|access_token/i.test(text), false);
});

test("static governance scope contains no routes UI deletion cleanup executor Docker or credentials", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../src/recovery-storage-governance.js"), "utf8");
  assert.equal(/app\.(get|post|put|delete)|createLauncherServer|document\.|innerHTML/i.test(source), false);
  assert.equal(/fs\.(rm|unlink|rmdir|writeFile|rename)|docker\s+(?:rm|prune|stop|start|restart)|spawn\(|exec\(/i.test(source), false);
  assert.equal(/MYSQL_PASSWORD|DB_PASSWORD|signing_secret|Bearer\s+[A-Za-z0-9]/i.test(source), false);
});
