"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { classifyLauncherRoute } = require("../src/http-security");
const { RESTORE_HANDLE } = require("../src/viewing-date-restore");
const { createProjectScaffold } = require("../src/project-store");

let port = 32200;

async function requestJson(baseUrl, requestPath, options) {
  const requestOptions = Object.assign({}, options || {});
  const headers = Object.assign({ "Content-Type": "application/json" }, requestOptions.headers || {});
  if (requestOptions.includeToken !== false) {
    const session = await fetch(baseUrl + "/api/security/session");
    const data = await session.json();
    headers.Origin = baseUrl;
    headers["X-Factory-CSRF-Token"] = data.csrf_token;
  }
  delete requestOptions.includeToken;
  requestOptions.headers = headers;
  const response = await fetch(baseUrl + requestPath, requestOptions);
  return { response, body: await response.json() };
}

async function withServer(stubs, callback) {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "factory-viewing-date-restore-route-"));
  createProjectScaffold({ name: "CSF ST Viewing Before v1", slug: "csf-st-viewing-before-v1", port: port += 1, projectsRoot });
  const restoreModule = require("../src/viewing-date-restore");
  const restorePlanModule = require("../src/structural-restore-plan");
  const originalRestore = restoreModule.restoreViewingDate;
  const originalPlan = restorePlanModule.createRestorePlan;
  restoreModule.restoreViewingDate = stubs.restoreViewingDate || originalRestore;
  restorePlanModule.createRestorePlan = stubs.createRestorePlan || originalPlan;
  const serverPath = require.resolve("../src/server");
  delete require.cache[serverPath];
  const { createLauncherServer } = require(serverPath);
  const server = createLauncherServer({ host: "127.0.0.1", port: port += 1, projectsRoot });
  try {
    const info = await server.listen();
    return await callback({ baseUrl: "http://127.0.0.1:" + info.port, projectsRoot });
  } finally {
    await server.close().catch(() => {});
    restoreModule.restoreViewingDate = originalRestore;
    restorePlanModule.createRestorePlan = originalPlan;
    delete require.cache[serverPath];
  }
}

test("same-project Restore route is loopback/CSRF protected, has a strict body, and does not reveal internal authority", async () => {
  const calls = [];
  await withServer({
    restoreViewingDate: async (input) => {
      calls.push(input);
      return { status: "restored", mutation_performed: true, snapshot_id: "must-not-leak" };
    }
  }, async ({ baseUrl }) => {
    const endpoint = "/api/projects/csf-st-viewing-before-v1/viewing-date/restore";
    const unprotected = await requestJson(baseUrl, endpoint, { method: "POST", includeToken: false, body: JSON.stringify({ restore_handle: RESTORE_HANDLE, confirm_restore: true }) });
    assert.equal(unprotected.response.status, 403);
    const rejected = await requestJson(baseUrl, endpoint, { method: "POST", body: JSON.stringify({ restore_handle: "browser-controlled", confirm_restore: true }) });
    assert.equal(rejected.response.status, 400);
    const authorityInjection = await requestJson(baseUrl, endpoint, { method: "POST", body: JSON.stringify({ restore_handle: RESTORE_HANDLE, confirm_restore: true, agentAuthorityMode: "verify_existing" }) });
    assert.equal(authorityInjection.response.status, 400);
    const accepted = await requestJson(baseUrl, endpoint, { method: "POST", headers: { "Idempotency-Key": "viewing-date-restore-route-key" }, body: JSON.stringify({ restore_handle: RESTORE_HANDLE, confirm_restore: true }) });
    assert.equal(accepted.response.status, 200);
    assert.deepEqual(accepted.body, { ok: true, status: "restored", mutation_performed: true });
    assert.equal(JSON.stringify(accepted.body).includes("must-not-leak"), false);
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["idempotencyKey", "projectsRoot", "slug"]);
});

test("generic Restore endpoints cannot bypass the same-project guard", async () => {
  let genericPlans = 0;
  await withServer({
    createRestorePlan: async () => { genericPlans += 1; throw new Error("generic plan must not run"); }
  }, async ({ baseUrl }) => {
    const result = await requestJson(baseUrl, "/api/projects/csf-st-viewing-before-v1/recovery-points/snapshot-2026-09-04t07-33-05-548z-cc33fa13cbce/restore-plan", { method: "POST", body: JSON.stringify({}) });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.status, "error");
  });
  assert.equal(genericPlans, 0);
  assert.equal(classifyLauncherRoute("POST", "/api/projects/csf-st-viewing-before-v1/viewing-date/restore").id, "viewing_date_restore");
});
