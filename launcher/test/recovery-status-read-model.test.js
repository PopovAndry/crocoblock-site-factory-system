"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createProjectScaffold
} = require("../src/project-store");
const {
  createManifestRecord,
  resolveSnapshotDirectory,
  transitionManifestStatus
} = require("../src/structural-snapshot-store");
const {
  getRecoveryStatus,
  SCHEMA_VERSION
} = require("../src/recovery-status-read-model");

const BASE_NOW = Date.parse("2026-07-17T12:00:00.000Z");
let portCounter = 43000;

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-recovery-status-"));
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
  return scaffold;
}

function snapshotId(index) {
  return "snapshot-2026-07-" + String(10 + index).padStart(2, "0") + "t00-00-00-000z-" + String(index).padStart(12, "0");
}

function summary(index, overrides) {
  return Object.assign({
    snapshot_id: snapshotId(index),
    created_at: new Date(BASE_NOW - index * 60 * 1000).toISOString(),
    status: "verified",
    snapshot_tier: "local_rescue",
    verified: true,
    restorable: true,
    corrupt: false
  }, overrides || {});
}

function governanceFor(slug, snapshots, overrides) {
  const safeSnapshots = (snapshots || []).map((snapshot) => ({
    snapshot_id: snapshot.snapshot_id,
    status: snapshot.status || "verified",
    classification: snapshot.classification || (snapshot.protected ? "protected" : "retained"),
    protected: snapshot.protected === true,
    restorable: snapshot.restorable !== false,
    created_at: snapshot.created_at || null,
    bytes: 0,
    protection_reasons: [],
    classification_reasons: [],
    compatibility: { status: "same_project_compatible", blocking: false }
  }));
  return Object.assign({
    pressure_status: "healthy",
    warnings: [],
    blockers: [],
    projects: [{
      project_slug: slug,
      snapshots: safeSnapshots,
      snapshot_counts_by_classification: safeSnapshots.reduce((counts, item) => {
        counts[item.classification] = (counts[item.classification] || 0) + 1;
        return counts;
      }, {})
    }]
  }, overrides || {});
}

function evaluate(projectsRoot, slug, options) {
  const safe = options || {};
  const snapshots = safe.snapshots || [];
  return getRecoveryStatus({
    projectsRoot,
    projectSlug: slug,
    clock: () => new Date(BASE_NOW),
    governanceReader: safe.governanceReader || (() => governanceFor(slug, safe.governanceSnapshots || snapshots, safe.governance || {})),
    snapshotReader: safe.snapshotReader || (() => snapshots),
    operationReader: safe.operationReader || (() => safe.operations || []),
    planReader: safe.planReader || (() => safe.plans || [])
  });
}

function assertNoUnsafeSerializedFields(result) {
  const text = JSON.stringify(result);
  assert.equal(/[A-Za-z]:[\\/]|\/tmp\/|\/var\/|\/home\/|wordpress\.tar|database\.sql|project-metadata\.json|manifest\.json|restore-journal\.json|op-\d{4}|Error:|at\s+\w|password|Bearer|access_token/i.test(text), false);
}

function createRestorableSnapshot(projectsRoot, slug, index, overrides) {
  const id = snapshotId(index);
  const createdAt = overrides && overrides.created_at || new Date(BASE_NOW - index * 60 * 1000).toISOString();
  createManifestRecord({
    projectsRoot,
    slug,
    snapshotId: id,
    manifest: {
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
      provenance: { source: "read_model_test" },
      created_at: createdAt,
      updated_at: createdAt
    }
  });
  const context = resolveSnapshotDirectory({ projectsRoot, slug, snapshotId: id });
  const db = Buffer.from("CREATE TABLE wp_posts (ID bigint);\n");
  const archive = Buffer.from("fake archive");
  const metadata = Buffer.from("{}");
  writeFile(path.join(context.snapshotDirectory, "database.sql"), db);
  writeFile(path.join(context.snapshotDirectory, "wordpress.tar"), archive);
  writeFile(path.join(context.snapshotDirectory, "project-metadata.json"), metadata);
  const artifact = (type, filename, content) => ({
    type,
    relative_filename: filename,
    digest_algorithm: "sha256",
    digest: sha256(content),
    size_bytes: content.length,
    capture_status: "verified"
  });
  transitionManifestStatus({
    projectsRoot,
    slug,
    snapshotId: id,
    status: "complete",
    patch: {
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
      verification: { status: "artifacts_verified", successful: true, verified_at: createdAt },
      restore_compatibility: { status: "same_project_compatible", blocking: false, blockers: [] }
    }
  });
  transitionManifestStatus({ projectsRoot, slug, snapshotId: id, status: "verified" });
  return id;
}

