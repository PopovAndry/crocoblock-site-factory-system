"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assertSystemCheckReady,
  buildCreateWebsitePrompt,
  buildProgress,
  executeCreateWebsiteWorkflow,
  getCreateWebsiteStatus,
  startCreateWebsite,
  validateCreateWebsiteRequest
} = require("../src/create-website");
const {
  createProjectScaffold,
  listProjects,
  readProjectBySlug,
  saveProjectRecord
} = require("../src/project-store");
const { buildPlanningContextFromPersonalization, buildStructuredPersonalization } = require("../src/prompt-personalization");

function validRequest(overrides) {
  return Object.assign({
    profile: "real-estate",
    project_name: "Kyiv Realty CEO Demo",
    agency_name: "Kyiv Realty",
    city: "Kyiv",
    phone: "+380 44 555 01 01",
    email: "hello@kyivrealty.example"
  }, overrides || {});
}

function readySystemCheck() {
  return { state: "PASS", checks: [] };
}

function temporaryProjectsRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-create-website-"));
}

function scaffold(projectsRoot, slug) {
  const result = createProjectScaffold({
    name: "Workflow Test",
    slug,
    port: 47000 + Math.floor(Math.random() * 1000),
    projectsRoot
  });
  const state = readProjectBySlug(slug, projectsRoot);
  state.project.create_website = {
    schema: "factory_create_website",
    version: 1,
    status: "requested",
    operation_id: "op-test",
    business: validRequest()
  };
  saveProjectRecord(state, state.project);
  return result;
}

test("structured Create Website request normalizes supported customer values", () => {
  const result = validateCreateWebsiteRequest(validRequest({
    project_name: "  Kyiv   Realty CEO Demo  ",
    email: "HELLO@KYIVREALTY.EXAMPLE"
  }));
  assert.equal(result.project_name, "Kyiv Realty CEO Demo");
  assert.equal(result.phone, "+380 44 555 01 01");
  assert.equal(result.email, "hello@kyivrealty.example");
});

test("Create Website rejects required, bounded, email, path, profile, and browser-owned technical fields", () => {
  const cases = [
    [validRequest({ agency_name: "" }), "create_website_invalid_request"],
    [validRequest({ city: "x".repeat(81) }), "create_website_invalid_request"],
    [validRequest({ email: "invalid" }), "create_website_invalid_request"],
    [validRequest({ project_name: "C:\\sites\\demo" }), "create_website_unsafe_project_name"],
    [validRequest({ profile: "future-vertical" }), "create_website_unknown_profile"],
    [Object.assign(validRequest(), { project_root: "C:\\sites" }), "create_website_unknown_fields"],
    [Object.assign(validRequest(), { port: 8120 }), "create_website_unknown_fields"],
    [Object.assign(validRequest(), { package_path: "C:\\vendor\\jet-engine.zip" }), "create_website_unknown_fields"],
    [Object.assign(validRequest(), { command: "docker compose up" }), "create_website_unknown_fields"],
    [Object.assign(validRequest(), { agent_secret: "hidden" }), "create_website_unknown_fields"]
  ];
  for (const [payload, code] of cases) {
    assert.throws(() => validateCreateWebsiteRequest(payload), (error) => error.code === code);
  }
});

test("structured personalization remains authoritative for agency, city, phone, and email", () => {
  const request = validateCreateWebsiteRequest(validRequest());
  const personalization = buildStructuredPersonalization(request);
  const context = buildPlanningContextFromPersonalization(personalization);
  assert.equal(personalization.source, "structured_create_request");
  assert.equal(context.preset_variables.agency_name, "Kyiv Realty");
  assert.equal(context.preset_variables.phone, "+380 44 555 01 01");
  assert.equal(context.preset_variables.email, "hello@kyivrealty.example");
  assert.match(buildCreateWebsitePrompt(request), /30 demonstration properties/);
});

