"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const test = require("node:test");
const { createProjectScaffold } = require("../src/project-store");
const {
  computeRequestFingerprint,
  runProjectOperation
} = require("../src/project-operation-coordinator");
const {
  createRequestedOperation,
  getLockDirectory,
  getOperationPath,
  getProjectState,
  hashValue,
  listOperations,
  nowIso,
  updateOperation,
  writeLockMetadata
} = require("../src/project-operation-store");

let portCounter = 24000;

function createTempProjectsRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-opcoord-"));
}

function createTempProject(projectsRoot, slug) {
  createProjectScaffold({
    name: slug,
    slug,
    port: portCounter++,
    projectsRoot
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fakeOperation(options) {
  return runProjectOperation(Object.assign({
    projectsRoot: options.projectsRoot,
    slug: options.slug,
    operationType: options.operationType || "provision",
    idempotencyKey: options.idempotencyKey || ("test-key-" + Math.random().toString(36).slice(2, 14)),
    fingerprintInput: options.fingerprintInput || { test: options.slug },
    execute: async (context) => {
      if (options.onExecute) {
        await options.onExecute(context);
      }
      if (options.delayMs) {
        await sleep(options.delayMs);
      }
      if (options.fail) {
        const error = new Error("planned failure");
        error.code = "planned_failure";
        throw error;
      }
      return {
        result: { ok: true, value: options.value || options.slug },
        proofRef: options.proofRef || null,
        resultSummary: { ok: true, value: options.value || options.slug }
      };
    }
  }, options.override || {}));
}

test("serializes concurrent operations for the same project", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "same-project");
  let executed = 0;

  const first = fakeOperation({
    projectsRoot,
    slug: "same-project",
    idempotencyKey: "same-key-0000001",
    delayMs: 250,
    onExecute: () => {
      executed += 1;
    }
  });
  await sleep(50);

  await assert.rejects(
    fakeOperation({
      projectsRoot,
      slug: "same-project",
      idempotencyKey: "same-key-0000002"
    }),
    (error) => error.code === "project_operation_in_progress"
  );

  await first;
  assert.strictEqual(executed, 1);
});

test("allows concurrent operations for different projects", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "project-a");
  createTempProject(projectsRoot, "project-b");

  const [left, right] = await Promise.all([
    fakeOperation({
      projectsRoot,
      slug: "project-a",
      idempotencyKey: "parallel-key-0001",
      delayMs: 100,
      value: "a"
    }),
    fakeOperation({
      projectsRoot,
      slug: "project-b",
      idempotencyKey: "parallel-key-0002",
      delayMs: 100,
      value: "b"
    })
  ]);

  assert.strictEqual(left.operation.status, "succeeded");
  assert.strictEqual(right.operation.status, "succeeded");
});

test("replays a successful operation for the same idempotency key and fingerprint", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "replay-project");
  let executed = 0;
  const fingerprintInput = { action: "once" };

  const first = await fakeOperation({
    projectsRoot,
    slug: "replay-project",
    idempotencyKey: "replay-key-000001",
    fingerprintInput,
    onExecute: () => {
      executed += 1;
    }
  });
  const second = await fakeOperation({
    projectsRoot,
    slug: "replay-project",
    idempotencyKey: "replay-key-000001",
    fingerprintInput,
    onExecute: () => {
      executed += 1;
    }
  });

  assert.strictEqual(first.operation.status, "succeeded");
  assert.strictEqual(second.idempotentReplay, true);
  assert.strictEqual(second.operation.operation_id, first.operation.operation_id);
  assert.strictEqual(executed, 1);
});

test("rejects reused idempotency key with a different fingerprint", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "fingerprint-project");

  await fakeOperation({
    projectsRoot,
    slug: "fingerprint-project",
    idempotencyKey: "conflict-key-0001",
    fingerprintInput: { action: "a" }
  });

  await assert.rejects(
    fakeOperation({
      projectsRoot,
      slug: "fingerprint-project",
      idempotencyKey: "conflict-key-0001",
      fingerprintInput: { action: "b" }
    }),
    (error) => error.code === "idempotency_key_conflict"
  );
});

