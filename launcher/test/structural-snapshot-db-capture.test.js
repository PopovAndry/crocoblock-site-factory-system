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
  DB_ARTIFACT_FILENAME,
  DB_SERVICE,
  MYSQLDUMP_SCRIPT,
  OPERATION_TYPE,
  createDatabaseStructuralSnapshot,
  sanitizeDiagnosticText,
  verifyDumpArtifact
} = require("../src/structural-snapshot-db-capture");
const {
  listManifests,
  readManifest,
  resolveSnapshotDirectory,
  toBrowserSafeSummary
} = require("../src/structural-snapshot-store");

let portCounter = 28200;

function createTempProjectsRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-db-snapshot-"));
}

function createTempProject(projectsRoot, slug) {
  return createProjectScaffold({
    name: slug,
    slug,
    port: portCounter += 1,
    projectsRoot
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const chunks = Array.isArray(sql) ? sql : [sql];
  const runner = async (request) => {
    calls.push(request);
    if (options && options.delayMs) {
      await sleep(options.delayMs);
    }
    for (const chunk of chunks) {
      await request.onStdoutChunk(Buffer.from(chunk, "utf8"));
    }
    return {
      code: options && Object.prototype.hasOwnProperty.call(options, "code") ? options.code : 0,
      timedOut: Boolean(options && options.timedOut),
      stderr: options && options.stderr || ""
    };
  };
  runner.calls = calls;
  return runner;
}

async function capture(projectsRoot, slug, options) {
  return createDatabaseStructuralSnapshot(Object.assign({
    projectsRoot,
    slug,
    idempotencyKey: "snapshot-key-" + slug + "-0001",
    dumpRunner: createDumpRunner(syntheticSql())
  }, options || {}));
}

function listSnapshotDirs(projectsRoot, slug) {
  const listed = listManifests({ projectsRoot, slug });
  return listed.map((summary) => {
    const context = resolveSnapshotDirectory({ projectsRoot, slug, snapshotId: summary.snapshot_id });
    return context.snapshotDirectory;
  });
}

function readOnlyChangedProductionSources() {
  return [
    fs.readFileSync(path.resolve(__dirname, "../src/structural-snapshot-db-capture.js"), "utf8"),
    fs.readFileSync(path.resolve(__dirname, "../src/project-operation-coordinator.js"), "utf8")
  ].join("\n");
}

test("capture starts through coordinator semantics and succeeds", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "coord-start");
  const result = await capture(projectsRoot, "coord-start");

  assert.equal(result.operation.operation_type, OPERATION_TYPE);
  assert.equal(result.operation.status, "succeeded");
  assert.equal(result.result.manifest.status, "complete");
  assert.equal(result.result.summary.restorable, false);
  assert.equal(result.operation.result_summary.snapshot_id, result.result.snapshot_id);
});

test("unknown project fails before process execution", async () => {
  const projectsRoot = createTempProjectsRoot();
  const runner = createDumpRunner(syntheticSql());
  await assert.rejects(
    createDatabaseStructuralSnapshot({
      projectsRoot,
      slug: "unknown-project",
      idempotencyKey: "unknown-project-key-001",
      dumpRunner: runner
    }),
    /Factory project not found|Project not found/
  );
  assert.equal(runner.calls.length, 0);
});

test("fixed DB service and command keep plaintext credentials out of host arguments", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "fixed-service");
  const secret = "db_super_secret_value";
  const runner = createDumpRunner(syntheticSql());
  await capture(projectsRoot, "fixed-service", {
    idempotencyKey: "fixed-service-key-001",
    dumpRunner: runner
  });

  assert.equal(runner.calls[0].dbService, DB_SERVICE);
  assert.equal(DB_SERVICE, "mysql");
  assert.equal(MYSQLDUMP_SCRIPT.startsWith("set -eu; mysqldump "), true);
  assert.equal(MYSQLDUMP_SCRIPT.startsWith("set -eu mysqldump "), false);
  assert.equal(MYSQLDUMP_SCRIPT.includes("$MYSQL_PASSWORD"), true);
  assert.equal(MYSQLDUMP_SCRIPT.includes('-p"$MYSQL_PASSWORD"'), true);
  assert.equal(MYSQLDUMP_SCRIPT.includes(secret), false);
  assert.equal(/--password=|db_super_secret_value/.test(MYSQLDUMP_SCRIPT), false);
});

