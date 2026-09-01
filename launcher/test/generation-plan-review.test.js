"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");

let portCounter = 48500;
const DISCOVERY_RULES_DESCRIPTION = "Property Discovery specification only: each of Purpose, Property Type and District accepts one taxonomy term. Active selections use AND, so a property must match every selected condition. An unselected filter adds no restriction; all other active conditions still apply. When no filters are selected, or after Clear filters, the base properties catalog is used. A valid search with no matches while filters are active shows an explicit empty state and offers Clear filters; conditions are not relaxed automatically. An empty base catalog remains empty, and an execution error is shown as an error, not as no matches. Runtime filtering behavior is not verified in this slice.";

function projectState() {
  return {
    project: {
      slug: "fixture-realty",
      name: "Fixture Realty",
      runtime: { status: "provisioned" },
      agent: { status: "installed" },
      dependency_state: { can_generate: true, blockers: [] }
    },
    runtimePath: path.join(process.cwd(), "test-fixture-runtime")
  };
}

async function requestJson(baseUrl, requestPath, options) {
  const sessionResponse = await fetch(baseUrl + "/api/security/session");
  const session = await sessionResponse.json();
  const response = await fetch(baseUrl + requestPath, Object.assign({}, options, {
    headers: Object.assign({
      "Content-Type": "application/json",
      "X-Factory-CSRF-Token": session.csrf_token,
      Origin: baseUrl
    }, options && options.headers || {})
  }));
  return { response, body: await response.json() };
}

async function withPatchedServer(stubs, callback) {
  const modulePatches = [
    { path: require.resolve("../src/project-store"), stubs: stubs.projectStore || {} },
    { path: require.resolve("../src/setup"), stubs: stubs.setup || {} },
    { path: require.resolve("../src/plan"), stubs: stubs.plan || {} },
    { path: require.resolve("../src/ai"), stubs: stubs.ai || {} }
  ];
  const originals = [];
  const serverModulePath = require.resolve("../src/server");

  for (const patch of modulePatches) {
    const target = require(patch.path);
    for (const [key, value] of Object.entries(patch.stubs)) {
      originals.push({ target, key, value: target[key] });
      target[key] = value;
    }
  }
  delete require.cache[serverModulePath];
  const { createLauncherServer } = require(serverModulePath);
  const server = createLauncherServer({
    host: "127.0.0.1",
    port: portCounter += 1,
    projectsRoot: path.join(process.cwd(), "test-fixture-projects"),
    skipRestoreReconciliation: true
  });

  try {
    const listenInfo = await server.listen();
    return await callback("http://127.0.0.1:" + listenInfo.port);
  } finally {
    await server.close().catch(() => {});
    for (const original of originals) {
      original.target[original.key] = original.value;
    }
    delete require.cache[serverModulePath];
  }
}

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

function createReviewHarness() {
  const elements = new Map();
  function getElement(id) {
    if (!elements.has(id)) elements.set(id, new FakeElement(id));
    return elements.get(id);
  }
  getElement("create-project-form").elements = {
    name: new FakeElement("create-name"),
    slug: new FakeElement("create-slug"),
    port: new FakeElement("create-port")
  };
  const window = {
    FactoryLauncherConfig: { testMode: true, skipInitialLoad: true },
    FactoryLauncherTestHooks: {},
    FactoryProjectSummaryCounts: null,
    location: { origin: "http://127.0.0.1:3847" },
    localStorage: { getItem: () => null, setItem: () => {} },
    matchMedia: () => ({ matches: false }),
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000000" },
    setTimeout,
    clearTimeout
  };
  window.window = window;
  const context = {
    window,
    document: { documentElement: { dataset: {} }, getElementById: getElement, querySelectorAll: () => [] },
    console,
    fetch: async () => { throw new Error("unexpected fetch"); },
    AbortController,
    Headers,
    FormData: class FormData {},
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../src/ui/app.js"), "utf8"), context, {
    filename: "launcher/src/ui/app.js"
  });
  return window.FactoryLauncherTestHooks.generatePreview;
}

test("generation-plan response includes the validated contract-derived business summary without changing planning inputs", async () => {
  const calls = [];
  const state = projectState();
  await withPatchedServer({
    projectStore: {
      readProjectBySlug: () => state
    },
    setup: {
      getSetupStatus: async () => ({
        setup: {
          ready_to_generate: true,
          dependencies: { can_generate: true, blockers: [] }
        }
      })
    },
    plan: {
      planProject: async (options) => {
        calls.push(options);
        return {
          project: state.project,
          run: { run_id: "run-2026-08-31T00-00-00-000Z-abcdef", status: "planned", warnings: [] },
          proof: { prompt_hash: "safe-prompt-hash", prompt_personalization: { source: "local_interpreter", fields: {} } },
          runPath: "internal-plan-path",
          proofPath: "internal-plan-proof"
        };
      }
    },
    ai: {
      estimateAi: () => ({
        estimate: { estimated_input_tokens: 1, estimated_output_tokens: 2, estimated_total_tokens: 3, estimated_cost: 0, uncertainty: "low" },
        proofPath: "internal-estimate-proof"
      })
    }
  }, async (baseUrl) => {
    const result = await requestJson(baseUrl, "/api/projects/fixture-realty/generation/plan", {
      method: "POST",
      body: JSON.stringify({ prompt: "Create a focused property website." })
    });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.business_summary, {
      description: "Visitors can browse properties, filter by Purpose, Property Type and District, and open property details.",
      discovery_rules_description: DISCOVERY_RULES_DESCRIPTION,
      request_viewing_description: "Request Viewing specification only: it relates to the selected property and requires Email or Phone. Preferred date does not confirm an appointment. Opening an email client does not confirm submission or receipt. Runtime submission is not connected in this slice."
    });
    assert.equal(result.body.provider_called, false);
    assert.equal(result.body.can_generate, true);
    assert.equal(result.body.setup_ready, true);
  });
  assert.deepEqual(calls, [{
    slug: "fixture-realty",
    prompt: "Create a focused property website.",
    projectsRoot: path.join(process.cwd(), "test-fixture-projects")
  }]);
});

