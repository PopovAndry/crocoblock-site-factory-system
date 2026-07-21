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
  const storage = new Map();
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
    documentElement: { dataset: {} },
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
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    matchMedia: () => ({ matches: false }),
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
    Headers,
    FormData: class FormData {},
    setInterval,
    clearInterval,
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
    presentationHooks: window.FactoryLauncherTestHooks.presentation,
    recoveryStatus: getElement("recovery-status"),
    generateProjectSlug: getElement("generate-project-slug"),
    root: document.documentElement,
    storage,
    themeToggle: getElement("theme-toggle"),
    themeToggleLabel: getElement("theme-toggle-label")
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

test("Launcher presentation maps project states to customer-safe readiness and next actions", () => {
  const { presentationHooks } = createHarness();
  const ready = presentationHooks.getProjectPresentation({
    slug: "internal-project-slug",
    runtime: { status: "provisioned" },
    dependency_state: { can_generate: true },
    generation: { status: "not_generated" },
    generated_site: { present: false }
  });
  assert.equal(ready.status, "Ready to continue");
  assert.equal(ready.generate, "Ready to generate");
  assert.equal(JSON.stringify(ready).includes("internal-project-slug"), false);

  const running = presentationHooks.getProjectPresentation({
    runtime: { status: "provisioned" },
    dependency_state: { can_generate: true },
    generation: { status: "running" },
    generated_site: { present: false }
  });
  assert.equal(running.status, "Site in progress");

  const generated = presentationHooks.getProjectPresentation({
    runtime: { status: "provisioned" },
    dependency_state: { can_generate: true },
    generation: { status: "succeeded" },
    generated_site: { present: true, urls: { home: "http://127.0.0.1:8120" } }
  });
  assert.equal(generated.status, "Site ready");
  assert.equal(generated.edit, "Ready to edit");

  const unavailable = presentationHooks.getProjectPresentation({
    runtime: { status: "unavailable" },
    dependency_state: { can_generate: false },
    generation: {},
    generated_site: {}
  });
  assert.equal(unavailable.status, "Project unavailable");
});

test("Launcher presentation sanitizes internal paths identifiers and credentials from errors", () => {
  const { presentationHooks } = createHarness();
  const fallback = "This action is temporarily unavailable.";
  assert.equal(presentationHooks.sanitizePublicError("C:\\secret\\proof.json", fallback), fallback);
  assert.equal(presentationHooks.sanitizePublicError("operation_id: op-2026-07-18-secret", fallback), fallback);
  assert.equal(presentationHooks.sanitizePublicError("Bearer private-token", fallback), fallback);
  assert.equal(presentationHooks.sanitizePublicError("Request timed out: http://127.0.0.1:8141", fallback), fallback);
  assert.equal(presentationHooks.sanitizePublicError("The selected project is unavailable.", fallback), "The selected project is unavailable.");
});

test("Launcher theme toggle applies and persists light and dark modes", () => {
  const { root, storage, themeToggle, themeToggleLabel } = createHarness();
  assert.equal(root.dataset.theme, "light");
  assert.equal(themeToggleLabel.textContent, "Dark mode");

  themeToggle.listeners.click();
  assert.equal(root.dataset.theme, "dark");
  assert.equal(themeToggleLabel.textContent, "Light mode");
  assert.equal(storage.get("crocoblock-site-factory-theme"), "dark");

  themeToggle.listeners.click();
  assert.equal(root.dataset.theme, "light");
  assert.equal(storage.get("crocoblock-site-factory-theme"), "light");
});

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
  assert.match(recoveryStatus.innerHTML, /No verified Recovery Point yet/);
  assert.match(recoveryStatus.innerHTML, /Create one before making risky changes/);
  assert.match(recoveryStatus.innerHTML, /Create a Recovery Point first/);
  assert.doesNotMatch(recoveryStatus.innerHTML, /Website restore is ready/);

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

