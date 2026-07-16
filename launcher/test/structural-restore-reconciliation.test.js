"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createLauncherServer } = require("../src/server");
const {
  createProjectScaffold,
  readProjectBySlug
} = require("../src/project-store");
const {
  createRequestedOperation,
  listOperations,
  updateOperation
} = require("../src/project-operation-store");
const {
  JOURNAL_FILENAME,
  createRestoreJournal,
  discoverInterruptedStructuralRestores,
  getRestoreWorkRoot,
  readRestoreJournal,
  reconcileInterruptedStructuralRestores,
  resolveJournalPaths,
  updateRestoreJournal
} = require("../src/structural-restore-reconciliation");

let portCounter = 37100;

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-restore-reconcile-"));
}

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, content) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function removeTree(targetPath) {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function createWordPressTree(rootPath, label) {
  writeFile(path.join(rootPath, "index.php"), "<?php echo '" + label + "';\n");
  writeFile(path.join(rootPath, "wp-admin", "admin.php"), "<?php echo 'admin';\n");
  writeFile(path.join(rootPath, "wp-includes", "version.php"), "<?php $wp_version = 'test';\n");
  writeFile(path.join(rootPath, "wp-content", "plugins", "crocoblock-site-factory", "crocoblock-site-factory.php"), "<?php /* Plugin Name: Crocoblock Site Factory */\n");
  writeFile(path.join(rootPath, "wp-content", "themes", "twentytwenty", "style.css"), "body{}\n");
  writeFile(path.join(rootPath, "wp-content", "uploads", label + ".txt"), label + "\n");
  writeFile(path.join(rootPath, "wp-config.php"), "define('DB_NAME','factory_test');\n");
}

function createProject(projectsRoot, slug) {
  const scaffold = createProjectScaffold({
    name: slug,
    slug,
    port: portCounter += 1,
    projectsRoot
  });
  createWordPressTree(path.join(scaffold.project.runtime_path, "wordpress"), "original");
  return {
    slug,
    projectState: readProjectBySlug(slug, projectsRoot),
    runtimePath: scaffold.project.runtime_path
  };
}

function createRunningRestoreOperation(projectsRoot, slug, operationId) {
  createRequestedOperation({
    projectsRoot,
    slug,
    operationId,
    operationType: "structural_restore_execute",
    idempotencyKeyHash: "hash-" + operationId,
    requestFingerprint: "fingerprint-" + operationId,
    metadata: { plan_id: "restore-plan-test" }
  });
  return updateOperation({
    projectsRoot,
    slug,
    operationId,
    patch: {
      status: "running",
      stage: "promoting_filesystem",
      started_at: "2026-07-16T12:00:00.000Z"
    }
  }).operation;
}

function createJournal(projectsRoot, fixture, operationId, patch) {
  createRestoreJournal({
    projectsRoot,
    runtimePath: fixture.runtimePath,
    projectState: fixture.projectState,
    operationId,
    planId: "restore-plan-test",
    requestFingerprint: "fingerprint-" + operationId,
    stage: "promoting_filesystem",
    clock: () => Date.parse("2026-07-16T12:00:00.000Z")
  });
  return updateRestoreJournal({
    projectsRoot,
    runtimePath: fixture.runtimePath,
    operationId,
    clock: () => Date.parse("2026-07-16T12:01:00.000Z")
  }, patch || {});
}

function fakeServiceController(calls, initialRunning) {
  let running = initialRunning !== false;
  return async (action) => {
    calls.push(action);
    if (action === "isWordPressRunning") {
      return { running };
    }
    if (action === "stopWordPress") {
      running = false;
      return { running };
    }
    if (action === "startWordPress") {
      running = true;
      return { running };
    }
    throw new Error("unexpected service action " + action);
  };
}

function readLatestProof(runtimePath) {
  const proofDir = path.join(runtimePath, "proofs");
  const files = fs.readdirSync(proofDir).filter((name) => name.startsWith("restore-reconcile-") && name.endsWith(".json"));
  assert.ok(files.length > 0);
  files.sort();
  return JSON.parse(fs.readFileSync(path.join(proofDir, files[files.length - 1]), "utf8"));
}

test("journal is atomic, server-confined, and discovery only selects unfinished structural restores", () => {
  const projectsRoot = tempRoot();
  const fixture = createProject(projectsRoot, "journal-project");
  const operationId = "op-journal";
  createRunningRestoreOperation(projectsRoot, fixture.slug, operationId);
  const journal = createJournal(projectsRoot, fixture, operationId, {
    maintenance_created_by_operation: true,
    wordpress_service_was_running: true
  });
  const workRoot = getRestoreWorkRoot(fixture.runtimePath, operationId);
  const journalPath = path.join(workRoot, JOURNAL_FILENAME);

  assert.equal(fs.existsSync(journalPath), true);
  assert.equal(fs.readdirSync(workRoot).some((entry) => entry.includes(".tmp-")), false);
  assert.equal(journal.project_slug, fixture.slug);
  assert.equal(path.isAbsolute(journal.paths.work_root), false);
  assert.equal(JSON.stringify(journal).includes(fixture.runtimePath), false);
  assert.deepEqual(discoverInterruptedStructuralRestores({ projectsRoot }), [
    { slug: fixture.slug, operation_id: operationId, status: "running", stage: "promoting_filesystem" }
  ]);
});

test("invalid journal paths are rejected before filesystem mutation", () => {
  const projectsRoot = tempRoot();
  const fixture = createProject(projectsRoot, "path-project");
  const operationId = "op-path";
  createRunningRestoreOperation(projectsRoot, fixture.slug, operationId);
  const journal = createJournal(projectsRoot, fixture, operationId);

  assert.throws(
    () => resolveJournalPaths(fixture.runtimePath, Object.assign({}, journal, {
      paths: Object.assign({}, journal.paths, { rollback_root: "../outside" })
    })),
    (error) => error.code === "restore_rollback_path_unsafe"
  );
  assert.throws(
    () => resolveJournalPaths(fixture.runtimePath, Object.assign({}, journal, {
      paths: Object.assign({}, journal.paths, { staging_root: "runs\\restore-work\\op-path\\staging" })
    })),
    (error) => error.code === "restore_staging_path_unsafe"
  );
});

test("pre-promotion interruption cleans staging and operation-created maintenance without duplicate operation", async () => {
  const projectsRoot = tempRoot();
  const fixture = createProject(projectsRoot, "pre-promotion");
  const operationId = "op-pre-promotion";
  createRunningRestoreOperation(projectsRoot, fixture.slug, operationId);
  const workRoot = getRestoreWorkRoot(fixture.runtimePath, operationId);
  writeFile(path.join(workRoot, "staging", "wordpress", "index.php"), "staged\n");
  writeFile(path.join(fixture.runtimePath, "wordpress", ".maintenance"), "operation maintenance\n");
  createJournal(projectsRoot, fixture, operationId, {
    maintenance_created_by_operation: true,
    wordpress_service_was_running: true,
    staging_validated: true,
    filesystem_promotion_started: false,
    filesystem_promotion_completed: false,
    database_import_started: false
  });
  const calls = [];

  const result = await reconcileInterruptedStructuralRestores({
    projectsRoot,
    serviceController: fakeServiceController(calls, false)
  });
  const operation = listOperations({ projectsRoot, slug: fixture.slug })[0];

  assert.equal(result.checked, 1);
  assert.equal(result.results[0].action, "pre_promotion_cleanup");
  assert.equal(operation.status, "failed");
  assert.equal(operation.stage, "interrupted_reconciled");
  assert.equal(operation.result_summary.reconciliation_succeeded, true);
  assert.equal(operation.result_summary.manual_recovery_required, false);
  assert.equal(fs.existsSync(workRoot), false);
  assert.equal(fs.existsSync(path.join(fixture.runtimePath, "wordpress", ".maintenance")), false);
  assert.deepEqual(calls, ["startWordPress", "isWordPressRunning"]);
  assert.equal(listOperations({ projectsRoot, slug: fixture.slug }).length, 1);
});

test("post-promotion pre-database interruption rolls original filesystem back and never starts DB work", async () => {
  const projectsRoot = tempRoot();
  const fixture = createProject(projectsRoot, "promoted-before-db");
  const operationId = "op-promoted-before-db";
  createRunningRestoreOperation(projectsRoot, fixture.slug, operationId);
  const workRoot = getRestoreWorkRoot(fixture.runtimePath, operationId);
  const liveRoot = path.join(fixture.runtimePath, "wordpress");
  const rollbackRoot = path.join(workRoot, "rollback-wordpress");
  const stagingRoot = path.join(workRoot, "staging");
  const originalConfig = fs.readFileSync(path.join(liveRoot, "wp-config.php"), "utf8");

  removeTree(liveRoot);
  createWordPressTree(liveRoot, "restored-source");
  writeFile(path.join(liveRoot, "wp-content", "uploads", "source-only.txt"), "source\n");
  createWordPressTree(rollbackRoot, "original");
  writeFile(path.join(rollbackRoot, "wp-content", "uploads", "original-probe.txt"), "original\n");
  writeFile(path.join(rollbackRoot, "wp-config.php"), originalConfig);
  writeFile(path.join(stagingRoot, "leftover.txt"), "leftover\n");
  writeFile(path.join(liveRoot, ".maintenance"), "operation maintenance\n");
  createJournal(projectsRoot, fixture, operationId, {
    maintenance_created_by_operation: true,
    wordpress_service_was_running: true,
    staging_validated: true,
    rollback_tree_ready: true,
    filesystem_promotion_started: true,
    filesystem_promotion_completed: true,
    database_import_started: false
  });
  const calls = [];

  const result = await reconcileInterruptedStructuralRestores({
    projectsRoot,
    serviceController: fakeServiceController(calls, true)
  });
  const operation = listOperations({ projectsRoot, slug: fixture.slug })[0];

  assert.equal(result.results[0].action, "promoted_before_db_rollback");
  assert.equal(operation.status, "failed");
  assert.equal(operation.result_summary.restore_state, "interrupted_reconciled");
  assert.equal(operation.result_summary.auto_rollback_completed, true);
  assert.equal(operation.result_summary.database_import_started, false);
  assert.equal(operation.result_summary.filesystem_restored_to_pre_operation_state, true);
  assert.equal(fs.existsSync(path.join(liveRoot, "wp-content", "uploads", "original-probe.txt")), true);
  assert.equal(fs.existsSync(path.join(liveRoot, "wp-content", "uploads", "source-only.txt")), false);
  assert.equal(fs.existsSync(workRoot), false);
  assert.deepEqual(calls, ["stopWordPress", "startWordPress", "isWordPressRunning"]);
  const proof = readLatestProof(fixture.runtimePath);
  assert.equal(proof.database_import_started, false);
  assert.equal(JSON.stringify(proof).includes(fixture.runtimePath), false);

  const second = await reconcileInterruptedStructuralRestores({
    projectsRoot,
    serviceController: fakeServiceController([], true)
  });
  assert.equal(second.checked, 0);
  assert.equal(listOperations({ projectsRoot, slug: fixture.slug }).length, 1);
});

test("ambiguous DB-import and invalid journal identity become manual recovery required", async () => {
  const projectsRoot = tempRoot();
  const fixture = createProject(projectsRoot, "manual-project");
  const operationId = "op-manual-db";
  createRunningRestoreOperation(projectsRoot, fixture.slug, operationId);
  createJournal(projectsRoot, fixture, operationId, {
    filesystem_promotion_completed: true,
    database_import_started: true,
    database_import_completed: false
  });

  await reconcileInterruptedStructuralRestores({
    projectsRoot,
    serviceController: fakeServiceController([], true)
  });
  const operation = listOperations({ projectsRoot, slug: fixture.slug })[0];
  assert.equal(operation.status, "failed");
  assert.equal(operation.stage, "interrupted_recovery_required");
  assert.equal(operation.result_summary.manual_recovery_required, true);
  assert.equal(operation.result_summary.database_import_started, true);

  const mismatch = createProject(projectsRoot, "identity-project");
  const mismatchOperationId = "op-identity";
  createRunningRestoreOperation(projectsRoot, mismatch.slug, mismatchOperationId);
  const journal = createJournal(projectsRoot, mismatch, mismatchOperationId);
  writeFile(
    path.join(getRestoreWorkRoot(mismatch.runtimePath, mismatchOperationId), JOURNAL_FILENAME),
    JSON.stringify(Object.assign({}, journal, {
      project_binding: Object.assign({}, journal.project_binding, { fingerprint: "wrong" })
    }), null, 2) + "\n"
  );
  await reconcileInterruptedStructuralRestores({
    projectsRoot,
    serviceController: fakeServiceController([], true)
  });
  const identityOperation = listOperations({ projectsRoot, slug: mismatch.slug })[0];
  assert.equal(identityOperation.stage, "interrupted_recovery_required");
  assert.equal(identityOperation.error.code, "restore_journal_project_binding_mismatch");
});

test("normal Launcher startup invokes restore reconciliation once and is idempotent", async () => {
  const projectsRoot = tempRoot();
  const fixture = createProject(projectsRoot, "startup-project");
  const operationId = "op-startup";
  createRunningRestoreOperation(projectsRoot, fixture.slug, operationId);
  const workRoot = getRestoreWorkRoot(fixture.runtimePath, operationId);
  writeFile(path.join(workRoot, "staging", "wordpress", "index.php"), "staged\n");
  createJournal(projectsRoot, fixture, operationId, {
    filesystem_promotion_completed: false,
    database_import_started: false
  });

  const server = createLauncherServer({
    projectsRoot,
    host: "127.0.0.1",
    port: 0,
    restoreReconciliationServiceController: fakeServiceController([], true)
  });
  const started = await server.listen();
  await server.close();
  assert.equal(started.restoreReconciliation.checked, 1);
  assert.equal(started.restoreReconciliation.results[0].action, "pre_promotion_cleanup");

  const secondServer = createLauncherServer({
    projectsRoot,
    host: "127.0.0.1",
    port: 0,
    restoreReconciliationServiceController: fakeServiceController([], true)
  });
  const second = await secondServer.listen();
  await secondServer.close();
  assert.equal(second.restoreReconciliation.checked, 0);
  assert.equal(listOperations({ projectsRoot, slug: fixture.slug }).length, 1);
});

test("malformed journal JSON is finalized safely without exposing raw filesystem errors", async () => {
  const projectsRoot = tempRoot();
  const fixture = createProject(projectsRoot, "malformed-project");
  const operationId = "op-malformed";
  createRunningRestoreOperation(projectsRoot, fixture.slug, operationId);
  const workRoot = getRestoreWorkRoot(fixture.runtimePath, operationId);
  mkdirp(workRoot);
  fs.writeFileSync(path.join(workRoot, JOURNAL_FILENAME), "{not json", "utf8");

  const result = await reconcileInterruptedStructuralRestores({
    projectsRoot,
    serviceController: fakeServiceController([], true)
  });
  const operation = listOperations({ projectsRoot, slug: fixture.slug })[0];
  assert.equal(result.results[0].action, "manual_recovery_required");
  assert.equal(operation.stage, "interrupted_recovery_required");
  assert.equal(operation.error.message, "Interrupted restore requires manual recovery.");
  assert.equal(JSON.stringify(operation).includes(workRoot), false);
});

test("read journal validates persisted checkpoint flags", () => {
  const projectsRoot = tempRoot();
  const fixture = createProject(projectsRoot, "read-journal");
  const operationId = "op-read";
  createRunningRestoreOperation(projectsRoot, fixture.slug, operationId);
  createJournal(projectsRoot, fixture, operationId, {
    rescue_verified: true,
    cleanup_completed: false,
    database_import_started: false
  });
  const journal = readRestoreJournal({
    projectsRoot,
    runtimePath: fixture.runtimePath,
    operationId
  });
  assert.equal(journal.journal_schema_version, 1);
  assert.equal(journal.rescue_verified, true);
  assert.equal(journal.database_import_started, false);
});