test("valid project with no snapshots", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "empty-project");
  const result = evaluate(projectsRoot, "empty-project");
  assert.equal(result.availability, "unavailable");
  assert.equal(result.protection_status, "not_protected");
  assert.equal(result.latest_recovery_point, null);
  assert.equal(result.recommended_action, "create_recovery_point");
});

test("one verified restorable snapshot", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "one-project");
  const snapshots = [summary(1)];
  const result = evaluate(projectsRoot, "one-project", { snapshots, governanceSnapshots: [{ snapshot_id: snapshots[0].snapshot_id, protected: true }] });
  assert.equal(result.availability, "available");
  assert.equal(result.latest_recovery_point.snapshot_id, snapshots[0].snapshot_id);
  assert.equal(result.latest_recovery_point.verified, true);
  assert.equal(result.latest_recovery_point.restorable, true);
});

test("newer unverified snapshot plus older verified snapshot", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "unverified-project");
  const snapshots = [
    summary(1, { status: "complete", verified: false, restorable: false }),
    summary(2)
  ];
  const result = evaluate(projectsRoot, "unverified-project", { snapshots });
  assert.equal(result.latest_recovery_point.snapshot_id, snapshots[1].snapshot_id);
  assert.equal(result.availability, "limited");
  assert.ok(result.warnings.some((warning) => warning.code === "newer_recovery_point_unusable"));
});

test("newer corrupt snapshot plus older verified snapshot", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "corrupt-project");
  const snapshots = [
    summary(1, { status: "corrupt", verified: false, restorable: false, corrupt: true }),
    summary(2)
  ];
  const result = evaluate(projectsRoot, "corrupt-project", { snapshots, governanceSnapshots: [{ snapshot_id: snapshots[0].snapshot_id, classification: "unknown_requires_review" }, { snapshot_id: snapshots[1].snapshot_id }] });
  assert.equal(result.latest_recovery_point.snapshot_id, snapshots[1].snapshot_id);
  assert.equal(result.availability, "limited");
});

test("no restorable snapshots", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "no-restorable-project");
  const result = evaluate(projectsRoot, "no-restorable-project", { snapshots: [summary(1, { restorable: false })] });
  assert.equal(result.availability, "unavailable");
  assert.equal(result.protection_status, "not_protected");
});

test("selected Recovery Point is governance-protected", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "protected-project");
  const snapshots = [summary(1)];
  const result = evaluate(projectsRoot, "protected-project", { snapshots, governanceSnapshots: [{ snapshot_id: snapshots[0].snapshot_id, protected: true }] });
  assert.equal(result.latest_recovery_point.protected, true);
  assert.equal(result.protection_status, "protected");
});

test("usable but unprotected Recovery Point", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "unprotected-project");
  const result = evaluate(projectsRoot, "unprotected-project", { snapshots: [summary(1)] });
  assert.equal(result.latest_recovery_point.protected, false);
  assert.equal(result.protection_status, "partially_protected");
});

