"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const {
  DEFAULT_PROJECTS_ROOT,
  createProjectScaffold,
  listProjects,
  readProjectBySlug,
  resolveProjectsRoot,
  validateExplicitSlug
} = require("./project-store");
const { provisionProject } = require("./provision");
const { installAgent } = require("./install-agent");
const { installDependency } = require("./install-dependency");
const { listApprovedDependencySources, resolveApprovedDependencySource } = require("./dependency-sources");
const { getSetupStatus } = require("./setup");
const { getSetupMutationLock, withSetupMutationLock } = require("./setup-lock");
const { planProject } = require("./plan");
const { configureAi, enableLiveAi, estimateAi, getAiStatus } = require("./ai");
const { assertPlanningRunReady, generateProject, readRunFile } = require("./generate");
const { getSiteStatus, writeSiteSurfaceProof } = require("./site");
const { readStateStatus, refreshState, planState, applyStatePlan, rollbackStateApply } = require("./state");
const { generateProofPack, getProofPackStatus } = require("./proof-pack");
const { getGenerationMutationLock, withGenerationMutationLock } = require("./generation-lock");
const {
  createGenerationOperation,
  findSuccessfulOperationByPlanId,
  getLatestGenerationOperation,
  interruptOperationIfStale,
  normalizePlanId,
  updateGenerationOperation
} = require("./generation-operation");