test("Recovery card requires confirmation, shows progress, refreshes status after verified creation, and keeps actions customer-safe", async () => {
  let resolveCreate;
  const createResponse = new Promise((resolve) => {
    resolveCreate = resolve;
  });
  const requests = [];
  const { hooks, recoveryStatus } = createHarness(async (url, options) => {
    requests.push({ url: String(url), options: options || {} });
    if (String(url) === "/api/security/session") {
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({ csrf_token: "test-csrf-token", launcher_origin: "http://127.0.0.1:3847" })
      };
    }
    if (String(url).includes("/recovery-points")) {
      return createResponse;
    }
    if (String(url).includes("/recovery/status")) {
      return {
        ok: true,
        json: async () => baseStatus({
          latest_recovery_point: Object.assign({}, baseStatus().latest_recovery_point, {
            created_at: "2026-07-17T11:00:00.000Z"
          })
        })
      };
    }
    throw new Error("unexpected fetch: " + url);
  });

  hooks.setSelectedProject("card-project");
  hooks.renderState({ slug: "card-project", requestId: 7, payload: baseStatus() });
  assert.match(recoveryStatus.innerHTML, /Create Recovery Point/);
  assert.match(recoveryStatus.innerHTML, /Restore Website/);

  hooks.startRecoveryPointCreate();
  assert.match(recoveryStatus.innerHTML, /Create a Recovery Point for this website\?/);
  assert.equal(hooks.getCreateState().phase, "confirming");

  const creating = hooks.confirmRecoveryPointCreate();
  assert.match(recoveryStatus.innerHTML, /Creating Recovery Point/);
  assert.equal(hooks.getCreateState().phase, "creating");
  resolveCreate({
    ok: true,
    json: async () => ({
      recovery_point: { status: "verified", restorable: true }
    })
  });
  await creating;

  assert.match(recoveryStatus.innerHTML, /Recovery Point created and verified/);
  assert.equal(hooks.getCreateState().phase, "succeeded");
  assert.equal(requests.some((request) => request.url.includes("/recovery-points")), true);
  assert.equal(requests.some((request) => request.url.includes("/recovery/status")), true);
  assertNoTechnicalRecoveryDetails(recoveryStatus.innerHTML);
});

test("Recovery card selects a verified Recovery Point, requires exact restore confirmation, and refreshes after verified restore", async () => {
  const requests = [];
  const plan = {
    plan_id: "restore-plan-2026-07-17t12-00-00-000z-abcdef",
    recovery_point: { label: "Recovery Point", created_at: "2026-07-17T10:00:00.000Z" },
    readiness: "ready",
    restore_boundary: { restores: ["WordPress database"] },
    warnings: [],
    blockers: [],
    rescue_strategy: "full_required",
    confirmation: {
      required: true,
      mode: "normal",
      phrase: "Restore Website for card-project",
      warning: null
    },
    impact_summary: {
      replaces: ["Managed WordPress database state"],
      preserves: ["Current project credentials"],
      does_not_affect: ["Other Factory projects"],
      expected_temporary_downtime: "The website may be temporarily unavailable while restore execution runs in a later phase."
    }
  };
  const { hooks, recoveryStatus } = createHarness(async (url, options) => {
    requests.push({ url: String(url), options: options || {} });
    if (String(url) === "/api/security/session") {
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({ csrf_token: "test-csrf-token", launcher_origin: "http://127.0.0.1:3847" })
      };
    }
    if (String(url) === "/api/projects/card-project/recovery-points") {
      return {
        ok: true,
        json: async () => ({
          recovery_points: [{
            reference: "snapshot-2026-07-17t10-00-00-000z-abcdef123456",
            label: "Recovery Point",
            created_at: "2026-07-17T10:00:00.000Z",
            status: "verified",
            restorable: true
          }]
        })
      };
    }
    if (String(url).includes("/restore-plan")) {
      return { ok: true, json: async () => ({ restore_plan: plan }) };
    }
    if (String(url) === "/api/projects/card-project/restore/execute") {
      return {
        ok: true,
        json: async () => ({ restore: { status: "succeeded", verified: true, manual_recovery_required: false } })
      };
    }
    if (String(url).includes("/recovery/status")) {
      return { ok: true, json: async () => baseStatus({ restore_status: "completed" }) };
    }
    throw new Error("unexpected fetch: " + url);
  });

  hooks.setSelectedProject("card-project");
  hooks.renderState({ slug: "card-project", requestId: 13, payload: baseStatus() });
  hooks.startRecoveryRestore();
  assert.match(recoveryStatus.innerHTML, /Loading available Recovery Points/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(recoveryStatus.innerHTML, /Choose a verified Recovery Point/);
  assertNoTechnicalRecoveryDetails(recoveryStatus.innerHTML);

  await hooks.selectRecoveryPointForRestore(0);
  assert.match(recoveryStatus.innerHTML, /Restore Website will replace/);
  assert.match(recoveryStatus.innerHTML, /Restore Website for card-project/);
  assert.equal(/snapshot-/.test(recoveryStatus.innerHTML), false);
  assert.equal(hooks.getRestoreState().phase, "review");

  await hooks.confirmRecoveryRestore("not the exact phrase");
  assert.equal(hooks.getRestoreState().phase, "review");
  await hooks.confirmRecoveryRestore("Restore Website for card-project");
  assert.match(recoveryStatus.innerHTML, /Website restore completed and verified/);
  assert.equal(hooks.getRestoreState().phase, "succeeded");
  const execute = requests.find((request) => request.url.endsWith("/restore/execute"));
  assert.ok(execute);
  assert.deepEqual(JSON.parse(execute.options.body), {
    plan_id: "restore-plan-2026-07-17t12-00-00-000z-abcdef",
    exact_confirmation: "Restore Website for card-project"
  });
  assertNoTechnicalRecoveryDetails(recoveryStatus.innerHTML);
});

