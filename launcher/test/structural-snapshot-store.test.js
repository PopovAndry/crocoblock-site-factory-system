"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createProjectScaffold,
  readProjectBySlug
} = require("../src/project-store");
const {
  DEFAULT_CUSTOMER_LABEL,
  REQUIRED_RESTORABLE_ARTIFACT_TYPES,
  REQUIRED_STRUCTURAL_COMPONENTS,
  createManifestRecord,
  deriveProjectBinding,
  generateSnapshotId,
  isRestorable,
  listManifests,
  normalizeRelativeArtifactFilename,
  readManifest,
  resolveRecoveryRoot,
  resolveSnapshotDirectory,
  toBrowserSafeSummary,
  transitionManifestStatus,
  validateManifest,
  validateSnapshotId
} = require("../src/structural-snapshot-store");

let portCounter = 27200;

function createTempProjectsRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-structural-snapshot-"));
}

function createTempProject(projectsRoot, slug) {
  return createProjectScaffold({
    name: slug,
    slug,
    port: portCounter += 1,
    projectsRoot
  });
}

function digest(char) {
  return String(char || "a").repeat(64);
}

function safeArtifact(type, relativeFilename, char) {
  return {
    type,
    relative_filename: relativeFilename,
    digest_algorithm: "sha256",
    digest: digest(char || "a"),
    size_bytes: 123,
    capture_status: "verified"
  };
}

function metadataOnlyManifestInput(overrides) {
  return Object.assign({
    snapshot_tier: "local_rescue",
    captured_components: [],
    excluded_components: REQUIRED_STRUCTURAL_COMPONENTS.slice(),
    consistency_mode: "metadata_only_no_artifacts",
    software: {},
    verification: {
      status: "not_verified",
      successful: false
    },
    restore_compatibility: {
      status: "not_evaluated",
      blocking: true,
      blockers: ["metadata_only"]
    },
    provenance: {
      source: "test_internal_store_api"
    }
  }, overrides || {});
}

function syntheticVerifiedManifestInput() {
  return metadataOnlyManifestInput({
    captured_components: REQUIRED_STRUCTURAL_COMPONENTS.slice(),
    excluded_components: [],
    consistency_mode: "synthetic_test_only",
    artifacts: REQUIRED_RESTORABLE_ARTIFACT_TYPES.map((type, index) => safeArtifact(type, "artifacts/" + type + ".json", String(index + 1))),
    software: {
      factory_commit: "0eab7c2",
      wordpress_version: "synthetic",
      agent_version: "synthetic"
    },
    verification: {
      status: "passed",
      successful: true,
      verified_at: "2026-07-16T00:00:00.000Z",
      checks: ["manifest", "artifact_metadata"]
    },
    restore_compatibility: {
      status: "compatible",
      blocking: false,
      blockers: []
    }
  });
}

function createCreatingRecord(projectsRoot, slug, manifest) {
  return createManifestRecord({
    projectsRoot,
    slug,
    manifest: manifest || metadataOnlyManifestInput()
  });
}

function pathIsInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

test("recovery root is derived from projects root", () => {
  const projectsRoot = createTempProjectsRoot();
  assert.equal(resolveRecoveryRoot(projectsRoot), path.join(projectsRoot, ".factory-recovery", "snapshots"));
});

test("storage is outside project and WordPress directories", () => {
  const projectsRoot = createTempProjectsRoot();
  const scaffold = createTempProject(projectsRoot, "outside-project");
  const context = resolveSnapshotDirectory({
    projectsRoot,
    slug: "outside-project",
    snapshotId: generateSnapshotId()
  });
  assert.equal(pathIsInside(scaffold.project.runtime_path, context.snapshotDirectory), false);
  assert.equal(pathIsInside(path.join(scaffold.project.runtime_path, "wordpress"), context.snapshotDirectory), false);
  assert.equal(pathIsInside(resolveRecoveryRoot(projectsRoot), context.snapshotDirectory), true);
});

test("deterministic project binding", () => {
  const projectsRoot = createTempProjectsRoot();
  const scaffold = createTempProject(projectsRoot, "stable-binding");
  assert.deepEqual(deriveProjectBinding(scaffold.project), deriveProjectBinding(scaffold.project));
});

test("project binding contains no secret or raw path", () => {
  const projectsRoot = createTempProjectsRoot();
  const scaffold = createTempProject(projectsRoot, "safe-binding");
  const binding = deriveProjectBinding(scaffold.project);
  assert.ok(binding.binding_key.startsWith("safe-binding-"));
  assert.equal(binding.binding_key.includes(scaffold.project.runtime_path), false);
  assert.equal(binding.binding_key.includes(":"), false);
  assert.equal(binding.binding_key.includes("\\"), false);
});