const UI_DIR = path.join(__dirname, "ui");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, statusCode, body, contentType) {
  response.writeHead(statusCode, {
    "Content-Type": contentType || "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large."));
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function renderHomePage(config) {
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "  <meta charset=\"utf-8\">",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "  <title>Factory Launcher</title>",
    "  <link rel=\"stylesheet\" href=\"/assets/styles.css\">",
    "</head>",
    "<body>",
    "  <main class=\"launcher-shell\">",
    "    <header class=\"hero\">",
    "      <p class=\"eyebrow\">Standalone launcher - outside WordPress</p>",
    "      <div class=\"hero-row\">",
    "        <div>",
    "          <h1>Factory Launcher</h1>",
    "          <p class=\"hero-copy\">Project scaffolding, local WordPress provisioning, Agent pairing, read-only planning, and controlled generate all run here from the launcher.</p>",
    "        </div>",
    "        <div class=\"hero-status\">",
    "          <div><span>Runtime</span><strong>Not provisioned</strong></div>",
    "          <div><span>Agent</span><strong>Paired per project</strong></div>",
    "          <div><span>AI</span><strong>Read-only planning</strong></div>",
    "        </div>",
    "      </div>",
    "    </header>",
    "    <section class=\"milestone-card\">",
    "      <h2>Next milestone</h2>",
    "      <p>Controlled generate and proof</p>",
    "      <button type=\"button\" class=\"button\" id=\"launcher-milestone-generate\" disabled>Generate from launcher</button>",
    "    </section>",
    "    <section class=\"panel-grid\">",
    "      <section class=\"panel\">",
    "        <div class=\"panel-header\">",
    "          <h2>Create project</h2>",
    "          <p>Write a local real estate project scaffold without starting Docker or touching WordPress.</p>",
    "        </div>",
    "        <form id=\"create-project-form\" class=\"project-form\">",
      "          <label>",
    "            <span>Site name</span>",
    "            <input name=\"name\" type=\"text\" required placeholder=\"Kyiv Realty\">",
    "          </label>",
    "          <label>",
    "            <span>Project slug</span>",
    "            <input name=\"slug\" type=\"text\" required placeholder=\"kyiv-realty\" pattern=\"[a-z0-9]+(?:-[a-z0-9]+)*\">",
    "          </label>",
    "          <label>",
    "            <span>WordPress port</span>",
    "            <input name=\"port\" type=\"number\" min=\"1024\" max=\"65535\" value=\"8120\" required>",
    "          </label>",
    "          <p class=\"project-note\">Vertical: Real Estate. Projects root: " + escapeHtml(config.projectsRoot) + "</p>",
    "          <button type=\"submit\" class=\"button\">Create project scaffold</button>",
    "        </form>",
    "        <div id=\"create-result\" class=\"result-box\" hidden></div>",
    "      </section>",
    "      <section class=\"panel\">",
    "        <div class=\"panel-header\">",
    "          <h2>Projects</h2>",
    "          <p>Scaffolded runtimes waiting for provisioning.</p>",
    "        </div>",
    "        <div id=\"project-list\" class=\"project-list\"></div>",
    "      </section>",
    "    </section>",
    "    <section class=\"panel single-panel\">",
    "      <div class=\"panel-header\">",
    "        <h2>Project Setup</h2>",
    "        <p>Create a project, provision WordPress, install the Site Factory Agent, and onboard the required approved dependencies until the runtime is ready to generate.</p>",
    "      </div>",
    "      <form id=\"setup-project-form\" class=\"project-form compact-form\">",
    "        <label>",
    "          <span>Project</span>",
    "          <select name=\"slug\" id=\"setup-project-slug\"></select>",
    "        </label>",
    "      </form>",
    "      <div id=\"setup-status\" class=\"project-list\"></div>",
    "      <div id=\"setup-result\" class=\"result-box\" hidden></div>",
    "    </section>",
    "    <section class=\"panel-grid\">",
    "      <section class=\"panel\">",
    "        <div class=\"panel-header\">",
    "          <h2>Read-only planning</h2>",
    "          <p>Send a prompt to the paired Site Factory Agent and capture plan proof without mutating WordPress.</p>",
    "        </div>",
    "        <form id=\"plan-project-form\" class=\"project-form\">",
    "          <label>",
    "            <span>Project</span>",
    "            <select name=\"slug\" id=\"plan-project-slug\"></select>",
    "          </label>",
    "          <label>",
    "            <span>Prompt</span>",
    "            <textarea name=\"prompt\" rows=\"5\" required placeholder=\"Create a real estate site for Kyiv apartments\"></textarea>",
    "          </label>",
    "          <button type=\"submit\" class=\"button\">Run read-only plan</button>",
    "        </form>",
    "        <div id=\"plan-result\" class=\"result-box\" hidden></div>",
    "      </section>",
    "      <section class=\"panel\">",
    "        <div class=\"panel-header\">",
    "          <h2>Latest run</h2>",
    "          <p>Launcher-only run metadata and stage summaries.</p>",
    "        </div>",
    "        <div id=\"latest-run\" class=\"project-list\"></div>",
    "      </section>",
    "    </section>",
    "    <section class=\"panel single-panel\">",
    "      <div class=\"panel-header\">",
    "        <h2>AI / model / tokens</h2>",
    "        <p>Placeholder only in this slice. No provider calls and no settings writes yet.</p>",
    "      </div>",
    "      <div class=\"placeholder-grid\">",
    "        <div><span>Mode</span><strong id=\"launcher-ai-mode\">mock</strong></div>",
    "        <div><span>Provider</span><strong id=\"launcher-ai-provider\">mock</strong></div>",
    "        <div><span>Model profile</span><strong id=\"launcher-ai-model\">balanced</strong></div>",
    "        <div><span>Key status</span><strong id=\"launcher-ai-key-status\">not_required</strong></div>",
    "        <div><span>Last estimate</span><strong id=\"launcher-ai-last-estimate\">Not recorded</strong></div>",
    "        <div><span>Total tokens</span><strong id=\"launcher-total-tokens\">0</strong></div>",
    "      </div>",
    "      <p class=\"project-note\">Live AI calls stay disabled until a project is explicitly configured, estimated, and live-enabled for desired-state planning.</p>",
    "    </section>",
    "    <section class=\"panel-grid\">",
    "      <section class=\"panel\">",
    "        <div class=\"panel-header\">",
    "          <h2>Generate Site</h2>",
    "          <p>Preview a read-only local-interpreter plan, review the estimate and mutation warning, then explicitly confirm controlled generate for ready projects only.</p>",
    "        </div>",
    "        <form id=\"generate-project-form\" class=\"project-form\">",
    "          <label>",
    "            <span>Project</span>",
    "            <select name=\"slug\" id=\"generate-project-slug\"></select>",
    "          </label>",
    "          <label>",
    "            <span>Prompt</span>",
    "            <textarea name=\"prompt\" id=\"generate-prompt\" rows=\"6\" required placeholder=\"Create a family-focused real estate website for Mykolaiv named Harbor Family Realty, focused on apartments near parks, schools, and quiet neighborhoods.\"></textarea>",
    "          </label>",
    "          <div class=\"generate-action-row\">",
    "            <button type=\"button\" class=\"button\" id=\"generate-preview-button\">Preview Plan</button>",
    "            <button type=\"submit\" class=\"button\" id=\"generate-submit-button\" disabled>Generate Site</button>",
    "          </div>",
    "          <label class=\"checkbox-row\">",
    "            <input type=\"checkbox\" id=\"generate-confirm-checkbox\">",
    "            <span>I understand that Generate will modify this WordPress project.</span>",
    "          </label>",
    "        </form>",
    "        <div id=\"generation-status\" class=\"project-list\"></div>",
    "        <div id=\"generate-preview-result\" class=\"result-box\" hidden></div>",
    "        <div id=\"generate-result\" class=\"result-box\" hidden></div>",
    "      </section>",
    "      <section class=\"panel\">",
    "        <div class=\"panel-header\">",
    "          <h2>Generated site result</h2>",
    "          <p>The latest generate proof, counts, and direct links to the generated site.</p>",
    "        </div>",
    "        <div id=\"site-status\" class=\"project-list\"></div>",
    "        <div class=\"panel-header\">",
    "          <h2>Managed State</h2>",
    "          <p>Launcher-managed ownership, personalization, and protected override summary.</p>",
    "        </div>",
    "        <div id=\"managed-state\" class=\"project-list\"></div>",
    "        <div class=\"managed-state-actions\">",
    "          <button type=\"button\" class=\"button\" id=\"refresh-state-button\">Refresh State</button>",
    "        </div>",
    "        <form id=\"state-plan-form\" class=\"project-form compact-form\">",
    "          <label>",
    "            <span>Plan a change against current state</span>",
    "            <textarea name=\"prompt\" id=\"state-plan-prompt\" rows=\"4\" placeholder=\"Describe the next site direction without applying it yet.\"></textarea>",
    "          </label>",
    "          <button type=\"submit\" class=\"button\" id=\"state-plan-button\">Plan Change</button>",
    "        </form>",
    "        <div id=\"state-plan-result\" class=\"result-box\" hidden></div>",
    "        <div id=\"state-rollback-result\" class=\"result-box\" hidden></div>",
    "        <div class=\"panel-header\">",
    "          <h2>Alpha Proof Pack</h2>",
    "          <p>Read-only evaluator summary for the Launcher-first AI safe-edit alpha.</p>",
    "        </div>",
    "        <div id=\"proof-pack-status\" class=\"project-list\"></div>",
    "        <div class=\"managed-state-actions\">",
    "          <button type=\"button\" class=\"button\" id=\"proof-pack-refresh-button\">Refresh</button>",
    "          <button type=\"button\" class=\"button\" id=\"proof-pack-generate-button\">Generate Proof Pack</button>",
    "        </div>",
    "        <div id=\"proof-pack-result\" class=\"result-box\" hidden></div>",
    "      </section>",
    "    </section>",
    "  </main>",
    "  <script>window.FactoryLauncherConfig = " + JSON.stringify({
      projectsRoot: config.projectsRoot
    }) + ";</script>",
    "  <script src=\"/assets/app.js\"></script>",
    "</body>",
    "</html>"
  ].join("\n");
}

