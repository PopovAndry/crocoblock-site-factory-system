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
  getLockDirectory,
  getProjectState,
  hashValue,
  listOperations,
  nowIso,
  updateOperation,
  writeLockMetadata
} = require("../src/project-operation-store");
const { computeRequestFingerprint } = require("../src/project-operation-coordinator");
const {
  METADATA_ARTIFACT_FILENAME,
  OPERATION_TYPE,
  WORDPRESS_ARTIFACT_FILENAME,
  captureWordPressFilesystemArtifact,
  createFullStructuralSnapshot,
  listTarEntries,
  validateArchiveEntries,
  walkWordPressFilesystem
} = require("../src/structural-snapshot-capture");
const {
  listManifests,
  readManifest,
  resolveSnapshotDirectory,
  toBrowserSafeSummary
} = require("../src/structural-snapshot-store");

let portCounter = 30200;

function createTempProjectsRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-full-snapshot-"));
}

function createTempProject(projectsRoot, slug) {
  const scaffold = createProjectScaffold({
    name: slug,
    slug,
    port: portCounter += 1,
    projectsRoot
  });
  createWordPressTree(scaffold.project.runtime_path);
  return scaffold;
}

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, content) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function createWordPressTree(runtimePath) {
  const root = path.join(runtimePath, "wordpress");
  writeFile(path.join(root, "index.php"), "<?php echo 'index';\n");
  writeFile(path.join(root, "wp-admin", "admin.php"), "<?php echo 'admin';\n");
  writeFile(path.join(root, "wp-includes", "version.php"), "<?php $wp_version = 'test';\n");
  writeFile(path.join(root, "wp-content", "plugins", "crocoblock-site-factory", "crocoblock-site-factory.php"), "<?php /* Plugin Name: Crocoblock Site Factory */\n");
  writeFile(path.join(root, "wp-content", "themes", "twentytwenty", "style.css"), "body{}\n");
  writeFile(path.join(root, "wp-content", "uploads", "2026", "image.txt"), "asset\n");
  writeFile(path.join(root, "wp-content", "mu-plugins", "loader.php"), "<?php\n");
  writeFile(path.join(root, ".htaccess"), "# test\n");
  writeFile(path.join(root, "wp-config.php"), "DB_PASSWORD='do-not-archive';\n");
  writeFile(path.join(root, "wp-content", "debug.log"), "debug secret\n");
  writeFile(path.join(root, "wp-content", "cache", "cached.txt"), "cached\n");
  writeFile(path.join(root, "wp-content", "upgrade", "upgrade.txt"), "upgrade\n");
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

function createDumpRunner(sql, options) {
  const calls = [];
  const runner = async (request) => {
    calls.push(request);
    if (options && options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    if (sql) {
      await request.onStdoutChunk(Buffer.from(sql, "utf8"));
    }
    return {
      code: options && options.code || 0,
      timedOut: Boolean(options && options.timedOut),
      stderr: options && options.stderr || ""
    };
  };
  runner.calls = calls;
  return runner;
}

async function fullCapture(projectsRoot, slug, options) {
  return createFullStructuralSnapshot(Object.assign({
    projectsRoot,
    slug,
    idempotencyKey: "full-key-" + slug + "-0001",
    dumpRunner: createDumpRunner(syntheticSql()),
    freeSpaceProbe: () => 1024 * 1024 * 1024
  }, options || {}));
}

function readSource() {
  return fs.readFileSync(path.resolve(__dirname, "../src/structural-snapshot-capture.js"), "utf8");
}

test("full capture runs through one coordinator operation and creates one verified restorable manifest", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "full-success");

  const result = await fullCapture(projectsRoot, "full-success");
  const operations = listOperations({ projectsRoot, slug: "full-success" })
    .filter((operation) => operation.operation_type === OPERATION_TYPE);
  const manifests = listManifests({ projectsRoot, slug: "full-success" });

  assert.equal(operations.length, 1);
  assert.equal(operations[0].status, "succeeded");
  assert.equal(manifests.length, 1);
  assert.equal(result.result.manifest.status, "verified");
  assert.equal(result.result.summary.restorable, true);
  assert.equal(toBrowserSafeSummary(result.result.manifest).restorable, true);
});

test("DB and filesystem artifacts share one snapshot ID and manifest", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "shared-manifest");
  const result = await fullCapture(projectsRoot, "shared-manifest");
  const artifacts = result.result.manifest.artifacts;

  assert.equal(result.operation.result_summary.snapshot_id, result.result.snapshot_id);
  assert.ok(artifacts.find((artifact) => artifact.type === "database_dump"));
  assert.ok(artifacts.find((artifact) => artifact.type === "wordpress_filesystem"));
  assert.ok(artifacts.find((artifact) => artifact.type === "project_metadata"));
});