for (const [name, pressure, expectedAction] of [
  ["storage healthy", "healthy", "none"],
  ["storage approaching limit", "approaching_limit", "review_storage"],
  ["cleanup recommended", "cleanup_recommended", "review_storage"],
  ["capture blocked", "capture_blocked", "review_storage"],
  ["restore-only emergency", "restore_only_emergency", "review_storage"]
]) {
  test(name, () => {
    const projectsRoot = tempRoot();
    createProject(projectsRoot, name.replace(/[^a-z]+/g, "-"));
    const snapshots = [summary(1)];
    const result = evaluate(projectsRoot, name.replace(/[^a-z]+/g, "-"), {
      snapshots,
      governance: { pressure_status: pressure }
    });
    assert.equal(result.storage_status, pressure);
    assert.equal(result.recommended_action, expectedAction);
  });
}

test("valid non-expired ready restore plan", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "plan-project");
  const result = evaluate(projectsRoot, "plan-project", {
    snapshots: [summary(1)],
    plans: [{ plan_id: "restore-plan-2026-07-17t11-00-00-000z-aaaaaa", project_slug: "plan-project", readiness: "ready", expired: false }]
  });
  assert.equal(result.restore_status, "plan_ready");
  assert.equal(result.recommended_action, "review_restore");
});

test("a later successful verified restore dominates an older still-valid plan", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "completed-after-plan");
  const result = evaluate(projectsRoot, "completed-after-plan", {
    snapshots: [summary(1)],
    plans: [{
      plan_id: "restore-plan-2026-07-17t11-00-00-000z-complete",
      project_slug: "completed-after-plan",
      readiness: "ready",
      created_at: "2026-07-17T11:00:00.000Z",
      expired: false
    }],
    operations: [{
      operation_id: "op-completed-after-plan",
      operation_type: "structural_restore_execute",
      project_slug: "completed-after-plan",
      status: "succeeded",
      completed_at: "2026-07-17T11:01:00.000Z",
      result_summary: { restore_verified: true }
    }]
  });
  assert.equal(result.restore_status, "completed");
  assert.equal(result.recommended_action, "none");
  assert.ok(result.warnings.some((warning) => warning.code === "restore_completed"));
});

test("a newer actionable restore plan remains ready after an older verified restore", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "newer-plan-after-restore");
  const result = evaluate(projectsRoot, "newer-plan-after-restore", {
    snapshots: [summary(1)],
    plans: [{
      plan_id: "restore-plan-2026-07-17t11-02-00-000z-newer",
      project_slug: "newer-plan-after-restore",
      readiness: "ready",
      created_at: "2026-07-17T11:02:00.000Z",
      expired: false
    }],
    operations: [{
      operation_id: "op-older-verified-restore",
      operation_type: "structural_restore_execute",
      project_slug: "newer-plan-after-restore",
      status: "succeeded",
      completed_at: "2026-07-17T11:01:00.000Z",
      result_summary: { restore_verified: true }
    }]
  });
  assert.equal(result.restore_status, "plan_ready");
  assert.equal(result.recommended_action, "review_restore");
});

test("a later unverified successful restore does not complete an older plan", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "unverified-after-plan");
  const result = evaluate(projectsRoot, "unverified-after-plan", {
    snapshots: [summary(1)],
    plans: [{
      plan_id: "restore-plan-2026-07-17t11-00-00-000z-unverified",
      project_slug: "unverified-after-plan",
      readiness: "ready",
      created_at: "2026-07-17T11:00:00.000Z",
      expired: false
    }],
    operations: [{
      operation_id: "op-unverified-after-plan",
      operation_type: "structural_restore_execute",
      project_slug: "unverified-after-plan",
      status: "succeeded",
      completed_at: "2026-07-17T11:01:00.000Z",
      result_summary: { restore_verified: false }
    }]
  });
  assert.equal(result.restore_status, "failed");
  assert.equal(result.recommended_action, "review_restore");
  assert.ok(result.warnings.some((warning) => warning.code === "restore_failed"));
});