function serveAsset(response, assetName) {
  const assetPath = path.join(UI_DIR, assetName);
  if (!fs.existsSync(assetPath)) {
    sendText(response, 404, "Not found");
    return;
  }

  const contentType = assetName.endsWith(".css")
    ? "text/css; charset=utf-8"
    : "application/javascript; charset=utf-8";
  sendText(response, 200, fs.readFileSync(assetPath, "utf8"), contentType);
}

function summarizeProjectForSite(project) {
  return {
    project_id: project.project_id,
    site_name: project.site_name,
    slug: project.slug,
    runtime_path: project.runtime_path,
    wp_url: project.wp_url,
    wp_port: project.wp_port,
    generation: project.generation || null,
    generated_site: project.generated_site || null
  };
}

function createStructuredError(message, code, statusCode, extras) {
  const error = new Error(message);
  error.code = code || null;
  error.statusCode = statusCode || 400;
  if (extras && typeof extras === "object") {
    Object.assign(error, extras);
  }
  return error;
}

function normalizeProjectSlugForRoute(rawSlug) {
  try {
    return validateExplicitSlug(rawSlug);
  } catch (error) {
    throw createStructuredError(
      "Project slug is invalid.",
      "invalid_project_slug",
      400
    );
  }
}

function assertProjectExistsForRoute(slug, projectsRoot) {
  try {
    return readProjectBySlug(slug, projectsRoot);
  } catch (error) {
    throw createStructuredError(
      "Project not found.",
      "project_not_found",
      404
    );
  }
}

function validateGenerationPrompt(promptInput) {
  if (typeof promptInput !== "string") {
    throw createStructuredError(
      "Generate preview requires a string prompt.",
      "generation_prompt_invalid_type",
      400
    );
  }

  const prompt = promptInput.trim();
  if (!prompt) {
    throw createStructuredError(
      "Generate preview requires a non-empty prompt.",
      "generation_prompt_required",
      400
    );
  }

  if (prompt.length < 10) {
    throw createStructuredError(
      "Generate preview prompt must be at least 10 characters.",
      "generation_prompt_too_short",
      400
    );
  }

  if (prompt.length > 2000) {
    throw createStructuredError(
      "Generate preview prompt must be 2000 characters or fewer.",
      "generation_prompt_too_long",
      400
    );
  }

  return prompt;
}

function planProofPathForRun(projectState, runId) {
  return path.join(projectState.runtimePath, "proofs", "plan-" + runId + ".json");
}