test("Recovery card hides creation without a selected project, blocks it for unsafe state, and keeps failed creation retryable", async () => {
  const { hooks, recoveryStatus } = createHarness(async (url) => {
    if (String(url) === "/api/security/session") {
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({ csrf_token: "test-csrf-token", launcher_origin: "http://127.0.0.1:3847" })
      };
    }
    if (String(url).includes("/recovery-points")) {
      return {
        ok: false,
        json: async () => ({ error: "C:\\secret\\database.sql password" })
      };
    }
    throw new Error("unexpected fetch: " + url);
  });

  hooks.renderState({ slug: "", requestId: 0 });
  assert.equal(/Create Recovery Point/.test(recoveryStatus.innerHTML), false);

  hooks.setSelectedProject("card-project");
  hooks.renderState({
    slug: "card-project",
    requestId: 8,
    payload: baseStatus({
      availability: "unknown",
      blockers: [{ code: "recovery_metadata_unreadable", message: "Recovery metadata could not be read safely." }]
    })
  });
  assert.equal(/Create Recovery Point/.test(recoveryStatus.innerHTML), false);

  hooks.renderState({ slug: "card-project", requestId: 9, payload: baseStatus() });
  await hooks.startRecoveryPointCreate();
  await hooks.confirmRecoveryPointCreate();
  assert.match(recoveryStatus.innerHTML, /Recovery Point could not be created/);
  assert.match(recoveryStatus.innerHTML, /Review the issue and try again/);
  assert.match(recoveryStatus.innerHTML, /Create Recovery Point/);
  assertNoTechnicalRecoveryDetails(recoveryStatus.innerHTML);
});

test("Recovery card presents manual recovery as attention-required, never as restore success", () => {
  const { hooks, recoveryStatus } = createHarness();
  hooks.setSelectedProject("card-project");
  hooks.renderState({
    slug: "card-project",
    requestId: 15,
    payload: baseStatus(),
    restorePhase: "failed",
    restoreError: "Restore requires attention. Manual recovery is required."
  });
  assert.match(recoveryStatus.innerHTML, /Restore requires attention. Manual recovery is required/);
  assert.equal(/Website restore completed and verified/.test(recoveryStatus.innerHTML), false);
  assertNoTechnicalRecoveryDetails(recoveryStatus.innerHTML);
});

test("Recovery Point creation ignores a stale completion after the selected project changes", async () => {
  let resolveCreate;
  const pendingCreate = new Promise((resolve) => {
    resolveCreate = resolve;
  });
  const { hooks, recoveryStatus } = createHarness(async (url) => {
    if (String(url) === "/api/security/session") {
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({ csrf_token: "test-csrf-token", launcher_origin: "http://127.0.0.1:3847" })
      };
    }
    if (String(url).includes("/recovery-points")) {
      return pendingCreate;
    }
    throw new Error("unexpected fetch: " + url);
  });

  hooks.setSelectedProject("alpha");
  hooks.renderState({ slug: "alpha", requestId: 10, payload: baseStatus({ project: { slug: "alpha" } }) });
  hooks.startRecoveryPointCreate();
  const creating = hooks.confirmRecoveryPointCreate();
  hooks.setSelectedProject("beta");
  hooks.resetRecoveryStatusView("beta");
  resolveCreate({
    ok: true,
    json: async () => ({ recovery_point: { status: "verified", restorable: true } })
  });
  await creating;

  assert.match(recoveryStatus.innerHTML, /Loading Recovery status/);
  assert.equal(/Recovery Point created and verified/.test(recoveryStatus.innerHTML), false);
  assert.equal(hooks.getCreateState().slug, "beta");
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
