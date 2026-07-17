"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  classifyLauncherRoute
} = require("../src/http-security");
const {
  createProjectScaffold
} = require("../src/project-store");

let portCounter = 28200;

function createTempProjectsRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-recovery-create-route-"));
}

function createTempProject(projectsRoot, slug) {
  return createProjectScaffold({
    name: slug,
    slug,
    port: portCounter += 1,
    projectsRoot
  });
}

function verifiedCaptureResult(replayed) {
  return {
    idempotentReplay: replayed === true,
    operation: {
      status: "succeeded",
      operation_id: "op-2026-07-17T00-00-00-000Z-test01"
    },
    result: {
      manifest: { status: "verified" },
      summary: {
        verification_state: "verified",
        restorable: true,
        snapshot_id: "snapshot-2026-07-17t00-00-00-000z-abcdef123456"
      }
    }
  };
}

function assertNoUnsafeResponse(value) {
  const text = JSON.stringify(value);
  assert.equal(/[A-Za-z]:[\\/]/.test(text), false);
  assert.equal(/(?:password|Bearer|access_token|MYSQL_PASSWORD)/i.test(text), false);
  assert.equal(/(?:proof|manifest\.json|database\.sql|wordpress\.tar|snapshot-)/i.test(text), false);
  assert.equal(/op-\d{4}/i.test(text), false);
}

async function requestJson(baseUrl, requestPath, options) {
  const requestOptions = Object.assign({}, options || {});
  const method = String(requestOptions.method || "GET").toUpperCase();
  const headers = Object.assign({
    "Content-Type": "application/json"
  }, requestOptions.headers || {});
  if (method !== "GET" && method !== "HEAD" && requestOptions.includeMutationToken !== false) {
    const session = await fetch(baseUrl + "/api/security/session");
    const sessionPayload = await session.json();
    headers.Origin = baseUrl;
    headers["X-Factory-CSRF-Token"] = sessionPayload.csrf_token;
  }
  delete requestOptions.includeMutationToken;
  requestOptions.headers = headers;
  const response = await fetch(baseUrl + requestPath, requestOptions);
  return {
    response,
    body: await response.json()
  };
}

async function withPatchedServer(projectsRoot, createFullStructuralSnapshot, callback) {
  const captureModulePath = require.resolve("../src/structural-snapshot-capture");
  const captureModule = require(captureModulePath);
  const originalCreate = captureModule.createFullStructuralSnapshot;
  captureModule.createFullStructuralSnapshot = createFullStructuralSnapshot;
  const serverModulePath = require.resolve("../src/server");
  delete require.cache[serverModulePath];
  const { createLauncherServer } = require(serverModulePath);
  const port = portCounter += 1;
  const server = createLauncherServer({
    host: "127.0.0.1",
    port,
    projectsRoot
  });
  try {
    const listenInfo = await server.listen();
    return await callback({ baseUrl: "http://127.0.0.1:" + listenInfo.port });
  } finally {
    await server.close().catch(() => {});
    captureModule.createFullStructuralSnapshot = originalCreate;
    delete require.cache[serverModulePath];
  }
}

test("Recovery Point creation route invokes the existing full capture service and returns a safe verified result", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "create-valid");
  const calls = [];

  await withPatchedServer(projectsRoot, async (options) => {
    calls.push(options);
    return verifiedCaptureResult(false);
  }, async ({ baseUrl }) => {
    const result = await requestJson(baseUrl, "/api/projects/create-valid/recovery-points", {
      method: "POST",
      headers: { "Idempotency-Key": "recovery-create-valid-0001" },
      body: JSON.stringify({ confirm_create_recovery_point: true })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, "created");
    assert.deepEqual(result.body.recovery_point, { status: "verified", restorable: true });
    assert.deepEqual(result.body.operation, { status: "succeeded" });
    assert.equal(result.body.idempotent_replay, false);
    assertNoUnsafeResponse(result.body);
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].slug, "create-valid");
  assert.equal(calls[0].projectsRoot, projectsRoot);
  assert.equal(calls[0].idempotencyKey, "recovery-create-valid-0001");
  assert.equal(Object.keys(calls[0]).sort().join(","), "idempotencyKey,projectsRoot,slug");
});