test("workflow invokes existing services once in frozen stage order and succeeds only after validation", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const slug = "workflow-success";
  scaffold(projectsRoot, slug);
  const stages = [];
  const calls = [];
  const result = await executeCreateWebsiteWorkflow({
    request: validRequest(),
    slug,
    projectsRoot,
    operationId: "op-test",
    setStage(stage) { stages.push(stage); },
    services: {
      async provisionProject() { calls.push("provision"); return { proofPath: "provision-proof" }; },
      createManagedDependencyInstallPlan({ dependency }) { calls.push("plan:" + dependency); return { plan: { plan_id: "plan-" + dependency } }; },
      async installDependency({ planId }) { calls.push("install:" + planId); return { proof: { installed: true, active: true } }; },
      async installAgent() { calls.push("agent"); return { health: { status: "ok" }, capabilities: { capabilities: { controlled_generate: true } } }; },
      async readDependencies() { calls.push("verify-dependencies"); return { blockers: [] }; },
      async planProject(options) {
        calls.push("plan-site");
        assert.equal(options.structuredPersonalization.source, "structured_create_request");
        return { run: { run_id: "run-1", status: "ok" } };
      },
      async generateProject(options) {
        calls.push("generate");
        await options.onProgress("generating");
        return {
          afterCounts: { pages: 3, properties: 30 },
          proofPath: "generate-proof",
          urlStatus: { home: 200, properties: 200, single_property: 200, contact: 200 }
        };
      },
      async getSiteStatus() {
        calls.push("site-status");
        return {
          project: { wp_url: "http://127.0.0.1:47001" },
          site: {
            generated_site_present: true,
            generation_status: "ok",
            generated_urls: { home: "http://127.0.0.1:47001" },
            url_status: { home: 200, properties: 200, contact: 200 }
          }
        };
      },
      evaluateRealEstateContract() { calls.push("contract"); return { status: "compliant", totals: { passed: 25, total: 25 } }; }
    }
  });
  assert.deepEqual(stages.filter((stage, index) => index === 0 || stage !== stages[index - 1]), [
    "validate_request", "create_project", "provision_runtime", "install_dependencies", "install_agent",
    "verify_agent", "create_plan", "apply_plan", "validate_website", "finalize_project"
  ]);
  assert.equal(calls.filter((call) => call === "provision").length, 1);
  assert.equal(calls.filter((call) => call.startsWith("install:")).length, 3);
  assert.equal(calls.filter((call) => call === "agent").length, 1);
  assert.equal(calls.filter((call) => call === "generate").length, 1);
  assert.equal(result.resultSummary.validation_passed, true);
  assert.equal(result.resultSummary.url_status.single_property, 200);
  assert.equal(readProjectBySlug(slug, projectsRoot).project.create_website.status, "ready");
});

test("failed dependency stage prevents Agent and generate", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const slug = "dependency-failure";
  scaffold(projectsRoot, slug);
  let laterCalls = 0;
  await assert.rejects(executeCreateWebsiteWorkflow({
    request: validRequest(), slug, projectsRoot, operationId: "op-test", setStage() {},
    services: {
      async provisionProject() { return {}; },
      createManagedDependencyInstallPlan({ dependency }) { return { plan: { plan_id: dependency } }; },
      async installDependency() { throw new Error("dependency failure"); },
      async installAgent() { laterCalls += 1; },
      async planProject() { laterCalls += 1; },
      async generateProject() { laterCalls += 1; }
    }
  }), (error) => error.createWebsiteStage === "install_dependencies");
  assert.equal(laterCalls, 0);
});