function buildGenerationPlanSummary(projectState, runState) {
  if (!runState || !runState.run) {
    return null;
  }

  const run = runState.run;
  const personalization = run.prompt_personalization && typeof run.prompt_personalization === "object"
    ? run.prompt_personalization
    : { source: "local_interpreter", fields: {}, warnings: [] };
  const stageWarnings = Array.isArray(run.warnings) ? run.warnings : [];

  return {
    plan_id: run.run_id,
    prompt_hash: run.prompt_hash || null,
    prompt_length: typeof run.prompt === "string" ? run.prompt.length : 0,
    status: run.status || "unknown",
    created_at: run.created_at || null,
    provider_called: false,
    personalization_source: personalization.source || "local_interpreter",
    interpreted_fields: personalization.fields || {},
    warnings: stageWarnings,
    estimated_input_tokens: Number(run.estimated_input_tokens || 0),
    estimated_output_tokens: Number(run.estimated_output_tokens || 0),
    estimated_total_tokens: Number(run.estimated_total_tokens || 0),
    plan_path: runState.runPath,
    proof_path: planProofPathForRun(projectState, run.run_id)
  };
}

function readGenerationPlanState(projectState, planId) {
  const safePlanId = normalizePlanId(planId);
  let runState;
  try {
    runState = readRunFile(projectState, safePlanId);
  } catch (error) {
    throw createStructuredError(
      "Generation plan was not found for this project.",
      "generation_plan_not_found",
      404
    );
  }

  try {
    assertPlanningRunReady(runState.run);
  } catch (error) {
    throw createStructuredError(
      error.message,
      "generation_plan_invalid",
      409
    );
  }

  if (String(runState.run.slug || "") !== String(projectState.project.slug || "")) {
    throw createStructuredError(
      "Generation plan does not belong to the selected project.",
      "generation_plan_project_mismatch",
      409
    );
  }

  return runState;
}

async function ensureProjectReadyToGenerate(slug, projectsRoot) {
  const setupResult = await getSetupStatus({
    slug,
    projectsRoot
  });

  if (!setupResult.setup || setupResult.setup.ready_to_generate !== true) {
    throw createStructuredError(
      "Project is not ready to generate yet.",
      "project_not_ready_to_generate",
      409,
      {
        blockers: setupResult.setup && setupResult.setup.dependencies
          ? setupResult.setup.dependencies.blockers || []
          : []
      }
    );
  }

  return setupResult;
}

async function buildGenerationStatusPayload(slug, projectsRoot) {
  const projectState = readProjectBySlug(slug, projectsRoot);
  const setupResult = await getSetupStatus({
    slug,
    projectsRoot
  });
  const latestOperationEntry = interruptOperationIfStale({
    slug,
    projectsRoot,
    hasActiveLock: Boolean(getGenerationMutationLock(slug))
  }) || getLatestGenerationOperation({
    slug,
    projectsRoot
  });
  let latestPlan = null;

  if (projectState.project.current_run_id) {
    try {
      latestPlan = buildGenerationPlanSummary(
        projectState,
        readGenerationPlanState(projectState, projectState.project.current_run_id)
      );
    } catch (error) {
      latestPlan = {
        plan_id: String(projectState.project.current_run_id || ""),
        status: "invalid",
        error: error.message
      };
    }
  }

  const siteResult = await getSiteStatus({
    slug,
    projectsRoot,
    persistProject: false,
    checkUrls: true
  });
  const activeLock = getGenerationMutationLock(slug);
  const latestOperation = latestOperationEntry ? latestOperationEntry.operation : null;

  return {
    project: summarizeProjectForSite(projectState.project),
    setup: setupResult.setup,
    latest_plan: latestPlan,
    current_operation: latestOperation && (latestOperation.status === "requested" || latestOperation.status === "running")
      ? latestOperation
      : null,
    latest_operation: latestOperation,
    operation_lock: activeLock ? {
      current_operation: activeLock.operation,
      acquired_at: activeLock.acquired_at
    } : null,
    site: siteResult.site
  };
}

