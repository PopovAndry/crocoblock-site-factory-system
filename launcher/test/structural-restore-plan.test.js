"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const test = require("node:test");
const { createProjectScaffold } = require("../src/project-store");
const {
  createRequestedOperation,
  listOperations
} = require("../src/project-operation-store");
const {
  captureWordPressFilesystemArtifact,
  walkWordPressFilesystem
} = require("../src/structural-snapshot-capture");
const {
  createManifestRecord,
  deriveProjectBinding,
  listManifests,
  readManifest,
  resolveSnapshotDirectory,
  transitionManifestStatus
} = require("../src/structural-snapshot-store");
const {
  RESTORE_PLAN_TTL_MS,
  createRestorePlan,
  getRestorePlanDirectory,
  readRestorePlan
} = require("../src/structural-restore-plan");

let portCounter = 33200;

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-restore-plan-"));
}

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, content) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function createProject(projectsRoot, slug) {
  const scaffold = createProjectScaffold({
    name: slug,
    slug,
    port: portCounter += 1,
    projectsRoot
  });
  scaffold.project.agent = Object.assign({}, scaffold.project.agent, {
    status: "installed",
    version: "test-agent"
  });
  createWordPressTree(scaffold.project.runtime_path);
  return scaffold;
}

function createWordPressTree(runtimePath) {
  const root = path.join(runtimePath, "wordpress");
  writeFile(path.join(root, "index.php"), "<?php echo 'index';\n");
  writeFile(path.join(root, "wp-admin", "admin.php"), "<?php echo 'admin';\n");
  writeFile(path.join(root, "wp-includes", "version.php"), "<?php $wp_version = 'test';\n");
  writeFile(path.join(root, "wp-content", "plugins", "crocoblock-site-factory", "crocoblock-site-factory.php"), "<?php /* Plugin Name: Crocoblock Site Factory */\n");
  writeFile(path.join(root, "wp-content", "themes", "twentytwenty", "style.css"), "body{}\n");
  writeFile(path.join(root, "wp-content", "uploads", "image.txt"), "asset\n");
  writeFile(path.join(root, "wp-config.php"), "DB_PASSWORD='do-not-archive';\n");
}

