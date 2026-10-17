"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createLauncherServer } = require("../src/server");
const { createProjectScaffold } = require("../src/project-store");
const { classifyLauncherRoute } = require("../src/http-security");
const { RESTORE_HANDLE, assertConfirmation } = require("../src/property-area-range-restore");

const PLAN_ID = "property-area-range-plan-11111111-1111-4111-8111-111111111111";
const OTHER_PLAN_ID = "property-area-range-plan-22222222-2222-4222-8222-222222222222";
const SNAPSHOT_ID = "snapshot-2026-10-08t12-00-00-000z-abcdef123456";
const APPLY_ID = "op-2026-10-08T12-00-00-000Z-aabbcc";
const PREVIEW_SUMMARY = Object.freeze({
  schema_version: 1,
  change: Object.freeze({
    title: "Add an optional Property area range",
    archive: "/properties/",
    unit: "sq m",
    behavior: "Inclusive minimum and maximum bounds."
  }),
  observed: Object.freeze({ published_property_count: 30 }),
  preservation: Object.freeze([
    "Property data is not changed.",
    "Existing archive filters, sorting, pagination, cards, count, and default results stay unchanged until a later transaction."
  ]),
  boundary: "This Preview has not applied the change and does not verify Recovery, Restore, or Proof Gate."
});
let port = 35100;

function serviceError(code, statusCode) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function previewResult() {
  return { status: "prepared_for_recovery", plan_id: PLAN_ID, browser_summary: JSON.parse(JSON.stringify(PREVIEW_SUMMARY)) };
}

async function withServer(callback, overrides) {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "factory-property-area-range-route-"));
  createProjectScaffold({ name: "Area Route", slug: "area-route", port: port += 1, projectsRoot });
  createProjectScaffold({ name: "Other Area Route", slug: "other-area-route", port: port += 1, projectsRoot });
  const calls = [];
  const restoreBoundary = { invoked: 0, confirmationAccepted: 0, sideEffects: 0 };
  const server = createLauncherServer({
    host: "127.0.0.1", port: port += 1, projectsRoot, skipRestoreReconciliation: true,
    propertyAreaRangePreviewService: async (input) => {
      calls.push(["preview", input]);
      return overrides && overrides.previewResult ? overrides.previewResult(input) : previewResult();
    },
    propertyAreaRangeRecoveryService: async (input) => {
      calls.push(["recovery", input]);
      if (input.planId !== PLAN_ID || input.slug !== "area-route") throw serviceError("property_area_range_plan_missing", 409);
      if (overrides && overrides.recoveryResult) return overrides.recoveryResult(input);
      return { status: "prepared", snapshot_id: SNAPSHOT_ID };
    },
    propertyAreaRangeApplyService: async (input) => {
      calls.push(["apply", input]);
      if (input.planId !== PLAN_ID) throw serviceError("property_area_range_apply_recovery_stale", 409);
      if (overrides && overrides.applyResult) return overrides.applyResult(input);
      if (input.idempotencyKey === "in-progress") throw serviceError("project_operation_in_progress", 409);
      if (input.idempotencyKey === "different-key") throw serviceError("idempotency_key_conflict", 409);
      if (input.idempotencyKey === "failed-terminal") throw serviceError("property_area_range_apply_prior_attempt_terminal", 409);
      return { status: "applied", mutation_performed: true, plan_id: PLAN_ID, snapshot_id: SNAPSHOT_ID, operation_id: APPLY_ID };
    },
    propertyAreaRangeRestoreService: async (input) => {
      calls.push(["restore", input]);
      restoreBoundary.invoked += 1;
      assertConfirmation({
        authority: {
          plan: { plan_id: input.slug === "area-route" ? PLAN_ID : OTHER_PLAN_ID },
          recovery: { snapshot_id: SNAPSHOT_ID }
        },
        apply: { operation_id: APPLY_ID }
      }, input.confirmation);
      restoreBoundary.confirmationAccepted += 1;
      if (input.idempotencyKey === "failed-terminal") throw serviceError("property_area_range_restore_prior_attempt_terminal", 409);
      restoreBoundary.sideEffects += 1;
      return { status: "restored", mutation_performed: true };
    }
  });
  const info = await server.listen();
  try { await callback("http://127.0.0.1:" + info.port, calls, projectsRoot, restoreBoundary); } finally { await server.close(); }
}

