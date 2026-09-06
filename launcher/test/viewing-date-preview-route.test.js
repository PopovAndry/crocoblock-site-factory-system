"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createLauncherServer } = require("../src/server");
const { createProjectScaffold } = require("../src/project-store");
const { browserSummary } = require("../src/viewing-date-preview");
let port = 29600;

async function withServer(callback) {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "factory-viewing-date-route-"));
  createProjectScaffold({ name: "CSF ST Viewing Before v1", slug: "csf-st-viewing-before-v1", port: port += 1, projectsRoot });
  const calls = [];
  const server = createLauncherServer({
    host: "127.0.0.1", port: port += 1, projectsRoot, skipRestoreReconciliation: true,
    viewingDatePreviewService: async (input) => { calls.push(["preview", input]); return Object.assign(browserSummary({ classification: { classification: "applicable" }, recovery: { status: "not_prepared" } }), { ok: true, plan_id: "viewing-date-plan-11111111-1111-4111-8111-111111111111" }); },
    viewingDateRecoveryService: async (input) => { calls.push(["recovery", input]); return { ok: true, status: "prepared", summary: browserSummary({ classification: { classification: "applicable" }, recovery: { status: "prepared" } }) }; }
  });
  const info = await server.listen();
  const baseUrl = "http://127.0.0.1:" + info.port;
  try { await callback(baseUrl, calls); } finally { await server.close(); }
}

async function request(baseUrl, pathname, body, protectedRequest) {
  const headers = { "Content-Type": "application/json" };
  if (protectedRequest !== false) {
    const session = await (await fetch(baseUrl + "/api/security/session")).json();
    headers.Origin = baseUrl;
    headers["X-Factory-CSRF-Token"] = session.csrf_token;
  }
  const response = await fetch(baseUrl + pathname, { method: "POST", headers, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}

test("viewing-date routes accept only server-owned profile facts and keep recovery plan-bound", async () => {
  await withServer(async (baseUrl, calls) => {
    const preview = await request(baseUrl, "/api/projects/csf-st-viewing-before-v1/viewing-date/preview", {});
    assert.equal(preview.response.status, 200);
    assert.equal(preview.body.status, "applicable");
    assert.equal(calls.length, 1);
    assert.deepEqual(Object.keys(calls[0][1]).sort(), ["projectsRoot", "slug"]);
    assert.doesNotMatch(JSON.stringify(preview.body), /native|path|blocker|form_id/i);

    const rejected = await request(baseUrl, "/api/projects/csf-st-viewing-before-v1/viewing-date/preview", { form_id: 13 });
    assert.equal(rejected.response.status, 400);
    assert.equal(calls.length, 1);

    const recovery = await request(baseUrl, "/api/projects/csf-st-viewing-before-v1/viewing-date/recovery-point", { plan_id: preview.body.plan_id, confirm_prepare_recovery_point: true });
    assert.equal(recovery.response.status, 200);
    assert.equal(calls[1][0], "recovery");
    assert.deepEqual(Object.keys(calls[1][1]).sort(), ["planId", "projectsRoot", "slug"]);
    assert.match(recovery.body.summary.recovery.byte_verification_notice, /byte-verified/);
    assert.match(recovery.body.summary.recovery.coverage_notice, /full database, WordPress filesystem, and project metadata/);
    assert.match(recovery.body.summary.recovery.row_inspection_notice, /rows were not inspected/);
    assert.match(recovery.body.summary.recovery.restore_notice, /Restore has not been run/);
    assert.doesNotMatch(JSON.stringify(recovery.body), /snapshot_id|plan_id|manifest|sha256|sql|wp_posts|raw_sql/i);
  });
});

test("viewing-date recovery route remains CSRF-protected and rejects browser claims", async () => {
  await withServer(async (baseUrl, calls) => {
    const denied = await request(baseUrl, "/api/projects/csf-st-viewing-before-v1/viewing-date/recovery-point", { plan_id: "viewing-date-plan-11111111-1111-4111-8111-111111111111", confirm_prepare_recovery_point: true }, false);
    assert.equal(denied.response.status, 403);
    const rejected = await request(baseUrl, "/api/projects/csf-st-viewing-before-v1/viewing-date/recovery-point", { plan_id: "viewing-date-plan-11111111-1111-4111-8111-111111111111", confirm_prepare_recovery_point: true, verified: true });
    assert.equal(rejected.response.status, 400);
    assert.equal(calls.length, 0);
  });
});

test("legacy state apply rejects a viewing-date plan identifier before any ST-1 mutation", async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await request(baseUrl, "/api/projects/csf-st-viewing-before-v1/state/apply", {
      plan_id: "viewing-date-plan-11111111-1111-4111-8111-111111111111",
      confirm_apply: true,
      confirm_protected_overwrite: true
    });
    assert.equal(response.response.status >= 400 && response.response.status < 500, true);
    assert.equal(response.body.ok, false);
    assert.equal(calls.length, 0);
    assert.equal(response.body.code, "state_plan_id_invalid");
    assert.equal(response.body.proof_path, null);
    assert.doesNotMatch(JSON.stringify(response.body), /viewing-date-plan|form_id|binding|policy/i);
  });
});