test("valid snapshot ID generation", () => {
  assert.doesNotThrow(() => validateSnapshotId(generateSnapshotId()));
});

test("malformed traversal drive and UNC IDs are rejected", () => {
  assert.throws(() => validateSnapshotId("snapshot-../bad"), (error) => error.code === "invalid_snapshot_id");
  assert.throws(() => validateSnapshotId("snapshot bad"), (error) => error.code === "invalid_snapshot_id");
  assert.throws(() => validateSnapshotId("C:\\temp\\snapshot"), (error) => error.code === "invalid_snapshot_id");
  assert.throws(() => validateSnapshotId("\\\\server\\share\\snapshot"), (error) => error.code === "invalid_snapshot_id");
  assert.throws(() => validateSnapshotId("snapshot-%2e%2e%2fbad"), (error) => error.code === "invalid_snapshot_id");
});

test("schema v1 acceptance", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "schema-v1");
  const created = createCreatingRecord(projectsRoot, "schema-v1");
  assert.equal(validateManifest(created.manifest).schema_version, 1);
});

test("unsupported schema rejection", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "bad-schema");
  const created = createCreatingRecord(projectsRoot, "bad-schema");
  assert.throws(
    () => validateManifest(Object.assign({}, created.manifest, { schema_version: 2 })),
    (error) => error.code === "snapshot_manifest_unsupported_schema"
  );
});

test("required fields are enforced", () => {
  assert.throws(() => validateManifest({ schema_version: 1 }), (error) => error.code === "snapshot_manifest_missing_field");
});

test("safe artifact relative path", () => {
  assert.equal(normalizeRelativeArtifactFilename("artifacts/database.sql"), "artifacts/database.sql");
});

test("absolute and traversal artifact paths are rejected", () => {
  assert.throws(() => normalizeRelativeArtifactFilename("C:/dump.sql"), (error) => error.code === "invalid_artifact_path");
  assert.throws(() => normalizeRelativeArtifactFilename("/tmp/dump.sql"), (error) => error.code === "invalid_artifact_path");
  assert.throws(() => normalizeRelativeArtifactFilename("../dump.sql"), (error) => error.code === "invalid_artifact_path");
  assert.throws(() => normalizeRelativeArtifactFilename("artifacts/../dump.sql"), (error) => error.code === "invalid_artifact_path");
  assert.throws(() => normalizeRelativeArtifactFilename("artifacts\\dump.sql"), (error) => error.code === "invalid_artifact_path");
  assert.throws(() => normalizeRelativeArtifactFilename("artifacts/%2e%2e/dump.sql"), (error) => error.code === "invalid_artifact_path");
});

test("new manifest starts creating", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "starts-creating");
  const created = createCreatingRecord(projectsRoot, "starts-creating");
  assert.equal(created.manifest.status, "creating");
});

test("valid status transitions", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "valid-transition");
  const created = createCreatingRecord(projectsRoot, "valid-transition");
  const completed = transitionManifestStatus({
    projectsRoot,
    slug: "valid-transition",
    snapshotId: created.manifest.snapshot_id,
    status: "complete"
  });
  assert.equal(completed.manifest.status, "complete");
});

test("invalid transitions are rejected", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "invalid-transition");
  const created = createCreatingRecord(projectsRoot, "invalid-transition");
  assert.throws(
    () => transitionManifestStatus({ projectsRoot, slug: "invalid-transition", snapshotId: created.manifest.snapshot_id, status: "verified" }),
    (error) => error.code === "snapshot_status_transition_invalid"
  );
});

test("verified requires successful verification", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "verified-requires-check");
  const created = createCreatingRecord(projectsRoot, "verified-requires-check");
  transitionManifestStatus({ projectsRoot, slug: "verified-requires-check", snapshotId: created.manifest.snapshot_id, status: "complete" });
  assert.throws(
    () => transitionManifestStatus({ projectsRoot, slug: "verified-requires-check", snapshotId: created.manifest.snapshot_id, status: "verified" }),
    (error) => error.code === "snapshot_verified_requires_verification"
  );
});

test("restored requires restore metadata", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "restored-requires-result");
  const created = createCreatingRecord(projectsRoot, "restored-requires-result");
  assert.throws(
    () => validateManifest(Object.assign({}, created.manifest, { status: "restored" })),
    (error) => error.code === "snapshot_restored_requires_restore_metadata"
  );
});

