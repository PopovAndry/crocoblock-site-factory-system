"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createLauncherServer } = require("../src/server");
const { createProjectScaffold } = require("../src/project-store");
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

function createUiHarness(baseUrl) {
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
    fetch: (url, options) => {
      const requestOptions = Object.assign({}, options || {});
      const headers = new Headers(requestOptions.headers || {});
      if (String(requestOptions.method || "GET").toUpperCase() !== "GET") headers.set("Origin", baseUrl);
      requestOptions.headers = headers;
      return fetch(new URL(url, baseUrl), requestOptions);
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
    result: getElementById("property-area-range-preview-result")
  };
}

function error(statusCode) {
  const value = new Error("preview unavailable");
  value.statusCode = statusCode;
  return value;
}

async function withServer(previewService, callback) {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "factory-property-area-range-ui-"));
  createProjectScaffold({ name: "Area UI", slug: "area-route", port: port += 1, projectsRoot });
  const server = createLauncherServer({
    host: "127.0.0.1",
    port: port += 1,
    projectsRoot,
    skipRestoreReconciliation: true,
    propertyAreaRangePreviewService: previewService
  });
  const info = await server.listen();
  try {
    await callback("http://127.0.0.1:" + info.port);
  } finally {
    await server.close();
  }
}

test("Property Area Range Preview routes a valid server-owned summary into curated human-readable UI", async () => {
  await withServer(async () => ({
    status: "prepared_for_recovery",
    plan_id: PLAN_ID,
    browser_summary: browserSummary({ baseline: { property_count: 30 } })
  }), async (baseUrl) => {
    const { hooks, result } = createUiHarness(baseUrl);
    await hooks.preview();
    assert.match(result.innerHTML, /Property area range Preview is ready/);
    assert.match(result.innerHTML, /optional Property area range/);
    assert.match(result.innerHTML, /30 published Properties were checked/);
    assert.match(result.innerHTML, /Existing archive filters, sorting, pagination, cards, count, and default results/);
    assert.match(result.innerHTML, /has not applied the change/);
    assert.doesNotMatch(result.innerHTML, /Apply|Proof Gate PASS|Recovery Point|Restore was successful/i);
  });
});

test("Property Area Range Preview UI fails closed for malformed, stale, and failed route responses", async () => {
  const cases = [
    async () => ({ status: "prepared_for_recovery", plan_id: PLAN_ID, browser_summary: { schema_version: 1 } }),
    async () => { throw error(409); },
    async () => { throw error(500); }
  ];
  for (const previewService of cases) {
    await withServer(previewService, async (baseUrl) => {
      const { hooks, result } = createUiHarness(baseUrl);
      await hooks.preview();
      assert.equal(result.textContent, "Property Area Range Preview cannot be prepared safely.");
      assert.equal(result.className, "result-box result-box-error");
      assert.doesNotMatch(result.textContent, /plan|snapshot|operation|proof|path|sql/i);
    });
  }
});

test("Launcher markup exposes the curated Property Area Range Preview action only", () => {
  const serverSource = fs.readFileSync(path.resolve(__dirname, "../src/server.js"), "utf8");
  assert.match(serverSource, /id=\\"property-area-range-preview-button\\"/);
  assert.match(serverSource, /Preview Property area range/);
  assert.doesNotMatch(serverSource.slice(serverSource.indexOf("property-area-range-preview-title"), serverSource.indexOf("state-rollback-result")), /Apply Property area|Proof Gate PASS|Restore Property area/);
});
