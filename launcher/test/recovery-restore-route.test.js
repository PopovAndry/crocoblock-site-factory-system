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

let portCounter = 28300;

function createTempProjectsRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-recovery-restore-route-"));
}

function createTempProject(projectsRoot, slug) {
  return createProjectScaffold({
    name: slug,
    slug,
    port: portCounter += 1,
    projectsRoot
  });
}

function restorePlanSummary() {
  return {
    plan_id: "restore-plan-2026-07-17t12-00-00-000z-abcdef",
    recovery_point_label: "Recovery Point",
    recovery_point_created_at: "2026-07-17T10:00:00.000Z",
    readiness: "ready",
    restore_boundary: {
      product_term: "Restore Website",
      restores: ["WordPress database"],
      preserves: ["Current project credentials"]
    },
    warnings: [],
    blockers: [],
    rescue_strategy: "full_required",
    confirmation: {
      required: true,
      mode: "normal",
      phrase: "Restore Website for restore-route",
      warning: null
    },
    impact_summary: {
      action: "Restore Website",
      replaces: ["Managed WordPress database state"],
      preserves: ["Current project credentials"],
      does_not_affect: ["Other Factory projects"],
      expected_temporary_downtime: "The website may be temporarily unavailable while restore execution runs in a later phase."
    },
    snapshot_id: "snapshot-2026-07-17t10-00-00-000z-abcdef123456"
  };
}

function assertNoUnsafeResponse(value) {
  const text = JSON.stringify(value);
  assert.equal(/[A-Za-z]:[\\/]/.test(text), false);
  assert.equal(/(?:password|Bearer|access_token|MYSQL_PASSWORD|manifest\.json|database\.sql|wordpress\.tar|proof)/i.test(text), false);
  assert.equal(/(?:artifact|source_snapshot_id|operation_id)/i.test(text), false);
}

async function requestJson(baseUrl, requestPath, options) {
  const requestOptions = Object.assign({}, options || {});
  const method = String(requestOptions.method || "GET").toUpperCase();
  const headers = Object.assign({ "Content-Type": "application/json" }, requestOptions.headers || {});
  if (method !== "GET" && method !== "HEAD" && requestOptions.includeMutationToken !== false) {
    const session = await fetch(baseUrl + "/api/security/session");
    const sessionPayload = await session.json();
    headers.Origin = baseUrl;
    headers["X-Factory-CSRF-Token"] = sessionPayload.csrf_token;
  }
  delete requestOptions.includeMutationToken;
  requestOptions.headers = headers;
  const response = await fetch(baseUrl + requestPath, requestOptions);
  return { response, body: await response.json() };
}

async function withPatchedServer(projectsRoot, stubs, callback) {
  const patches = [
    { module: require("../src/structural-snapshot-store"), stubs: { listManifests: stubs.listManifests } },
    { module: require("../src/structural-restore-plan"), stubs: { createRestorePlan: stubs.createRestorePlan } },
    { module: require("../src/structural-restore-execution"), stubs: { executeManagedWebsiteRestore: stubs.executeManagedWebsiteRestore } }
  ];
  const originals = [];
  for (const patch of patches) {
    for (const [key, value] of Object.entries(patch.stubs)) {
      if (value) {
        originals.push({ module: patch.module, key, value: patch.module[key] });
        patch.module[key] = value;
      }
    }
  }
  const serverPath = require.resolve("../src/server");
  delete require.cache[serverPath];
  const { createLauncherServer } = require(serverPath);
  const server = createLauncherServer({ host: "127.0.0.1", port: portCounter += 1, projectsRoot });
  try {
    const listenInfo = await server.listen();
    return await callback({ baseUrl: "http://127.0.0.1:" + listenInfo.port });
  } finally {
    await server.close().catch(() => {});
    for (const original of originals) {
      original.module[original.key] = original.value;
    }
    delete require.cache[serverPath];
  }
}

test("restore flow lists only verified points and keeps selection metadata free of paths and artifacts", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "restore-route");
  await withPatchedServer(projectsRoot, {
    listManifests: () => [
      { snapshot_id: "snapshot-2026-07-17t10-00-00-000z-abcdef123456", customer_label: "Recovery Point", created_at: "2026-07-17T10:00:00.000Z", verification_state: "verified", restorable: true },
      { snapshot_id: "snapshot-2026-07-17t11-00-00-000z-fedcba123456", customer_label: "Recovery Point", created_at: "2026-07-17T11:00:00.000Z", verification_state: "pending", restorable: false }
    ]
  }, async ({ baseUrl }) => {
    const result = await requestJson(baseUrl, "/api/projects/restore-route/recovery-points");
    assert.equal(result.response.status, 200);
    assert.equal(result.body.recovery_points.length, 1);
    assert.deepEqual(result.body.recovery_points[0], {
      reference: "snapshot-2026-07-17t10-00-00-000z-abcdef123456",
      label: "Recovery Point",
      created_at: "2026-07-17T10:00:00.000Z",
      status: "verified",
      restorable: true
    });
    assertNoUnsafeResponse(result.body);
  });
});