test("incomplete and corrupt are not restorable", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "not-restorable");
  const created = createCreatingRecord(projectsRoot, "not-restorable");
  const incomplete = transitionManifestStatus({
    projectsRoot,
    slug: "not-restorable",
    snapshotId: created.manifest.snapshot_id,
    status: "incomplete"
  });
  assert.equal(isRestorable(incomplete.manifest), false);
  assert.equal(toBrowserSafeSummary(incomplete.manifest).restorable, false);
});

test("synthetic valid verified manifest is restorable", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "synthetic-verified");
  const created = createManifestRecord({
    projectsRoot,
    slug: "synthetic-verified",
    manifest: syntheticVerifiedManifestInput()
  });
  transitionManifestStatus({ projectsRoot, slug: "synthetic-verified", snapshotId: created.manifest.snapshot_id, status: "complete" });
  const verified = transitionManifestStatus({ projectsRoot, slug: "synthetic-verified", snapshotId: created.manifest.snapshot_id, status: "verified" });
  assert.equal(isRestorable(verified.manifest), true);
  assert.equal(verified.summary.restorable, true);
});

test("atomic create and read", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "atomic-read");
  const created = createCreatingRecord(projectsRoot, "atomic-read");
  const read = readManifest({
    projectsRoot,
    slug: "atomic-read",
    snapshotId: created.manifest.snapshot_id
  });
  assert.equal(read.snapshot_id, created.manifest.snapshot_id);
  assert.equal(read.status, "creating");
});

test("duplicate conflict", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "duplicate-id");
  const snapshotId = generateSnapshotId();
  createManifestRecord({ projectsRoot, slug: "duplicate-id", snapshotId });
  assert.throws(
    () => createManifestRecord({ projectsRoot, slug: "duplicate-id", snapshotId }),
    (error) => error.code === "snapshot_id_conflict"
  );
});

test("malformed JSON safe failure", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "malformed-json");
  const snapshotId = generateSnapshotId();
  const context = resolveSnapshotDirectory({ projectsRoot, slug: "malformed-json", snapshotId });
  fs.mkdirSync(context.snapshotDirectory, { recursive: true });
  fs.writeFileSync(context.manifestPath, "{not-json", "utf8");
  assert.throws(
    () => readManifest({ projectsRoot, slug: "malformed-json", snapshotId }),
    (error) => error.code === "snapshot_manifest_malformed" && !String(error.message).includes(context.manifestPath)
  );
});

test("failed write cleanup", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "failed-cleanup");
  const snapshotId = generateSnapshotId();
  assert.throws(
    () => createManifestRecord({ projectsRoot, slug: "failed-cleanup", snapshotId, failBeforePromotion: true }),
    (error) => error.code === "snapshot_manifest_write_failed"
  );
  const context = resolveSnapshotDirectory({ projectsRoot, slug: "failed-cleanup", snapshotId });
  assert.equal(fs.existsSync(context.snapshotDirectory), false);
});

test("project binding mismatch rejection", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "binding-left");
  createTempProject(projectsRoot, "binding-right");
  const created = createCreatingRecord(projectsRoot, "binding-left");
  const right = deriveProjectBinding(readProjectBySlug("binding-right", projectsRoot).project);
  assert.throws(
    () => validateManifest(created.manifest, {
      expectedProjectSlug: "binding-right",
      expectedProjectIdentityFingerprint: right.fingerprint
    }),
    (error) => error.code === "snapshot_project_mismatch" || error.code === "snapshot_project_binding_mismatch"
  );
});

test("concurrent same-ID behavior", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "concurrent-id");
  const snapshotId = generateSnapshotId();
  const results = await Promise.allSettled([
    Promise.resolve().then(() => createManifestRecord({ projectsRoot, slug: "concurrent-id", snapshotId })),
    Promise.resolve().then(() => createManifestRecord({ projectsRoot, slug: "concurrent-id", snapshotId }))
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason.code === "snapshot_id_conflict").length, 1);
});

test("forbidden secret keys are rejected", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "secret-key");
  assert.throws(
    () => createManifestRecord({
      projectsRoot,
      slug: "secret-key",
      manifest: Object.assign({}, syntheticVerifiedManifestInput(), {
        software: { signing_secret: "do-not-store" }
      })
    }),
    (error) => error.code === "snapshot_manifest_forbidden_metadata"
  );
});

