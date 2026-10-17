"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createLauncherServer } = require("../src/server");
const { createProjectScaffold } = require("../src/project-store");
const { runProjectOperation } = require("../src/project-operation-coordinator");
const { browserSummary } = require("../src/property-area-range-preview");

const PLAN_ID = "property-area-range-plan-11111111-1111-4111-8111-111111111111";
let port = 35300;

class FakeElement {
  constructor() {
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.className = "";
    this.dataset = {};
    this.elements = {};
  }

  addEventListener() {}
  setAttribute() {}
  getAttribute() { return null; }
  querySelector() { return null; }
  closest() { return null; }
}

function createUiHarness(baseUrl, options) {
  const elements = new Map();
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, new FakeElement());
    return elements.get(id);
  };
  getElementById("create-project-form").elements = {
    name: new FakeElement(), slug: new FakeElement(), port: new FakeElement()
  };
  getElementById("generate-project-slug").value = "area-route";
  const window = {
    FactoryLauncherConfig: { testMode: true, skipInitialLoad: true },
    FactoryLauncherTestHooks: {},
    FactoryProjectSummaryCounts: null,
    location: { origin: baseUrl },
    localStorage: { getItem: () => null, setItem: () => {} },
    matchMedia: () => ({ matches: false }),
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000000" },
    setTimeout,
    clearTimeout
  };
  window.window = window;
  const context = {
    window,
    document: { documentElement: { dataset: {} }, getElementById, querySelectorAll: () => [] },
    console,
    fetch: async (url, requestOptionsInput) => {
      const requestOptions = Object.assign({}, requestOptionsInput || {});
      const headers = new Headers(requestOptions.headers || {});
      if (String(requestOptions.method || "GET").toUpperCase() !== "GET") headers.set("Origin", baseUrl);
      requestOptions.headers = headers;
      const target = new URL(url, baseUrl);
      const response = await fetch(target, requestOptions);
      if (options && options.interruptApplyResponse === true
        && String(requestOptions.method || "GET").toUpperCase() === "POST"
        && target.pathname.endsWith("/property-area-range/apply")) {
        throw new TypeError("simulated browser response interruption");
      }
      return response;
    },
    AbortController,
    Headers,
    FormData: class FormData {},
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../src/ui/app.js"), "utf8"), context, { filename: "launcher/src/ui/app.js" });
  return {
    hooks: window.FactoryLauncherTestHooks.propertyAreaRangePreview,
    result: getElementById("property-area-range-preview-result"),
    recoveryButton: getElementById("property-area-range-recovery-button"),
    applyConfirmation: getElementById("property-area-range-apply-confirmation"),
    applyButton: getElementById("property-area-range-apply-button")
  };
}

function error(statusCode) {
  const value = new Error("preview unavailable");
  value.statusCode = statusCode;
  return value;
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for the test route dispatch");
}

function recoveryResult() {
  return { status: "prepared", snapshot_id: "snapshot-2026-10-17t12-00-00-000z-abcdef123456" };
}

function applyResult() {
  return {
    status: "applied",
    mutation_performed: true,
    plan_id: PLAN_ID,
    snapshot_id: recoveryResult().snapshot_id,
    operation_id: "op-2026-10-17T12-00-00-000Z-aabbcc"
  };
}

async function withServer(services, callback) {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "factory-property-area-range-ui-"));
  createProjectScaffold({ name: "Area UI", slug: "area-route", port: port += 1, projectsRoot });
  const calls = [];
  const server = createLauncherServer({
    host: "127.0.0.1",
    port: port += 1,
    projectsRoot,
    skipRestoreReconciliation: true,
    propertyAreaRangePreviewService: async (input) => {
      calls.push(["preview", input]);
      return services && services.preview ? services.preview(input) : {
        status: "prepared_for_recovery",
        plan_id: PLAN_ID,
        browser_summary: browserSummary({ baseline: { property_count: 30 } })
      };
    },
    propertyAreaRangeRecoveryService: async (input) => {
      calls.push(["recovery", input]);
      return services && services.recovery ? services.recovery(input) : recoveryResult();
    },
    propertyAreaRangeApplyService: async (input) => {
      calls.push(["apply", input]);
      return services && services.apply ? services.apply(input) : applyResult();
    }
  });
  const info = await server.listen();
  try {
    await callback("http://127.0.0.1:" + info.port, calls, projectsRoot);
  } finally {
    await server.close();
  }
}