function createLauncherServer(options) {
  const host = options.host || "127.0.0.1";
  const port = Number(options.port || 3847);
  const projectsRoot = resolveProjectsRoot(options.projectsRoot || DEFAULT_PROJECTS_ROOT);

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, "http://" + host + ":" + String(port));

    try {
      if (request.method === "GET" && requestUrl.pathname === "/") {
        sendText(response, 200, renderHomePage({ projectsRoot }), "text/html; charset=utf-8");
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/assets/styles.css") {
        serveAsset(response, "styles.css");
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/assets/app.js") {
        serveAsset(response, "app.js");
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/health") {
        sendJson(response, 200, {
          ok: true,
          service: "factory-launcher",
          mode: "alpha_scaffold_and_provisioning",
          host,
          port,
          projects_root: projectsRoot
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/projects") {
        sendJson(response, 200, {
          projects_root: projectsRoot,
          projects: listProjects(projectsRoot)
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/dependency-sources") {
        sendJson(response, 200, {
          ok: true,
          sources: listApprovedDependencySources()
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/projects") {
        const rawBody = await readRequestBody(request);
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const result = createProjectScaffold({
          name: payload.name,
          port: payload.port,
          slug: payload.slug,
          projectsRoot
        });

        sendJson(response, 201, {
          ok: true,
          status: "created",
          next_step: "Provision WordPress",
          project: result.project,
          files_written: result.files_written,
          directories_written: result.directories_written
        });
        return;
      }

      if (request.method === "GET" && /^\/api\/projects\/[^/]+\/setup$/.test(requestUrl.pathname)) {
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = await getSetupStatus({
          slug,
          projectsRoot
        });

        sendJson(response, 200, {
          ok: true,
          project: summarizeProjectForSite(result.project),
          approved_sources: result.approved_sources,
          setup: result.setup,
          warnings: result.warnings
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/provision$/.test(requestUrl.pathname)) {
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = await withSetupMutationLock(slug, "provision", () => {
          return provisionProject({
            slug,
            projectsRoot
          });
        });

        sendJson(response, 200, {
          ok: true,
          project: summarizeProjectForSite(result.project),
          status: "ready",
          wp_url: result.project.wp_url,
          root_http_status: result.rootHttpStatus,
          wp_json_status: result.wpJsonStatus,
          proof: result.proof,
          proof_path: result.proofPath
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/install-agent$/.test(requestUrl.pathname)) {
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = await withSetupMutationLock(slug, "install-agent", () => {
          return installAgent({
            slug,
            projectsRoot
          });
        });

        sendJson(response, 200, {
          ok: true,
          project: summarizeProjectForSite(result.project),
          status: "ready",
          rest_base: result.restBase,
          health: result.health,
          capabilities: result.capabilities,
          proof: result.proof,
          proof_path: result.proofPath
        });
        return;
      }

      if (request.method === "GET" && /^\/api\/projects\/[^/]+\/dependencies$/.test(requestUrl.pathname)) {
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = await getSetupStatus({
          slug,
          projectsRoot
        });

        sendJson(response, 200, {
          ok: true,
          project: summarizeProjectForSite(result.project),
          approved_sources: result.approved_sources,
          dependencies: result.setup.dependencies.rows,
          blockers: result.setup.dependencies.blockers,
          can_generate: result.setup.dependencies.can_generate,
          proof_path: result.setup.dependencies.proof_path,
          warnings: result.warnings
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/install-dependency$/.test(requestUrl.pathname)) {
        const rawBody = await readRequestBody(request);
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const approvedSource = resolveApprovedDependencySource(payload.dependency);

        if (!approvedSource.exists) {
          const missingError = new Error("Approved dependency ZIP is missing for " + approvedSource.key + ": " + approvedSource.absolutePath);
          missingError.code = "approved_dependency_zip_missing";
          throw missingError;
        }

        const result = await withSetupMutationLock(slug, "install-dependency:" + approvedSource.key, () => {
          return installDependency({
            slug,
            dependency: payload.dependency,
            zip: approvedSource.absolutePath,
            projectsRoot
          });
        });

        sendJson(response, 200, {
          ok: true,
          project: summarizeProjectForSite(result.project),
          dependency: result.dependency.slug,
          proof: result.proof,
          proof_path: result.proofPath
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/plan$/.test(requestUrl.pathname)) {
        const rawBody = await readRequestBody(request);
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = await planProject({
          slug,
          prompt: payload.prompt,
          projectsRoot: payload.projectsRoot || projectsRoot
        });

        sendJson(response, 200, {
          ok: true,
          status: result.run.status,
          run: result.run,
          proof: result.proof,
          run_path: result.runPath,
          proof_path: result.proofPath,
          project: result.project
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/generation\/plan$/.test(requestUrl.pathname)) {
        const rawBody = await readRequestBody(request);
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const slug = normalizeProjectSlugForRoute(decodeURIComponent(requestUrl.pathname.split("/")[3] || ""));
        assertProjectExistsForRoute(slug, projectsRoot);
        const prompt = validateGenerationPrompt(payload.prompt);
        const setupResult = await ensureProjectReadyToGenerate(slug, projectsRoot);
        const planResult = await planProject({
          slug,
          prompt,
          projectsRoot
        });
        const estimateResult = estimateAi({
          slug,
          projectsRoot,
          prompt
        });

        sendJson(response, 200, {
          ok: true,
          project: summarizeProjectForSite(planResult.project),
          plan_id: planResult.run.run_id,
          prompt_hash: planResult.proof.prompt_hash,
          personalization_source: planResult.proof.prompt_personalization
            ? planResult.proof.prompt_personalization.source || "local_interpreter"
            : "local_interpreter",
          provider_called: false,
          interpreted_fields: planResult.proof.prompt_personalization
            ? planResult.proof.prompt_personalization.fields || {}
            : {},
          warnings: Array.isArray(planResult.run.warnings) ? planResult.run.warnings : [],
          estimated_input_tokens: estimateResult.estimate.estimated_input_tokens,
          estimated_output_tokens: estimateResult.estimate.estimated_output_tokens,
          estimated_total_tokens: estimateResult.estimate.estimated_total_tokens,
          estimated_cost: estimateResult.estimate.estimated_cost,
          estimate_uncertainty: estimateResult.estimate.uncertainty,
          can_generate: setupResult.setup.dependencies.can_generate === true,
          dependency_blockers: setupResult.setup.dependencies.blockers || [],
          plan_path: planResult.runPath,
          plan_proof_path: planResult.proofPath,
          estimate_proof_path: estimateResult.proofPath,
          setup_ready: setupResult.setup.ready_to_generate === true,
          latest_plan: buildGenerationPlanSummary(
            readProjectBySlug(slug, projectsRoot),
            {
              runPath: planResult.runPath,
              run: planResult.run
            }
          )
        });
        return;
      }

      if (request.method === "GET" && /^\/api\/projects\/[^/]+\/generation$/.test(requestUrl.pathname)) {
        const slug = normalizeProjectSlugForRoute(decodeURIComponent(requestUrl.pathname.split("/")[3] || ""));
        assertProjectExistsForRoute(slug, projectsRoot);
        const result = await buildGenerationStatusPayload(slug, projectsRoot);

        sendJson(response, 200, {
          ok: true,
          project: result.project,
          setup: result.setup,
          latest_plan: result.latest_plan,
          current_operation: result.current_operation,
          latest_operation: result.latest_operation,
          operation_lock: result.operation_lock,
          site: result.site
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/generate$/.test(requestUrl.pathname)) {
        const rawBody = await readRequestBody(request);
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const slug = normalizeProjectSlugForRoute(decodeURIComponent(requestUrl.pathname.split("/")[3] || ""));
        assertProjectExistsForRoute(slug, projectsRoot);
        const setupLock = getSetupMutationLock(slug);
        if (setupLock) {
          throw createStructuredError(
            "A setup operation is already in progress for this project.",
            "setup_operation_in_progress",
            409,
            {
              current_operation: setupLock.operation
            }
          );
        }

        if (payload.confirm_generate !== true) {
          throw createStructuredError(
            "Generate requires confirm_generate=true.",
            "generation_confirmation_required",
            400
          );
        }

        const planId = normalizePlanId(payload.plan_id);
        const setupResult = await ensureProjectReadyToGenerate(slug, projectsRoot);
        const projectState = readProjectBySlug(slug, projectsRoot);
        const planState = readGenerationPlanState(projectState, planId);
        const priorSuccess = findSuccessfulOperationByPlanId({
          slug,
          projectsRoot,
          planId
        });

        if (priorSuccess) {
          throw createStructuredError(
            "This plan was already consumed by a successful controlled generate.",
            "generation_plan_already_consumed",
            409,
            {
              proof_path: priorSuccess.operation.proof_path || null
            }
          );
        }

        let operationSeed = null;
        let result = null;
        try {
          result = await withGenerationMutationLock(slug, "controlled-generate:" + planId, async () => {
            operationSeed = createGenerationOperation({
              slug,
              projectsRoot,
              planId,
              promptHash: planState.run.prompt_hash || null,
              statusDetail: "preparing"
            });
            await updateGenerationOperation({
              slug,
              projectsRoot,
              operationId: operationSeed.operation.operation_id,
              patch: {
                status: "running",
                status_detail: "validating",
                started_at: new Date().toISOString()
              }
            });

            return generateProject({
              slug,
              projectsRoot,
              planId,
              operationId: operationSeed.operation.operation_id,
              onProgress: async (statusDetail) => {
                await updateGenerationOperation({
                  slug,
                  projectsRoot,
                  operationId: operationSeed.operation.operation_id,
                  patch: {
                    status: "running",
                    status_detail: statusDetail
                  }
                });
              }
            });
          });
        } catch (error) {
          const failureProofPath = error.proofPath || null;
          if (operationSeed) {
            await updateGenerationOperation({
              slug,
              projectsRoot,
              operationId: operationSeed.operation.operation_id,
              patch: {
                status: "failed",
                status_detail: "failed",
                completed_at: new Date().toISOString(),
                proof_path: failureProofPath,
                error: {
                  code: error.code || "controlled_generate_failed",
                  message: error.message
                }
              }
            });
          }
          throw error;
        }

        const finalOperation = updateGenerationOperation({
          slug,
          projectsRoot,
          operationId: operationSeed.operation.operation_id,
          patch: {
            status: "succeeded",
            status_detail: "succeeded",
            completed_at: new Date().toISOString(),
            proof_path: result.proofPath,
            result_summary: {
              status: result.executeData.status || "ok",
              code: result.executeData.code || "controlled_generate_completed",
              provider_called: false,
              personalization_source: result.proof && result.proof.personalization
                ? result.proof.personalization.source || "local_interpreter"
                : "local_interpreter",
              counts_before: result.beforeCounts || null,
              counts_after: result.afterCounts || null,
              generated_urls: result.generatedUrls || {},
              url_status: result.urlStatus || {}
            }
          }
        });

        sendJson(response, 200, {
          ok: true,
          status: result.executeData.status,
          code: result.executeData.code,
          proof: result.proof,
          proof_path: result.proofPath,
          project: summarizeProjectForSite(result.project),
          generated_urls: result.generatedUrls,
          url_status: result.urlStatus,
          operation: finalOperation.operation,
          operation_path: finalOperation.operationPath,
          setup_ready: setupResult.setup.ready_to_generate === true
        });
        return;
      }

      if (request.method === "GET" && /^\/api\/projects\/[^/]+\/site$/.test(requestUrl.pathname)) {
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = await getSiteStatus({
          slug,
          projectsRoot,
          persistProject: false,
          checkUrls: true
        });

        sendJson(response, 200, {
          ok: true,
          project: summarizeProjectForSite(result.project),
          site: result.site
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/site\/surface-proof$/.test(requestUrl.pathname)) {
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = await writeSiteSurfaceProof({
          slug,
          projectsRoot,
          checkUrls: true
        });

        sendJson(response, 200, {
          ok: true,
          project: summarizeProjectForSite(result.project),
          site: result.site,
          proof: result.proof,
          proof_path: result.proofPath
        });
        return;
      }

      if (request.method === "GET" && /^\/api\/projects\/[^/]+\/state$/.test(requestUrl.pathname)) {
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = readStateStatus({
          slug,
          projectsRoot
        });
        const stateProject = summarizeProjectForSite(result.project);
        if (result.exists && result.state && stateProject.generated_site) {
          stateProject.generated_site = Object.assign({}, stateProject.generated_site, {
            personalization_last_applied: result.state.personalization || null
          });
        }

        sendJson(response, 200, {
          ok: true,
          exists: result.exists,
          project: stateProject,
          state_path: result.statePath,
          summary: result.summary,
          effective_safe_fields: result.exists && result.state ? result.state.effective_safe_fields || null : null,
          latest_apply_method: result.summary ? result.summary.latest_apply_method || null : null,
          warnings: result.warnings,
          rollback: result.rollback || null
        });
        return;
      }

      if (request.method === "GET" && /^\/api\/projects\/[^/]+\/proof-pack$/.test(requestUrl.pathname)) {
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = await getProofPackStatus({
          slug,
          projectsRoot
        });

        sendJson(response, 200, {
          ok: true,
          exists: result.exists,
          project: summarizeProjectForSite(result.project),
          proof_pack: result.proofPack,
          summary: result.summary,
          readiness: result.summary ? result.summary.readiness : null,
          missing_proof_categories: result.summary ? result.summary.missing_proof_categories : [],
          json_path: result.jsonPath,
          markdown_path: result.markdownPath,
          state_summary: result.stateSummary && result.stateSummary.summary ? result.stateSummary.summary : null,
          effective_safe_fields: result.stateSummary && result.stateSummary.state && result.stateSummary.state.effective_safe_fields
            ? result.stateSummary.state.effective_safe_fields
            : null,
          site_summary: result.siteSummary || null,
          warnings: result.warnings || []
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/proof-pack\/generate$/.test(requestUrl.pathname)) {
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = await generateProofPack({
          slug,
          projectsRoot
        });

        sendJson(response, 200, {
          ok: true,
          project: summarizeProjectForSite(result.project),
          proof_pack: result.proofPack,
          summary: result.summary,
          readiness: result.summary ? result.summary.readiness : null,
          missing_proof_categories: result.summary ? result.summary.missing_proof_categories : [],
          json_path: result.jsonPath,
          markdown_path: result.markdownPath
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/state\/refresh$/.test(requestUrl.pathname)) {
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = await refreshState({
          slug,
          projectsRoot
        });

        sendJson(response, 200, {
          ok: true,
          project: summarizeProjectForSite(result.project),
          state_path: result.statePath,
          snapshot_path: result.snapshotPath,
          proof_path: result.proofPath,
          summary: result.summary,
          effective_safe_fields: result.state.effective_safe_fields || null,
          warnings: result.state.warnings
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/state\/plan$/.test(requestUrl.pathname)) {
        const rawBody = await readRequestBody(request);
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = await planState({
          slug,
          projectsRoot,
          prompt: payload.prompt,
          overwriteFields: payload.overwrite_fields,
          aiSource: payload.ai_source,
          confirmLive: payload.confirm_live === true,
          estimate: payload.estimate
        });

        sendJson(response, 200, {
          ok: true,
          project: summarizeProjectForSite(result.project),
          plan: result.plan,
          plan_path: result.planPath,
          proof_path: result.proofPath,
          ai_source: result.plan.source && result.plan.source.ai_source || result.plan.source.prompt_personalization_source || "local_interpreter",
          provider_called: result.plan.provider_called === true,
          estimate_id: result.plan.source && result.plan.source.estimate_id || null,
          candidate_summary: result.plan.proposed ? result.plan.proposed.personalization : null,
          ai_candidate_proof_path: result.aiCandidateProofPath || null,
          field_scope: result.plan.field_scope || null,
          preserved_protected_fields: result.plan.field_scope && Array.isArray(result.plan.field_scope.preserved_protected_fields)
            ? result.plan.field_scope.preserved_protected_fields
            : [],
          excluded_fields: result.plan.field_scope && Array.isArray(result.plan.field_scope.excluded_fields)
            ? result.plan.field_scope.excluded_fields
            : [],
          included_fields: result.plan.field_scope && Array.isArray(result.plan.field_scope.included_fields)
            ? result.plan.field_scope.included_fields
            : [],
          confirmation_required: result.plan.confirmation_required || null,
          conflicts: result.plan.conflicts,
          warnings: result.plan.warnings
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/state\/apply$/.test(requestUrl.pathname)) {
        const rawBody = await readRequestBody(request);
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = await applyStatePlan({
          slug,
          projectsRoot,
          planPath: payload.plan_path,
          confirmOverwriteFields: payload.confirm_overwrite_fields
        });

        sendJson(response, 200, {
          ok: true,
          project: summarizeProjectForSite(result.project),
          status: result.status,
          code: result.code,
          apply_method: result.apply ? result.apply.apply_method : (result.proof ? result.proof.apply_method : null),
          field_only_apply: result.apply ? (result.apply.field_only_apply || null) : (result.proof ? (result.proof.field_only_apply || null) : null),
          apply: result.apply || result.proof,
          proof_path: result.proofPath,
          state_path: result.statePath,
          conflicts: result.conflicts || [],
          warnings: result.apply ? result.apply.warnings : (result.proof ? result.proof.warnings : [])
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/state\/rollback$/.test(requestUrl.pathname)) {
        const rawBody = await readRequestBody(request);
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = await rollbackStateApply({
          slug,
          projectsRoot,
          applyPath: payload.apply_path
        });

        sendJson(response, 200, {
          ok: true,
          project: summarizeProjectForSite(result.project),
          status: result.status,
          code: result.code,
          rollback: result.rollback || null,
          proof_path: result.proofPath || null,
          state_path: result.statePath,
          protected_conflicts: result.protectedConflicts || [],
          warnings: result.rollback ? result.rollback.warnings : []
        });
        return;
      }

      if (request.method === "GET" && /^\/api\/projects\/[^/]+\/ai$/.test(requestUrl.pathname)) {
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = getAiStatus({
          slug,
          projectsRoot
        });

        sendJson(response, 200, {
          ok: true,
          project: result.project,
          ai: result.ai,
          profiles: result.profiles
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/ai\/configure$/.test(requestUrl.pathname)) {
        const rawBody = await readRequestBody(request);
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = configureAi({
          slug,
          projectsRoot,
          mode: payload.mode,
          provider: payload.provider,
          modelProfile: payload.modelProfile,
          keyEnv: payload.keyEnv
        });

        sendJson(response, 200, {
          ok: true,
          project: result.project,
          ai: result.ai,
          proof: result.proof,
          proof_path: result.proofPath
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/ai\/enable-live$/.test(requestUrl.pathname)) {
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = enableLiveAi({
          slug,
          projectsRoot
        });

        sendJson(response, 200, {
          ok: true,
          project: result.project,
          ai: result.ai,
          proof: result.proof,
          proof_path: result.proofPath
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/ai\/estimate$/.test(requestUrl.pathname)) {
        const rawBody = await readRequestBody(request);
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = estimateAi({
          slug,
          projectsRoot,
          prompt: payload.prompt
        });

        sendJson(response, 200, {
          ok: true,
          project: result.project,
          ai: result.ai,
          estimate: result.estimate,
          proof: result.proof,
          proof_path: result.proofPath
        });
        return;
      }

      sendText(response, 404, "Not found");
    } catch (error) {
      const statusCode = error.statusCode || (request.method === "POST" && (
        requestUrl.pathname === "/api/projects" ||
        /^\/api\/projects\/[^/]+\/provision$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/install-agent$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/install-dependency$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/plan$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/generation\/plan$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/generate$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/site\/surface-proof$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/proof-pack\/generate$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/state\/refresh$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/state\/plan$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/state\/apply$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/state\/rollback$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/ai\/configure$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/ai\/enable-live$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/ai\/estimate$/.test(requestUrl.pathname)
      ) ? 400 : 500);
      sendJson(response, statusCode, {
        ok: false,
        error: error.message,
        code: error.code || null,
        current_operation: error.current_operation || null,
        proof_path: error.proofPath || null,
        blockers: error.blockers || []
      });
    }
  });

  return {
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          resolve({
            host,
            port,
            projectsRoot
          });
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

module.exports = {
  createLauncherServer
};