test("unknown project and low disk fail before maintenance", async () => {
  const projectsRoot = createTempProjectsRoot();
  let maintenanceCalls = 0;
  await assert.rejects(
    createFullStructuralSnapshot({
      projectsRoot,
      slug: "missing-project",
      idempotencyKey: "missing-full-key-001",
      maintenanceController: () => {
        maintenanceCalls += 1;
      }
    }),
    /Factory project not found|Project not found/
  );
  assert.equal(maintenanceCalls, 0);

  createTempProject(projectsRoot, "low-disk");
  await assert.rejects(
    fullCapture(projectsRoot, "low-disk", {
      idempotencyKey: "low-disk-key-0001",
      freeSpaceProbe: () => 1,
      maintenanceController: () => {
        maintenanceCalls += 1;
      }
    }),
    (error) => error.code === "snapshot_disk_space_low"
  );
  assert.equal(maintenanceCalls, 0);
});

test("maintenance marker is removed on success and pre-existing maintenance is preserved", async () => {
  const projectsRoot = createTempProjectsRoot();
  const clean = createTempProject(projectsRoot, "maintenance-clean");
  await fullCapture(projectsRoot, "maintenance-clean");
  assert.equal(fs.existsSync(path.join(clean.project.runtime_path, "wordpress", ".maintenance")), false);

  const existing = createTempProject(projectsRoot, "maintenance-existing");
  const marker = path.join(existing.project.runtime_path, "wordpress", ".maintenance");
  fs.writeFileSync(marker, "<?php $upgrading = 1; ?>\n", "utf8");
  await fullCapture(projectsRoot, "maintenance-existing", {
    idempotencyKey: "maintenance-existing-key"
  });
  assert.equal(fs.readFileSync(marker, "utf8"), "<?php $upgrading = 1; ?>\n");
});

test("maintenance marker is removed after DB and archive failures", async () => {
  const projectsRoot = createTempProjectsRoot();
  const dbFail = createTempProject(projectsRoot, "db-fail");
  await assert.rejects(
    fullCapture(projectsRoot, "db-fail", {
      idempotencyKey: "db-fail-key-0001",
      dumpRunner: createDumpRunner("")
    }),
    (error) => error.code === "snapshot_db_dump_empty"
  );
  assert.equal(fs.existsSync(path.join(dbFail.project.runtime_path, "wordpress", ".maintenance")), false);

  const archiveFail = createTempProject(projectsRoot, "archive-fail");
  await assert.rejects(
    fullCapture(projectsRoot, "archive-fail", {
      idempotencyKey: "archive-fail-key",
      archiveRunner: async () => {
        const error = new Error("archive failed");
        error.code = "snapshot_archive_failed";
        throw error;
      }
    }),
    (error) => error.code === "snapshot_archive_failed"
  );
  assert.equal(fs.existsSync(path.join(archiveFail.project.runtime_path, "wordpress", ".maintenance")), false);
});

test("filesystem walk excludes wp-config maintenance debug cache and upgrade files", () => {
  const projectsRoot = createTempProjectsRoot();
  const scaffold = createTempProject(projectsRoot, "exclusions");
  fs.writeFileSync(path.join(scaffold.project.runtime_path, "wordpress", ".maintenance"), "existing\n", "utf8");

  const walk = walkWordPressFilesystem({
    wordpressRoot: path.join(scaffold.project.runtime_path, "wordpress"),
    requireAgentPlugin: true
  });
  const names = walk.entries.map((entry) => entry.archivePath);

  assert.equal(names.some((name) => name.endsWith("wp-config.php")), false);
  assert.equal(names.includes("wordpress/.maintenance"), false);
  assert.equal(names.includes("wordpress/wp-content/debug.log"), false);
  assert.equal(names.some((name) => name.startsWith("wordpress/wp-content/cache/")), false);
  assert.equal(names.some((name) => name.startsWith("wordpress/wp-content/upgrade/")), false);
  assert.ok(walk.exclusions.includes("wp_config"));
});