test("requires a new idempotency key after failed operation", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "failed-project");

  await assert.rejects(
    fakeOperation({
      projectsRoot,
      slug: "failed-project",
      idempotencyKey: "failed-key-000001",
      fingerprintInput: { action: "fail" },
      fail: true
    }),
    (error) => error.code === "planned_failure"
  );

  await assert.rejects(
    fakeOperation({
      projectsRoot,
      slug: "failed-project",
      idempotencyKey: "failed-key-000001",
      fingerprintInput: { action: "fail" }
    }),
    (error) => error.code === "operation_retry_requires_new_idempotency_key"
  );
});

test("requires a new idempotency key after interrupted operation", async () => {
  const projectsRoot = createTempProjectsRoot();
  const slug = "interrupted-project";
  createTempProject(projectsRoot, slug);
  const operationId = "op-interrupted";
  const idempotencyKey = "interrupted-key-01";
  const requestFingerprint = computeRequestFingerprint({
    project_slug: slug,
    operation_type: "provision",
    input: { action: "interrupted" }
  });
  const state = getProjectState({ slug, projectsRoot });

  createRequestedOperation({
    slug,
    projectsRoot,
    operationId,
    operationType: "provision",
    idempotencyKeyHash: hashValue(idempotencyKey),
    requestFingerprint
  });
  updateOperation({
    slug,
    projectsRoot,
    operationId,
    patch: {
      status: "running",
      stage: "executing",
      started_at: nowIso()
    }
  });
  fs.mkdirSync(getLockDirectory(state.runtimePath));
  writeLockMetadata(state.runtimePath, {
    schema: "factory_project_operation_lock",
    version: 1,
    operation_id: operationId,
    operation_type: "provision",
    project_slug: slug,
    pid: 99999999,
    process_instance_id: "dead-process",
    acquired_at: "2000-01-01T00:00:00.000Z",
    heartbeat_at: "2000-01-01T00:00:00.000Z"
  });

  await assert.rejects(
    fakeOperation({
      projectsRoot,
      slug,
      idempotencyKey,
      fingerprintInput: { action: "interrupted" }
    }),
    (error) => error.code === "operation_retry_requires_new_idempotency_key"
  );

  const operations = listOperations({ slug, projectsRoot, includeRaw: true });
  const interrupted = operations.find((operation) => operation.operation_id === operationId);
  assert.strictEqual(interrupted.status, "interrupted");
});

test("recovers a stale lock from a dead owner and permits a new key", async () => {
  const projectsRoot = createTempProjectsRoot();
  const slug = "stale-project";
  createTempProject(projectsRoot, slug);
  const operationId = "op-stale";
  const state = getProjectState({ slug, projectsRoot });

  createRequestedOperation({
    slug,
    projectsRoot,
    operationId,
    operationType: "provision",
    idempotencyKeyHash: hashValue("stale-key-old-0001"),
    requestFingerprint: computeRequestFingerprint({
      project_slug: slug,
      operation_type: "provision",
      input: { old: true }
    })
  });
  updateOperation({
    slug,
    projectsRoot,
    operationId,
    patch: {
      status: "running",
      stage: "executing",
      started_at: nowIso()
    }
  });
  fs.mkdirSync(getLockDirectory(state.runtimePath));
  writeLockMetadata(state.runtimePath, {
    schema: "factory_project_operation_lock",
    version: 1,
    operation_id: operationId,
    operation_type: "provision",
    project_slug: slug,
    pid: 99999999,
    process_instance_id: "dead-process",
    acquired_at: "2000-01-01T00:00:00.000Z",
    heartbeat_at: "2000-01-01T00:00:00.000Z"
  });

  const result = await fakeOperation({
    projectsRoot,
    slug,
    idempotencyKey: "stale-key-new-0001",
    fingerprintInput: { old: false }
  });

  assert.strictEqual(result.operation.status, "succeeded");
  const operations = listOperations({ slug, projectsRoot, includeRaw: true });
  assert.strictEqual(operations.find((operation) => operation.operation_id === operationId).status, "interrupted");
});