test("credential values do not enter safe errors", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "safe-errors");
  const secret = "db_password_should_not_echo";
  const runner = createDumpRunner("", {
    code: 2,
    stderr: "MYSQL_PASSWORD=" + secret + "\n" + "x".repeat(9000)
  });

  await assert.rejects(
    capture(projectsRoot, "safe-errors", {
      idempotencyKey: "safe-errors-key-01",
      dumpRunner: runner
    }),
    (error) => {
      const text = JSON.stringify(error);
      return error.code === "snapshot_db_dump_failed" && !text.includes(secret) && text.length < 6000;
    }
  );
});

test("artifact path is server-controlled and fixed", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "fixed-artifact");
  const result = await capture(projectsRoot, "fixed-artifact");
  const manifest = result.result.manifest;
  assert.equal(manifest.artifacts.length, 1);
  assert.equal(manifest.artifacts[0].relative_filename, DB_ARTIFACT_FILENAME);
  assert.equal(manifest.artifacts[0].relative_filename.includes(":"), false);
  assert.equal(manifest.artifacts[0].relative_filename.includes("\\"), false);
});

test("output streams through chunks without full SQL buffering", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "streaming");
  const chunks = [
    "-- MySQL dump\nCREATE TABLE `wp_options` (`id` int);\n",
    "CREATE TABLE `wp_posts` (`id` int);\n",
    "CREATE TABLE `wp_postmeta` (`id` int);\n"
  ];
  const runner = createDumpRunner(chunks);
  await capture(projectsRoot, "streaming", {
    idempotencyKey: "streaming-key-0001",
    dumpRunner: runner
  });
  assert.equal(runner.calls.length, 1);
});

test("successful dump writes fixed artifact filename with correct sha256 and size", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "digest-size");
  const sql = syntheticSql();
  const result = await capture(projectsRoot, "digest-size", {
    idempotencyKey: "digest-size-key-01",
    dumpRunner: createDumpRunner(sql)
  });
  const artifact = result.result.manifest.artifacts[0];
  assert.equal(artifact.size_bytes, Buffer.byteLength(sql));
  assert.equal(artifact.digest, crypto.createHash("sha256").update(sql).digest("hex"));
  assert.equal(artifact.relative_filename, DB_ARTIFACT_FILENAME);
});

test("empty dump is rejected and marked incomplete", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "empty-dump");
  await assert.rejects(
    capture(projectsRoot, "empty-dump", {
      idempotencyKey: "empty-dump-key-001",
      dumpRunner: createDumpRunner("")
    }),
    (error) => error.code === "snapshot_db_dump_empty"
  );
  assert.equal(listManifests({ projectsRoot, slug: "empty-dump" })[0].status, "incomplete");
});

test("HTML output and malformed SQL are rejected", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "bad-html");
  createTempProject(projectsRoot, "bad-sql");

  await assert.rejects(
    capture(projectsRoot, "bad-html", {
      idempotencyKey: "bad-html-key-0001",
      dumpRunner: createDumpRunner("<!doctype html><html><form>login</form></html>")
    }),
    (error) => error.code === "snapshot_db_dump_invalid"
  );
  await assert.rejects(
    capture(projectsRoot, "bad-sql", {
      idempotencyKey: "bad-sql-key-0001",
      dumpRunner: createDumpRunner("-- MySQL dump\nSELECT 1;\n")
    }),
    (error) => error.code === "snapshot_db_dump_invalid"
  );
});

test("missing WordPress tables are rejected", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "missing-options");
  createTempProject(projectsRoot, "missing-posts");
  createTempProject(projectsRoot, "missing-postmeta");

  await assert.rejects(
    capture(projectsRoot, "missing-options", {
      idempotencyKey: "missing-options-key",
      dumpRunner: createDumpRunner("CREATE TABLE `wp_posts` (`id` int);\nCREATE TABLE `wp_postmeta` (`id` int);\n")
    }),
    (error) => error.code === "snapshot_db_dump_invalid"
  );
  await assert.rejects(
    capture(projectsRoot, "missing-posts", {
      idempotencyKey: "missing-posts-key1",
      dumpRunner: createDumpRunner("CREATE TABLE `wp_options` (`id` int);\nCREATE TABLE `wp_postmeta` (`id` int);\n")
    }),
    (error) => error.code === "snapshot_db_dump_invalid"
  );
  await assert.rejects(
    capture(projectsRoot, "missing-postmeta", {
      idempotencyKey: "missing-postmeta-key",
      dumpRunner: createDumpRunner("CREATE TABLE `wp_options` (`id` int);\nCREATE TABLE `wp_posts` (`id` int);\n")
    }),
    (error) => error.code === "snapshot_db_dump_invalid"
  );
});