test("path traversal and symlink escape are rejected", () => {
  const projectsRoot = createTempProjectsRoot();
  const scaffold = createTempProject(projectsRoot, "unsafe-tree");
  const linkPath = path.join(scaffold.project.runtime_path, "wordpress", "wp-content", "plugins", "linked-out");
  try {
    fs.symlinkSync(projectsRoot, linkPath, "dir");
  } catch (error) {
    return;
  }
  assert.throws(
    () => walkWordPressFilesystem({
      wordpressRoot: path.join(scaffold.project.runtime_path, "wordpress"),
      requireAgentPlugin: true
    }),
    (error) => error.code === "snapshot_fs_symlink_rejected" || error.code === "snapshot_fs_reparse_escape"
  );
});

test("archive root, fixed filename, entries and required WordPress structure are verified", async () => {
  const projectsRoot = createTempProjectsRoot();
  const scaffold = createTempProject(projectsRoot, "archive-verify");
  const walk = walkWordPressFilesystem({
    wordpressRoot: path.join(scaffold.project.runtime_path, "wordpress"),
    requireAgentPlugin: true
  });
  const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-archive-"));
  const artifact = await captureWordPressFilesystemArtifact({
    snapshotDirectory: snapshotDir,
    walk,
    requireAgentPlugin: true
  });
  const entries = listTarEntries(path.join(snapshotDir, WORDPRESS_ARTIFACT_FILENAME));

  assert.equal(artifact.relative_filename, WORDPRESS_ARTIFACT_FILENAME);
  assert.equal(artifact.size_bytes > 0, true);
  assert.equal(/^[a-f0-9]{64}$/.test(artifact.digest), true);
  assert.ok(entries.every((entry) => entry.name.startsWith("wordpress/")));
  assert.equal(entries.some((entry) => entry.name.includes("..") || entry.name.startsWith("/")), false);
  assert.doesNotThrow(() => validateArchiveEntries(entries, { requireAgentPlugin: true }));
});

test("missing required WordPress directories and missing Agent plugin fail closed", () => {
  const projectsRoot = createTempProjectsRoot();
  const missingAdmin = createTempProject(projectsRoot, "missing-admin");
  fs.rmSync(path.join(missingAdmin.project.runtime_path, "wordpress", "wp-admin"), { recursive: true, force: true });
  assert.throws(
    () => walkWordPressFilesystem({ wordpressRoot: path.join(missingAdmin.project.runtime_path, "wordpress"), requireAgentPlugin: true }),
    (error) => error.code === "snapshot_fs_required_entry_missing"
  );

  const missingAgent = createTempProject(projectsRoot, "missing-agent");
  fs.rmSync(path.join(missingAgent.project.runtime_path, "wordpress", "wp-content", "plugins", "crocoblock-site-factory"), { recursive: true, force: true });
  assert.throws(
    () => walkWordPressFilesystem({ wordpressRoot: path.join(missingAgent.project.runtime_path, "wordpress"), requireAgentPlugin: true }),
    (error) => error.code === "snapshot_fs_agent_plugin_missing"
  );
});

test("failure remains non-restorable and partial artifacts are cleaned", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "cleanup-partial");
  await assert.rejects(
    fullCapture(projectsRoot, "cleanup-partial", {
      idempotencyKey: "cleanup-partial-key",
      archiveRunner: async () => {
        const error = new Error("archive failed");
        error.code = "snapshot_archive_failed";
        throw error;
      }
    }),
    (error) => error.code === "snapshot_archive_failed"
  );
  const summary = listManifests({ projectsRoot, slug: "cleanup-partial" })[0];
  const manifest = readManifest({ projectsRoot, slug: "cleanup-partial", snapshotId: summary.snapshot_id });
  const context = resolveSnapshotDirectory({ projectsRoot, slug: "cleanup-partial", snapshotId: summary.snapshot_id });
  const leftovers = fs.readdirSync(context.snapshotDirectory).filter((name) => name !== "manifest.json");

  assert.equal(manifest.status, "incomplete");
  assert.equal(summary.restorable, false);
  assert.deepEqual(leftovers, []);
});

test("final filesystem artifact conflict fails closed", async () => {
  const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-conflict-"));
  fs.writeFileSync(path.join(snapshotDir, WORDPRESS_ARTIFACT_FILENAME), "exists");
  await assert.rejects(
    captureWordPressFilesystemArtifact({
      snapshotDirectory: snapshotDir,
      walk: { entries: [], fileCount: 0, exclusions: [] },
      requireAgentPlugin: false
    }),
    (error) => error.code === "snapshot_fs_artifact_conflict"
  );
});