test("a later failed restore remains visible over an older verified restore", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "failed-after-verified");
  const result = evaluate(projectsRoot, "failed-after-verified", {
    snapshots: [summary(1)],
    operations: [
      {
        operation_id: "op-verified-first",
        operation_type: "structural_restore_execute",
        project_slug: "failed-after-verified",
        status: "succeeded",
        completed_at: "2026-07-17T11:01:00.000Z",
        result_summary: { restore_verified: true }
      },
      {
        operation_id: "op-failed-later",
        operation_type: "structural_restore_execute",
        project_slug: "failed-after-verified",
        status: "failed",
        completed_at: "2026-07-17T11:02:00.000Z"
      }
    ]
  });
  assert.equal(result.restore_status, "failed");
  assert.equal(result.recommended_action, "review_restore");
});

test("a later reconciliation-required restore remains visible over verified success", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "reconciliation-after-verified");
  const result = evaluate(projectsRoot, "reconciliation-after-verified", {
    snapshots: [summary(1)],
    operations: [
      {
        operation_id: "op-verified-first",
        operation_type: "structural_restore_execute",
        project_slug: "reconciliation-after-verified",
        status: "succeeded",
        completed_at: "2026-07-17T11:01:00.000Z",
        result_summary: { restore_verified: true }
      },
      {
        operation_id: "op-reconciliation-later",
        operation_type: "structural_restore_execute",
        project_slug: "reconciliation-after-verified",
        status: "failed",
        stage: "interrupted_recovery_required",
        completed_at: "2026-07-17T11:02:00.000Z"
      }
    ]
  });
  assert.equal(result.restore_status, "reconciliation_required");
  assert.equal(result.recommended_action, "resume_reconciliation");
});

test("plan awaiting confirmation", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "confirm-project");
  const result = evaluate(projectsRoot, "confirm-project", {
    snapshots: [summary(1)],
    plans: [{ plan_id: "restore-plan-2026-07-17t11-00-00-000z-bbbbbb", project_slug: "confirm-project", readiness: "ready_with_emergency_confirmation", expired: false }]
  });
  assert.equal(result.restore_status, "awaiting_confirmation");
});

test("expired restore plan ignored as active", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "expired-project");
  const result = evaluate(projectsRoot, "expired-project", {
    snapshots: [summary(1)],
    plans: [{ plan_id: "restore-plan-2026-07-17t11-00-00-000z-cccccc", project_slug: "expired-project", readiness: "ready", expired: true }]
  });
  assert.equal(result.restore_status, "idle");
  assert.ok(result.warnings.some((warning) => warning.code === "expired_restore_plan_ignored"));
});

for (const [name, operation, expectedStatus, expectedAction] of [
  ["running restore", { operation_type: "structural_restore_execute", project_slug: "restore-project", status: "running", requested_at: "2026-07-17T11:00:00.000Z" }, "running", "review_restore"],
  ["interrupted restore", { operation_type: "structural_restore_execute", project_slug: "restore-project", status: "interrupted", requested_at: "2026-07-17T11:00:00.000Z" }, "interrupted", "resume_reconciliation"],
  ["reconciliation required", { operation_type: "structural_restore_execute", project_slug: "restore-project", status: "failed", stage: "interrupted_recovery_required", requested_at: "2026-07-17T11:00:00.000Z" }, "reconciliation_required", "resume_reconciliation"],
  ["failed restore", { operation_type: "structural_restore_execute", project_slug: "restore-project", status: "failed", requested_at: "2026-07-17T11:00:00.000Z" }, "failed", "review_restore"],
  ["unverified successful restore", { operation_type: "structural_restore_execute", project_slug: "restore-project", status: "succeeded", requested_at: "2026-07-17T11:00:00.000Z" }, "failed", "review_restore"],
  ["completed verified restore", { operation_type: "structural_restore_execute", project_slug: "restore-project", status: "succeeded", requested_at: "2026-07-17T11:00:00.000Z", result_summary: { restore_verified: true } }, "completed", "none"]
]) {
  test(name, () => {
    const projectsRoot = tempRoot();
    createProject(projectsRoot, "restore-project");
    const result = evaluate(projectsRoot, "restore-project", {
      snapshots: [summary(1)],
      operations: [Object.assign({ operation_id: "op-test" }, operation)]
    });
    assert.equal(result.restore_status, expectedStatus);
    assert.equal(result.recommended_action, expectedAction);
  });
}