test("normalizes legacy generation operation records without rewriting them", async () => {
  const projectsRoot = createTempProjectsRoot();
  const slug = "legacy-project";
  createTempProject(projectsRoot, slug);
  const state = getProjectState({ slug, projectsRoot });
  const legacyPath = getOperationPath(state.runtimePath, "legacy-op");
  const legacy = {
    schema: "factory_generation_operation",
    version: 1,
    operation_id: "legacy-op",
    project_slug: slug,
    operation_type: "controlled_generate",
    status: "succeeded",
    requested_at: "2026-01-01T00:00:00.000Z",
    completed_at: "2026-01-01T00:00:01.000Z",
    proof_path: "proofs/generate.json",
    result_summary: { code: "controlled_generate_completed" }
  };
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
  fs.writeFileSync(legacyPath, JSON.stringify(legacy, null, 2));
  const before = fs.readFileSync(legacyPath, "utf8");

  const operations = listOperations({ slug, projectsRoot });
  const normalized = operations.find((operation) => operation.operation_id === "legacy-op");

  assert.strictEqual(normalized.schema, "factory_project_operation");
  assert.strictEqual(normalized.legacy, true);
  assert.strictEqual(fs.readFileSync(legacyPath, "utf8"), before);
});

test("operation records remain parseable after atomic updates", async () => {
  const projectsRoot = createTempProjectsRoot();
  const slug = "integrity-project";
  createTempProject(projectsRoot, slug);

  for (let index = 0; index < 5; index += 1) {
    await fakeOperation({
      projectsRoot,
      slug,
      idempotencyKey: "integrity-key-000" + index,
      fingerprintInput: { index }
    });
  }

  const state = getProjectState({ slug, projectsRoot });
  const operationsDir = path.join(state.runtimePath, "runs", "operations");
  for (const entry of fs.readdirSync(operationsDir)) {
    if (entry.endsWith(".json")) {
      JSON.parse(fs.readFileSync(path.join(operationsDir, entry), "utf8"));
    }
  }
});

test("cross-process lock prevents a competing process from starting", async () => {
  const projectsRoot = createTempProjectsRoot();
  const slug = "cross-process";
  createTempProject(projectsRoot, slug);
  const coordinatorPath = path.resolve(__dirname, "../src/project-operation-coordinator.js");
  const childScript = [
    "const { runProjectOperation } = require(process.argv[1]);",
    "const projectsRoot = process.argv[2];",
    "const slug = process.argv[3];",
    "runProjectOperation({",
    "  projectsRoot,",
    "  slug,",
    "  operationType: 'provision',",
    "  idempotencyKey: 'child-lock-key-001',",
    "  fingerprintInput: { child: true },",
    "  execute: async () => { console.log('running'); await new Promise((resolve) => setTimeout(resolve, 1200)); return { result: { ok: true }, resultSummary: { ok: true } }; }",
    "}).then(() => process.exit(0)).catch((error) => { console.error(error.code || error.message); process.exit(1); });"
  ].join("\n");

  const child = spawn(process.execPath, ["-e", childScript, coordinatorPath, projectsRoot, slug], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("running")) {
        resolve();
      }
    });
    child.on("error", reject);
  });

  await assert.rejects(
    fakeOperation({
      projectsRoot,
      slug,
      idempotencyKey: "parent-lock-key-01",
      fingerprintInput: { parent: true }
    }),
    (error) => error.code === "project_operation_in_progress"
  );

  await new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error("child exited with code " + code));
      }
    });
  });
});
