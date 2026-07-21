"use strict";

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const {
  DEFAULT_JSON_BODY_LIMIT_BYTES,
  DEFAULT_LAUNCHER_HOST,
  createHttpSecurity,
  sanitizeErrorText
} = require("./http-security");
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
const { rotateAgentAuth, revokeAgentAuth } = require("./agent-auth-lifecycle");
const { installDependency } = require("./install-dependency");
const { listApprovedDependencySources } = require("./dependency-sources");
const { createManagedDependencyInstallPlan } = require("./managed-package-cache");
const { getSetupStatus } = require("./setup");
const { planProject } = require("./plan");
const { configureAi, enableLiveAi, estimateAi, getAiStatus } = require("./ai");
const { assertPlanningRunReady, generateProject, readRunFile } = require("./generate");
const { getSiteStatus, writeSiteSurfaceProof } = require("./site");
const {
  readStateStatus,
  refreshState,
  planState,
  applyStatePlan,
  rollbackStateApply,
  resolveStateApplyPathById,
  resolveStatePlanPathById
} = require("./state");
const { generateProofPack, getProofPackStatus } = require("./proof-pack");
const {
  computeRequestFingerprint,
  getProjectOperationsStatus,
  runProjectOperation
} = require("./project-operation-coordinator");
const {
  findSuccessfulControlledGenerateByPlanId,
  findSuccessfulOperationByMetadata,
  readOperationById
} = require("./project-operation-store");
const {
  normalizePlanId
} = require("./generation-operation");
const {
  assertOperationBelongsToProject,
  assertPlanBelongsToProject,
  normalizeOperationId,
  normalizeStatePlanId,
  rejectBrowserSuppliedStatePaths,
  summarizeStatePlanForClient,
  validateChangeRequestPrompt
} = require("./state-change-contract");
const {
  reconcileInterruptedStructuralRestores
} = require("./structural-restore-reconciliation");
const {
  getRecoveryStatus
} = require("./recovery-status-read-model");
const {
  createFullStructuralSnapshot
} = require("./structural-snapshot-capture");
const {
  listManifests
} = require("./structural-snapshot-store");
const {
  createRestorePlan
} = require("./structural-restore-plan");
const {
  executeManagedWebsiteRestore
} = require("./structural-restore-execution");