async function request(baseUrl, pathname, body, idempotencyKey) {
  const session = await (await fetch(baseUrl + "/api/security/session")).json();
  const headers = { "Content-Type": "application/json", Origin: baseUrl, "X-Factory-CSRF-Token": session.csrf_token };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(baseUrl + pathname, { method: "POST", headers, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}

function endpoint(slug, name) { return "/api/projects/" + slug + "/property-area-range/" + name; }

test("Property Area Range routes accept only the exact server-owned lineage", async () => {
  await withServer(async (baseUrl, calls, _projectsRoot, restoreBoundary) => {
    const preview = await request(baseUrl, endpoint("area-route", "preview"), {});
    assert.deepEqual(preview.body, { ok: true, status: "prepared_for_recovery", plan_id: PLAN_ID, summary: PREVIEW_SUMMARY });
    assert.doesNotMatch(JSON.stringify(preview.body.summary), /plan_id|project_id|operation_id|snapshot|sha256|path|sql/i);

    const recovery = await request(baseUrl, endpoint("area-route", "recovery-point"), { plan_id: PLAN_ID, confirm_prepare_recovery_point: true });
    assert.deepEqual(recovery.body, { ok: true, status: "prepared", snapshot_id: SNAPSHOT_ID });

    const apply = await request(baseUrl, endpoint("area-route", "apply"), { plan_id: PLAN_ID, confirm_apply: true }, "apply-key");
    assert.deepEqual(apply.body, { ok: true, status: "applied", mutation_performed: true, lineage: { plan_id: PLAN_ID, snapshot_id: SNAPSHOT_ID, apply_operation_id: APPLY_ID } });

    const restore = await request(baseUrl, endpoint("area-route", "restore"), {
      restore_handle: RESTORE_HANDLE, confirm_restore: true, plan_id: PLAN_ID, snapshot_id: SNAPSHOT_ID, apply_operation_id: APPLY_ID
    }, "restore-key");
    assert.deepEqual(restore.body, { ok: true, status: "restored", mutation_performed: true });
    assert.deepEqual(calls.map(([name]) => name), ["preview", "recovery", "apply", "restore"]);
    assert.deepEqual(Object.keys(calls[0][1]).sort(), ["projectsRoot", "slug"]);
    assert.deepEqual(Object.keys(calls[1][1]).sort(), ["planId", "projectsRoot", "slug"]);
    assert.deepEqual(Object.keys(calls[2][1]).sort(), ["idempotencyKey", "planId", "projectsRoot", "slug"]);
    assert.deepEqual(Object.keys(calls[3][1]).sort(), ["confirmation", "idempotencyKey", "projectsRoot", "slug"]);
    assert.deepEqual(calls[3][1].confirmation, { plan_id: PLAN_ID, snapshot_id: SNAPSHOT_ID, apply_operation_id: APPLY_ID });
    assert.deepEqual(restoreBoundary, { invoked: 1, confirmationAccepted: 1, sideEffects: 1 });
  });
});

test("Property Area Range Preview route fails closed for malformed, stale, and failed presentation results", async () => {
  const cases = [
    ["malformed", () => ({ status: "prepared_for_recovery", plan_id: PLAN_ID, browser_summary: { schema_version: 1 } }), 500],
    ["stale", () => { throw serviceError("property_area_range_baseline_drift", 409); }, 409],
    ["failed", () => { throw new Error("unexpected preview failure"); }, 500]
  ];
  for (const [_name, previewResultOverride, expectedStatus] of cases) {
    await withServer(async (baseUrl, calls) => {
      const result = await request(baseUrl, endpoint("area-route", "preview"), {});
      assert.equal(result.response.status, expectedStatus);
      assert.deepEqual(result.body, {
        ok: false,
        status: "blocked",
        error: expectedStatus >= 500 ? "Property Area Range is temporarily unavailable." : "Property Area Range cannot proceed safely.",
        message: expectedStatus >= 500 ? "Property Area Range is temporarily unavailable." : "Property Area Range cannot proceed safely."
      });
      assert.equal(calls.length, 1);
    }, { previewResult: previewResultOverride });
  }
});

test("Property Area Range Recovery route fails closed before it can present an unverified recovery", async () => {
  const cases = [
    () => ({ status: "prepared", snapshot_id: "not-a-snapshot" }),
    () => ({ status: "captured", snapshot_id: SNAPSHOT_ID }),
    () => ({ status: "prepared" })
  ];
  for (const recoveryResult of cases) {
    await withServer(async (baseUrl, calls) => {
      const result = await request(baseUrl, endpoint("area-route", "recovery-point"), { plan_id: PLAN_ID, confirm_prepare_recovery_point: true });
      assert.equal(result.response.status, 500);
      assert.deepEqual(result.body, {
        ok: false,
        status: "blocked",
        error: "Property Area Range is temporarily unavailable.",
        message: "Property Area Range is temporarily unavailable."
      });
      assert.deepEqual(calls.map(([name]) => name), ["recovery"]);
    }, { recoveryResult });
  }
});

test("Property Area Range Apply route fails closed for non-authoritative observed status", async () => {
  const cases = [
    () => ({ status: "applied", mutation_performed: false, plan_id: PLAN_ID, snapshot_id: SNAPSHOT_ID, operation_id: APPLY_ID }),
    () => ({ status: "already_applied", mutation_performed: true, plan_id: PLAN_ID, snapshot_id: SNAPSHOT_ID, operation_id: APPLY_ID }),
    () => ({ status: "interrupted", mutation_performed: false, plan_id: PLAN_ID, snapshot_id: SNAPSHOT_ID, operation_id: APPLY_ID })
  ];
  for (const applyResult of cases) {
    await withServer(async (baseUrl, calls) => {
      const result = await request(baseUrl, endpoint("area-route", "apply"), { plan_id: PLAN_ID, confirm_apply: true }, "response-invalid");
      assert.equal(result.response.status, 500);
      assert.deepEqual(result.body, {
        ok: false,
        status: "blocked",
        error: "Property Area Range is temporarily unavailable.",
        message: "Property Area Range is temporarily unavailable."
      });
      assert.deepEqual(calls.map(([name]) => name), ["apply"]);
    }, { applyResult });
  }
});

test("Property Area Range routes reject injected profile, schema, option, evidence, and project authority before dispatch", async () => {
  await withServer(async (baseUrl, calls, _projectsRoot, restoreBoundary) => {
    const cases = [
      ["preview", { profile: "viewing_date" }],
      ["recovery-point", { plan_id: PLAN_ID, confirm_prepare_recovery_point: true, schema: 1 }],
      ["apply", { plan_id: PLAN_ID, confirm_apply: true, option_value: { state: "enabled" } }],
      ["restore", { restore_handle: RESTORE_HANDLE, confirm_restore: true, plan_id: PLAN_ID, snapshot_id: SNAPSHOT_ID, apply_operation_id: APPLY_ID, evidence: {} }],
      ["restore", { restore_handle: RESTORE_HANDLE, confirm_restore: true, plan_id: PLAN_ID, snapshot_id: SNAPSHOT_ID, apply_operation_id: APPLY_ID, project_id: "other" }]
    ];
    for (const [name, body] of cases) {
      const result = await request(baseUrl, endpoint("area-route", name), body, "inject-" + name);
      assert.equal(result.response.status, 400);
      assert.equal(result.body.status, "blocked");
      assert.doesNotMatch(JSON.stringify(result.body), /profile|schema|option|evidence|project_id|snapshot_id|apply_operation_id/i);
    }
    assert.equal(calls.length, 0);
    assert.deepEqual(restoreBoundary, { invoked: 0, confirmationAccepted: 0, sideEffects: 0 });
  });
});

test("Property Area Range Restore route rejects malformed, stale, cross-project, and camelCase lineage before side effects", async () => {
  await withServer(async (baseUrl, calls, _projectsRoot, restoreBoundary) => {
    const valid = { restore_handle: RESTORE_HANDLE, confirm_restore: true, plan_id: PLAN_ID, snapshot_id: SNAPSHOT_ID, apply_operation_id: APPLY_ID };
    const cases = [
      ["missing", endpoint("area-route", "restore"), { restore_handle: RESTORE_HANDLE, confirm_restore: true, plan_id: PLAN_ID, snapshot_id: SNAPSHOT_ID }],
      ["camelCase", endpoint("area-route", "restore"), { restore_handle: RESTORE_HANDLE, confirm_restore: true, planId: PLAN_ID, snapshot_id: SNAPSHOT_ID, apply_operation_id: APPLY_ID }],
      ["stale", endpoint("area-route", "restore"), Object.assign({}, valid, { plan_id: OTHER_PLAN_ID })],
      ["cross-project", endpoint("other-area-route", "restore"), valid]
    ];
    for (const [_name, route, body] of cases) {
      const result = await request(baseUrl, route, body, "restore-reject-" + _name);
      assert.equal(result.response.status, 400);
      assert.equal(result.body.status, "blocked");
      assert.doesNotMatch(JSON.stringify(result.body), /plan_id|snapshot_id|operation_id|proof|path|evidence/i);
    }
    assert.deepEqual(calls.map(([name]) => name), ["restore", "restore"]);
    assert.deepEqual(restoreBoundary, { invoked: 2, confirmationAccepted: 0, sideEffects: 0 });
  });
});

test("Property Area Range routes preserve cross-project, stale, concurrent, different-key, and terminal failures", async () => {
  await withServer(async (baseUrl, calls) => {
    const stale = await request(baseUrl, endpoint("area-route", "apply"), { plan_id: OTHER_PLAN_ID, confirm_apply: true }, "stale-key");
    const crossProject = await request(baseUrl, endpoint("other-area-route", "recovery-point"), { plan_id: PLAN_ID, confirm_prepare_recovery_point: true }, "cross-key");
    const concurrent = await request(baseUrl, endpoint("area-route", "apply"), { plan_id: PLAN_ID, confirm_apply: true }, "in-progress");
    const differentKey = await request(baseUrl, endpoint("area-route", "apply"), { plan_id: PLAN_ID, confirm_apply: true }, "different-key");
    const terminal = await request(baseUrl, endpoint("area-route", "restore"), { restore_handle: RESTORE_HANDLE, confirm_restore: true, plan_id: PLAN_ID, snapshot_id: SNAPSHOT_ID, apply_operation_id: APPLY_ID }, "failed-terminal");
    for (const result of [stale, crossProject, concurrent, differentKey, terminal]) {
      assert.equal(result.response.status, 409);
      assert.equal(result.body.status, "blocked");
      assert.doesNotMatch(JSON.stringify(result.body), /plan_id|snapshot_id|operation_id|proof|path|evidence/i);
    }
    assert.deepEqual(calls.map(([name]) => name), ["apply", "recovery", "apply", "apply", "restore"]);
  });
});

test("Property Area Range routes remain explicit mutation boundaries", () => {
  assert.equal(classifyLauncherRoute("POST", endpoint("area-route", "preview")).id, "property_area_range_preview");
  assert.equal(classifyLauncherRoute("POST", endpoint("area-route", "recovery-point")).id, "property_area_range_recovery_prepare");
  assert.equal(classifyLauncherRoute("POST", endpoint("area-route", "apply")).id, "property_area_range_apply");
  assert.equal(classifyLauncherRoute("POST", endpoint("area-route", "restore")).id, "property_area_range_restore");
});

test("generic Restore cannot bypass a persisted Property Area Range plan", async () => {
  await withServer(async (baseUrl, _calls, projectsRoot) => {
    const planPath = path.join(projectsRoot, "area-route", "proofs", "property-area-range-preview-v1", "plans", PLAN_ID + ".json");
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, "{}\n", "utf8");
    const planResult = await request(baseUrl, "/api/projects/area-route/recovery-points/" + SNAPSHOT_ID + "/restore-plan", {});
    const executeResult = await request(baseUrl, "/api/projects/area-route/restore/execute", { plan_id: "restore-plan-2026-10-08t12-00-00-000z-abcdef", exact_confirmation: "Restore Website for area-route" });
    for (const result of [planResult, executeResult]) {
      assert.equal(result.response.status, 409);
      assert.equal(result.body.code, "property_area_range_restore_required");
    }
  });
});