test("non-zero process exit and timeout are rejected", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "nonzero");
  createTempProject(projectsRoot, "timeout");

  await assert.rejects(
    capture(projectsRoot, "nonzero", {
      idempotencyKey: "nonzero-key-00001",
      dumpRunner: createDumpRunner(syntheticSql(), { code: 1, stderr: "mysqldump failed" })
    }),
    (error) => error.code === "snapshot_db_dump_failed"
  );
  await assert.rejects(
    capture(projectsRoot, "timeout", {
      idempotencyKey: "timeout-key-00001",
      dumpRunner: createDumpRunner(syntheticSql(), { timedOut: true })
    }),
    (error) => error.code === "snapshot_db_dump_timeout"
  );
});

test("bounded stderr sanitizer redacts secrets", () => {
  const secret = "secret-password-value";
  const sanitized = sanitizeDiagnosticText("x".repeat(9000) + " MYSQL_PASSWORD=" + secret + " Bearer abc123");
  assert.equal(sanitized.includes(secret), false);
  assert.equal(sanitized.includes("abc123"), false);
  assert.ok(sanitized.length <= 4096);
});

test("partial and temp files are removed after handled failure", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "cleanup-failure");

  await assert.rejects(
    capture(projectsRoot, "cleanup-failure", {
      idempotencyKey: "cleanup-failure-key",
      dumpRunner: createDumpRunner("CREATE TABLE `wp_options` (`id` int);\n")
    }),
    (error) => error.code === "snapshot_db_dump_invalid"
  );

  for (const snapshotDirectory of listSnapshotDirs(projectsRoot, "cleanup-failure")) {
    assert.equal(fs.existsSync(path.join(snapshotDirectory, DB_ARTIFACT_FILENAME)), false);
    const leftovers = fs.readdirSync(snapshotDirectory).filter((name) => name.includes(".tmp-"));
    assert.deepEqual(leftovers, []);
  }
});

test("existing final artifact conflict fails closed", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "artifact-conflict");
  const originalLinkSync = fs.linkSync;
  try {
    fs.linkSync = () => {
      const error = new Error("file exists");
      error.code = "EEXIST";
      throw error;
    };
    await assert.rejects(
      capture(projectsRoot, "artifact-conflict", {
        idempotencyKey: "artifact-conflict-key",
        dumpRunner: createDumpRunner(syntheticSql())
      }),
      (error) => error.code === "EEXIST"
    );
  } finally {
    fs.linkSync = originalLinkSync;
  }
});

test("manifest lifecycle starts creating then completes", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "manifest-life");
  let statusDuringDump = null;
  const runner = async (request) => {
    const listed = listManifests({ projectsRoot, slug: "manifest-life" });
    statusDuringDump = listed[0].status;
    await request.onStdoutChunk(Buffer.from(syntheticSql(), "utf8"));
    return { code: 0, timedOut: false, stderr: "" };
  };

  const result = await capture(projectsRoot, "manifest-life", {
    idempotencyKey: "manifest-life-key1",
    dumpRunner: runner
  });
  assert.equal(statusDuringDump, "creating");
  assert.equal(result.result.manifest.status, "complete");
});

test("success remains non-restorable and filesystem component remains deferred", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "non-restorable");
  const result = await capture(projectsRoot, "non-restorable");
  const manifest = result.result.manifest;

  assert.deepEqual(manifest.captured_components, ["database"]);
  assert.deepEqual(manifest.excluded_components, ["wordpress_filesystem"]);
  assert.equal(manifest.restore_compatibility.blocking, true);
  assert.equal(result.result.summary.restorable, false);
});

test("browser-safe summary and proof omit artifact paths and SQL", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "summary-proof");
  const result = await capture(projectsRoot, "summary-proof");
  const summaryText = JSON.stringify(toBrowserSafeSummary(result.result.manifest));
  const proofText = JSON.stringify(result.result.proof);

  assert.equal(summaryText.includes(DB_ARTIFACT_FILENAME), false);
  assert.equal(summaryText.includes(projectsRoot), false);
  assert.equal(proofText.includes(DB_ARTIFACT_FILENAME), false);
  assert.equal(proofText.includes("CREATE TABLE"), false);
  assert.equal(proofText.includes(projectsRoot), false);
});

test("manifest and proof contain no password or SQL row data", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "no-secret-sql");
  const sql = syntheticSql() + "INSERT INTO `wp_options` VALUES ('secret-row');\n";
  const result = await capture(projectsRoot, "no-secret-sql", {
    idempotencyKey: "no-secret-sql-key",
    dumpRunner: createDumpRunner(sql)
  });
  const manifestText = JSON.stringify(result.result.manifest);
  const proofText = JSON.stringify(result.result.proof);
  assert.equal(manifestText.includes("secret-row"), false);
  assert.equal(proofText.includes("secret-row"), false);
  assert.equal(manifestText.includes("MYSQL_PASSWORD"), false);
  assert.equal(proofText.includes("MYSQL_PASSWORD"), false);
});