test("conflicting journals fail closed", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "journal-conflict");
  const result = evaluate(projectsRoot, "journal-conflict", {
    snapshots: [summary(1)],
    operations: [
      { operation_id: "op-a", operation_type: "structural_restore_execute", project_slug: "journal-conflict", status: "failed", stage: "interrupted_recovery_required" },
      { operation_id: "op-b", operation_type: "structural_restore_execute", project_slug: "journal-conflict", status: "failed", stage: "interrupted_recovery_required" }
    ]
  });
  assert.equal(result.restore_status, "unknown");
  assert.equal(result.recommended_action, "contact_support");
});

test("conflicting active restore states fail closed", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "active-conflict");
  const result = evaluate(projectsRoot, "active-conflict", {
    snapshots: [summary(1)],
    operations: [
      { operation_id: "op-a", operation_type: "structural_restore_execute", project_slug: "active-conflict", status: "running" },
      { operation_id: "op-b", operation_type: "structural_restore_execute", project_slug: "active-conflict", status: "requested" }
    ]
  });
  assert.equal(result.restore_status, "unknown");
  assert.ok(result.blockers.some((blocker) => blocker.code === "restore_state_conflict"));
});

test("unknown snapshot classification", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "unknown-classification");
  const snapshots = [summary(1)];
  const result = evaluate(projectsRoot, "unknown-classification", {
    snapshots,
    governanceSnapshots: [{ snapshot_id: snapshots[0].snapshot_id, classification: "unknown_requires_review" }]
  });
  assert.equal(result.availability, "limited");
  assert.ok(result.warnings.some((warning) => warning.code === "newer_recovery_point_unusable"));
});

test("governance blocker", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "governance-blocker");
  const result = evaluate(projectsRoot, "governance-blocker", {
    snapshots: [summary(1)],
    governance: { blockers: ["active_dependency_state_unreadable"] }
  });
  assert.equal(result.availability, "unknown");
  assert.equal(result.recommended_action, "contact_support");
});

test("unreadable metadata sanitized", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "unreadable-project");
  const result = evaluate(projectsRoot, "unreadable-project", {
    snapshotReader() {
      const error = new Error("C:\\secret\\manifest.json failed");
      error.code = "EACCES";
      throw error;
    }
  });
  assert.equal(result.availability, "unknown");
  assert.ok(result.blockers.some((blocker) => blocker.code === "recovery_metadata_unreadable"));
  assertNoUnsafeSerializedFields(result);
});

test("unsupported schema sanitized", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "unsupported-project");
  const result = evaluate(projectsRoot, "unsupported-project", {
    snapshotReader() {
      const error = new Error("unsupported schema in manifest.json");
      error.code = "snapshot_manifest_unsupported_schema";
      throw error;
    }
  });
  assert.ok(result.blockers.some((blocker) => blocker.code === "unsupported_recovery_metadata"));
  assertNoUnsafeSerializedFields(result);
});

test("invalid project slug rejected", () => {
  const projectsRoot = tempRoot();
  assert.throws(() => getRecoveryStatus({ projectsRoot, projectSlug: "../bad" }), (error) => error.code === "invalid_project_slug");
});

test("project not found", () => {
  const projectsRoot = tempRoot();
  assert.throws(() => getRecoveryStatus({ projectsRoot, projectSlug: "missing-project" }), (error) => error.code === "project_not_found");
});

test("cross-project reference rejected", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "project-a");
  const result = evaluate(projectsRoot, "project-a", {
    snapshots: [summary(1)],
    plans: [{ plan_id: "restore-plan-2026-07-17t11-00-00-000z-dddddd", project_slug: "project-b", readiness: "ready", expired: false }]
  });
  assert.equal(result.restore_status, "unknown");
  assert.ok(result.blockers.some((blocker) => blocker.code === "cross_project_recovery_state"));
});