test("Recovery Point creation route requires mutation security and confirmation", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "create-security");
  let calls = 0;

  await withPatchedServer(projectsRoot, async () => {
    calls += 1;
    return verifiedCaptureResult(false);
  }, async ({ baseUrl }) => {
    const unprotected = await requestJson(baseUrl, "/api/projects/create-security/recovery-points", {
      method: "POST",
      includeMutationToken: false,
      body: JSON.stringify({ confirm_create_recovery_point: true })
    });
    assert.equal(unprotected.response.status, 403);
    assert.equal(unprotected.body.code, "origin_not_allowed");

    const unconfirmed = await requestJson(baseUrl, "/api/projects/create-security/recovery-points", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert.equal(unconfirmed.response.status, 400);
    assert.equal(unconfirmed.body.code, "recovery_point_confirmation_required");
    assertNoUnsafeResponse(unconfirmed.body);
  });

  assert.equal(calls, 0);
});

test("Recovery Point creation route rejects unknown projects, invalid slugs, and browser-supplied capture inputs", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "create-inputs");
  let calls = 0;

  await withPatchedServer(projectsRoot, async () => {
    calls += 1;
    return verifiedCaptureResult(false);
  }, async ({ baseUrl }) => {
    const missing = await requestJson(baseUrl, "/api/projects/missing/recovery-points", {
      method: "POST",
      body: JSON.stringify({ confirm_create_recovery_point: true })
    });
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.code, "project_not_found");

    const invalid = await requestJson(baseUrl, "/api/projects/C:%5Ctemp/recovery-points", {
      method: "POST",
      body: JSON.stringify({ confirm_create_recovery_point: true })
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.code, "invalid_project_slug");

    for (const field of ["path", "snapshot_id", "artifact_name", "component_map", "capture_policy"]) {
      const rejected = await requestJson(baseUrl, "/api/projects/create-inputs/recovery-points", {
        method: "POST",
        body: JSON.stringify({
          confirm_create_recovery_point: true,
          [field]: field === "path" ? "C:\\secret\\snapshot" : "browser-value"
        })
      });
      assert.equal(rejected.response.status, 400);
      assert.equal(rejected.body.code, "recovery_point_request_rejected");
      assertNoUnsafeResponse(rejected.body);
    }
  });

  assert.equal(calls, 0);
});

test("Recovery Point creation idempotency replay creates no duplicate and capture failures stay sanitized", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "create-idempotent");
  const completedKeys = new Set();
  let executions = 0;

  await withPatchedServer(projectsRoot, async (options) => {
    if (options.idempotencyKey === "recovery-create-fail-0001") {
      const error = new Error("C:\\secret\\database.sql password Bearer token");
      error.code = "snapshot_db_dump_failed";
      throw error;
    }
    if (completedKeys.has(options.idempotencyKey)) {
      return verifiedCaptureResult(true);
    }
    completedKeys.add(options.idempotencyKey);
    executions += 1;
    return verifiedCaptureResult(false);
  }, async ({ baseUrl }) => {
    const requestBody = JSON.stringify({ confirm_create_recovery_point: true });
    const first = await requestJson(baseUrl, "/api/projects/create-idempotent/recovery-points", {
      method: "POST",
      headers: { "Idempotency-Key": "recovery-create-replay-0001" },
      body: requestBody
    });
    const replay = await requestJson(baseUrl, "/api/projects/create-idempotent/recovery-points", {
      method: "POST",
      headers: { "Idempotency-Key": "recovery-create-replay-0001" },
      body: requestBody
    });
    assert.equal(first.response.status, 200);
    assert.equal(replay.response.status, 200);
    assert.equal(replay.body.status, "replayed");
    assert.equal(replay.body.idempotent_replay, true);

    const failed = await requestJson(baseUrl, "/api/projects/create-idempotent/recovery-points", {
      method: "POST",
      headers: { "Idempotency-Key": "recovery-create-fail-0001" },
      body: requestBody
    });
    assert.equal(failed.response.status, 500);
    assert.equal(failed.body.code, "recovery_point_create_failed");
    assert.match(failed.body.error, /Recovery Point could not be created/);
    assertNoUnsafeResponse(failed.body);
  });

  assert.equal(executions, 1);
});

test("Recovery Point creation stays classified as a mutation while the approved restore flow routes stay explicit", () => {
  const route = classifyLauncherRoute("POST", "/api/projects/create-route/recovery-points");
  assert.ok(route);
  assert.equal(route.id, "recovery_point_create");
  assert.equal(route.group, "mutation");
  assert.equal(route.mutation, true);
  const inventory = classifyLauncherRoute("GET", "/api/projects/create-route/recovery-points");
  assert.ok(inventory);
  assert.equal(inventory.id, "recovery_points_list");
  assert.equal(inventory.mutation, false);
  assert.equal(classifyLauncherRoute("POST", "/api/projects/create-route/recovery-points/restore"), null);
  assert.equal(classifyLauncherRoute("DELETE", "/api/projects/create-route/recovery-points"), null);
});