const UI_DIR = path.join(__dirname, "ui");
const BASE_SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sendJson(response, statusCode, payload, extraHeaders) {
  response.writeHead(statusCode, Object.assign({}, BASE_SECURITY_HEADERS, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  }, extraHeaders || {}));
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, statusCode, body, contentType, extraHeaders) {
  response.writeHead(statusCode, Object.assign({}, BASE_SECURITY_HEADERS, {
    "Content-Type": contentType || "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  }, extraHeaders || {}));
  response.end(body);
}

function readRequestBody(request, options) {
  if (request.__factoryBodyPromise) {
    return request.__factoryBodyPromise;
  }
  const limitBytes = Number(options && options.limitBytes || DEFAULT_JSON_BODY_LIMIT_BYTES);
  request.__factoryBodyPromise = new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let tooLarge = false;

    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (tooLarge) {
        return;
      }
      if (totalBytes > limitBytes) {
        tooLarge = true;
        return;
      }
      chunks.push(Buffer.from(chunk));
    });

    request.on("end", () => {
      if (tooLarge) {
        reject(createStructuredError(
          "Request body exceeds the Launcher JSON limit.",
          "request_body_too_large",
          413,
          { securityBoundary: true }
        ));
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
  return request.__factoryBodyPromise;
}

async function readJsonPayload(request, options) {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    throw createStructuredError(
      "Launcher API requests with JSON bodies require Content-Type: application/json.",
      "unsupported_media_type",
      415,
      { securityBoundary: true }
    );
  }
  const rawBody = await readRequestBody(request, options);
  if (!rawBody) {
    return {};
  }
  try {
    return JSON.parse(rawBody);
  } catch (error) {
    throw createStructuredError(
      "Request body must be valid JSON.",
      "invalid_json_body",
      400,
      { securityBoundary: true }
    );
  }
}

function renderHomePage(config) {
  const cspNonce = config.cspNonce || "";
  const packagedRuntime = config.packagedRuntime || null;
  const projectsRootLabel = packagedRuntime ? "Factory-managed project location" : escapeHtml(config.projectsRoot);
  const systemCheck = packagedRuntime && packagedRuntime.systemCheck;
  const systemCheckMarkup = systemCheck && Array.isArray(systemCheck.checks)
    ? (() => {
      const actionable = systemCheck.checks.filter((check) => check.state !== "PASS");
      const visibleChecks = actionable.length ? actionable : [{
        id: "ready",
        label: "Readiness",
        state: "PASS",
        message: "All required system checks passed."
      }];
      const actions = systemCheck.checks
        .filter((check) => check.action && check.action.url)
        .map((check) => "          <a class=\"button button-secondary\" href=\"" + escapeHtml(check.action.url) + "\" target=\"_blank\" rel=\"noreferrer\">" + escapeHtml(check.action.label) + "</a>")
        .join("\n");
      return [
        "    <section class=\"system-check\" id=\"system-check\" data-state=\"" + escapeHtml(systemCheck.state) + "\" aria-labelledby=\"system-check-title\">",
        "      <div class=\"system-check__summary\">",
        "        <div><p class=\"section-kicker\">System Check</p><h2 id=\"system-check-title\">" + escapeHtml(systemCheck.title) + "</h2><p>" + escapeHtml(systemCheck.message) + "</p></div>",
        "        <span class=\"system-check__state\">" + escapeHtml(systemCheck.state) + "</span>",
        "      </div>",
        "      <ul class=\"system-check__actions\">",
        visibleChecks.map((check) => "        <li data-state=\"" + escapeHtml(check.state) + "\"><strong>" + escapeHtml(check.label) + "</strong><span>" + escapeHtml(check.message) + "</span></li>").join("\n"),
        "      </ul>",
        "      <div class=\"system-check__buttons\">",
        actions,
        "        <a class=\"button\" href=\"" + escapeHtml(systemCheck.recheckPath || "/") + "\">Recheck</a>",
        "      </div>",
        systemCheck.checks.some((check) => check.id === "docker_application" && check.state !== "PASS")
          ? "      <p class=\"system-check__note\">System permission prompts may appear during Docker Desktop installation. " + escapeHtml(systemCheck.dockerLicensingNote || "") + "</p>"
          : "",
        "      <details class=\"system-check__details\"><summary>Technical details</summary><dl>",
        systemCheck.checks.map((check) => "        <div><dt>" + escapeHtml(check.label) + "</dt><dd>" + escapeHtml(check.state) + "</dd></div>").join("\n"),
        "      </dl></details>",
        "    </section>"
      ].join("\n");
    })() : "";
  const runtimeDiagnosticsMarkup = packagedRuntime && Array.isArray(packagedRuntime.diagnostics)
    ? [
      "          <section class=\"technical-section runtime-diagnostics\">",
      "            <div class=\"panel-header\">",
      "              <p class=\"section-kicker\">Diagnostics</p>",
      "              <h3>Factory runtime</h3>",
      "              <p>" + escapeHtml(packagedRuntime.summary || "Runtime checks completed.") + "</p>",
      "            </div>",
      "            <dl class=\"runtime-diagnostics-list\">",
      packagedRuntime.diagnostics.map((diagnostic) => {
        return "              <div><dt>" + escapeHtml(diagnostic.label) + "</dt><dd>" + escapeHtml(diagnostic.message) + "</dd></div>";
      }).join("\n"),
      "            </dl>",
      "          </section>"
    ].join("\n") : "";
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "  <meta charset=\"utf-8\">",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "  <title>Crocoblock Site Factory</title>",
    "  <link rel=\"stylesheet\" href=\"/assets/styles.css\">",
    "</head>",
    "<body>",
    "  <main class=\"launcher-shell\">",
    "    <header class=\"product-bar\">",
    "      <a class=\"product-brand\" href=\"#workspace\" aria-label=\"Crocoblock Site Factory home\">",
    "        <span class=\"product-mark\" aria-hidden=\"true\"><span></span><span></span><span></span></span>",
    "        <span><strong>Crocoblock</strong><small>Site Factory</small></span>",
    "      </a>",
    "      <nav class=\"product-nav\" aria-label=\"Product navigation\">",
    "        <a href=\"#projects\">Projects</a>",
    systemCheckMarkup ? "        <a href=\"#system-check\">System Check</a>" : "        <a href=\"#workspace\">Workspace</a>",
    "        <a href=\"#technical-details\">Technical details</a>",
    "      </nav>",
    "      <button type=\"button\" class=\"icon-button\" id=\"theme-toggle\" aria-label=\"Switch color theme\" aria-pressed=\"false\"><span aria-hidden=\"true\">◐</span><span id=\"theme-toggle-label\">Dark mode</span></button>",
    "    </header>",
    systemCheckMarkup,
    "    <section class=\"project-hero\" id=\"workspace\" aria-labelledby=\"selected-project-name\">",
    "      <div class=\"project-hero__content\">",
    "        <p class=\"section-kicker\">Current project</p>",
    "        <div class=\"project-hero__title-row\">",
    "          <h1 id=\"selected-project-name\">Loading projects…</h1>",
    "          <span class=\"status-pill status-pill--large\" id=\"selected-project-status\">Loading</span>",
    "        </div>",
    "        <p class=\"project-hero__next\" id=\"selected-project-next\">Preparing your workspace.</p>",
    "      </div>",
    "      <div class=\"project-hero__actions\">",
    "        <a class=\"button button-secondary\" id=\"selected-project-open\" href=\"#\" target=\"_blank\" rel=\"noreferrer\" hidden>Open website</a>",
    "        <button type=\"button\" class=\"button\" id=\"launcher-milestone-generate\" disabled>Generate site</button>",
    "      </div>",
    "    </section>",
    "    <div class=\"workspace-layout\">",
    "      <aside class=\"project-sidebar panel\" id=\"projects\">",
    "        <div class=\"panel-header panel-header--row\"><div><p class=\"section-kicker\">Portfolio</p><h2>Projects</h2></div><span class=\"status-pill\" id=\"project-count\">…</span></div>",
    "        <label class=\"field-label\" for=\"generate-project-slug\">Current project</label>",
    "        <select name=\"slug\" id=\"generate-project-slug\" class=\"project-switcher\"></select>",
    "        <div id=\"project-list\" class=\"project-list project-list--navigation\"></div>",
    "        <details class=\"secondary-disclosure\">",
    "          <summary>Create project</summary>",
    "          <form id=\"create-project-form\" class=\"project-form\">",
    "            <label><span>Site name</span><input name=\"name\" type=\"text\" required placeholder=\"Kyiv Realty\"></label>",
    "            <label><span>Project slug</span><input name=\"slug\" type=\"text\" required placeholder=\"kyiv-realty\" pattern=\"[a-z0-9]+(?:-[a-z0-9]+)*\"></label>",
    "            <label><span>WordPress port</span><input name=\"port\" type=\"number\" min=\"1024\" max=\"65535\" value=\"8120\" required></label>",
    "            <p class=\"project-note\">Real Estate project · " + projectsRootLabel + "</p>",
    "            <button type=\"submit\" class=\"button\">Create project</button>",
    "          </form>",
    "          <div id=\"create-result\" class=\"result-box\" hidden></div>",
    "        </details>",
    "      </aside>",
    "      <div class=\"primary-workspace\">",
    "        <section class=\"capability-grid\" aria-label=\"Site actions\">",
    "          <section class=\"panel capability-card capability-card--generate\" id=\"generate-site\">",
    "            <div class=\"capability-card__icon\" aria-hidden=\"true\">✦</div>",
    "            <div class=\"panel-header\"><p class=\"section-kicker\">Build</p><h2>Generate site</h2><p>Describe the website you want, review the plan, then start generation when ready.</p></div>",
    "            <p class=\"capability-status\"><span id=\"generate-capability-status\">Checking readiness</span></p>",
    "        <form id=\"generate-project-form\" class=\"project-form\">",
    "          <label>",
    "            <span>Describe your site</span>",
    "            <textarea name=\"prompt\" id=\"generate-prompt\" rows=\"4\" required placeholder=\"Create a family-focused real estate website with homes near parks and schools.\"></textarea>",
    "          </label>",
    "          <div class=\"generate-action-row\">",
    "            <button type=\"button\" class=\"button button-secondary\" id=\"generate-preview-button\">Review plan</button>",
    "            <button type=\"submit\" class=\"button\" id=\"generate-submit-button\" disabled>Generate site</button>",
    "          </div>",
    "          <label class=\"checkbox-row\">",
    "            <input type=\"checkbox\" id=\"generate-confirm-checkbox\">",
    "            <span>I understand that generation updates this website.</span>",
    "          </label>",
    "        </form>",
    "        <div id=\"generation-status\" class=\"project-list\"></div>",
    "        <div id=\"generate-preview-result\" class=\"result-box\" hidden></div>",
    "        <div id=\"generate-result\" class=\"result-box\" hidden></div>",
    "          </section>",
    "          <section class=\"panel capability-card capability-card--edit\" id=\"edit-site\">",
    "            <div class=\"capability-card__icon\" aria-hidden=\"true\">↗</div>",
    "            <div class=\"panel-header\"><p class=\"section-kicker\">Refine</p><h2>Edit site</h2><p>Review the live result and prepare a focused, protected content change.</p></div>",
    "            <p class=\"capability-status\"><span id=\"edit-capability-status\">Waiting for a site</span></p>",
    "            <form id=\"state-plan-form\" class=\"project-form compact-form\">",
    "          <label>",
    "              <span>What would you like to change?</span>",
    "              <textarea name=\"prompt\" id=\"state-plan-prompt\" rows=\"3\" placeholder=\"Update the homepage message without changing protected content.\"></textarea>",
    "          </label>",
    "          <label class=\"checkbox-row\">",
    "            <input type=\"checkbox\" id=\"state-overwrite-hero-title-checkbox\">",
    "              <span>Allow replacing the protected homepage headline.</span>",
    "          </label>",
    "              <button type=\"submit\" class=\"button\" id=\"state-plan-button\">Review changes</button>",
    "        </form>",
    "        <div id=\"state-plan-result\" class=\"result-box\" hidden></div>",
    "        <div id=\"state-rollback-result\" class=\"result-box\" hidden></div>",
    "            <div id=\"site-status\" class=\"project-list\"></div>",
    "            <div id=\"managed-state\" class=\"project-list\"></div>",
    "            <div class=\"managed-state-actions\"><button type=\"button\" class=\"button button-secondary\" id=\"refresh-state-button\">Refresh site state</button></div>",
    "          </section>",
    "          <section class=\"panel capability-card capability-card--recovery\" id=\"recovery\">",
    "            <div class=\"capability-card__icon\" aria-hidden=\"true\">↺</div>",
    "            <div class=\"panel-header\"><p class=\"section-kicker\">Protect</p><h2>Recovery</h2><p>Create a verified Recovery Point or restore the website when one is available.</p></div>",
    "            <p class=\"capability-status\"><span id=\"recovery-capability-status\">Checking protection</span></p>",
    "            <div id=\"recovery-status\" class=\"project-list\"></div>",
    "          </section>",
    "        </section>",
    "        <details class=\"technical-hub panel\" id=\"technical-details\">",
    "          <summary><span><span class=\"section-kicker\">Secondary</span><strong>Technical details &amp; setup</strong></span><span aria-hidden=\"true\">＋</span></summary>",
    "          <div class=\"technical-grid\">",
    "            <section class=\"technical-section\"><div class=\"panel-header\"><h3>Project setup</h3><p>Provision WordPress and prepare approved dependencies.</p></div><form id=\"setup-project-form\" class=\"project-form compact-form\"><label><span>Project</span><select name=\"slug\" id=\"setup-project-slug\"></select></label></form><div id=\"setup-status\" class=\"project-list\"></div><div id=\"setup-result\" class=\"result-box\" hidden></div></section>",
    "            <section class=\"technical-section\"><div class=\"panel-header\"><h3>Read-only planning</h3><p>Prepare a diagnostic plan without changing the website.</p></div><form id=\"plan-project-form\" class=\"project-form\"><label><span>Project</span><select name=\"slug\" id=\"plan-project-slug\"></select></label><label><span>Prompt</span><textarea name=\"prompt\" rows=\"4\" required placeholder=\"Create a real estate site for Kyiv apartments\"></textarea></label><button type=\"submit\" class=\"button button-secondary\">Run read-only plan</button></form><div id=\"plan-result\" class=\"result-box\" hidden></div></section>",
    "            <section class=\"technical-section\"><div class=\"panel-header\"><h3>Project history</h3><p>Recent task status and detailed operation records.</p></div><div id=\"project-operations\" class=\"project-list\"></div><div id=\"latest-run\" class=\"project-list\"></div></section>",
    "            <section class=\"technical-section\"><div class=\"panel-header\"><h3>AI diagnostics</h3><p>Model and usage metadata for this local configuration.</p></div><div class=\"placeholder-grid\"><div><span>Mode</span><strong id=\"launcher-ai-mode\">mock</strong></div><div><span>Provider</span><strong id=\"launcher-ai-provider\">mock</strong></div><div><span>Model profile</span><strong id=\"launcher-ai-model\">balanced</strong></div><div><span>Key status</span><strong id=\"launcher-ai-key-status\">not_required</strong></div><div><span>Last estimate</span><strong id=\"launcher-ai-last-estimate\">Not recorded</strong></div><div><span>Total tokens</span><strong id=\"launcher-total-tokens\">0</strong></div></div></section>",
    "            <section class=\"technical-section technical-section--wide\"><div class=\"panel-header\"><h3>Proof pack</h3><p>Read-only evaluator summary and diagnostics.</p></div><div id=\"proof-pack-status\" class=\"project-list\"></div><div class=\"managed-state-actions\"><button type=\"button\" class=\"button button-secondary\" id=\"proof-pack-refresh-button\">Refresh</button><button type=\"button\" class=\"button button-secondary\" id=\"proof-pack-generate-button\">Generate proof pack</button></div><div id=\"proof-pack-result\" class=\"result-box\" hidden></div></section>",
    runtimeDiagnosticsMarkup,
    "          </div>",
    "        </details>",
    "      </div>",
    "    </div>",
    "  </main>",
    "  <script nonce=\"" + escapeHtml(cspNonce) + "\">window.FactoryLauncherConfig = " + JSON.stringify({
      projectsRoot: packagedRuntime ? null : config.projectsRoot,
      packagedRuntime: Boolean(packagedRuntime),
      sessionPath: "/api/security/session"
    }) + ";</script>",
    "  <script src=\"/assets/project-summary-counts.js\"></script>",
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
  sendText(response, 200, fs.readFileSync(assetPath, "utf8"), contentType, {
    "Cache-Control": "no-store"
  });
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

function sendRecoveryStatusError(response, error) {
  const code = error && error.code;
  if (code === "project_not_found") {
    sendJson(response, 404, {
      ok: false,
      status: "error",
      code: "project_not_found",
      error: "Project not found.",
      message: "Project not found."
    });
    return;
  }
  if (code === "invalid_project_slug") {
    sendJson(response, 400, {
      ok: false,
      status: "error",
      code: "invalid_project_slug",
      error: "Project slug is invalid.",
      message: "Project slug is invalid."
    });
    return;
  }
  const statusCode = code === "recovery_metadata_unreadable" || code === "unsupported_recovery_metadata"
    ? 503
    : 500;
  const safeCode = statusCode === 503 ? "recovery_status_unavailable" : "recovery_status_failed";
  const safeMessage = statusCode === 503
    ? "Recovery status is temporarily unavailable."
    : "Recovery status could not be loaded safely.";
  sendJson(response, statusCode, {
    ok: false,
    status: "error",
    code: safeCode,
    error: safeMessage,
    message: safeMessage
  });
}

function validateRecoveryPointCreatePayload(payload) {
  const input = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const rejectedFields = Object.keys(input).filter((field) => field !== "confirm_create_recovery_point");
  if (rejectedFields.length > 0) {
    throw createStructuredError(
      "Recovery Point creation accepts confirmation only.",
      "recovery_point_request_rejected",
      400
    );
  }
  if (input.confirm_create_recovery_point !== true) {
    throw createStructuredError(
      "Create Recovery Point requires confirmation.",
      "recovery_point_confirmation_required",
      400
    );
  }
}

function buildRecoveryPointCreateResponse(operationResult) {
  const result = operationResult && operationResult.result;
  const manifest = result && result.manifest;
  const summary = result && result.summary;
  if (
    !manifest ||
    manifest.status !== "verified" ||
    !summary ||
    summary.restorable !== true ||
    summary.verification_state !== "verified"
  ) {
    throw createStructuredError(
      "Recovery Point could not be verified.",
      "recovery_point_verification_failed",
      500
    );
  }
  return {
    ok: true,
    status: operationResult.idempotentReplay ? "replayed" : "created",
    idempotent_replay: operationResult.idempotentReplay === true,
    operation: {
      status: operationResult.operation && operationResult.operation.status === "succeeded"
        ? "succeeded"
        : "unknown"
    },
    recovery_point: {
      status: "verified",
      restorable: true
    }
  };
}

function sendRecoveryPointCreateError(response, error) {
  const code = error && error.code;
  const known = {
    invalid_project_slug: [400, "Project slug is invalid."],
    project_not_found: [404, "Project not found."],
    recovery_point_confirmation_required: [400, "Create Recovery Point requires confirmation."],
    recovery_point_request_rejected: [400, "Recovery Point creation accepts confirmation only."],
    invalid_idempotency_key: [400, "Recovery Point request could not be accepted."],
    idempotency_key_conflict: [409, "Recovery Point request conflicts with an earlier request."],
    operation_retry_requires_new_idempotency_key: [409, "Recovery Point could not be created. Review the issue and try again."],
    project_operation_in_progress: [409, "Recovery Point creation is already in progress."],
    recovery_point_verification_failed: [500, "Recovery Point could not be verified."],
    snapshot_disk_space_low: [409, "Recovery Point could not be created. Review the issue and try again."]
  };
  const entry = known[code] || [500, "Recovery Point could not be created. Review the issue and try again."];
  sendJson(response, entry[0], {
    ok: false,
    status: "error",
    code: code && Object.prototype.hasOwnProperty.call(known, code) ? code : "recovery_point_create_failed",
    error: entry[1],
    message: entry[1]
  });
}

function listRecoveryPointsForBrowser(projectsRoot, slug) {
  return listManifests({ projectsRoot, slug })
    .filter((summary) => summary && summary.verification_state === "verified" && summary.restorable === true)
    .map((summary) => ({
      reference: summary.snapshot_id,
      label: summary.customer_label || "Recovery Point",
      created_at: summary.created_at,
      status: "verified",
      restorable: true
    }));
}

function validateRestorePlanPayload(payload) {
  const input = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  if (Object.keys(input).length > 0) {
    throw createStructuredError(
      "Restore planning accepts a selected Recovery Point only.",
      "restore_plan_request_rejected",
      400
    );
  }
}

function validateRestoreExecutionPayload(payload) {
  const input = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  if (!input || Object.keys(input).some((field) => field !== "plan_id" && field !== "exact_confirmation")) {
    throw createStructuredError(
      "Restore execution accepts the reviewed plan and exact confirmation only.",
      "restore_execution_request_rejected",
      400
    );
  }
  if (typeof input.plan_id !== "string" || typeof input.exact_confirmation !== "string") {
    throw createStructuredError(
      "Restore execution requires the reviewed plan and exact confirmation.",
      "restore_execution_confirmation_required",
      400
    );
  }
  return {
    planId: input.plan_id,
    exactConfirmation: input.exact_confirmation
  };
}

function summarizeRestorePlanForBrowser(summary) {
  if (!summary || typeof summary !== "object" || !summary.plan_id || !summary.confirmation || !summary.impact_summary) {
    throw createStructuredError("Restore review could not be prepared.", "restore_plan_invalid", 500);
  }
  return {
    plan_id: summary.plan_id,
    recovery_point: {
      label: summary.recovery_point_label || "Recovery Point",
      created_at: summary.recovery_point_created_at || null
    },
    readiness: summary.readiness,
    restore_boundary: summary.restore_boundary,
    warnings: Array.isArray(summary.warnings) ? summary.warnings : [],
    blockers: Array.isArray(summary.blockers) ? summary.blockers : [],
    rescue_strategy: summary.rescue_strategy || null,
    confirmation: {
      required: summary.confirmation.required === true,
      mode: summary.confirmation.mode === "emergency" ? "emergency" : "normal",
      phrase: String(summary.confirmation.phrase || ""),
      warning: summary.confirmation.warning || null
    },
    impact_summary: summary.impact_summary
  };
}

function buildRestorePlanResponse(planResult) {
  return {
    ok: true,
    status: planResult && planResult.idempotentReplay === true ? "replayed" : "planned",
    idempotent_replay: planResult && planResult.idempotentReplay === true,
    restore_plan: summarizeRestorePlanForBrowser(planResult && planResult.summary)
  };
}

function buildRestoreExecutionResponse(operationResult) {
  const operation = operationResult && operationResult.operation || {};
  const summary = operation.result_summary && typeof operation.result_summary === "object"
    ? operation.result_summary
    : {};
  if (operation.status !== "succeeded" || summary.status !== "succeeded" || summary.restore_verified !== true) {
    throw createStructuredError("Restore did not complete verification.", "restore_verification_failed", 500);
  }
  return {
    ok: true,
    status: operationResult.idempotentReplay === true ? "replayed" : "completed",
    idempotent_replay: operationResult.idempotentReplay === true,
    restore: {
      status: "succeeded",
      verified: true,
      manual_recovery_required: false
    }
  };
}

function sendRestoreFlowError(response, error) {
  if (error && (error.manualRecoveryRequired === true || error.result_summary && error.result_summary.manual_recovery_required === true)) {
    sendJson(response, 409, {
      ok: false,
      status: "recovery_requires_attention",
      code: "restore_recovery_required",
      error: "Restore requires attention. Manual recovery is required.",
      message: "Restore requires attention. Manual recovery is required.",
      recovery: {
        manual_recovery_required: true
      }
    });
    return;
  }
  const code = error && error.code;
  const known = {
    invalid_project_slug: [400, "Project slug is invalid."],
    project_not_found: [404, "Project not found."],
    restore_plan_request_rejected: [400, "Restore planning accepts a selected Recovery Point only."],
    restore_execution_request_rejected: [400, "Restore execution accepts the reviewed plan and exact confirmation only."],
    restore_execution_confirmation_required: [400, "Restore execution requires the reviewed plan and exact confirmation."],
    restore_snapshot_not_found: [404, "Recovery Point was not found."],
    restore_plan_not_found: [404, "Restore plan was not found."],
    restore_snapshot_not_verified: [409, "Recovery Point is not verified."],
    restore_snapshot_not_restorable: [409, "Recovery Point is not available for restore."],
    restore_project_binding_mismatch: [409, "Recovery Point is not bound to this project."],
    restore_confirmation_required: [400, "Restore confirmation text is required."],
    restore_confirmation_mismatch: [409, "Restore confirmation text does not match."],
    restore_plan_expired: [410, "Restore review has expired. Review the Recovery Point again."],
    restore_plan_not_ready: [409, "Restore review is not ready for execution."],
    restore_active_operation: [409, "A project operation is active. Restore cannot begin yet."],
    project_operation_in_progress: [409, "A project operation is active. Restore cannot begin yet."],
    restore_disk_space_insufficient: [409, "Restore requires more available storage before it can begin."],
    restore_emergency_plan_obsolete: [409, "A safer restore review is now available. Review it again."],
    restore_artifact_digest_mismatch: [409, "Recovery Point changed after review. Review it again."],
    restore_execution_input_rejected: [400, "Restore execution accepts the reviewed plan and exact confirmation only."],
    restore_verification_failed: [500, "Restore did not complete verification."],
    idempotency_key_conflict: [409, "Restore request conflicts with an earlier request."],
    operation_retry_requires_new_idempotency_key: [409, "Restore did not complete. Review the result and try again."]
  };
  const entry = known[code] || [500, "Restore did not complete. Review the result and try again."];
  sendJson(response, entry[0], {
    ok: false,
    status: "error",
    code: code && Object.prototype.hasOwnProperty.call(known, code) ? code : "restore_failed",
    error: entry[1],
    message: entry[1]
  });
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

function getRequestIdempotencyKey(request) {
  const raw = request.headers["idempotency-key"];
  return Array.isArray(raw) ? raw[0] : raw;
}

function buildOperationResponse(result, payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const operation = result.operation || null;
  return Object.assign({}, safePayload, {
    operation,
    operation_result_summary: operation && operation.result_summary ? operation.result_summary : null,
    proof_ref: operation && operation.proof_ref ? operation.proof_ref : null,
    idempotent_replay: result.idempotentReplay === true
  });
}

function assertNoClientPackageSource(payload) {
  const forbiddenFields = [
    "zip",
    "zip_path",
    "zipPath",
    "source_path",
    "sourcePath",
    "path",
    "url",
    "checksum",
    "sha256",
    "cache_path",
    "cachePath",
    "absolutePath"
  ];

  for (const field of forbiddenFields) {
    if (Object.prototype.hasOwnProperty.call(payload || {}, field)) {
      throw createStructuredError(
        "Dependency package sources are resolved by the trusted Launcher catalog only.",
        "client_dependency_source_not_allowed",
        400
      );
    }
  }
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
  const operationsStatus = getProjectOperationsStatus({
    slug,
    projectsRoot,
    limit: 20
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
  const latestOperation = operationsStatus.operations.length ? operationsStatus.operations[0] : null;

  return {
    project: summarizeProjectForSite(projectState.project),
    setup: setupResult.setup,
    latest_plan: latestPlan,
    current_operation: operationsStatus.active_operation || null,
    latest_operation: latestOperation,
    operations: operationsStatus.operations,
    operation_lock: operationsStatus.active_operation ? {
      current_operation: operationsStatus.active_operation
    } : null,
    site: siteResult.site
  };
}

function readJsonMaybe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return null;
  }
}

function resolveStatePlanForRoute(slug, projectsRoot, planId) {
  const safePlanId = normalizeStatePlanId(planId);
  const planPath = resolveStatePlanPathById({
    slug,
    projectsRoot,
    planId: safePlanId
  });
  if (!planPath) {
    throw createStructuredError(
      "State plan was not found for this project.",
      "state_plan_not_found",
      404
    );
  }

  const plan = readJsonMaybe(planPath);
  if (!plan) {
    throw createStructuredError(
      "State plan could not be read.",
      "state_plan_unreadable",
      409
    );
  }
  assertPlanBelongsToProject(plan, slug);
  return { planId: safePlanId, planPath, plan };
}

function getStateRollbackCandidates(slug, projectsRoot, operations) {
  const safeOperations = Array.isArray(operations) ? operations : [];
  const successfulRollbacks = new Set(
    safeOperations
      .filter((operation) => operation.operation_type === "state_rollback" && operation.status === "succeeded")
      .flatMap((operation) => [
        operation.metadata && operation.metadata.target_apply_operation_id,
        operation.metadata && operation.metadata.source_apply_id
      ])
      .filter(Boolean)
  );

  return safeOperations
    .filter((operation) => operation.operation_type === "state_apply" && operation.status === "succeeded")
    .filter((operation) => !successfulRollbacks.has(operation.operation_id))
    .filter((operation) => {
      const applyId = operation.result_summary && operation.result_summary.apply_id;
      return !applyId || !successfulRollbacks.has(applyId);
    })
    .map((operation) => {
      const applyId = operation.result_summary && operation.result_summary.apply_id || null;
      return {
        apply_operation_id: operation.operation_id,
        apply_id: applyId,
        status: operation.status,
        completed_at: operation.completed_at || null,
        apply_method: operation.result_summary && operation.result_summary.apply_method || null,
        applied_fields: operation.result_summary && Array.isArray(operation.result_summary.applied_fields)
          ? operation.result_summary.applied_fields
          : [],
        rollback_eligible: Boolean(applyId && resolveStateApplyPathById({
          slug,
          projectsRoot,
          applyId
        }))
      };
    });
}

async function buildStateChangeStatusPayload(slug, projectsRoot) {
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
  const operationsStatus = getProjectOperationsStatus({
    slug,
    projectsRoot,
    limit: 30
  });
  const rollbackCandidates = getStateRollbackCandidates(slug, projectsRoot, operationsStatus.operations);

  return {
    ok: true,
    exists: result.exists,
    project: stateProject,
    state_path: result.statePath,
    summary: result.summary,
    effective_safe_fields: result.exists && result.state ? result.state.effective_safe_fields || null : null,
    latest_apply_method: result.summary ? result.summary.latest_apply_method || null : null,
    active_operation: operationsStatus.active_operation || null,
    operations: operationsStatus.operations.filter((operation) => operation.operation_type === "state_apply" || operation.operation_type === "state_rollback"),
    rollback_candidates: rollbackCandidates,
    rollback: Object.assign({}, result.rollback || {}, {
      apply_operation_id: rollbackCandidates.length ? rollbackCandidates[0].apply_operation_id : null,
      apply_path: undefined
    }),
    warnings: result.warnings
  };
}

function createLauncherServer(options) {
  const host = options.host || DEFAULT_LAUNCHER_HOST;
  const port = Number(options.port || 3847);
  const projectsRoot = resolveProjectsRoot(options.projectsRoot || DEFAULT_PROJECTS_ROOT);
  const httpSecurity = createHttpSecurity({
    host,
    port,
    jsonBodyLimitBytes: options.jsonBodyLimitBytes,
    mutationRateLimitMax: options.mutationRateLimitMax,
    mutationRateLimitWindowMs: options.mutationRateLimitWindowMs
  });

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, "http://" + DEFAULT_LAUNCHER_HOST + ":" + String(port));
    let requestSecurity = null;

    try {
      requestSecurity = httpSecurity.enforce(request, response, requestUrl);
      if (requestSecurity && requestSecurity.handled) {
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/") {
        const cspNonce = crypto.randomBytes(16).toString("base64");
        sendText(response, 200, renderHomePage({
          projectsRoot,
          cspNonce,
          packagedRuntime: options.packagedRuntime
        }), "text/html; charset=utf-8", {
          "Content-Security-Policy": [
            "default-src 'self'",
            "script-src 'self' 'nonce-" + cspNonce + "'",
            "style-src 'self'",
            "img-src 'self' data:",
            "connect-src 'self'",
            "font-src 'self'",
            "object-src 'none'",
            "base-uri 'none'",
            "frame-ancestors 'none'",
            "form-action 'self'"
          ].join("; ")
        });
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

      if (request.method === "GET" && requestUrl.pathname === "/assets/project-summary-counts.js") {
        serveAsset(response, "project-summary-counts.js");
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/health") {
        sendJson(response, 200, {
          ok: true,
          service: "factory-launcher",
          mode: "alpha_scaffold_and_provisioning",
          host,
          port,
          projects_root: options.packagedRuntime ? undefined : projectsRoot
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/security/session") {
        const sessionBootstrap = httpSecurity.getSessionBootstrap(requestSecurity.hostInfo);
        sendJson(response, 200, sessionBootstrap.body);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/projects") {
        sendJson(response, 200, {
          projects_root: options.packagedRuntime ? undefined : projectsRoot,
          projects: listProjects(projectsRoot)
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/dependency-sources") {
        sendJson(response, 200, {
          ok: true,
          sources: listApprovedDependencySources(options.dependencySourceOptions)
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/projects") {
        const payload = await readJsonPayload(request);
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
        await readJsonPayload(request);
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const operationResult = await runProjectOperation({
          slug,
          projectsRoot,
          operationType: "provision",
          idempotencyKey: getRequestIdempotencyKey(request),
          fingerprintInput: { project_slug: slug, operation_type: "provision" },
          metadata: {},
          execute: async () => {
            const result = await provisionProject({
              slug,
              projectsRoot
            });
            return {
              result,
              proofRef: result.proofPath,
              resultSummary: {
                status: "ready",
                wp_url: result.project.wp_url,
                root_http_status: result.rootHttpStatus,
                wp_json_status: result.wpJsonStatus
              }
            };
          }
        });
        if (operationResult.idempotentReplay) {
          sendJson(response, 200, buildOperationResponse(operationResult, {
            ok: true,
            status: "replayed"
          }));
          return;
        }
        const result = operationResult.result;

        sendJson(response, 200, buildOperationResponse(operationResult, {
          ok: true,
          project: summarizeProjectForSite(result.project),
          status: "ready",
          wp_url: result.project.wp_url,
          root_http_status: result.rootHttpStatus,
          wp_json_status: result.wpJsonStatus,
          proof: result.proof,
          proof_path: result.proofPath
        }));
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/install-agent$/.test(requestUrl.pathname)) {
        await readJsonPayload(request);
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const operationResult = await runProjectOperation({
          slug,
          projectsRoot,
          operationType: "install_agent",
          idempotencyKey: getRequestIdempotencyKey(request),
          fingerprintInput: { project_slug: slug, operation_type: "install_agent" },
          metadata: {},
          execute: async () => {
            const result = await installAgent({
              slug,
              projectsRoot
            });
            return {
              result,
              proofRef: result.proofPath,
              resultSummary: {
                status: "ready",
                rest_base: result.restBase,
                health_status: result.health && result.health.status || null,
                capabilities_status: result.capabilities && result.capabilities.status || null
              }
            };
          }
        });
        if (operationResult.idempotentReplay) {
          sendJson(response, 200, buildOperationResponse(operationResult, {
            ok: true,
            status: "replayed"
          }));
          return;
        }
        const result = operationResult.result;

        sendJson(response, 200, buildOperationResponse(operationResult, {
          ok: true,
          project: summarizeProjectForSite(result.project),
          status: "ready",
          rest_base: result.restBase,
          health: result.health,
          capabilities: result.capabilities,
          proof: result.proof,
          proof_path: result.proofPath
        }));
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/agent-auth\/rotate$/.test(requestUrl.pathname)) {
        await readJsonPayload(request);
        const slug = normalizeProjectSlugForRoute(decodeURIComponent(requestUrl.pathname.split("/")[3] || ""));
        assertProjectExistsForRoute(slug, projectsRoot);
        const operationResult = await runProjectOperation({
          slug,
          projectsRoot,
          operationType: "agent_auth_rotate",
          idempotencyKey: getRequestIdempotencyKey(request),
          resumeStatuses: ["interrupted", "failed"],
          fingerprintInput: {
            project_slug: slug,
            operation_type: "agent_auth_rotate"
          },
          metadata: {},
          safety: {
            live_ai_used: false,
            apply_used: false,
            rollback_used: false
          },
          execute: async () => {
            const result = await rotateAgentAuth({
              slug,
              projectsRoot
            });
            return {
              result,
              proofRef: result.proofPath || null,
              resultSummary: {
                status: result.status,
                code: result.code,
                old_key_id: result.oldKeyId,
                new_key_id: result.newKeyId,
                old_key_rejection_code: result.oldKeyRejectionCode,
                rotation_stage: result.rotationState ? result.rotationState.stage : null
              }
            };
          }
        });
        if (operationResult.idempotentReplay) {
          sendJson(response, 200, buildOperationResponse(operationResult, {
            ok: true,
            status: "replayed"
          }));
          return;
        }
        const result = operationResult.result;
        sendJson(response, 200, buildOperationResponse(operationResult, {
          ok: true,
          status: result.status,
          code: result.code,
          old_key_id: result.oldKeyId,
          new_key_id: result.newKeyId,
          rotation_state: result.rotationState,
          proof_path: result.proofPath,
          old_key_rejection_code: result.oldKeyRejectionCode
        }));
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/agent-auth\/revoke$/.test(requestUrl.pathname)) {
        const payload = await readJsonPayload(request);
        const slug = normalizeProjectSlugForRoute(decodeURIComponent(requestUrl.pathname.split("/")[3] || ""));
        assertProjectExistsForRoute(slug, projectsRoot);
        if (payload.confirm_revoke !== true) {
          throw createStructuredError(
            "Agent credential revoke requires confirm_revoke=true.",
            "agent_auth_revoke_confirmation_required",
            400
          );
        }
        const operationResult = await runProjectOperation({
          slug,
          projectsRoot,
          operationType: "agent_auth_revoke",
          idempotencyKey: getRequestIdempotencyKey(request),
          fingerprintInput: {
            project_slug: slug,
            operation_type: "agent_auth_revoke",
            confirm_revoke: true
          },
          metadata: {},
          safety: {
            live_ai_used: false,
            apply_used: false,
            rollback_used: false
          },
          execute: async () => {
            const result = await revokeAgentAuth({
              slug,
              projectsRoot,
              confirmRevoke: true
            });
            return {
              result,
              proofRef: result.proofPath || null,
              resultSummary: {
                status: result.status,
                code: result.code,
                key_id: result.keyId,
                revoked_at: result.revokedAt,
                revoked_key_rejection_code: result.revokedKeyRejectionCode,
                repair_required: result.repairRequired
              }
            };
          }
        });
        if (operationResult.idempotentReplay) {
          sendJson(response, 200, buildOperationResponse(operationResult, {
            ok: true,
            status: "replayed"
          }));
          return;
        }
        const result = operationResult.result;
        sendJson(response, 200, buildOperationResponse(operationResult, {
          ok: true,
          status: result.status,
          code: result.code,
          key_id: result.keyId,
          revoked_at: result.revokedAt,
          repair_required: result.repairRequired,
          revoked_key_rejection_code: result.revokedKeyRejectionCode,
          proof_path: result.proofPath
        }));
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

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/dependencies\/plan$/.test(requestUrl.pathname)) {
        const payload = await readJsonPayload(request);
        assertNoClientPackageSource(payload);
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = createManagedDependencyInstallPlan({
          slug,
          dependency: payload.dependency,
          projectsRoot,
          dependencySourceOptions: options.dependencySourceOptions
        });

        sendJson(response, 200, {
          ok: true,
          status: "planned",
          project: summarizeProjectForSite(result.project),
          dependency: result.dependency.slug,
          plan: result.summary
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/dependencies\/install$/.test(requestUrl.pathname)) {
        const payload = await readJsonPayload(request);
        assertNoClientPackageSource(payload);
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        if (payload.confirm_install !== true) {
          throw createStructuredError("Dependency install requires explicit confirmation.", "dependency_install_confirmation_required", 400);
        }
        if (!payload.plan_id) {
          throw createStructuredError("Dependency install requires a managed install plan.", "dependency_install_plan_required", 400);
        }

        const operationResult = await runProjectOperation({
          slug,
          projectsRoot,
          operationType: "install_dependency",
          idempotencyKey: getRequestIdempotencyKey(request),
          fingerprintInput: {
            project_slug: slug,
            operation_type: "install_dependency",
            plan_id: payload.plan_id
          },
          metadata: {
            plan_id: payload.plan_id
          },
          execute: async () => {
            const result = await installDependency({
              slug,
              planId: payload.plan_id,
              projectsRoot
            });
            return {
              result,
              proofRef: result.proofPath,
              resultSummary: {
                status: "ok",
                dependency_key: result.dependency && result.dependency.slug || null,
                plan_id: payload.plan_id,
                installed: result.proof && result.proof.installed === true,
                active: result.proof && result.proof.active === true,
                can_generate_after: result.proof && result.proof.can_generate_after === true
              }
            };
          }
        });
        if (operationResult.idempotentReplay) {
          sendJson(response, 200, buildOperationResponse(operationResult, {
            ok: true,
            status: "replayed"
          }));
          return;
        }
        const result = operationResult.result;

        sendJson(response, 200, buildOperationResponse(operationResult, {
          ok: true,
          project: summarizeProjectForSite(result.project),
          dependency: result.dependency.slug,
          proof: result.proof,
          proof_path: result.proofPath
        }));
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/install-dependency$/.test(requestUrl.pathname)) {
        const payload = await readJsonPayload(request);
        assertNoClientPackageSource(payload);
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const planResult = createManagedDependencyInstallPlan({
          slug,
          dependency: payload.dependency,
          projectsRoot,
          dependencySourceOptions: options.dependencySourceOptions
        });

        const operationResult = await runProjectOperation({
          slug,
          projectsRoot,
          operationType: "install_dependency",
          idempotencyKey: getRequestIdempotencyKey(request),
          fingerprintInput: {
            project_slug: slug,
            operation_type: "install_dependency",
            dependency_key: planResult.dependency.slug,
            plan_id: planResult.plan.plan_id
          },
          metadata: {
            dependency_key: planResult.dependency.slug,
            plan_id: planResult.plan.plan_id
          },
          execute: async () => {
            const result = await installDependency({
              slug,
              planId: planResult.plan.plan_id,
              projectsRoot
            });
            return {
              result,
              proofRef: result.proofPath,
              resultSummary: {
                status: "ok",
                dependency_key: result.dependency && result.dependency.slug || planResult.dependency.slug,
                plan_id: planResult.plan.plan_id,
                installed: result.proof && result.proof.installed === true,
                active: result.proof && result.proof.active === true,
                can_generate_after: result.proof && result.proof.can_generate_after === true
              }
            };
          }
        });
        if (operationResult.idempotentReplay) {
          sendJson(response, 200, buildOperationResponse(operationResult, {
            ok: true,
            status: "replayed"
          }));
          return;
        }
        const result = operationResult.result;

        sendJson(response, 200, buildOperationResponse(operationResult, {
          ok: true,
          project: summarizeProjectForSite(result.project),
          dependency: result.dependency.slug,
          proof: result.proof,
          proof_path: result.proofPath
        }));
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/plan$/.test(requestUrl.pathname)) {
        const payload = await readJsonPayload(request);
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = await planProject({
          slug,
          prompt: payload.prompt,
          projectsRoot
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
        const payload = await readJsonPayload(request);
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

      if (request.method === "GET" && /^\/api\/projects\/[^/]+\/operations$/.test(requestUrl.pathname)) {
        const slug = normalizeProjectSlugForRoute(decodeURIComponent(requestUrl.pathname.split("/")[3] || ""));
        assertProjectExistsForRoute(slug, projectsRoot);
        const rawLimit = requestUrl.searchParams.get("limit");
        const limit = rawLimit == null || rawLimit === ""
          ? 20
          : Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          throw createStructuredError(
            "Operation history limit must be an integer from 1 to 100.",
            "invalid_operation_history_limit",
            400
          );
        }
        const operationsStatus = getProjectOperationsStatus({
          slug,
          projectsRoot,
          limit
        });

        sendJson(response, 200, {
          ok: true,
          project: summarizeProjectForSite(operationsStatus.project),
          active_operation: operationsStatus.active_operation,
          operations: operationsStatus.operations
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/generate$/.test(requestUrl.pathname)) {
        const payload = await readJsonPayload(request);
        const slug = normalizeProjectSlugForRoute(decodeURIComponent(requestUrl.pathname.split("/")[3] || ""));
        assertProjectExistsForRoute(slug, projectsRoot);
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
        const priorSuccess = findSuccessfulControlledGenerateByPlanId({
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

        const operationResult = await runProjectOperation({
          slug,
          projectsRoot,
          operationType: "controlled_generate",
          idempotencyKey: getRequestIdempotencyKey(request),
          fingerprintInput: {
            project_slug: slug,
            operation_type: "controlled_generate",
            plan_id: planId,
            prompt_hash: planState.run.prompt_hash || null
          },
          metadata: {
            plan_id: planId,
            prompt_hash: planState.run.prompt_hash || null
          },
          safety: {
            live_ai_used: false,
            apply_used: false,
            rollback_used: false
          },
          execute: async (context) => {
            const result = await generateProject({
              slug,
              projectsRoot,
              planId,
              operationId: context.operationId,
              onProgress: async (statusDetail) => {
                await context.setStage(statusDetail || "executing");
              }
            });
            return {
              result,
              proofRef: result.proofPath,
              resultSummary: {
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
          }
        });
        if (operationResult.idempotentReplay) {
          sendJson(response, 200, buildOperationResponse(operationResult, {
            ok: true,
            status: "replayed"
          }));
          return;
        }
        const result = operationResult.result;

        sendJson(response, 200, buildOperationResponse(operationResult, {
          ok: true,
          status: result.executeData.status,
          code: result.executeData.code,
          proof: result.proof,
          proof_path: result.proofPath,
          project: summarizeProjectForSite(result.project),
          generated_urls: result.generatedUrls,
          url_status: result.urlStatus,
          setup_ready: setupResult.setup.ready_to_generate === true
        }));
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

      if (request.method === "GET" && /^\/api\/projects\/[^/]+\/recovery\/status$/.test(requestUrl.pathname)) {
        try {
          const slug = normalizeProjectSlugForRoute(decodeURIComponent(requestUrl.pathname.split("/")[3] || ""));
          const result = getRecoveryStatus({
            projectsRoot,
            projectSlug: slug
          });
          sendJson(response, 200, result);
        } catch (error) {
          sendRecoveryStatusError(response, error);
        }
        return;
      }

      if (request.method === "GET" && /^\/api\/projects\/[^/]+\/recovery-points$/.test(requestUrl.pathname)) {
        try {
          const slug = normalizeProjectSlugForRoute(decodeURIComponent(requestUrl.pathname.split("/")[3] || ""));
          assertProjectExistsForRoute(slug, projectsRoot);
          sendJson(response, 200, {
            ok: true,
            project: { slug },
            recovery_points: listRecoveryPointsForBrowser(projectsRoot, slug)
          });
        } catch (error) {
          sendRestoreFlowError(response, error);
        }
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/recovery-points$/.test(requestUrl.pathname)) {
        try {
          const payload = await readJsonPayload(request);
          const slug = normalizeProjectSlugForRoute(decodeURIComponent(requestUrl.pathname.split("/")[3] || ""));
          assertProjectExistsForRoute(slug, projectsRoot);
          validateRecoveryPointCreatePayload(payload);
          const operationResult = await createFullStructuralSnapshot({
            projectsRoot,
            slug,
            idempotencyKey: getRequestIdempotencyKey(request)
          });
          sendJson(response, 200, buildRecoveryPointCreateResponse(operationResult));
        } catch (error) {
          if (error && error.securityBoundary === true) {
            throw error;
          }
          sendRecoveryPointCreateError(response, error);
        }
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/recovery-points\/[^/]+\/restore-plan$/.test(requestUrl.pathname)) {
        try {
          const payload = await readJsonPayload(request);
          const parts = requestUrl.pathname.split("/");
          const slug = normalizeProjectSlugForRoute(decodeURIComponent(parts[3] || ""));
          const snapshotId = decodeURIComponent(parts[5] || "");
          assertProjectExistsForRoute(slug, projectsRoot);
          validateRestorePlanPayload(payload);
          const planResult = await createRestorePlan({
            projectsRoot,
            slug,
            snapshotId,
            idempotencyKey: getRequestIdempotencyKey(request)
          });
          sendJson(response, 200, buildRestorePlanResponse(planResult));
        } catch (error) {
          if (error && error.securityBoundary === true) {
            throw error;
          }
          sendRestoreFlowError(response, error);
        }
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/restore\/execute$/.test(requestUrl.pathname)) {
        try {
          const payload = await readJsonPayload(request);
          const slug = normalizeProjectSlugForRoute(decodeURIComponent(requestUrl.pathname.split("/")[3] || ""));
          assertProjectExistsForRoute(slug, projectsRoot);
          const input = validateRestoreExecutionPayload(payload);
          const operationResult = await executeManagedWebsiteRestore({
            projectsRoot,
            projectSlug: slug,
            planId: input.planId,
            exactConfirmation: input.exactConfirmation,
            idempotencyKey: getRequestIdempotencyKey(request)
          });
          sendJson(response, 200, buildRestoreExecutionResponse(operationResult));
        } catch (error) {
          if (error && error.securityBoundary === true) {
            throw error;
          }
          sendRestoreFlowError(response, error);
        }
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/site\/surface-proof$/.test(requestUrl.pathname)) {
        await readJsonPayload(request);
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
        const slug = normalizeProjectSlugForRoute(decodeURIComponent(requestUrl.pathname.split("/")[3] || ""));
        assertProjectExistsForRoute(slug, projectsRoot);
        const result = await buildStateChangeStatusPayload(slug, projectsRoot);
        sendJson(response, 200, result);
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
        await readJsonPayload(request);
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
        await readJsonPayload(request);
        const slug = normalizeProjectSlugForRoute(decodeURIComponent(requestUrl.pathname.split("/")[3] || ""));
        assertProjectExistsForRoute(slug, projectsRoot);
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
        const payload = await readJsonPayload(request);
        const slug = normalizeProjectSlugForRoute(decodeURIComponent(requestUrl.pathname.split("/")[3] || ""));
        assertProjectExistsForRoute(slug, projectsRoot);
        const prompt = validateChangeRequestPrompt(payload.prompt);
        const result = await planState({
          slug,
          projectsRoot,
          prompt,
          overwriteFields: payload.overwrite_fields,
          aiSource: payload.ai_source,
          confirmLive: payload.confirm_live === true,
          estimate: payload.estimate
        });

        sendJson(response, 200, {
          ...summarizeStatePlanForClient(result),
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
        const payload = await readJsonPayload(request);
        const slug = normalizeProjectSlugForRoute(decodeURIComponent(requestUrl.pathname.split("/")[3] || ""));
        assertProjectExistsForRoute(slug, projectsRoot);
        const usesPlanId = Object.prototype.hasOwnProperty.call(payload, "plan_id");
        let planPath = payload.plan_path;
        let planId = null;
        let resolvedPlan = null;
        let confirmOverwriteFields = payload.confirm_overwrite_fields;

        if (usesPlanId) {
          rejectBrowserSuppliedStatePaths(payload);
          if (payload.confirm_apply !== true) {
            throw createStructuredError(
              "State apply requires confirm_apply=true.",
              "state_apply_confirmation_required",
              400
            );
          }
          resolvedPlan = resolveStatePlanForRoute(slug, projectsRoot, payload.plan_id);
          planId = resolvedPlan.planId;
          planPath = resolvedPlan.planPath;
          const requiredFields = resolvedPlan.plan && resolvedPlan.plan.confirmation_required && Array.isArray(resolvedPlan.plan.confirmation_required.fields)
            ? resolvedPlan.plan.confirmation_required.fields
            : [];
          if (requiredFields.length && payload.confirm_protected_overwrite !== true) {
            throw createStructuredError(
              "Protected field overwrite requires explicit confirm_protected_overwrite=true.",
              "state_apply_protected_overwrite_confirmation_required",
              409,
              { required_fields: requiredFields }
            );
          }
          confirmOverwriteFields = payload.confirm_protected_overwrite === true ? requiredFields : [];
        }

        const operationResult = await runProjectOperation({
          slug,
          projectsRoot,
          operationType: "state_apply",
          idempotencyKey: getRequestIdempotencyKey(request),
          fingerprintInput: {
            project_slug: slug,
            operation_type: "state_apply",
            plan_id: planId || null,
            plan_path: usesPlanId ? null : (payload.plan_path || "latest"),
            confirm_apply: usesPlanId ? payload.confirm_apply === true : null,
            confirm_protected_overwrite: usesPlanId ? payload.confirm_protected_overwrite === true : null,
            confirm_overwrite_fields: Array.isArray(confirmOverwriteFields)
              ? confirmOverwriteFields.slice().sort()
              : confirmOverwriteFields || []
          },
          metadata: {
            plan_id: planId || null,
            plan_ref: usesPlanId ? planId : (payload.plan_path || "latest")
          },
          safety: {
            live_ai_used: false,
            apply_used: true,
            rollback_used: false
          },
          execute: async () => {
            if (planId && findSuccessfulOperationByMetadata({
              slug,
              projectsRoot,
              operationType: "state_apply",
              metadataKey: "plan_id",
              metadataValue: planId
            })) {
              throw createStructuredError(
                "This state plan was already consumed by a successful state apply.",
                "state_plan_already_consumed",
                409
              );
            }
            const result = await applyStatePlan({
              slug,
              projectsRoot,
              planPath,
              confirmOverwriteFields
            });
            return {
              result,
              proofRef: result.proofPath || null,
              resultSummary: {
                status: result.status,
                code: result.code,
                apply_id: result.apply ? result.apply.apply_id : (result.proof ? result.proof.apply_id : null),
                plan_id: result.apply ? result.apply.plan_id : (result.proof ? result.proof.plan_id : planId),
                apply_method: result.apply ? result.apply.apply_method : (result.proof ? result.proof.apply_method : null),
                applied_fields: result.apply && Array.isArray(result.apply.applied_fields) ? result.apply.applied_fields : []
              }
            };
          }
        });
        if (operationResult.idempotentReplay) {
          sendJson(response, 200, buildOperationResponse(operationResult, {
            ok: true,
            status: "replayed"
          }));
          return;
        }
        const result = operationResult.result;

        sendJson(response, 200, buildOperationResponse(operationResult, {
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
        }));
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/state\/rollback$/.test(requestUrl.pathname)) {
        const payload = await readJsonPayload(request);
        const slug = normalizeProjectSlugForRoute(decodeURIComponent(requestUrl.pathname.split("/")[3] || ""));
        assertProjectExistsForRoute(slug, projectsRoot);
        const usesOperationId = Object.prototype.hasOwnProperty.call(payload, "apply_operation_id");
        let applyPath = payload.apply_path;
        let targetApplyOperationId = null;
        let sourceApplyId = null;

        if (usesOperationId) {
          rejectBrowserSuppliedStatePaths(payload);
          if (payload.confirm_rollback !== true) {
            throw createStructuredError(
              "State rollback requires confirm_rollback=true.",
              "state_rollback_confirmation_required",
              400
            );
          }
          targetApplyOperationId = normalizeOperationId(payload.apply_operation_id, "state_apply_operation_id_invalid");
          const applyOperationRecord = readOperationById({
            slug,
            projectsRoot,
            operationId: targetApplyOperationId
          });
          if (!applyOperationRecord || !applyOperationRecord.operation) {
            throw createStructuredError(
              "State apply operation was not found.",
              "state_apply_operation_not_found",
              404
            );
          }
          const applyOperation = applyOperationRecord.operation;
          assertOperationBelongsToProject(applyOperation, slug, "state_apply_operation_project_mismatch");
          if (applyOperation.operation_type !== "state_apply" || applyOperation.status !== "succeeded") {
            throw createStructuredError(
              "Selected operation is not a successful state apply.",
              "state_apply_operation_not_rollback_eligible",
              409
            );
          }
          sourceApplyId = applyOperation.result_summary && applyOperation.result_summary.apply_id || null;
          if (!sourceApplyId) {
            throw createStructuredError(
              "Selected state apply operation is missing its apply id.",
              "state_apply_operation_missing_apply_id",
              409
            );
          }
          applyPath = resolveStateApplyPathById({
            slug,
            projectsRoot,
            applyId: sourceApplyId
          });
          if (!applyPath) {
            throw createStructuredError(
              "State apply record is unavailable or not rollback-eligible.",
              "state_apply_record_not_found",
              404
            );
          }
        }

        const operationResult = await runProjectOperation({
          slug,
          projectsRoot,
          operationType: "state_rollback",
          idempotencyKey: getRequestIdempotencyKey(request),
          fingerprintInput: {
            project_slug: slug,
            operation_type: "state_rollback",
            target_apply_operation_id: targetApplyOperationId || null,
            source_apply_id: sourceApplyId || null,
            apply_path: usesOperationId ? null : (payload.apply_path || "latest")
          },
          metadata: {
            target_apply_operation_id: targetApplyOperationId || null,
            source_apply_id: sourceApplyId || null,
            apply_ref: usesOperationId ? targetApplyOperationId : (payload.apply_path || "latest")
          },
          safety: {
            live_ai_used: false,
            apply_used: false,
            rollback_used: true
          },
          execute: async () => {
            if (targetApplyOperationId && findSuccessfulOperationByMetadata({
              slug,
              projectsRoot,
              operationType: "state_rollback",
              metadataKey: "target_apply_operation_id",
              metadataValue: targetApplyOperationId
            })) {
              throw createStructuredError(
                "This state apply operation has already been rolled back.",
                "state_apply_already_rolled_back",
                409
              );
            }
            const result = await rollbackStateApply({
              slug,
              projectsRoot,
              applyPath
            });
            return {
              result,
              proofRef: result.proofPath || null,
              resultSummary: {
                status: result.status,
                code: result.code,
                source_apply_id: result.rollback ? result.rollback.source_apply_id : sourceApplyId,
                rollback_fields: result.rollback ? Object.keys(result.rollback.rollback_fields || {}) : []
              }
            };
          }
        });
        if (operationResult.idempotentReplay) {
          sendJson(response, 200, buildOperationResponse(operationResult, {
            ok: true,
            status: "replayed"
          }));
          return;
        }
        const result = operationResult.result;

        sendJson(response, 200, buildOperationResponse(operationResult, {
          ok: true,
          project: summarizeProjectForSite(result.project),
          status: result.status,
          code: result.code,
          rollback: result.rollback || null,
          proof_path: result.proofPath || null,
          state_path: result.statePath,
          protected_conflicts: result.protectedConflicts || [],
          warnings: result.rollback ? result.rollback.warnings : []
        }));
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
        const payload = await readJsonPayload(request);
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
        await readJsonPayload(request);
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
        const payload = await readJsonPayload(request);
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
        /^\/api\/projects\/[^/]+\/agent-auth\/rotate$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/agent-auth\/revoke$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/dependencies\/plan$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/dependencies\/install$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/install-dependency$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/plan$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/generation\/plan$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/generate$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/recovery-points$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/recovery-points\/[^/]+\/restore-plan$/.test(requestUrl.pathname) ||
        /^\/api\/projects\/[^/]+\/restore\/execute$/.test(requestUrl.pathname) ||
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
      const isSecurityBoundary = error.securityBoundary === true;
      const responseHeaders = {};
      if (isSecurityBoundary) {
        responseHeaders.Connection = "close";
        if (!request.complete) {
          request.resume();
        }
      }
      if (Number.isInteger(error.retryAfterSeconds) && error.retryAfterSeconds > 0) {
        responseHeaders["Retry-After"] = String(error.retryAfterSeconds);
      }
      sendJson(response, statusCode, {
        ok: false,
        status: "error",
        error: sanitizeErrorText(error.message),
        message: sanitizeErrorText(error.message),
        code: error.code || null,
        current_operation: isSecurityBoundary ? null : (error.current_operation || null),
        required_fields: isSecurityBoundary ? [] : (error.required_fields || []),
        proof_path: isSecurityBoundary ? null : (error.proofPath || null),
        blockers: isSecurityBoundary ? [] : (error.blockers || []),
        rejected_fields: isSecurityBoundary ? [] : (error.rejected_fields || [])
      }, responseHeaders);
    }
  });

  return {
    async listen() {
      const restoreReconciliation = options.skipRestoreReconciliation
        ? { skipped: true, reason: "packaged_runtime_read_only_start" }
        : await reconcileInterruptedStructuralRestores({
          projectsRoot,
          serviceController: options.restoreReconciliationServiceController
        });
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          const address = server.address();
          resolve({
            host,
            port: address && typeof address === "object" ? address.port : port,
            projectsRoot,
            restoreReconciliation
          });
        });
      });
    },
    close(closeOptions) {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
        if (closeOptions && closeOptions.closeConnections === true && typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
      });
    }
  };
}

module.exports = {
  createLauncherServer
};
