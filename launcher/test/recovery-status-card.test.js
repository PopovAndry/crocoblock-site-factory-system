"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class FakeElement {
  constructor(id) {
    this.id = id;
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.hidden = false;
    this.checked = false;
    this.className = "";
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.elements = {};
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (match, char) => char.toUpperCase());
      this.dataset[key] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  querySelector() {
    return new FakeElement("query-result");
  }

  closest() {
    return null;
  }
}

function createHarness(fetchImpl) {
  const elements = new Map();
  function getElement(id) {
    if (!elements.has(id)) {
      elements.set(id, new FakeElement(id));
    }
    return elements.get(id);
  }

  const createForm = getElement("create-project-form");
  createForm.elements = {
    name: new FakeElement("create-name"),
    slug: new FakeElement("create-slug"),
    port: new FakeElement("create-port")
  };

  const document = {
    getElementById: getElement,
    querySelectorAll: () => []
  };
  const window = {
    FactoryLauncherConfig: {
      testMode: true,
      skipInitialLoad: true
    },
    FactoryLauncherTestHooks: {},
    FactoryProjectSummaryCounts: null,
    location: {
      origin: "http://127.0.0.1:3847"
    },
    crypto: {
      randomUUID: () => "00000000-0000-4000-8000-000000000000"
    },
    setTimeout,
    clearTimeout
  };
  window.window = window;
  const context = {
    window,
    document,
    console,
    fetch: fetchImpl || (async () => {
      throw new Error("unexpected fetch");
    }),
    AbortController,
    FormData: class FormData {},
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.resolve(__dirname, "../src/ui/app.js"), "utf8");
  vm.runInContext(source, context, {
    filename: "launcher/src/ui/app.js"
  });
  return {
    hooks: window.FactoryLauncherTestHooks.recoveryStatus,
    recoveryStatus: getElement("recovery-status"),
    generateProjectSlug: getElement("generate-project-slug")
  };
}

function baseStatus(overrides) {
  return Object.assign({
    schema_version: 1,
    project: { slug: "card-project" },
    availability: "available",
    protection_status: "protected",
    latest_recovery_point: {
      available: true,
      snapshot_id: "snapshot-2026-07-17t00-00-00-000z-abcdef123456",
      created_at: "2026-07-17T10:00:00.000Z",
      verified: true,
      restorable: true,
      protected: true,
      type: "full"
    },
    restore_status: "idle",
    storage_status: "healthy",
    recommended_action: "none",
    warnings: [],
    blockers: [],
    observed_at: "2026-07-17T10:01:00.000Z"
  }, overrides || {});
}

function assertNoTechnicalRecoveryDetails(html) {
  assert.equal(/snapshot-/.test(html), false);
  assert.equal(/op-\d{4}/.test(html), false);
  assert.equal(/[A-Za-z]:[\\/]/.test(html), false);
  assert.equal(/(?:manifest\.json|database\.sql|wordpress\.tar|proof)/i.test(html), false);
  assert.equal(/(?:password|Bearer|access_token|MYSQL_PASSWORD)/i.test(html), false);
}

test("Recovery card renders loading, no selected project, and request failure states", async () => {
  const { hooks, recoveryStatus } = createHarness();

  hooks.renderState({ slug: "", requestId: 0 });
  assert.match(recoveryStatus.innerHTML, /Select a project to view Recovery status/);

  hooks.renderState({ slug: "card-project", requestId: 1, loading: true });
  assert.match(recoveryStatus.innerHTML, /Loading Recovery status/);

  hooks.renderState({ slug: "card-project", requestId: 1, error: "C:\\secret\\password" });
  assert.match(recoveryStatus.innerHTML, /Recovery status is temporarily unavailable/);
  assertNoTechnicalRecoveryDetails(recoveryStatus.innerHTML);
});

test("Recovery card renders healthy, unavailable, warning, and blocked human states", () => {
  const { hooks, recoveryStatus } = createHarness();

  hooks.renderState({ slug: "card-project", requestId: 1, payload: baseStatus() });
  assert.match(recoveryStatus.innerHTML, /Recovery/);
  assert.match(recoveryStatus.innerHTML, /A verified Recovery Point is available/);
  assert.match(recoveryStatus.innerHTML, /Website restore is ready/);
  assert.match(recoveryStatus.innerHTML, /Storage<\/dt><dd>Healthy/);
  assertNoTechnicalRecoveryDetails(recoveryStatus.innerHTML);

  hooks.renderState({
    slug: "card-project",
    requestId: 1,
    payload: baseStatus({
      availability: "unavailable",
      protection_status: "not_protected",
      latest_recovery_point: null,
      recommended_action: "create_recovery_point",
      blockers: [{ code: "recovery_point_not_available", message: "No usable Recovery Point is available." }]
    })
  });
  assert.match(recoveryStatus.innerHTML, /No verified Recovery Point is available yet/);
  assert.match(recoveryStatus.innerHTML, /Create one before making major changes/);

  hooks.renderState({
    slug: "card-project",
    requestId: 1,
    payload: baseStatus({
      availability: "limited",
      warnings: [{ code: "storage_approaching_limit", message: "Recovery storage is approaching its limit." }]
    })
  });
  assert.match(recoveryStatus.innerHTML, /items to review/);
  assert.match(recoveryStatus.innerHTML, /Warnings: 1/);

  hooks.renderState({
    slug: "card-project",
    requestId: 1,
    payload: baseStatus({
      availability: "unknown",
      recommended_action: "contact_support",
      blockers: [{ code: "recovery_metadata_unreadable", message: "Recovery metadata could not be read safely." }]
    })
  });
  assert.match(recoveryStatus.innerHTML, /Attention required/);
  assert.match(recoveryStatus.innerHTML, /Blockers: 1/);
  assertNoTechnicalRecoveryDetails(recoveryStatus.innerHTML);
});

test("Recovery card ignores stale project-switch responses and renders no mutation action", async () => {
  let resolveAlpha;
  const alphaResponse = new Promise((resolve) => {
    resolveAlpha = resolve;
  });
  const { hooks, recoveryStatus } = createHarness((url) => {
    if (String(url).includes("/alpha/recovery/status")) {
      return alphaResponse;
    }
    throw new Error("unexpected fetch: " + url);
  });

  hooks.setSelectedProject("alpha");
  const alphaRequestId = hooks.resetRecoveryStatusView("alpha");
  const alphaLoad = hooks.loadRecoveryStatus("alpha", { requestId: alphaRequestId });

  hooks.setSelectedProject("beta");
  hooks.resetRecoveryStatusView("beta");
  resolveAlpha({
    ok: true,
    json: async () => baseStatus({ project: { slug: "alpha" } })
  });
  await alphaLoad;

  assert.match(recoveryStatus.innerHTML, /Loading Recovery status/);
  assert.equal(/A verified Recovery Point is available/.test(recoveryStatus.innerHTML), false);
  assert.equal(/<button/i.test(recoveryStatus.innerHTML), false);
  assert.equal(/data-(?:setup-action|dependency|mutation)/i.test(recoveryStatus.innerHTML), false);
});
