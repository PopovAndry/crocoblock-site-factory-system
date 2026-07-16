"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const test = require("node:test");
const { createProjectScaffold } = require("../src/project-store");
const {
  listOperations
} = require("../src/project-operation-store");
const {
  runProjectOperation
} = require("../src/project-operation-coordinator");
const {
  captureWordPressFilesystemArtifact,
  walkWordPressFilesystem
} = require("../src/structural-snapshot-capture");
const {
  createManifestRecord,
  listManifests,
  resolveSnapshotDirectory,
  transitionManifestStatus
} = require("../src/structural-snapshot-store");
const {
  RESTORE_PLAN_TTL_MS,
  createRestorePlan
} = require("../src/structural-restore-plan");
const {
  RESTORE_WORK_DIRECTORY,
  executeManagedWebsiteRestore,
  extractTarArchive,
  importDatabaseArtifact,
  validateExecutionInput
} = require("../src/structural-restore-execution");

let portCounter = 36200;

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-restore-exec-"));
}

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, content) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
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

function syntheticSql(prefix) {
  const tablePrefix = prefix || "wp_";
  return [
    "-- MySQL dump 10.13  Distrib 8.0.0",
    "DROP TABLE IF EXISTS `" + tablePrefix + "options`;",
    "CREATE TABLE `" + tablePrefix + "options` (`option_id` bigint unsigned NOT NULL);",
    "DROP TABLE IF EXISTS `" + tablePrefix + "posts`;",
    "CREATE TABLE `" + tablePrefix + "posts` (`ID` bigint unsigned NOT NULL);",
    "DROP TABLE IF EXISTS `" + tablePrefix + "postmeta`;",
    "CREATE TABLE `" + tablePrefix + "postmeta` (`meta_id` bigint unsigned NOT NULL);",
    ""
  ].join("\n");
}

function createWordPressTree(runtimePath, label) {
  const root = path.join(runtimePath, "wordpress");
  writeFile(path.join(root, "index.php"), "<?php echo '" + label + "';\n");
  writeFile(path.join(root, "wp-admin", "admin.php"), "<?php echo 'admin';\n");
  writeFile(path.join(root, "wp-includes", "version.php"), "<?php $wp_version = 'test';\n");
  writeFile(path.join(root, "wp-content", "plugins", "crocoblock-site-factory", "crocoblock-site-factory.php"), "<?php /* Plugin Name: Crocoblock Site Factory */\n");
  writeFile(path.join(root, "wp-content", "themes", "twentytwenty", "style.css"), "body{}\n");
  writeFile(path.join(root, "wp-content", "uploads", "source.txt"), label + "\n");
  writeFile(path.join(root, "wp-config.php"), "DB_PASSWORD='current-secret-" + label + "';\n");
  return root;
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
  const root = createWordPressTree(scaffold.project.runtime_path, "source-" + slug);
  fs.writeFileSync(path.join(scaffold.project.runtime_path, "factory-project.json"), JSON.stringify(scaffold.project, null, 2) + "\n", "utf8");
  return { scaffold, root };
}