test("failed Agent stage prevents planning and failed validation prevents Website Ready", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  scaffold(projectsRoot, "agent-failure");
  let planCalls = 0;
  await assert.rejects(executeCreateWebsiteWorkflow({
    request: validRequest(), slug: "agent-failure", projectsRoot, operationId: "op-test", setStage() {},
    services: {
      async provisionProject() { return {}; },
      createManagedDependencyInstallPlan({ dependency }) { return { plan: { plan_id: dependency } }; },
      async installDependency() { return { proof: { installed: true, active: true } }; },
      async installAgent() { return { health: { status: "error" }, capabilities: { capabilities: {} } }; },
      async planProject() { planCalls += 1; }
    }
  }), (error) => error.createWebsiteStage === "verify_agent");
  assert.equal(planCalls, 0);

  scaffold(projectsRoot, "validation-failure");
  await assert.rejects(executeCreateWebsiteWorkflow({
    request: validRequest(), slug: "validation-failure", projectsRoot, operationId: "op-test", setStage() {},
    services: {
      async provisionProject() { return {}; },
      createManagedDependencyInstallPlan({ dependency }) { return { plan: { plan_id: dependency } }; },
      async installDependency() { return { proof: { installed: true, active: true } }; },
      async installAgent() { return { health: { status: "ok" }, capabilities: { capabilities: { controlled_generate: true } } }; },
      async readDependencies() { return { blockers: [] }; },
      async planProject() { return { run: { run_id: "run", status: "ok" } }; },
      async generateProject() { return { afterCounts: {}, proofPath: null }; },
      async getSiteStatus() { return { project: { wp_url: "http://127.0.0.1" }, site: { generated_site_present: true, generation_status: "ok", generated_urls: {}, url_status: { home: 200, properties: 500, single_property: 200, contact: 200 } } }; },
      evaluateRealEstateContract() { return { status: "compliant", totals: { passed: 25, total: 25 } }; }
    }
  }), (error) => error.createWebsiteStage === "validate_website");
  assert.notEqual(readProjectBySlug("validation-failure", projectsRoot).project.create_website.status, "ready");
});

test("System Check not-ready blocks before every mutation seam", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const calls = { port: 0, scaffold: 0, operation: 0, dependency: 0, agent: 0 };
  await assert.rejects(startCreateWebsite({
    request: validRequest(),
    projectsRoot,
    idempotencyKey: "create-system-check-blocked-0001",
    systemCheck: {
      state: "ACTION_REQUIRED",
      checks: [{ id: "docker_daemon", state: "ACTION_REQUIRED", message: "Start Docker Desktop, then recheck." }]
    },
    services: {
      async findAvailableProjectPort() { calls.port += 1; return 47001; },
      createProjectScaffold() { calls.scaffold += 1; },
      runProjectOperation() { calls.operation += 1; },
      installDependency() { calls.dependency += 1; },
      installAgent() { calls.agent += 1; }
    }
  }), (error) => error.code === "create_website_system_check_blocked");
  assert.deepEqual(calls, { port: 0, scaffold: 0, operation: 0, dependency: 0, agent: 0 });
  assert.deepEqual(fs.readdirSync(projectsRoot), []);
});

test("double submission reuses one project and status polling is read-only", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  let scaffoldCalls = 0;
  let nextPort = 47991;
  const never = new Promise(() => {});
  const services = {
    async findAvailableProjectPort() { return nextPort++; },
    createOperationId() { return "op-idempotent"; },
    createProjectScaffold(options) { scaffoldCalls += 1; return createProjectScaffold(options); },
    runProjectOperation() { return never; }
  };
  const options = {
    request: validRequest(), projectsRoot, idempotencyKey: "create-idempotent-request-0001",
    systemCheck: readySystemCheck(), services
  };
  const [first, second] = await Promise.all([startCreateWebsite(options), startCreateWebsite(options)]);
  assert.equal(first.project.slug, second.project.slug);
  assert.equal(scaffoldCalls, 1);
  assert.equal(listProjects(projectsRoot).length, 1);
  const retry = await startCreateWebsite(Object.assign({}, options, {
    idempotencyKey: "create-idempotent-request-0002"
  }));
  assert.notEqual(retry.project.slug, first.project.slug);
  assert.equal(scaffoldCalls, 2);
  assert.equal(listProjects(projectsRoot).length, 2);
  const manifest = path.join(projectsRoot, first.project.slug, "factory-project.json");
  const before = fs.statSync(manifest).mtimeMs;
  const polled = getCreateWebsiteStatus({ slug: first.project.slug, projectsRoot });
  const after = fs.statSync(manifest).mtimeMs;
  assert.equal(polled.status, "running");
  assert.equal(after, before);
});

test("customer progress maps backend stages without exposing internal identifiers", () => {
  const progress = buildProgress({ status: "running", stage: "install_agent" }, { status: "running" });
  assert.deepEqual(progress.map((stage) => stage.status), ["complete", "complete", "complete", "active", "pending", "pending"]);
  assert.throws(() => assertSystemCheckReady({ state: "UNSUPPORTED", checks: [] }), /System Check/);
});