test("restore plan route is CSRF-protected, passes only server-issued selection input, and returns a narrowed review", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "restore-route");
  const calls = [];
  await withPatchedServer(projectsRoot, {
    createRestorePlan: async (input) => {
      calls.push(input);
      return { idempotentReplay: false, summary: restorePlanSummary() };
    }
  }, async ({ baseUrl }) => {
    const unprotected = await requestJson(baseUrl, "/api/projects/restore-route/recovery-points/snapshot-2026-07-17t10-00-00-000z-abcdef123456/restore-plan", {
      method: "POST",
      includeMutationToken: false,
      body: JSON.stringify({})
    });
    assert.equal(unprotected.response.status, 403);

    const rejected = await requestJson(baseUrl, "/api/projects/restore-route/recovery-points/snapshot-2026-07-17t10-00-00-000z-abcdef123456/restore-plan", {
      method: "POST",
      headers: { "Idempotency-Key": "restore-plan-route-0001" },
      body: JSON.stringify({ artifact_path: "C:\\secret\\database.sql" })
    });
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.body.code, "restore_plan_request_rejected");
    assertNoUnsafeResponse(rejected.body);

    const planned = await requestJson(baseUrl, "/api/projects/restore-route/recovery-points/snapshot-2026-07-17t10-00-00-000z-abcdef123456/restore-plan", {
      method: "POST",
      headers: { "Idempotency-Key": "restore-plan-route-0002" },
      body: JSON.stringify({})
    });
    assert.equal(planned.response.status, 200);
    assert.equal(planned.body.restore_plan.plan_id, "restore-plan-2026-07-17t12-00-00-000z-abcdef");
    assert.equal(Object.prototype.hasOwnProperty.call(planned.body.restore_plan, "snapshot_id"), false);
    assertNoUnsafeResponse(planned.body);
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["idempotencyKey", "projectsRoot", "slug", "snapshotId"]);
});

test("restore execution accepts only a reviewed plan and exact confirmation, then returns a terminal safe result", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "restore-route");
  const calls = [];
  await withPatchedServer(projectsRoot, {
    executeManagedWebsiteRestore: async (input) => {
      calls.push(input);
      return {
        idempotentReplay: false,
        operation: {
          status: "succeeded",
          result_summary: { status: "succeeded", restore_verified: true, manual_recovery_required: false }
        }
      };
    }
  }, async ({ baseUrl }) => {
    const rejected = await requestJson(baseUrl, "/api/projects/restore-route/restore/execute", {
      method: "POST",
      headers: { "Idempotency-Key": "restore-execute-route-0001" },
      body: JSON.stringify({ plan_id: "restore-plan-2026-07-17t12-00-00-000z-abcdef", exact_confirmation: "Restore Website for restore-route", force: true })
    });
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.body.code, "restore_execution_request_rejected");
    assertNoUnsafeResponse(rejected.body);

    const complete = await requestJson(baseUrl, "/api/projects/restore-route/restore/execute", {
      method: "POST",
      headers: { "Idempotency-Key": "restore-execute-route-0002" },
      body: JSON.stringify({ plan_id: "restore-plan-2026-07-17t12-00-00-000z-abcdef", exact_confirmation: "Restore Website for restore-route" })
    });
    assert.equal(complete.response.status, 200);
    assert.deepEqual(complete.body.restore, { status: "succeeded", verified: true, manual_recovery_required: false });
    assertNoUnsafeResponse(complete.body);
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["exactConfirmation", "idempotencyKey", "planId", "projectSlug", "projectsRoot"]);
});

test("restore execution reports manual recovery as attention-required rather than a completed restore", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "restore-route");
  await withPatchedServer(projectsRoot, {
    executeManagedWebsiteRestore: async () => {
      const error = new Error("C:\\secret\\restore-journal.json password");
      error.code = "restore_execution_failed";
      error.manualRecoveryRequired = true;
      error.result_summary = { manual_recovery_required: true };
      throw error;
    }
  }, async ({ baseUrl }) => {
    const result = await requestJson(baseUrl, "/api/projects/restore-route/restore/execute", {
      method: "POST",
      headers: { "Idempotency-Key": "restore-execute-route-0003" },
      body: JSON.stringify({ plan_id: "restore-plan-2026-07-17t12-00-00-000z-abcdef", exact_confirmation: "Restore Website for restore-route" })
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.code, "restore_recovery_required");
    assert.equal(result.body.status, "recovery_requires_attention");
    assert.deepEqual(result.body.recovery, { manual_recovery_required: true });
    assertNoUnsafeResponse(result.body);
  });
});

test("restore flow routes are accurately inventoried and unknown projects fail safely", async () => {
  const projectsRoot = createTempProjectsRoot();
  await withPatchedServer(projectsRoot, {}, async ({ baseUrl }) => {
    const missing = await requestJson(baseUrl, "/api/projects/missing/recovery-points");
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.code, "project_not_found");
    assertNoUnsafeResponse(missing.body);
  });
  assert.equal(classifyLauncherRoute("GET", "/api/projects/restore-route/recovery-points").id, "recovery_points_list");
  assert.equal(classifyLauncherRoute("POST", "/api/projects/restore-route/recovery-points/snapshot-2026-07-17t10-00-00-000z-abcdef123456/restore-plan").id, "restore_plan_create");
  assert.equal(classifyLauncherRoute("POST", "/api/projects/restore-route/restore/execute").id, "restore_execute");
  assert.equal(classifyLauncherRoute("DELETE", "/api/projects/restore-route/restore/execute"), null);
});