test("credential-bearing URL rejected", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "credential-url");
  assert.throws(
    () => createManifestRecord({
      projectsRoot,
      slug: "credential-url",
      manifest: Object.assign({}, syntheticVerifiedManifestInput(), {
        provenance: { source: "https://user:pass@example.test/file.zip" }
      })
    }),
    (error) => error.code === "snapshot_manifest_forbidden_metadata"
  );
});

test("secret values never echoed", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "secret-redaction");
  const secret = "Bearer abcdef0123456789";
  assert.throws(
    () => createManifestRecord({
      projectsRoot,
      slug: "secret-redaction",
      manifest: Object.assign({}, syntheticVerifiedManifestInput(), {
        provenance: { source: secret }
      })
    }),
    (error) => error.code === "snapshot_manifest_forbidden_metadata" && !String(error.message).includes(secret)
  );
});

test("browser-safe summary contains no paths", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "summary-paths");
  const created = createManifestRecord({
    projectsRoot,
    slug: "summary-paths",
    manifest: syntheticVerifiedManifestInput()
  });
  const summaryText = JSON.stringify(created.summary);
  assert.equal(summaryText.includes(projectsRoot), false);
  assert.equal(summaryText.includes("artifacts/"), false);
  assert.equal(summaryText.includes("manifest.json"), false);
});

test("browser-safe summary contains no forbidden metadata", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "summary-safe");
  const created = createManifestRecord({
    projectsRoot,
    slug: "summary-safe",
    manifest: syntheticVerifiedManifestInput()
  });
  const summaryText = JSON.stringify(created.summary);
  assert.equal(Object.prototype.hasOwnProperty.call(created.summary, "artifacts"), false);
  assert.equal(summaryText.includes(digest("1")), false);
  assert.equal(created.summary.customer_label, DEFAULT_CUSTOMER_LABEL);
});

test("list ordering newest first", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "list-order");
  const older = createManifestRecord({
    projectsRoot,
    slug: "list-order",
    manifest: metadataOnlyManifestInput({ created_at: "2026-07-16T00:00:00.000Z" })
  });
  const newer = createManifestRecord({
    projectsRoot,
    slug: "list-order",
    manifest: metadataOnlyManifestInput({ created_at: "2026-07-16T01:00:00.000Z" })
  });
  const listed = listManifests({ projectsRoot, slug: "list-order" });
  assert.equal(listed[0].snapshot_id, newer.manifest.snapshot_id);
  assert.equal(listed[1].snapshot_id, older.manifest.snapshot_id);
});

test("empty list", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "empty-list");
  assert.deepEqual(listManifests({ projectsRoot, slug: "empty-list" }), []);
});

test("corrupt-record list policy", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "corrupt-list");
  const snapshotId = generateSnapshotId();
  const context = resolveSnapshotDirectory({ projectsRoot, slug: "corrupt-list", snapshotId });
  fs.mkdirSync(context.snapshotDirectory, { recursive: true });
  fs.writeFileSync(context.manifestPath, "{not-json", "utf8");
  const listed = listManifests({ projectsRoot, slug: "corrupt-list" });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].status, "corrupt");
  assert.equal(listed[0].restorable, false);
  assert.equal(Object.prototype.hasOwnProperty.call(listed[0], "manifestPath"), false);
});

test("unknown project", () => {
  const projectsRoot = createTempProjectsRoot();
  assert.throws(
    () => resolveSnapshotDirectory({ projectsRoot, slug: "unknown-project", snapshotId: generateSnapshotId() }),
    (error) => error.code === "project_not_found"
  );
});

test("unknown snapshot", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "unknown-snapshot");
  assert.throws(
    () => readManifest({ projectsRoot, slug: "unknown-snapshot", snapshotId: generateSnapshotId() }),
    (error) => error.code === "snapshot_not_found" && !String(error.message).includes(projectsRoot)
  );
});

test("automated recovery store writes stay under isolated temporary roots", () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "isolated-test-root");
  const created = createCreatingRecord(projectsRoot, "isolated-test-root");
  const context = resolveSnapshotDirectory({
    projectsRoot,
    slug: "isolated-test-root",
    snapshotId: created.manifest.snapshot_id
  });

  assert.equal(pathIsInside(projectsRoot, context.recoveryRoot), true);
  assert.equal(pathIsInside(projectsRoot, context.snapshotDirectory), true);
  assert.equal(context.recoveryRoot, path.join(projectsRoot, ".factory-recovery", "snapshots"));
  assert.notEqual(path.resolve(projectsRoot), path.resolve("C:\\sf-factory-projects"));
});