test("Property Area Range UI uses exact Preview, verified Recovery, explicit confirmation, and observed Apply status", async () => {
  await withServer(null, async (baseUrl, calls) => {
    const { hooks, result, recoveryButton, applyConfirmation, applyButton } = createUiHarness(baseUrl);
    await hooks.preview();
    assert.match(result.innerHTML, /Property area range Preview is ready/);
    assert.match(result.innerHTML, /optional Property area range/);
    assert.match(result.innerHTML, /30 published Properties were checked/);
    assert.match(result.innerHTML, /Existing archive filters, sorting, pagination, cards, count, and default results/);
    assert.match(result.innerHTML, /has not applied the change/);
    assert.match(result.innerHTML, /Prepare a verified Recovery Point before Apply/);
    assert.equal(recoveryButton.hidden, false);
    assert.equal(applyButton.hidden, true);
    await hooks.prepareRecovery();
    assert.match(result.innerHTML, /verified V3 Recovery Point is prepared/);
    assert.equal(recoveryButton.hidden, true);
    assert.equal(applyButton.hidden, false);
    assert.equal(applyButton.disabled, true);
    hooks.setApplyConfirmed(true);
    assert.equal(applyConfirmation.checked, true);
    assert.equal(applyButton.disabled, false);
    await hooks.apply();
    assert.match(result.innerHTML, /Observed Apply status: Applied/);
    assert.doesNotMatch(result.innerHTML, /Proof Gate PASS|Restore was successful|Restored/i);
    assert.deepEqual(calls.map(([name]) => name), ["preview", "recovery", "apply"]);
    assert.deepEqual(Object.keys(calls[1][1]).sort(), ["planId", "projectsRoot", "slug"]);
    assert.deepEqual(Object.keys(calls[2][1]).sort(), ["idempotencyKey", "planId", "projectsRoot", "slug"]);
  });
});

test("Property Area Range Preview UI fails closed for malformed, stale, and failed route responses", async () => {
  const cases = [
    async () => ({ status: "prepared_for_recovery", plan_id: PLAN_ID, browser_summary: { schema_version: 1 } }),
    async () => { throw error(409); },
    async () => { throw error(500); }
  ];
  for (const preview of cases) {
    await withServer({ preview }, async (baseUrl) => {
      const { hooks, result } = createUiHarness(baseUrl);
      await hooks.preview();
      assert.equal(result.textContent, "Property Area Range Preview cannot be prepared safely.");
      assert.equal(result.className, "result-box result-box-error");
      assert.doesNotMatch(result.textContent, /plan|snapshot|operation|proof|path|sql/i);
    });
  }
});

test("Property Area Range UI fails closed after Recovery or Apply failures", async () => {
  await withServer({ recovery: async () => { throw error(409); } }, async (baseUrl, calls) => {
    const { hooks, result, applyButton } = createUiHarness(baseUrl);
    await hooks.preview();
    await hooks.prepareRecovery();
    assert.equal(result.textContent, "Verified Recovery preparation did not complete. Apply remains unavailable.");
    assert.equal(applyButton.hidden, true);
    await hooks.apply();
    assert.deepEqual(calls.map(([name]) => name), ["preview", "recovery"]);
  });
  await withServer({ apply: async () => { throw error(409); } }, async (baseUrl, calls) => {
    const { hooks, result, applyButton } = createUiHarness(baseUrl);
    await hooks.preview();
    await hooks.prepareRecovery();
    hooks.setApplyConfirmed(true);
    await hooks.apply();
    assert.equal(result.textContent, "Apply did not complete. This UI will not send another Apply request.");
    assert.equal(applyButton.hidden, true);
    await hooks.apply();
    assert.deepEqual(calls.map(([name]) => name), ["preview", "recovery", "apply"]);
  });
});