test("deterministic latest selection", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "latest-project");
  const newer = summary(1);
  const older = summary(2);
  const result = evaluate(projectsRoot, "latest-project", { snapshots: [older, newer] });
  assert.equal(result.latest_recovery_point.snapshot_id, newer.snapshot_id);
});

test("stable tie-break selection", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "tie-project");
  const sameTime = "2026-07-17T10:00:00.000Z";
  const left = summary(1, { created_at: sameTime, snapshot_id: "snapshot-2026-07-17t10-00-00-000z-000000000001" });
  const right = summary(1, { created_at: sameTime, snapshot_id: "snapshot-2026-07-17t10-00-00-000z-000000000002" });
  const result = evaluate(projectsRoot, "tie-project", { snapshots: [left, right] });
  assert.equal(result.latest_recovery_point.snapshot_id, right.snapshot_id);
});

test("deterministic semantic output except observed_at", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "deterministic-project");
  const first = evaluate(projectsRoot, "deterministic-project", { snapshots: [summary(1)] });
  const second = getRecoveryStatus({
    projectsRoot,
    projectSlug: "deterministic-project",
    clock: () => new Date(BASE_NOW + 1000),
    governanceReader: () => governanceFor("deterministic-project", [summary(1)]),
    snapshotReader: () => [summary(1)],
    operationReader: () => [],
    planReader: () => []
  });
  const stripObserved = (value) => Object.assign({}, value, { observed_at: null });
  assert.deepEqual(stripObserved(second), stripObserved(first));
});

test("no absolute Windows paths in serialized result", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "windows-safe");
  assertNoUnsafeSerializedFields(evaluate(projectsRoot, "windows-safe", { snapshots: [summary(1)] }));
});

test("no Unix paths in serialized result", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "unix-safe");
  const text = JSON.stringify(evaluate(projectsRoot, "unix-safe", { snapshots: [summary(1)] }));
  assert.equal(/\/tmp\/|\/var\/|\/home\//.test(text), false);
});

test("no artifact filenames in serialized result", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "artifact-safe");
  const result = evaluate(projectsRoot, "artifact-safe", { snapshots: [summary(1)] });
  assert.equal(/wordpress\.tar|database\.sql|project-metadata\.json/.test(JSON.stringify(result)), false);
});

test("no manifest or journal filenames", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "metadata-safe");
  const result = evaluate(projectsRoot, "metadata-safe", { snapshots: [summary(1)] });
  assert.equal(/manifest\.json|restore-journal\.json/.test(JSON.stringify(result)), false);
});

test("no source operation ID", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "operation-safe");
  const result = evaluate(projectsRoot, "operation-safe", { snapshots: [summary(1)] });
  assert.equal(/op-\d{4}|op-test/.test(JSON.stringify(result)), false);
});

test("no raw exception or stack trace", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "exception-safe");
  const result = evaluate(projectsRoot, "exception-safe", {
    governanceReader() {
      throw new Error("at secret stack C:\\bad");
    }
  });
  assertNoUnsafeSerializedFields(result);
});

test("fixed schema version", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "schema-project");
  assert.equal(evaluate(projectsRoot, "schema-project").schema_version, SCHEMA_VERSION);
});

test("source Recovery tree remains unchanged", () => {
  const projectsRoot = tempRoot();
  createProject(projectsRoot, "readonly-project");
  createRestorableSnapshot(projectsRoot, "readonly-project", 1);
  const context = resolveSnapshotDirectory({ projectsRoot, slug: "readonly-project" });
  const before = fs.readdirSync(context.projectDirectory, { recursive: true }).sort();
  const result = getRecoveryStatus({
    projectsRoot,
    projectSlug: "readonly-project",
    clock: () => new Date(BASE_NOW)
  });
  const after = fs.readdirSync(context.projectDirectory, { recursive: true }).sort();
  assert.equal(result.latest_recovery_point.available, true);
  assert.deepEqual(after, before);
});