function syntheticSql(prefix) {
  const tablePrefix = prefix || "wp_";
  return [
    "-- MySQL dump 10.13  Distrib 8.0.0",
    "CREATE TABLE `" + tablePrefix + "options` (`option_id` bigint unsigned NOT NULL);",
    "CREATE TABLE `" + tablePrefix + "posts` (`ID` bigint unsigned NOT NULL);",
    "CREATE TABLE `" + tablePrefix + "postmeta` (`meta_id` bigint unsigned NOT NULL);",
    ""
  ].join("\n");
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function artifact(type, relativeFilename, content) {
  return {
    type,
    relative_filename: relativeFilename,
    digest_algorithm: "sha256",
    digest: Buffer.isBuffer(content) ? sha256(content) : sha256(Buffer.from(String(content), "utf8")),
    size_bytes: Buffer.isBuffer(content) ? content.length : Buffer.byteLength(String(content), "utf8"),
    capture_status: "verified"
  };
}

async function createVerifiedSnapshot(projectsRoot, slug, options) {
  const safeOptions = options || {};
  const scaffold = safeOptions.skipProject ? null : createProject(projectsRoot, slug);
  const created = createManifestRecord({
    projectsRoot,
    slug,
    manifest: {
      snapshot_tier: "local_rescue",
      customer_label: "Recovery Point",
      source_operation_id: "op-test",
      consistency_mode: "coordinated_maintenance_db_filesystem_capture",
      captured_components: [],
      excluded_components: [],
      artifacts: [],
      software: {
        test: true
      },
      verification: {
        status: "not_verified",
        successful: false
      },
      restore_compatibility: {
        status: "not_evaluated",
        blocking: true,
        blockers: ["creating"]
      },
      provenance: {
        source: "restore_plan_test"
      }
    }
  });
  const context = resolveSnapshotDirectory({ projectsRoot, slug, snapshotId: created.manifest.snapshot_id });
  const sql = safeOptions.sql || syntheticSql();
  writeFile(path.join(context.snapshotDirectory, "database.sql"), sql);
  const dbArtifact = artifact("database_dump", "database.sql", sql);
  const walk = walkWordPressFilesystem({
    wordpressRoot: path.join(context.projectState.runtimePath, "wordpress"),
    requireAgentPlugin: true
  });
  const fsArtifact = await captureWordPressFilesystemArtifact({
    snapshotDirectory: context.snapshotDirectory,
    walk,
    requireAgentPlugin: true
  });
  const metadata = JSON.stringify({
    schema: "factory_structural_snapshot_metadata",
    version: 1,
    project_slug: slug,
    agent_version: "test-agent"
  }, null, 2) + "\n";
  writeFile(path.join(context.snapshotDirectory, "project-metadata.json"), metadata);
  const metadataArtifact = artifact("project_metadata", "project-metadata.json", metadata);
  transitionManifestStatus({
    projectsRoot,
    slug,
    snapshotId: created.manifest.snapshot_id,
    status: "complete",
    patch: {
      captured_components: [
        "logical_database_dump",
        "wordpress_filesystem",
        "sanitized_project_metadata",
        "dependency_theme_plugin_identities",
        "agent_version_binding"
      ],
      excluded_components: [],
      artifacts: [dbArtifact, fsArtifact, metadataArtifact],
      verification: {
        status: "artifacts_verified",
        successful: true,
        verified_at: "2026-07-16T00:00:00.000Z",
        checks: ["database", "filesystem", "metadata"]
      },
      restore_compatibility: {
        status: "same_project_compatible",
        blocking: false,
        blockers: []
      }
    }
  });
  const verified = transitionManifestStatus({
    projectsRoot,
    slug,
    snapshotId: created.manifest.snapshot_id,
    status: "verified"
  });
  return {
    scaffold,
    snapshotId: created.manifest.snapshot_id,
    context,
    manifest: verified.manifest
  };
}

async function plan(projectsRoot, slug, snapshotId, options) {
  return createRestorePlan(Object.assign({
    projectsRoot,
    slug,
    snapshotId,
    idempotencyKey: "restore-plan-key-" + slug + "-0001",
    freeSpaceProbe: () => 10 * 1024 * 1024 * 1024,
    clock: () => Date.parse("2026-07-16T12:00:00.000Z"),
    idGenerator: () => "restore-plan-2026-07-16t12-00-00-000z-abcdef"
  }, options || {}));
}

test("verified same-project Recovery Point creates a ready immutable plan and performs no restore mutation", async () => {
  const projectsRoot = tempRoot();
  const source = await createVerifiedSnapshot(projectsRoot, "ready-plan");
  const beforeOps = listOperations({ projectsRoot, slug: "ready-plan" }).length;
  const beforeManifests = listManifests({ projectsRoot, slug: "ready-plan" }).length;
  const result = await plan(projectsRoot, "ready-plan", source.snapshotId);
  const afterOps = listOperations({ projectsRoot, slug: "ready-plan" }).length;
  const afterManifests = listManifests({ projectsRoot, slug: "ready-plan" }).length;

  assert.equal(result.plan.readiness, "ready");
  assert.equal(result.plan.rescue_strategy, "full_required");
  assert.equal(result.plan.confirmation.mode, "normal");
  assert.equal(result.plan.confirmation.phrase, "Restore Website for ready-plan");
  assert.equal(result.plan.restore_boundary.internal_term, "Managed Website Restore");
  assert.ok(result.plan.restore_boundary.invariant.includes("current credentials are preserved"));
  assert.ok(result.plan.restore_components.includes("WordPress database"));
  assert.ok(result.plan.preserved_state.includes("Current project credentials"));
  assert.ok(result.plan.exclusions.includes("Docker Desktop or container engine"));
  assert.equal(result.summary.immutable_fingerprint_abbrev.length, 12);
  assert.equal(afterOps, beforeOps);
  assert.equal(afterManifests, beforeManifests);
  assert.equal(fs.existsSync(path.join(source.scaffold.project.runtime_path, "wordpress", ".maintenance")), false);
});

test("unknown project unknown snapshot invalid snapshot and non-ready snapshots fail closed", async () => {
  const projectsRoot = tempRoot();
  await assert.rejects(
    createRestorePlan({ projectsRoot, slug: "missing", snapshotId: "snapshot-2026-07-16t00-00-00-000z-abcdefabcdef", idempotencyKey: "missing-key-0000001" }),
    (error) => error.code === "restore_project_not_found"
  );
  createProject(projectsRoot, "bad-inputs");
  await assert.rejects(
    createRestorePlan({ projectsRoot, slug: "bad-inputs", snapshotId: "../bad", idempotencyKey: "bad-snapshot-key-1" }),
    (error) => error.code === "restore_snapshot_not_found"
  );
  await assert.rejects(
    plan(projectsRoot, "bad-inputs", "snapshot-2026-07-16t00-00-00-000z-abcdefabcdef"),
    (error) => error.code === "restore_snapshot_not_found" || error.code === "restore_manifest_invalid"
  );

  const created = createManifestRecord({
    projectsRoot,
    slug: "bad-inputs",
    manifest: {
      snapshot_tier: "local_rescue",
      captured_components: [],
      excluded_components: [],
      consistency_mode: "test",
      artifacts: [],
      software: {},
      verification: { status: "not_verified", successful: false },
      restore_compatibility: { status: "blocked", blocking: true, blockers: ["test"] },
      provenance: { source: "test" }
    }
  });
  await assert.rejects(
    plan(projectsRoot, "bad-inputs", created.manifest.snapshot_id),
    (error) => error.code === "restore_snapshot_not_verified"
  );
  transitionManifestStatus({ projectsRoot, slug: "bad-inputs", snapshotId: created.manifest.snapshot_id, status: "complete" });
  await assert.rejects(
    plan(projectsRoot, "bad-inputs", created.manifest.snapshot_id, { idempotencyKey: "complete-key-0001" }),
    (error) => error.code === "restore_snapshot_not_verified"
  );
});

test("verified but non-restorable and cross-project copied snapshots are rejected", async () => {
  const projectsRoot = tempRoot();
  const source = await createVerifiedSnapshot(projectsRoot, "source-project");
  createProject(projectsRoot, "target-project");
  const targetContext = resolveSnapshotDirectory({ projectsRoot, slug: "target-project", snapshotId: source.snapshotId });
  mkdirp(targetContext.snapshotDirectory);
  fs.cpSync(source.context.snapshotDirectory, targetContext.snapshotDirectory, { recursive: true });

  await assert.rejects(
    plan(projectsRoot, "target-project", source.snapshotId),
    (error) => error.code === "restore_project_binding_mismatch" || error.code === "restore_manifest_invalid"
  );

  const nonRestorable = await createVerifiedSnapshot(projectsRoot, "non-restorable");
  const manifestPath = path.join(nonRestorable.context.snapshotDirectory, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.restore_compatibility = { status: "blocked", blocking: true, blockers: ["test_blocker"] };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  await assert.rejects(
    plan(projectsRoot, "non-restorable", nonRestorable.snapshotId),
    (error) => error.code === "restore_snapshot_not_restorable"
  );
});

test("database artifact revalidation catches missing size digest and SQL sanity failures", async () => {
  const projectsRoot = tempRoot();
  const missing = await createVerifiedSnapshot(projectsRoot, "db-missing");
  fs.rmSync(path.join(missing.context.snapshotDirectory, "database.sql"));
  await assert.rejects(plan(projectsRoot, "db-missing", missing.snapshotId), (error) => error.code === "restore_artifact_missing");

  const size = await createVerifiedSnapshot(projectsRoot, "db-size");
  fs.appendFileSync(path.join(size.context.snapshotDirectory, "database.sql"), "x");
  await assert.rejects(plan(projectsRoot, "db-size", size.snapshotId), (error) => error.code === "restore_artifact_size_mismatch");

  const digest = await createVerifiedSnapshot(projectsRoot, "db-digest");
  const dbPath = path.join(digest.context.snapshotDirectory, "database.sql");
  fs.writeFileSync(dbPath, fs.readFileSync(dbPath, "utf8").replace("postmeta", "postmetb"), "utf8");
  const manifestPath = path.join(digest.context.snapshotDirectory, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const artifact = manifest.artifacts.find((entry) => entry.type === "database_dump");
  artifact.size_bytes = fs.statSync(dbPath).size;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  await assert.rejects(plan(projectsRoot, "db-digest", digest.snapshotId), (error) => error.code === "restore_artifact_digest_mismatch");

  const sanity = await createVerifiedSnapshot(projectsRoot, "db-sanity");
  await assert.rejects(
    plan(projectsRoot, "db-sanity", sanity.snapshotId, {
      databaseVerifier: async () => {
        throw new Error("bad sql");
      }
    }),
    (error) => error.code === "restore_database_verification_failed"
  );
});

test("filesystem artifact revalidation catches missing size digest unsafe archive and required structure failures", async () => {
  const projectsRoot = tempRoot();
  const missing = await createVerifiedSnapshot(projectsRoot, "fs-missing");
  fs.rmSync(path.join(missing.context.snapshotDirectory, "wordpress.tar"));
  await assert.rejects(plan(projectsRoot, "fs-missing", missing.snapshotId), (error) => error.code === "restore_artifact_missing");

  const size = await createVerifiedSnapshot(projectsRoot, "fs-size");
  fs.appendFileSync(path.join(size.context.snapshotDirectory, "wordpress.tar"), "x");
  await assert.rejects(plan(projectsRoot, "fs-size", size.snapshotId), (error) => error.code === "restore_artifact_size_mismatch");

  const digest = await createVerifiedSnapshot(projectsRoot, "fs-digest");
  const archivePath = path.join(digest.context.snapshotDirectory, "wordpress.tar");
  const manifestPath = path.join(digest.context.snapshotDirectory, "manifest.json");
  fs.writeFileSync(archivePath, fs.readFileSync(archivePath).subarray(0, fs.statSync(archivePath).size - 1));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const fsArtifact = manifest.artifacts.find((entry) => entry.type === "wordpress_filesystem");
  fsArtifact.size_bytes = fs.statSync(archivePath).size;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  await assert.rejects(plan(projectsRoot, "fs-digest", digest.snapshotId), (error) => error.code === "restore_artifact_digest_mismatch");

  const unsafe = await createVerifiedSnapshot(projectsRoot, "fs-unsafe");
  await assert.rejects(
    plan(projectsRoot, "fs-unsafe", unsafe.snapshotId, {
      archiveVerifier: () => [{ name: "../wp-config.php", size: 1, type: "0" }]
    }),
    (error) => error.code === "restore_archive_verification_failed"
  );

  const required = await createVerifiedSnapshot(projectsRoot, "fs-required");
  await assert.rejects(
    plan(projectsRoot, "fs-required", required.snapshotId, {
      archiveVerifier: () => [{ name: "wordpress/index.php", size: 1, type: "0" }]
    }),
    (error) => error.code === "restore_archive_verification_failed"
  );
});

test("metadata revalidation catches mismatch and unsafe metadata", async () => {
  const projectsRoot = tempRoot();
  const mismatch = await createVerifiedSnapshot(projectsRoot, "metadata-mismatch");
  fs.appendFileSync(path.join(mismatch.context.snapshotDirectory, "project-metadata.json"), "x");
  await assert.rejects(plan(projectsRoot, "metadata-mismatch", mismatch.snapshotId), (error) => error.code === "restore_artifact_size_mismatch");

  const unsafe = await createVerifiedSnapshot(projectsRoot, "metadata-unsafe");
  const metadataPath = path.join(unsafe.context.snapshotDirectory, "project-metadata.json");
  const content = JSON.stringify({ schema: "factory_structural_snapshot_metadata", signing_secret: "abc" }) + "\n";
  fs.writeFileSync(metadataPath, content, "utf8");
  const manifestPath = path.join(unsafe.context.snapshotDirectory, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const metadataArtifact = manifest.artifacts.find((entry) => entry.type === "project_metadata");
  metadataArtifact.size_bytes = Buffer.byteLength(content);
  metadataArtifact.digest = sha256(Buffer.from(content, "utf8"));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  await assert.rejects(plan(projectsRoot, "metadata-unsafe", unsafe.snapshotId), (error) => error.code === "restore_metadata_verification_failed");
});

test("current unhealthy WordPress is advisory but active mutation blocks planning", async () => {
  const projectsRoot = tempRoot();
  const source = await createVerifiedSnapshot(projectsRoot, "advisory-health");
  const ready = await plan(projectsRoot, "advisory-health", source.snapshotId, {
    currentOperationReader: () => null
  });
  assert.equal(ready.plan.readiness, "ready");

  const active = await createVerifiedSnapshot(projectsRoot, "active-block");
  createRequestedOperation({
    projectsRoot,
    slug: "active-block",
    operationType: "state_apply",
    idempotencyKeyHash: "active-hash",
    requestFingerprint: "active"
  });
  await assert.rejects(
    plan(projectsRoot, "active-block", active.snapshotId),
    (error) => error.code === "restore_active_operation"
  );
});

test("restore scope is server-generated and caller paths component maps and emergency mode are rejected", async () => {
  const projectsRoot = tempRoot();
  const source = await createVerifiedSnapshot(projectsRoot, "server-scope");
  await assert.rejects(
    createRestorePlan({ projectsRoot, slug: "server-scope", snapshotId: source.snapshotId, idempotencyKey: "scope-key-0000001", componentMap: { database: false } }),
    (error) => error.code === "restore_caller_input_rejected"
  );
  await assert.rejects(
    createRestorePlan({ projectsRoot, slug: "server-scope", snapshotId: source.snapshotId, idempotencyKey: "scope-key-0000002", artifactPath: "C:/secret.sql" }),
    (error) => error.code === "restore_caller_input_rejected"
  );
  await assert.rejects(
    createRestorePlan({ projectsRoot, slug: "server-scope", snapshotId: source.snapshotId, idempotencyKey: "scope-key-0000003", rescueMode: "none_emergency" }),
    (error) => error.code === "restore_caller_input_rejected"
  );
});

test("disk and rescue policy classify full lightweight emergency and insufficient states", async () => {
  const projectsRoot = tempRoot();
  const full = await createVerifiedSnapshot(projectsRoot, "disk-full");
  assert.equal((await plan(projectsRoot, "disk-full", full.snapshotId)).plan.rescue_strategy, "full_required");

  const light = await createVerifiedSnapshot(projectsRoot, "disk-light");
  const lightPlan = await plan(projectsRoot, "disk-light", light.snapshotId, {
    idempotencyKey: "light-key-0000001",
    currentSiteEstimator: () => 10 * 1024 * 1024 * 1024,
    freeSpaceProbe: () => 700 * 1024 * 1024
  });
  assert.equal(lightPlan.plan.rescue_strategy, "lightweight_candidate");
  assert.equal(lightPlan.plan.readiness, "blocked");

  const emergency = await createVerifiedSnapshot(projectsRoot, "disk-emergency");
  const emergencyPlan = await plan(projectsRoot, "disk-emergency", emergency.snapshotId, {
    idempotencyKey: "emergency-key-0001",
    currentSiteEstimator: () => 100 * 1024 * 1024 * 1024,
    freeSpaceProbe: () => 170 * 1024 * 1024
  });
  assert.equal(emergencyPlan.plan.rescue_strategy, "none_emergency");
  assert.equal(emergencyPlan.plan.readiness, "ready_with_emergency_confirmation");
  assert.equal(emergencyPlan.plan.confirmation.mode, "emergency");
  assert.notEqual(emergencyPlan.plan.confirmation.phrase, "Restore Website for disk-emergency");

  const insufficient = await createVerifiedSnapshot(projectsRoot, "disk-low");
  await assert.rejects(
    plan(projectsRoot, "disk-low", insufficient.snapshotId, {
      idempotencyKey: "low-space-key-0001",
      freeSpaceProbe: () => 1
    }),
    (error) => error.code === "restore_disk_space_insufficient"
  );
});

test("plan expiry read path fails closed", async () => {
  const projectsRoot = tempRoot();
  const source = await createVerifiedSnapshot(projectsRoot, "expiry");
  const createdAt = Date.parse("2026-07-16T12:00:00.000Z");
  const result = await plan(projectsRoot, "expiry", source.snapshotId, {
    clock: () => createdAt
  });
  assert.equal(result.plan.expires_at, new Date(createdAt + RESTORE_PLAN_TTL_MS).toISOString());
  assert.throws(
    () => readRestorePlan({
      projectsRoot,
      slug: "expiry",
      planId: result.plan.plan_id,
      clock: () => createdAt + RESTORE_PLAN_TTL_MS + 1
    }),
    (error) => error.code === "restore_plan_expired"
  );
});

test("idempotency replay returns same plan and changed request conflicts without duplicate record", async () => {
  const projectsRoot = tempRoot();
  const source = await createVerifiedSnapshot(projectsRoot, "idempotent");
  const key = "idempotent-key-0001";
  const first = await plan(projectsRoot, "idempotent", source.snapshotId, { idempotencyKey: key });
  const second = await plan(projectsRoot, "idempotent", source.snapshotId, { idempotencyKey: key });
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.plan.plan_id, first.plan.plan_id);
  assert.equal(fs.readdirSync(getRestorePlanDirectory(source.scaffold.project.runtime_path)).filter((name) => name.endsWith(".json")).length, 1);

  const other = await createVerifiedSnapshot(projectsRoot, "idempotent", {
    skipProject: true
  });
  await assert.rejects(
    createRestorePlan({
      projectsRoot,
      slug: "idempotent",
      snapshotId: other.snapshotId,
      idempotencyKey: key,
      freeSpaceProbe: () => 10 * 1024 * 1024 * 1024
    }),
    (error) => error.code === "restore_plan_idempotency_conflict" || error.code === "restore_project_not_found"
  );
});

test("browser-safe output and plan record contain no paths secrets SQL archive listing or filenames", async () => {
  const projectsRoot = tempRoot();
  const source = await createVerifiedSnapshot(projectsRoot, "safe-output");
  const result = await plan(projectsRoot, "safe-output", source.snapshotId);
  const text = JSON.stringify(result.plan);
  const summaryText = JSON.stringify(result.summary);
  assert.equal(/C:\\|C:\/|sf-factory-projects|database\.sql|wordpress\.tar|project-metadata\.json|CREATE TABLE|wp-config\.php|signing_secret|Bearer|access_token|license_key/i.test(summaryText), false);
  assert.equal(/C:\\|C:\/|sf-factory-projects|database\.sql|wordpress\.tar|project-metadata\.json|CREATE TABLE|wp-config\.php|signing_secret|Bearer|access_token|license_key/i.test(text), false);
});

test("artifact fingerprint is immutable and source changes invalidate existing plan validation", async () => {
  const projectsRoot = tempRoot();
  const source = await createVerifiedSnapshot(projectsRoot, "fingerprint");
  const result = await plan(projectsRoot, "fingerprint", source.snapshotId);
  assert.equal(result.plan.immutable_source_fingerprint.digest.length, 64);
  fs.appendFileSync(path.join(source.context.snapshotDirectory, "database.sql"), "-- changed after planning\n");
  assert.throws(
    () => readRestorePlan({
      projectsRoot,
      slug: "fingerprint",
      planId: result.plan.plan_id,
      validateSource: true,
      clock: () => Date.parse("2026-07-16T12:01:00.000Z")
    }),
    (error) => error.code === "restore_artifact_digest_mismatch" || error.code === "restore_artifact_size_mismatch"
  );
});

test("atomic plan persistence failure is sanitized and leaves no valid plan record", async () => {
  const projectsRoot = tempRoot();
  const source = await createVerifiedSnapshot(projectsRoot, "atomic-failure");
  await assert.rejects(
    plan(projectsRoot, "atomic-failure", source.snapshotId, {
      writeJsonAtomic: () => {
        throw new Error("C:/secret/path failed");
      }
    }),
    (error) => error.code === "restore_plan_storage_failed" && !String(error.message).includes("C:/secret")
  );
  const dir = getRestorePlanDirectory(source.scaffold.project.runtime_path);
  const persisted = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.endsWith(".json")).length
    : 0;
  assert.equal(persisted, 0);
});

test("existing snapshot store full-capture and db-capture source contracts remain statically compatible", () => {
  const planSource = fs.readFileSync(path.resolve(__dirname, "../src/structural-restore-plan.js"), "utf8");
  assert.equal(/app\.(get|post|put|delete)|enterMaintenanceMode|extract\(|fs\.cpSync|fs\.renameSync\(.*wordpress|docker\s+(?:start|stop|restart|rm|prune)|execFile|spawn\(/i.test(planSource), false);
  assert.match(planSource, /readManifest/);
  assert.match(planSource, /verifyDumpArtifact/);
  assert.match(planSource, /validateArchiveEntries/);
});