test("same-project concurrency follows coordinator policy", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "same-project");
  const first = capture(projectsRoot, "same-project", {
    idempotencyKey: "same-project-key-1",
    dumpRunner: createDumpRunner(syntheticSql(), { delayMs: 250 })
  });
  await sleep(50);
  await assert.rejects(
    capture(projectsRoot, "same-project", {
      idempotencyKey: "same-project-key-2",
      dumpRunner: createDumpRunner(syntheticSql())
    }),
    (error) => error.code === "project_operation_in_progress"
  );
  await first;
});

test("idempotency replay does not re-run dump", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "replay");
  const runner = createDumpRunner(syntheticSql());
  const first = await capture(projectsRoot, "replay", {
    idempotencyKey: "replay-key-000001",
    dumpRunner: runner
  });
  const second = await capture(projectsRoot, "replay", {
    idempotencyKey: "replay-key-000001",
    dumpRunner: runner
  });

  assert.equal(runner.calls.length, 1);
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.operation.operation_id, first.operation.operation_id);
  assert.equal(second.result.snapshot_id, first.result.snapshot_id);
});

test("idempotency conflict is rejected", async () => {
  const projectsRoot = createTempProjectsRoot();
  const slug = "idempotency-conflict";
  const key = "idempotency-conflict-key";
  createTempProject(projectsRoot, slug);
  createRequestedOperation({
    slug,
    projectsRoot,
    operationId: "op-conflict",
    operationType: OPERATION_TYPE,
    idempotencyKeyHash: hashValue(key),
    requestFingerprint: "different-fingerprint"
  });

  await assert.rejects(
    capture(projectsRoot, slug, {
      idempotencyKey: key,
      dumpRunner: createDumpRunner(syntheticSql())
    }),
    (error) => error.code === "idempotency_key_conflict"
  );
});

test("interrupted operation is not silently treated as success", async () => {
  const projectsRoot = createTempProjectsRoot();
  const slug = "interrupted-snapshot";
  const key = "interrupted-snapshot-key";
  const operationId = "op-interrupted-snapshot";
  createTempProject(projectsRoot, slug);
  const state = getProjectState({ slug, projectsRoot });
  const requestFingerprint = computeRequestFingerprint({
    project_slug: slug,
    operation_type: OPERATION_TYPE,
    input: {
      capture: "logical_database_dump",
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
      stage: "dumping_database",
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
    capture(projectsRoot, slug, {
      idempotencyKey: key,
      dumpRunner: createDumpRunner(syntheticSql())
    }),
    (error) => error.code === "operation_retry_requires_new_idempotency_key"
  );
  const interrupted = listOperations({ slug, projectsRoot }).find((operation) => operation.operation_id === operationId);
  assert.equal(interrupted.status, "interrupted");
});

test("verifyDumpArtifact accepts synthetic WordPress table prefix", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-db-verify-"));
  const filePath = path.join(dir, "database.sql");
  const sql = syntheticSql("abc_");
  fs.writeFileSync(filePath, sql, "utf8");
  const verification = await verifyDumpArtifact(filePath, {
    digest: crypto.createHash("sha256").update(sql).digest("hex"),
    sizeBytes: Buffer.byteLength(sql)
  });
  assert.equal(verification.successful, true);
  assert.equal(verification.table_prefix_hint, "abc_");
});

test("no raw mysql copy, route, UI, archive, restore, or arbitrary execution implementation", () => {
  const source = readOnlyChangedProductionSources();
  assert.equal(/\.\/mysql|[\\/]mysql["'`]/i.test(source), false);
  assert.equal(/cp\s+-r|copy-item|xcopy|robocopy/i.test(source), false);
  assert.equal(/server\.get|app\.get|recovery-points/i.test(source), false);
  assert.equal(/launcher[\\/]src[\\/]ui|document\.querySelector|addEventListener/i.test(source), false);
  assert.equal(/\btar\b|\bzip\b|archive creation/i.test(source), false);
  assert.equal(/mysql\s+<|docker\s+exec|restore execution|import dump/i.test(source), false);
  assert.equal(source.includes('spawn("docker"'), true);
  assert.equal(/spawn\(\s*(?:options|request|command)|\bexecFile\s*\(|child_process\.exec\s*\(/.test(source), false);
});

test("automated tests use isolated project roots", () => {
  const projectsRoot = createTempProjectsRoot();
  assert.equal(path.resolve(projectsRoot).startsWith(path.resolve("C:\\sf-factory-projects")), false);
});