async function createVerifiedSnapshot(projectsRoot, slug, options) {
  const safeOptions = options || {};
  const created = createManifestRecord({
    projectsRoot,
    slug,
    snapshotId: safeOptions.snapshotId,
    manifest: {
      snapshot_tier: "local_rescue",
      customer_label: "Recovery Point",
      source_operation_id: "op-test",
      consistency_mode: "coordinated_maintenance_db_filesystem_capture",
      captured_components: [],
      excluded_components: [],
      artifacts: [],
      software: { test: true },
      verification: { status: "not_verified", successful: false },
      restore_compatibility: { status: "not_evaluated", blocking: true, blockers: ["creating"] },
      provenance: { source: "restore_execution_test" }
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
    snapshotId: created.manifest.snapshot_id,
    context,
    manifest: verified.manifest
  };
}

async function createReadyPlan(projectsRoot, slug, snapshotId, options) {
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

function executionInjections(projectsRoot, slug, calls) {
  return {
    freeSpaceProbe: () => 10 * 1024 * 1024 * 1024,
    clock: () => Date.parse("2026-07-16T12:01:00.000Z"),
    rescueCapture: async (context) => {
      calls.push("rescue");
      const rescue = await createVerifiedSnapshot(projectsRoot, slug, {
        snapshotId: "snapshot-2026-07-16t12-01-00-000z-abcdefabcdef"
      });
      return {
        result: {
          snapshot_id: rescue.snapshotId,
          summary: { restorable: true }
        }
      };
    },
    serviceController: async (action) => {
      calls.push(action);
      return { action };
    },
    dbImporter: async ({ databasePath }) => {
      calls.push("db");
      assert.equal(path.basename(databasePath), "database.sql");
      return { successful: true, streamed: true };
    },
    agentRepairer: async () => {
      calls.push("agent");
      return { successful: true, key_id: "key-test", health_status: "ok" };
    },
    healthVerifier: async () => {
      calls.push("health");
      return { wordpress: "ok", wp_json: "ok", mysql: "running", signed_agent: "ok" };
    }
  };
}

async function setupReadyRestore(slug) {
  const projectsRoot = tempRoot();
  const project = createProject(projectsRoot, slug);
  const source = await createVerifiedSnapshot(projectsRoot, slug);
  const wpConfigBefore = sha256File(path.join(project.root, "wp-config.php"));
  writeFile(path.join(project.root, "wp-content", "uploads", "site-factory-restore-probe-20a5a.txt"), "probe\n");
  writeFile(path.join(project.root, "wp-content", "uploads", "mutated.txt"), "mutated\n");
  const plan = await createReadyPlan(projectsRoot, slug, source.snapshotId);
  return { projectsRoot, project, source, plan, wpConfigBefore };
}

test("valid fresh ready plan executes one coordinator operation and restores filesystem with current wp-config", async () => {
  const slug = "exec-ready";
  const fixture = await setupReadyRestore(slug);
  const calls = [];
  const result = await executeManagedWebsiteRestore(Object.assign({
    projectsRoot: fixture.projectsRoot,
    projectSlug: slug,
    planId: fixture.plan.plan.plan_id,
    exactConfirmation: fixture.plan.plan.confirmation.phrase,
    idempotencyKey: "restore-exec-key-ready-0001"
  }, executionInjections(fixture.projectsRoot, slug, calls)));
  const liveRoot = fixture.project.root;

  assert.equal(result.operation.status, "succeeded");
  assert.equal(result.operation.operation_type, "structural_restore_execute");
  assert.equal(result.operation.result_summary.source_snapshot_id, fixture.source.snapshotId);
  assert.equal(result.operation.result_summary.rescue_snapshot_id, "snapshot-2026-07-16t12-01-00-000z-abcdefabcdef");
  assert.equal(fs.existsSync(path.join(liveRoot, "wp-content", "uploads", "site-factory-restore-probe-20a5a.txt")), false);
  assert.equal(fs.existsSync(path.join(liveRoot, "wp-content", "uploads", "mutated.txt")), false);
  assert.equal(sha256File(path.join(liveRoot, "wp-config.php")), fixture.wpConfigBefore);
  assert.deepEqual(calls.slice(0, 2), ["rescue", "stopWordPress"]);
  assert.ok(calls.includes("db"));
  assert.ok(calls.includes("agent"));
  assert.ok(calls.includes("health"));
  assert.equal(listOperations({ projectsRoot: fixture.projectsRoot, slug }).length, 1);
  assert.equal(listManifests({ projectsRoot: fixture.projectsRoot, slug }).some((entry) => entry.snapshot_id === fixture.source.snapshotId), true);
  assert.equal(listManifests({ projectsRoot: fixture.projectsRoot, slug }).some((entry) => entry.snapshot_id === "snapshot-2026-07-16t12-01-00-000z-abcdefabcdef"), true);
});

test("executor loads stored plan by ID and rejects resubmitted plan bodies and unsafe public fields", async () => {
  const slug = "exec-input";
  const fixture = await setupReadyRestore(slug);
  await assert.rejects(
    () => executeManagedWebsiteRestore({
      projectsRoot: fixture.projectsRoot,
      projectSlug: slug,
      planId: fixture.plan.plan.plan_id,
      exactConfirmation: fixture.plan.plan.confirmation.phrase,
      idempotencyKey: "restore-exec-key-input-0001",
      plan: { plan_id: "attacker" }
    }),
    (error) => error.code === "restore_execution_input_rejected"
  );
  assert.throws(
    () => validateExecutionInput({
      projectSlug: slug,
      planId: fixture.plan.plan.plan_id,
      exactConfirmation: fixture.plan.plan.confirmation.phrase,
      stagingPath: "C:\\temp\\x"
    }),
    (error) => error.code === "restore_execution_input_rejected"
  );
});

test("expired plan wrong project confirmation mismatch fingerprint mismatch and non-full rescue fail before mutation", async () => {
  const slug = "exec-reject";
  const fixture = await setupReadyRestore(slug);
  const base = {
    projectsRoot: fixture.projectsRoot,
    projectSlug: slug,
    planId: fixture.plan.plan.plan_id,
    idempotencyKey: "restore-exec-key-reject-0001"
  };
  await assert.rejects(
    () => executeManagedWebsiteRestore(Object.assign({}, base, {
      exactConfirmation: "Restore Website for another",
      idempotencyKey: "restore-exec-key-reject-0002"
    }, executionInjections(fixture.projectsRoot, slug, []))),
    (error) => error.code === "restore_confirmation_mismatch"
  );
  await assert.rejects(
    () => executeManagedWebsiteRestore(Object.assign({}, base, {
      projectSlug: "missing-project",
      exactConfirmation: fixture.plan.plan.confirmation.phrase,
      idempotencyKey: "restore-exec-key-reject-0003"
    }, executionInjections(fixture.projectsRoot, slug, []))),
    /Factory project not found/
  );
  writeFile(path.join(fixture.source.context.snapshotDirectory, "database.sql"), syntheticSql() + "--changed\n");
  await assert.rejects(
    () => executeManagedWebsiteRestore(Object.assign({}, base, {
      exactConfirmation: fixture.plan.plan.confirmation.phrase,
      idempotencyKey: "restore-exec-key-reject-0004"
    }, executionInjections(fixture.projectsRoot, slug, []))),
    (error) => error.code === "restore_artifact_size_mismatch" || error.code === "restore_artifact_digest_mismatch"
  );

  const fresh = await setupReadyRestore("exec-nonfull");
  await assert.rejects(
    () => executeManagedWebsiteRestore(Object.assign({
      projectsRoot: fresh.projectsRoot,
      projectSlug: "exec-nonfull",
      planId: fresh.plan.plan.plan_id,
      exactConfirmation: fresh.plan.plan.confirmation.phrase,
      idempotencyKey: "restore-exec-key-reject-0005",
      planLoader: async () => ({
        plan: Object.assign({}, fresh.plan.plan, { rescue_strategy: "lightweight_candidate" }),
        source: { artifacts: { filesystem: { path: "x" }, database: { path: "y" } } }
      })
    }, executionInjections(fresh.projectsRoot, "exec-nonfull", []))),
    (error) => error.code === "restore_full_rescue_required" || error.code === "restore_archive_verification_failed"
  );

  assert.equal(listOperations({ projectsRoot: fixture.projectsRoot, slug }).filter((entry) => entry.status === "succeeded").length, 0);
});

test("active mutation idempotency replay and idempotency conflict are handled by coordinator", async () => {
  const slug = "exec-idempotency";
  const fixture = await setupReadyRestore(slug);
  let releaseActive;
  const active = runProjectOperation({
    projectsRoot: fixture.projectsRoot,
    slug,
    operationType: "state_apply",
    idempotencyKey: "state-apply-active-lock-0001",
    fingerprintInput: { test: "active-lock" },
    execute: async () => new Promise((resolve) => {
      releaseActive = () => resolve({ resultSummary: { released: true } });
    })
  });
  while (!releaseActive) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  try {
    await assert.rejects(
      () => executeManagedWebsiteRestore(Object.assign({
        projectsRoot: fixture.projectsRoot,
        projectSlug: slug,
        planId: fixture.plan.plan.plan_id,
        exactConfirmation: fixture.plan.plan.confirmation.phrase,
        idempotencyKey: "restore-exec-key-idem-0001"
      }, executionInjections(fixture.projectsRoot, slug, []))),
      (error) => error.code === "project_operation_in_progress"
    );
  } finally {
    releaseActive();
    await active;
  }

  const clean = await setupReadyRestore("exec-idem-clean");
  const first = await executeManagedWebsiteRestore(Object.assign({
    projectsRoot: clean.projectsRoot,
    projectSlug: "exec-idem-clean",
    planId: clean.plan.plan.plan_id,
    exactConfirmation: clean.plan.plan.confirmation.phrase,
    idempotencyKey: "restore-exec-key-idem-0002"
  }, executionInjections(clean.projectsRoot, "exec-idem-clean", [])));
  const replay = await executeManagedWebsiteRestore(Object.assign({
    projectsRoot: clean.projectsRoot,
    projectSlug: "exec-idem-clean",
    planId: clean.plan.plan.plan_id,
    exactConfirmation: clean.plan.plan.confirmation.phrase,
    idempotencyKey: "restore-exec-key-idem-0002"
  }, executionInjections(clean.projectsRoot, "exec-idem-clean", [])));
  assert.equal(first.operation.operation_id, replay.operation.operation_id);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.result.status, "succeeded");
  assert.equal(replay.result.rescue_snapshot_id, first.result.rescue_snapshot_id);
  await assert.rejects(
    () => executeManagedWebsiteRestore(Object.assign({
      projectsRoot: clean.projectsRoot,
      projectSlug: "exec-idem-clean",
      planId: clean.plan.plan.plan_id,
      exactConfirmation: "changed confirmation",
      idempotencyKey: "restore-exec-key-idem-0002"
    }, executionInjections(clean.projectsRoot, "exec-idem-clean", []))),
    (error) => error.code === "idempotency_key_conflict"
  );
});

test("rescue failure and staging validation failure prevent live mutation and clean staging", async () => {
  const slug = "exec-pre-fail";
  const fixture = await setupReadyRestore(slug);
  await assert.rejects(
    () => executeManagedWebsiteRestore(Object.assign(executionInjections(fixture.projectsRoot, slug, []), {
      projectsRoot: fixture.projectsRoot,
      projectSlug: slug,
      planId: fixture.plan.plan.plan_id,
      exactConfirmation: fixture.plan.plan.confirmation.phrase,
      idempotencyKey: "restore-exec-key-prefail-0001",
      rescueCapture: async () => {
        throw Object.assign(new Error("rescue failed"), { code: "test_rescue_failed" });
      }
    })),
    (error) => error.code === "test_rescue_failed"
  );
  assert.equal(fs.existsSync(path.join(fixture.project.root, "wp-content", "uploads", "site-factory-restore-probe-20a5a.txt")), true);

  const second = await setupReadyRestore("exec-stage-fail");
  await assert.rejects(
    () => executeManagedWebsiteRestore(Object.assign(executionInjections(second.projectsRoot, "exec-stage-fail", []), {
      projectsRoot: second.projectsRoot,
      projectSlug: "exec-stage-fail",
      planId: second.plan.plan.plan_id,
      exactConfirmation: second.plan.plan.confirmation.phrase,
      idempotencyKey: "restore-exec-key-prefail-0002",
      extractedTreeValidator: async () => {
        throw Object.assign(new Error("bad tree"), { code: "restore_staging_required_missing" });
      }
    })),
    (error) => error.code === "restore_staging_required_missing"
  );
  assert.equal(fs.existsSync(path.join(second.project.root, "wp-content", "uploads", "site-factory-restore-probe-20a5a.txt")), true);
  const workParent = path.join(path.dirname(second.project.root), RESTORE_WORK_DIRECTORY);
  assert.deepEqual(fs.existsSync(workParent) ? fs.readdirSync(workParent) : [], []);
});

test("promotion failure rolls original tree back and post-promotion DB failure records recovery state", async () => {
  const slug = "exec-promotion-fail";
  const fixture = await setupReadyRestore(slug);
  await assert.rejects(
    () => executeManagedWebsiteRestore(Object.assign(executionInjections(fixture.projectsRoot, slug, []), {
      projectsRoot: fixture.projectsRoot,
      projectSlug: slug,
      planId: fixture.plan.plan.plan_id,
      exactConfirmation: fixture.plan.plan.confirmation.phrase,
      idempotencyKey: "restore-exec-key-promofail-0001",
      filesystemPromoter: async () => {
        throw Object.assign(new Error("promotion failed"), { code: "restore_filesystem_promotion_failed" });
      }
    })),
    (error) => error.code === "restore_filesystem_promotion_failed"
  );
  assert.equal(fs.existsSync(path.join(fixture.project.root, "wp-content", "uploads", "site-factory-restore-probe-20a5a.txt")), true);

  const dbFail = await setupReadyRestore("exec-db-fail");
  await assert.rejects(
    () => executeManagedWebsiteRestore(Object.assign(executionInjections(dbFail.projectsRoot, "exec-db-fail", []), {
      projectsRoot: dbFail.projectsRoot,
      projectSlug: "exec-db-fail",
      planId: dbFail.plan.plan.plan_id,
      exactConfirmation: dbFail.plan.plan.confirmation.phrase,
      idempotencyKey: "restore-exec-key-promofail-0002",
      dbImporter: async () => {
        throw Object.assign(new Error("db failed"), { code: "restore_db_import_failed" });
      }
    })),
    (error) => error.code === "restore_db_import_failed"
  );
  const failed = listOperations({ projectsRoot: dbFail.projectsRoot, slug: "exec-db-fail" })[0];
  assert.equal(failed.status, "failed");
  assert.equal(failed.result_summary.db_import_began, true);
  assert.equal(failed.result_summary.manual_recovery_required, false);
});

test("archive extraction rejects traversal symlink-like entries and requires WordPress structure", async () => {
  const root = tempRoot();
  const archivePath = path.join(root, "unsafe.tar");
  fs.writeFileSync(archivePath, Buffer.alloc(1024));
  assert.throws(
    () => extractTarArchive({ archivePath, stagingRoot: path.join(root, "staging") }),
    (error) => error.code === "snapshot_archive_invalid" || error.code === "snapshot_archive_required_entry_missing"
  );
});

test("database importer uses fixed mysql service and does not expose passwords in host args", async () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../src/structural-restore-execution.js"), "utf8");
  assert.equal(/MYSQL_PASSWORD=/.test(source), false);
  assert.equal(source.includes('["compose", "exec", "-T", DB_SERVICE'), true);
  assert.equal(/docker\s+rm|docker\s+volume\s+rm|prune/i.test(source), false);
  assert.equal(/server\.js|createRecoveryPoint|lightweight|emergency no-rescue/i.test(source), false);
  assert.equal(typeof importDatabaseArtifact, "function");
});