test("Generate Review renders escaped allowlisted content with the discovery summary and no internal details", () => {
  const review = createReviewHarness();
  const view = review.buildGeneratePreviewHtml({
    business_summary: {
      description: "Visitors can browse properties, filter by Purpose, Property Type and District, and open property details.",
      discovery_rules_description: DISCOVERY_RULES_DESCRIPTION,
      request_viewing_description: "Request Viewing specification only: it relates to the selected property and requires Email or Phone. Preferred date does not confirm an appointment. Opening an email client does not confirm submission or receipt. Runtime submission is not connected in this slice."
    },
    dependency_blockers: ["JetEngine plugin at C:\\runtime"],
    plan_id: "run-internal-id",
    plan_proof_path: "C:\\proofs\\plan.json",
    estimate_proof_path: "C:\\proofs\\estimate.json",
    prompt_hash: "internal-hash",
    warnings: ["powershell C:\\runtime"],
    interpreted_fields: {
      agency_name: "Kyiv <Realty> & Co.",
      city: "Kyiv & region",
      hero_title: "Find <your> home",
      hero_subtitle: "Trusted & local guidance",
      hero_cta_text: "Browse <properties>",
      internal_note: "do not render"
    },
    can_generate: true
  });

  assert.match(view.html, /Visitors can browse properties, filter by Purpose, Property Type and District, and open property details\./);
  assert.match(view.html, /Property Discovery specification only: each of Purpose, Property Type and District accepts one taxonomy term\. Active selections use AND, so a property must match every selected condition\. An unselected filter adds no restriction; all other active conditions still apply\. When no filters are selected, or after Clear filters, the base properties catalog is used\. A valid search with no matches while filters are active shows an explicit empty state and offers Clear filters; conditions are not relaxed automatically\. An empty base catalog remains empty, and an execution error is shown as an error, not as no matches\. Runtime filtering behavior is not verified in this slice\./);
  assert.match(view.html, /Request Viewing specification only: it relates to the selected property and requires Email or Phone\. Preferred date does not confirm an appointment\. Opening an email client does not confirm submission or receipt\. Runtime submission is not connected in this slice\./);
  assert.match(view.html, /Kyiv &lt;Realty&gt; &amp; Co\./);
  assert.match(view.html, /Kyiv &amp; region/);
  assert.match(view.html, /Find &lt;your&gt; home/);
  assert.match(view.html, /Trusted &amp; local guidance/);
  assert.match(view.html, /Browse &lt;properties&gt;/);
  assert.doesNotMatch(view.html, /internal_note|do not render/);
  assert.match(view.html, /Review setup before generating\./);
  assert.match(view.html, /Preview warnings:<\/span> 1/);
  for (const unsafe of ["JetEngine", "C:\\runtime", "run-internal-id", "plan.json", "estimate.json", "internal-hash", "powershell"]) {
    assert.doesNotMatch(view.html, new RegExp(unsafe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});

test("blocked Generate Review gives actionable setup guidance without exposing raw blockers", () => {
  const review = createReviewHarness();
  const view = review.buildGeneratePreviewHtml({
    business_summary: {
      description: "Visitors can browse properties, filter by Purpose, Property Type and District, and open property details.",
      discovery_rules_description: DISCOVERY_RULES_DESCRIPTION,
      request_viewing_description: "Request Viewing specification only: it relates to the selected property and requires Email or Phone. Preferred date does not confirm an appointment. Opening an email client does not confirm submission or receipt. Runtime submission is not connected in this slice."
    },
    can_generate: false,
    dependency_blockers: ["JetEngine plugin at C:\\runtime"],
    interpreted_fields: { agency_name: "Kyiv Realty" }
  });

  assert.match(view.html, /Website setup is not ready yet\. Complete the required setup before generating\./);
  assert.match(view.html, /Visitors can browse properties, filter by Purpose, Property Type and District, and open property details\./);
  assert.match(view.html, /When no filters are selected, or after Clear filters, the base properties catalog is used\./);
  assert.match(view.html, /Runtime filtering behavior is not verified in this slice\./);
  assert.match(view.html, /Runtime submission is not connected in this slice\./);
  assert.match(view.html, /Kyiv Realty/);
  assert.doesNotMatch(view.html, /JetEngine|C:\\runtime|plugin at/i);
});