test("safe proof and result omit absolute paths, wp-config contents, SQL, and secrets", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "safe-proof");
  const result = await fullCapture(projectsRoot, "safe-proof");
  const text = JSON.stringify({
    proof: result.result.proof,
    resultSummary: result.operation.result_summary,
    summary: result.result.summary
  });

  assert.equal(text.includes(projectsRoot), false);
  assert.equal(text.includes("do-not-archive"), false);
  assert.equal(text.includes("CREATE TABLE"), false);
  assert.equal(text.includes("MYSQL_PASSWORD"), false);
  assert.equal(text.includes("database.sql"), false);
  assert.equal(text.includes("wordpress.tar"), false);
});

test("same-project concurrency, idempotency replay and conflict follow coordinator policy", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "coordinator-policy");
  const runner = createDumpRunner(syntheticSql(), { delayMs: 200 });
  const first = fullCapture(projectsRoot, "coordinator-policy", {
    idempotencyKey: "coordinator-policy-key1",
    dumpRunner: runner
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await assert.rejects(
    fullCapture(projectsRoot, "coordinator-policy", {
      idempotencyKey: "coordinator-policy-key2"
    }),
    (error) => error.code === "project_operation_in_progress"
  );
  await first;

  const replay = await fullCapture(projectsRoot, "coordinator-policy", {
    idempotencyKey: "coordinator-policy-key1",
    dumpRunner: runner
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(runner.calls.length, 1);

  createTempProject(projectsRoot, "idempotency-conflict");
  createRequestedOperation({
    slug: "idempotency-conflict",
    projectsRoot,
    operationId: "op-full-conflict",
    operationType: OPERATION_TYPE,
    idempotencyKeyHash: hashValue("full-conflict-key"),
    requestFingerprint: "different-fingerprint"
  });
  await assert.rejects(
    fullCapture(projectsRoot, "idempotency-conflict", {
      idempotencyKey: "full-conflict-key"
    }),
    (error) => error.code === "idempotency_key_conflict"
  );
});

test("interrupted operation is not silently successful", async () => {
  const projectsRoot = createTempProjectsRoot();
  const slug = "interrupted-full";
  const key = "interrupted-full-key";
  const operationId = "op-interrupted-full";
  createTempProject(projectsRoot, slug);
  const state = getProjectState({ slug, projectsRoot });
  const requestFingerprint = computeRequestFingerprint({
    project_slug: slug,
    operation_type: OPERATION_TYPE,
    input: {
      capture: "full_structural_recovery_point",
      schema_version: 1,
      project_slug: slug
    }
  });
  createRequestedOperation({
    slug,
    projectsRoot,
    operationId,
    operationType: OPERATION_TYPE,
    idempotencyKeyHash: hashValue(key),
    requestFingerprint
  });
  updateOperation({
    slug,
    projectsRoot,
    operationId,
    patch: {
      status: "running",
      stage: "capturing_filesystem",
      started_at: nowIso()
    }
  });
  fs.mkdirSync(getLockDirectory(state.runtimePath));
  writeLockMetadata(state.runtimePath, {
    schema: "factory_project_operation_lock",
    version: 1,
    operation_id: operationId,
    operation_type: OPERATION_TYPE,
    project_slug: slug,
    pid: 99999999,
    process_instance_id: "dead-process",
    acquired_at: "2000-01-01T00:00:00.000Z",
    heartbeat_at: "2000-01-01T00:00:00.000Z"
  });

  await assert.rejects(
    fullCapture(projectsRoot, slug, {
      idempotencyKey: key
    }),
    (error) => error.code === "operation_retry_requires_new_idempotency_key"
  );
  const interrupted = listOperations({ slug, projectsRoot }).find((operation) => operation.operation_id === operationId);
  assert.equal(interrupted.status, "interrupted");
});

test("static scope excludes restore routes UI raw mysql copy and arbitrary archive execution", () => {
  const source = readSource();
  assert.equal(/server\.get|app\.get|recovery-points/i.test(source), false);
  assert.equal(/document\.querySelector|launcher[\\/]src[\\/]ui|addEventListener/i.test(source), false);
  assert.equal(/\.\/mysql|[\\/]mysql["'`]|robocopy|xcopy|copy-item/i.test(source), false);
  assert.equal(/restore execution|mysql\s+<|import dump/i.test(source), false);
  assert.equal(/spawn\(|execFile\(|exec\(/.test(source), false);
});

test("automated tests use isolated project roots", () => {
  const projectsRoot = createTempProjectsRoot();
  assert.equal(path.resolve(projectsRoot).startsWith(path.resolve("C:\\sf-factory-projects")), false);
});