test("Property Area Range UI ignores stale and interrupted progress without a second Apply", async () => {
  let releasePreview;
  await withServer({
    preview: async () => await new Promise((resolve) => { releasePreview = resolve; })
  }, async (baseUrl, calls) => {
    const { hooks, result } = createUiHarness(baseUrl);
    const pending = hooks.preview();
    await waitFor(() => typeof releasePreview === "function");
    hooks.resetForProject("other-area-route");
    releasePreview({ status: "prepared_for_recovery", plan_id: PLAN_ID, browser_summary: browserSummary({ baseline: { property_count: 30 } }) });
    await pending;
    assert.equal(result.hidden, true);
    assert.equal(hooks.getState().phase, "idle");
    assert.deepEqual(calls.map(([name]) => name), ["preview"]);
  });

  let releaseApply;
  let enteredNativeApply = false;
  await withServer({
    apply: async (input) => {
      let operationId = "";
      const outcome = await runProjectOperation({
        projectsRoot: input.projectsRoot,
        slug: input.slug,
        operationType: "property_area_range_apply",
        idempotencyKey: input.idempotencyKey,
        fingerprintInput: { plan_id: PLAN_ID, snapshot_id: recoveryResult().snapshot_id },
        metadata: {
          plan_id: PLAN_ID,
          recovery_snapshot_id: recoveryResult().snapshot_id
        },
        safety: { apply_used: true },
        execute: async ({ operationId: currentOperationId, setStage }) => {
          operationId = currentOperationId;
          await setStage("applying");
          enteredNativeApply = true;
          await new Promise((resolve) => { releaseApply = resolve; });
          return { result: { status: "applied", mutation_performed: true }, resultSummary: {} };
        }
      });
      return Object.assign({}, outcome.result, {
        plan_id: PLAN_ID,
        snapshot_id: recoveryResult().snapshot_id,
        operation_id: operationId
      });
    }
  }, async (baseUrl, calls) => {
    const { hooks, result } = createUiHarness(baseUrl);
    await hooks.preview();
    await hooks.prepareRecovery();
    hooks.setApplyConfirmed(true);
    const first = hooks.apply();
    const second = hooks.apply();
    try {
      await waitFor(() => enteredNativeApply && typeof releaseApply === "function" && /Observed Apply progress: Applying/.test(result.innerHTML));
      assert.equal(hooks.getState().phase, "applying");
      assert.deepEqual(calls.map(([name]) => name), ["preview", "recovery", "apply"]);
      hooks.resetForProject("other-area-route");
      releaseApply(applyResult());
      await Promise.all([first, second]);
      assert.equal(result.hidden, true);
      assert.equal(hooks.getState().phase, "idle");
      assert.deepEqual(calls.map(([name]) => name), ["preview", "recovery", "apply"]);
    } finally {
      if (typeof releaseApply === "function") releaseApply(applyResult());
    }
  });
});

test("Property Area Range UI treats an interrupted Apply response as persisted observation, not terminal success", async () => {
  await withServer({
    apply: async (input) => {
      let operationId = "";
      const outcome = await runProjectOperation({
        projectsRoot: input.projectsRoot,
        slug: input.slug,
        operationType: "property_area_range_apply",
        idempotencyKey: input.idempotencyKey,
        fingerprintInput: { plan_id: PLAN_ID, snapshot_id: recoveryResult().snapshot_id },
        metadata: { plan_id: PLAN_ID, recovery_snapshot_id: recoveryResult().snapshot_id },
        safety: { apply_used: true },
        execute: async ({ operationId: currentOperationId, setStage }) => {
          operationId = currentOperationId;
          await setStage("applying");
          return { result: { status: "applied", mutation_performed: true }, resultSummary: {} };
        }
      });
      return Object.assign({}, outcome.result, {
        plan_id: PLAN_ID,
        snapshot_id: recoveryResult().snapshot_id,
        operation_id: operationId
      });
    }
  }, async (baseUrl, calls) => {
    const { hooks, result } = createUiHarness(baseUrl, { interruptApplyResponse: true });
    await hooks.preview();
    await hooks.prepareRecovery();
    hooks.setApplyConfirmed(true);
    await hooks.apply();
    await waitFor(() => /Observed persisted Apply status: succeeded/.test(result.innerHTML));
    assert.equal(hooks.getState().phase, "apply_interrupted");
    assert.doesNotMatch(result.innerHTML, /Observed Apply status: Applied/);
    await hooks.apply();
    assert.deepEqual(calls.map(([name]) => name), ["preview", "recovery", "apply"]);
  });
});

test("Launcher markup exposes the curated Preview, Recovery, and confirmed Apply actions only", () => {
  const serverSource = fs.readFileSync(path.resolve(__dirname, "../src/server.js"), "utf8");
  assert.match(serverSource, /id=\\"property-area-range-preview-button\\"/);
  assert.match(serverSource, /Preview Property area range/);
  assert.match(serverSource, /id=\\"property-area-range-recovery-button\\"/);
  assert.match(serverSource, /id=\\"property-area-range-apply-confirmation\\"/);
  assert.match(serverSource, /Apply Property area range/);
  assert.doesNotMatch(serverSource.slice(serverSource.indexOf("property-area-range-preview-title"), serverSource.indexOf("state-rollback-result")), /Proof Gate PASS|Restore Property area/);
});
