"use strict";

(function bootstrapLauncher() {
  const config = window.FactoryLauncherConfig || {};
  const projectList = document.getElementById("project-list");
  const createForm = document.getElementById("create-project-form");
  const createResult = document.getElementById("create-result");
  const setupProjectForm = document.getElementById("setup-project-form");
  const setupProjectSlug = document.getElementById("setup-project-slug");
  const setupStatus = document.getElementById("setup-status");
  const setupResult = document.getElementById("setup-result");
  const planForm = document.getElementById("plan-project-form");
  const planProjectSlug = document.getElementById("plan-project-slug");
  const planResult = document.getElementById("plan-result");
  const latestRun = document.getElementById("latest-run");
  const generateForm = document.getElementById("generate-project-form");
  const generateProjectSlug = document.getElementById("generate-project-slug");
  const generatePrompt = document.getElementById("generate-prompt");
  const generatePreviewButton = document.getElementById("generate-preview-button");
  const generateSubmitButton = document.getElementById("generate-submit-button");
  const generateConfirmCheckbox = document.getElementById("generate-confirm-checkbox");
  const generationStatus = document.getElementById("generation-status");
  const generatePreviewResult = document.getElementById("generate-preview-result");
  const generateResult = document.getElementById("generate-result");
  const projectOperations = document.getElementById("project-operations");
  const siteStatus = document.getElementById("site-status");
  const managedState = document.getElementById("managed-state");
  const proofPackStatus = document.getElementById("proof-pack-status");
  const proofPackRefreshButton = document.getElementById("proof-pack-refresh-button");
  const proofPackGenerateButton = document.getElementById("proof-pack-generate-button");
  const proofPackResult = document.getElementById("proof-pack-result");
  const refreshStateButton = document.getElementById("refresh-state-button");
  const statePlanForm = document.getElementById("state-plan-form");
  const statePlanPrompt = document.getElementById("state-plan-prompt");
  const stateOverwriteHeroTitleCheckbox = document.getElementById("state-overwrite-hero-title-checkbox");
  const statePlanResult = document.getElementById("state-plan-result");
  const stateRollbackResult = document.getElementById("state-rollback-result");
  const milestoneGenerate = document.getElementById("launcher-milestone-generate");
  const totalTokens = document.getElementById("launcher-total-tokens");
  const aiMode = document.getElementById("launcher-ai-mode");
  const aiProvider = document.getElementById("launcher-ai-provider");
  const aiModel = document.getElementById("launcher-ai-model");
  const aiKeyStatus = document.getElementById("launcher-ai-key-status");
  const aiLastEstimate = document.getElementById("launcher-ai-last-estimate");

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  let projectsCache = [];
  let lastSetupPayload = null;
  let setupActionInFlight = false;
  let preferredSelectedSlug = "";
  let loadProjectsRequestId = 0;
  let loadSetupStatusRequestId = 0;
  let generatePreviewState = null;
  let generationActionInFlight = false;
  let generationStatusPollTimer = null;
  let generationSelectionRequestId = 0;
  let generationSelectionSettleTimer = null;
  let generationStatusLoading = false;
  let generationViewAbortController = null;
  let generationView = {
    slug: "",
    requestId: 0,
    loading: false,
    statusPayload: null,
    operationsPayload: null,
    sitePayload: null,
    error: null
  };
  let stateChangeRequestId = 0;
  let stateChangeAbortController = null;
  let stateChangeView = {
    slug: "",
    requestId: 0,
    loading: false,
    payload: null,
    plan: null,
    apply: null,
    rollback: null,
    error: null
  };

  function slugifyProjectName(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");
  }

  function setSiteStatusEmpty(message) {
    siteStatus.innerHTML = "<p class=\"empty-state\">" + escapeHtml(message) + "</p>";
  }

  function setGenerationStatusEmpty(message) {
    generationStatus.innerHTML = "<p class=\"empty-state\">" + escapeHtml(message) + "</p>";
  }

  function isActiveStateSelection(slug, requestId) {
    return String(stateChangeView.slug || "") === String(slug || "")
      && Number(stateChangeView.requestId) === Number(requestId)
      && String(generateProjectSlug.value || "").trim() === String(slug || "");
  }

  function resetStateChangeView(slug) {
    stateChangeRequestId += 1;
    if (stateChangeAbortController) {
      stateChangeAbortController.abort();
      stateChangeAbortController = null;
    }
    stateChangeView = {
      slug: String(slug || "").trim(),
      requestId: stateChangeRequestId,
      loading: true,
      payload: null,
      plan: null,
      apply: null,
      rollback: null,
      error: null
    };
    statePlanPrompt.value = "";
    if (stateOverwriteHeroTitleCheckbox) {
      stateOverwriteHeroTitleCheckbox.checked = false;
    }
    statePlanResult.hidden = true;
    statePlanResult.innerHTML = "";
    stateRollbackResult.hidden = true;
    stateRollbackResult.innerHTML = "";
    renderStateChangeView();
    return stateChangeView.requestId;
  }

  function renderStateChangeView() {
    const payload = stateChangeView.payload;
    managedState.setAttribute("data-project-slug", stateChangeView.slug || "");
    managedState.setAttribute("data-request-id", String(stateChangeView.requestId || 0));
    if (!stateChangeView.slug) {
      setManagedStateEmpty("Select a project to preview AI site changes.");
      return;
    }
    if (stateChangeView.loading && !payload) {
      setManagedStateEmpty("Loading AI site change status for " + stateChangeView.slug + "...");
      return;
    }
    if (stateChangeView.error && !payload) {
      setManagedStateEmpty("Unable to load AI site change status: " + stateChangeView.error);
      return;
    }
    if (payload) {
      renderManagedState(payload);
      return;
    }
    setManagedStateEmpty("Managed state has not been refreshed yet.");
  }

  function setProjectOperationsEmpty(message) {
    projectOperations.innerHTML = "<p class=\"empty-state\">" + escapeHtml(message) + "</p>";
  }

  function setSetupEmpty(message) {
    setupStatus.innerHTML = "<p class=\"empty-state\">" + escapeHtml(message) + "</p>";
  }

  function setManagedStateEmpty(message) {
    managedState.innerHTML = "<p class=\"empty-state\">" + escapeHtml(message) + "</p>";
  }

  function setProofPackEmpty(message) {
    proofPackStatus.innerHTML = "<p class=\"empty-state\">" + escapeHtml(message) + "</p>";
  }

  function renderProjects(projects) {
    projectsCache = projects.slice();

    if (!projects.length) {
      projectList.innerHTML = "<p class=\"empty-state\">No projects yet. Create the first scaffold to prepare a runtime folder.</p>";
      setupProjectSlug.innerHTML = "<option value=\"\">Create a project first</option>";
      setupProjectSlug.disabled = true;
      planProjectSlug.innerHTML = "<option value=\"\">Create a project first</option>";
      planProjectSlug.disabled = true;
      generateProjectSlug.innerHTML = "<option value=\"\">Create a project first</option>";
      generateProjectSlug.disabled = true;
      latestRun.innerHTML = "<p class=\"empty-state\">No planning runs yet.</p>";
      setSetupEmpty("Create a project, then provision WordPress and install dependencies here.");
      setGenerationStatusEmpty("Finish project setup, then preview a generate plan here.");
      setProjectOperationsEmpty("Select a project to view operation history.");
      setSiteStatusEmpty("No generated site result yet.");
      setManagedStateEmpty("Refresh state after generate or frontend edits.");
      setProofPackEmpty("Generate a proof pack after state and site data are available.");
      milestoneGenerate.disabled = true;
      totalTokens.textContent = "0";
      aiMode.textContent = "mock";
      aiProvider.textContent = "mock";
      aiModel.textContent = "balanced";
      aiKeyStatus.textContent = "not_required";
      aiLastEstimate.textContent = "Not recorded";
      updateGenerateActionState();
      return;
    }

    const previousSetupSlug = setupProjectSlug.value;
    const previousPlanSlug = planProjectSlug.value;
    const previousGenerateSlug = generateProjectSlug.value;
    setupProjectSlug.disabled = false;
    planProjectSlug.disabled = false;
    generateProjectSlug.disabled = false;
    const projectOptions = projects.map((project) => {
      return "<option value=\"" + escapeHtml(project.slug) + "\">" + escapeHtml(project.site_name + " (" + project.slug + ")") + "</option>";
    }).join("");
    setupProjectSlug.innerHTML = projectOptions;
    planProjectSlug.innerHTML = projectOptions;
    generateProjectSlug.innerHTML = projectOptions;

    const selectedSlug = preferredSelectedSlug && projects.some((project) => project.slug === preferredSelectedSlug)
      ? preferredSelectedSlug
      : (projects.some((project) => project.slug === previousSetupSlug)
      ? previousSetupSlug
      : (projects.some((project) => project.slug === previousGenerateSlug)
        ? previousGenerateSlug
        : (projects.some((project) => project.slug === previousPlanSlug) ? previousPlanSlug : projects[0].slug)));
    preferredSelectedSlug = "";
    setupProjectSlug.value = selectedSlug;
    planProjectSlug.value = selectedSlug;
    generateProjectSlug.value = selectedSlug;

    totalTokens.textContent = String(projects.reduce((sum, project) => {
      const usage = project.usage && Number(project.usage.total_tokens || 0);
      return sum + (Number.isFinite(usage) ? usage : 0);
    }, 0));

    const selectedProject = projects.find((project) => project.slug === planProjectSlug.value) || projects[0];
    const selectedAi = selectedProject.ai || {};
    const selectedEstimate = selectedAi.last_estimate || (selectedProject.usage && selectedProject.usage.last_estimate) || null;
    aiMode.textContent = String(selectedAi.mode || "mock");
    aiProvider.textContent = String(selectedAi.provider || "mock");
    aiModel.textContent = String(selectedAi.model_profile || "balanced");
    aiKeyStatus.textContent = String(selectedAi.key_status || "not_required");
    aiLastEstimate.textContent = selectedEstimate
      ? String(selectedEstimate.estimated_total_tokens || selectedEstimate.total || 0) + " tokens"
      : "Not recorded";
    milestoneGenerate.disabled = !(selectedProject.dependency_state && selectedProject.dependency_state.can_generate && selectedProject.current_run_id);

    projectList.innerHTML = projects.map((project) => {
      const runtimeStatus = project.runtime && project.runtime.status ? project.runtime.status : "not_provisioned";
      const dependencyState = project.dependency_state || null;
      const generationState = project.generation || null;
      const generatedSite = project.generated_site || null;
      const blockerSummary = dependencyState && Array.isArray(dependencyState.blockers) && dependencyState.blockers.length
        ? dependencyState.blockers.join(" | ")
        : "Not checked yet";
      return [
        "<article class=\"project-card\">",
        "  <div class=\"project-card__header\">",
        "    <h3>" + escapeHtml(project.site_name) + "</h3>",
        "    <span class=\"status-pill\">Runtime " + escapeHtml(runtimeStatus.replace(/_/g, " ")) + "</span>",
        "  </div>",
        "  <dl>",
        "    <div><dt>Slug</dt><dd>" + escapeHtml(project.slug) + "</dd></div>",
        "    <div><dt>WordPress URL</dt><dd>" + escapeHtml(project.wp_url) + "</dd></div>",
        "    <div><dt>Runtime</dt><dd>" + escapeHtml(runtimeStatus) + "</dd></div>",
        "    <div><dt>Agent</dt><dd>" + escapeHtml(project.agent && project.agent.status || "unknown") + "</dd></div>",
        "    <div><dt>Dependencies</dt><dd>" + escapeHtml(dependencyState ? (dependencyState.can_generate ? "ready" : "blocked") : "unknown") + "</dd></div>",
        "    <div><dt>Generate</dt><dd>" + escapeHtml(generationState && generationState.status || "not_generated") + "</dd></div>",
        "    <div><dt>Blockers</dt><dd>" + escapeHtml(blockerSummary) + "</dd></div>",
        "    <div><dt>Created</dt><dd>" + escapeHtml(project.created_at || "") + "</dd></div>",
        "  </dl>",
        dependencyState ? "  <p class=\"project-note\">" + escapeHtml(dependencyState.next_action || "") + "</p>" : "",
        generatedSite && generatedSite.present && generatedSite.urls && generatedSite.urls.home ? "  <p class=\"project-note\">Open site: <a href=\"" + escapeHtml(generatedSite.urls.home) + "\" target=\"_blank\" rel=\"noreferrer\">Home</a></p>" : "",
        "</article>"
      ].join("\n");
    }).join("\n");

    const latestProject = projects
      .filter((project) => project.current_run_id)
      .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")))[0];

    if (!latestProject) {
      latestRun.innerHTML = "<p class=\"empty-state\">No planning runs yet.</p>";
      updateGenerateActionState();
      return;
    }

    const estimate = latestProject.usage && latestProject.usage.last_estimate ? latestProject.usage.last_estimate : null;
    latestRun.innerHTML = [
      "<article class=\"project-card\">",
      "  <div class=\"project-card__header\">",
      "    <h3>" + escapeHtml(latestProject.site_name) + "</h3>",
      "    <span class=\"status-pill\">Run " + escapeHtml(latestProject.current_run_id) + "</span>",
      "  </div>",
      "  <dl>",
      "    <div><dt>Slug</dt><dd>" + escapeHtml(latestProject.slug) + "</dd></div>",
      "    <div><dt>Last run</dt><dd>" + escapeHtml(latestProject.current_run_id) + "</dd></div>",
      "    <div><dt>Model</dt><dd>" + escapeHtml(latestProject.ai && latestProject.ai.model_profile || "balanced") + "</dd></div>",
      "    <div><dt>Estimate</dt><dd>" + escapeHtml(estimate ? String(estimate.total) + " tokens" : "Not recorded") + "</dd></div>",
      "  </dl>",
      "</article>"
    ].join("\n");

    updateGenerateActionState();

  }

  function setupActionButton(label, action, disabled, extraAttributes) {
    return "<button type=\"button\" class=\"button\" data-setup-action=\"" + escapeHtml(action) + "\"" +
      (disabled ? " disabled" : "") +
      (extraAttributes || "") +
      ">" + escapeHtml(label) + "</button>";
  }

  function getActiveProjectOperation() {
    if (
      generationView.operationsPayload
      && generationView.operationsPayload.active_operation
      && String(generationView.operationsPayload.project && generationView.operationsPayload.project.slug || "") === String(generationView.slug || "")
    ) {
      return generationView.operationsPayload.active_operation;
    }

    if (
      generationView.statusPayload
      && generationView.statusPayload.current_operation
      && String(generationView.statusPayload.project && generationView.statusPayload.project.slug || "") === String(generationView.slug || "")
    ) {
      return generationView.statusPayload.current_operation;
    }

    return null;
  }

  function isProjectOperationActiveForSlug(slug) {
    const activeOperation = getActiveProjectOperation();
    return Boolean(
      activeOperation
      && (activeOperation.status === "requested" || activeOperation.status === "running")
      && String(generationView.slug || "") === String(slug || "").trim()
    );
  }

  function createRequestIdempotencyKey(prefix) {
    const safePrefix = String(prefix || "launcher").replace(/[^A-Za-z0-9._:-]+/g, "-").slice(0, 32) || "launcher";
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return safePrefix + ":" + window.crypto.randomUUID();
    }
    return safePrefix + ":" + Date.now().toString(36) + ":" + Math.random().toString(36).slice(2);
  }

  function renderSetupStatus(payload) {
    lastSetupPayload = payload;

    if (!payload || !payload.project || !payload.setup) {
      setSetupEmpty("Select a project to view guided setup.");
      return;
    }

    const setup = payload.setup;
    const dependencyRows = Array.isArray(setup.dependencies && setup.dependencies.rows)
      ? setup.dependencies.rows
      : [];
    const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    const readyToGenerate = setup.ready_to_generate === true;
    const setupMutationBlocked = setupActionInFlight || isProjectOperationActiveForSlug(payload.project.slug);
    const missingSourceKeys = dependencyRows
      .filter((row) => !row.source_available)
      .map((row) => row.key);
    const installableRows = dependencyRows.filter((row) => row.source_available && !row.active);
    const dependencyRowsMarkup = dependencyRows.map((row) => {
      const disabled = setupMutationBlocked || !setup.agent || setup.agent.status !== "ready" || !row.source_available || row.active;
      const installAttributes = " data-dependency=\"" + escapeHtml(row.key) + "\"";
      return [
        "<article class=\"setup-step-card\">",
        "  <div class=\"setup-step-card__header\">",
        "    <h4>" + escapeHtml(row.label) + "</h4>",
        "    <span class=\"status-pill\">" + escapeHtml(row.active ? "active" : (row.installed ? "installed" : "missing")) + "</span>",
        "  </div>",
        "  <dl>",
        "    <div><dt>Required</dt><dd>Yes</dd></div>",
        "    <div><dt>ZIP source</dt><dd>" + escapeHtml(row.source_available ? (row.source_filename || "available") : "missing") + "</dd></div>",
        "    <div><dt>Installed</dt><dd>" + escapeHtml(String(row.installed)) + "</dd></div>",
        "    <div><dt>Active</dt><dd>" + escapeHtml(String(row.active)) + "</dd></div>",
        "  </dl>",
        row.notes ? "  <p class=\"project-note\">" + escapeHtml(row.notes) + "</p>" : "",
        "  <div class=\"setup-actions\">" + setupActionButton(row.active ? "Installed" : "Install", "install-dependency", disabled, installAttributes) + "</div>",
        "</article>"
      ].join("\n");
    }).join("\n");

    setupStatus.innerHTML = [
      "<article class=\"project-card\">",
      "  <div class=\"project-card__header\">",
      "    <h3>" + escapeHtml(payload.project.site_name) + "</h3>",
      "    <span class=\"status-pill\">" + escapeHtml(readyToGenerate ? "Ready to Generate" : "Setup in progress") + "</span>",
      "  </div>",
      "  <dl>",
      "    <div><dt>Slug</dt><dd>" + escapeHtml(payload.project.slug) + "</dd></div>",
      "    <div><dt>Project root</dt><dd>" + escapeHtml(payload.setup.project.runtime_path || payload.project.runtime_path) + "</dd></div>",
      "    <div><dt>WordPress</dt><dd>" + escapeHtml(setup.wordpress.status) + "</dd></div>",
      "    <div><dt>Agent</dt><dd>" + escapeHtml(setup.agent.status) + "</dd></div>",
      "    <div><dt>Dependencies</dt><dd>" + escapeHtml(setup.dependencies.status) + "</dd></div>",
      "    <div><dt>Ready to Generate</dt><dd>" + escapeHtml(String(readyToGenerate)) + "</dd></div>",
      "  </dl>",
      "  <div class=\"setup-step-list\">",
      "    <article class=\"setup-step-card\">",
      "      <div class=\"setup-step-card__header\"><h4>1. Project</h4><span class=\"status-pill\">created</span></div>",
      "      <p class=\"project-note\">Scaffolded local real estate runtime at " + escapeHtml(payload.setup.project.runtime_path || payload.project.runtime_path) + ".</p>",
      "    </article>",
      "    <article class=\"setup-step-card\">",
      "      <div class=\"setup-step-card__header\"><h4>2. WordPress</h4><span class=\"status-pill\">" + escapeHtml(setup.wordpress.status) + "</span></div>",
      "      <p class=\"project-note\">Creates Docker runtime and local WordPress files for this project only.</p>",
      "      <dl><div><dt>URL</dt><dd>" + escapeHtml(setup.wordpress.wp_url || payload.project.wp_url) + "</dd></div><div><dt>/wp-json/</dt><dd>" + escapeHtml(String(setup.wordpress.wp_json_ok)) + "</dd></div><div><dt>Proof</dt><dd>" + escapeHtml(setup.wordpress.proof_path || "Unavailable") + "</dd></div></dl>",
      "      <div class=\"setup-actions\">" + setupActionButton("Provision WordPress", "provision", setupMutationBlocked || setup.wordpress.status === "ready") + (setup.wordpress.wp_url ? " <a class=\"site-link\" href=\"" + escapeHtml(setup.wordpress.wp_url) + "\" target=\"_blank\" rel=\"noreferrer\">Open WordPress</a>" : "") + "</div>",
      "    </article>",
      "    <article class=\"setup-step-card\">",
      "      <div class=\"setup-step-card__header\"><h4>3. Agent</h4><span class=\"status-pill\">" + escapeHtml(setup.agent.status) + "</span></div>",
      "      <p class=\"project-note\">Installs the local Site Factory Agent plugin already shipped in this repository.</p>",
      "      <dl><div><dt>Health</dt><dd>" + escapeHtml(setup.agent.health_status || "Unavailable") + "</dd></div><div><dt>Capabilities</dt><dd>" + escapeHtml(setup.agent.capabilities_status || "Unavailable") + "</dd></div><div><dt>Proof</dt><dd>" + escapeHtml(setup.agent.proof_path || "Unavailable") + "</dd></div></dl>",
      "      <div class=\"setup-actions\">" + setupActionButton("Install Agent", "install-agent", setupMutationBlocked || setup.wordpress.status !== "ready" || setup.agent.status === "ready") + "</div>",
      "    </article>",
      "    <article class=\"setup-step-card\">",
      "      <div class=\"setup-step-card__header\"><h4>4. Dependencies</h4><span class=\"status-pill\">" + escapeHtml(setup.dependencies.status) + "</span></div>",
      "      <p class=\"project-note\">Approved local ZIP sources are resolved server-side. The browser sends only dependency keys.</p>",
      "      <dl><div><dt>Can generate</dt><dd>" + escapeHtml(String(setup.dependencies.can_generate)) + "</dd></div><div><dt>Blockers</dt><dd>" + escapeHtml(setup.dependencies.blockers.length ? setup.dependencies.blockers.join(" | ") : "None") + "</dd></div><div><dt>Proof</dt><dd>" + escapeHtml(setup.dependencies.proof_path || "Unavailable") + "</dd></div></dl>",
      missingSourceKeys.length ? "      <p class=\"project-note\">Missing approved ZIPs: " + escapeHtml(missingSourceKeys.join(", ")) + "</p>" : "",
      installableRows.length ? "      <div class=\"setup-actions\">" + setupActionButton("Install Required Dependencies", "install-required", setupMutationBlocked || setup.agent.status !== "ready") + "</div>" : "",
      dependencyRowsMarkup,
      "    </article>",
      "    <article class=\"setup-step-card\">",
      "      <div class=\"setup-step-card__header\"><h4>5. Ready to Generate</h4><span class=\"status-pill\">" + escapeHtml(readyToGenerate ? "ready" : "blocked") + "</span></div>",
      "      <p class=\"project-note\">" + escapeHtml(readyToGenerate ? "Required dependencies are active. Use Generate Site to preview and explicitly confirm controlled generate." : (setup.dependencies.next_action || "Finish the setup blockers above.")) + "</p>",
      "    </article>",
      "  </div>",
      isProjectOperationActiveForSlug(payload.project.slug) ? "  <p class=\"project-note\">A project operation is in progress. Setup mutation buttons are temporarily disabled.</p>" : "",
      "  <div class=\"setup-actions\">" + setupActionButton("Refresh Setup Status", "refresh", setupActionInFlight) + "</div>",
      warnings.length ? "  <ul class=\"warning-list\">" + warnings.map((warning) => "<li>" + escapeHtml(warning) + "</li>").join("") + "</ul>" : "",
      "</article>"
    ].join("\n");
  }

  function renderSetupResult(payload, title) {
    setupResult.hidden = false;
    setupResult.className = "result-box result-box-success";
    setupResult.innerHTML = [
      "<strong>" + escapeHtml(title) + "</strong>",
      payload.proof_path ? "<p><span>Proof file:</span> " + escapeHtml(payload.proof_path) + "</p>" : "",
      payload.project && payload.project.runtime_path ? "<p><span>Project root:</span> " + escapeHtml(payload.project.runtime_path) + "</p>" : "",
      payload.wp_url ? "<p><span>WordPress URL:</span> " + escapeHtml(payload.wp_url) + "</p>" : "",
      payload.rest_base ? "<p><span>REST base:</span> " + escapeHtml(payload.rest_base) + "</p>" : ""
    ].join("");
  }

  function refreshSetupMutationAvailability() {
    if (
      lastSetupPayload
      && lastSetupPayload.project
      && String(lastSetupPayload.project.slug || "") === String(generationView.slug || "")
    ) {
      renderSetupStatus(lastSetupPayload);
    }
  }

  function showResult(target, payload, isError) {
    target.hidden = false;
    target.className = isError ? "result-box result-box-error" : "result-box result-box-success";

    if (isError) {
      target.innerHTML = "<strong>Request failed.</strong><p>" + escapeHtml(payload.error || "Unknown error") + "</p>";
      return;
    }

    target.innerHTML = [
      "<strong>" + escapeHtml(payload.title || "Completed") + "</strong>",
      "<p><span>Path:</span> " + escapeHtml(payload.project.runtime_path) + "</p>",
      payload.files_written ? "<p><span>Files written:</span> " + escapeHtml(payload.files_written.join(", ")) + "</p>" : "",
      payload.next_step ? "<p><span>Next step:</span> " + escapeHtml(payload.next_step) + "</p>" : "",
      payload.run_path ? "<p><span>Run file:</span> " + escapeHtml(payload.run_path) + "</p>" : "",
      payload.proof_path ? "<p><span>Proof file:</span> " + escapeHtml(payload.proof_path) + "</p>" : ""
    ].join("");
  }

  function renderPlanResult(result) {
    const stages = Array.isArray(result.run && result.run.stages) ? result.run.stages : [];
    const personalization = result.proof && result.proof.prompt_personalization ? result.proof.prompt_personalization : null;
    const stageList = stages.map((stage) => {
      const status = stage.status || stage.code || "ok";
      return "<li><strong>" + escapeHtml(stage.label || stage.name) + ":</strong> " + escapeHtml(status) + "</li>";
    }).join("");

    planResult.hidden = false;
    planResult.className = "result-box result-box-success";
    planResult.innerHTML = [
      "<strong>Read-only planning run completed.</strong>",
      "<p><span>Run ID:</span> " + escapeHtml(result.run.run_id) + "</p>",
      "<p><span>Run file:</span> " + escapeHtml(result.run_path) + "</p>",
      "<p><span>Proof file:</span> " + escapeHtml(result.proof_path) + "</p>",
      personalization ? "<p><span>Personalization:</span> " + escapeHtml(personalization.source) + " -> " + escapeHtml(Object.keys(personalization.fields || {}).join(", ")) + "</p>" : "",
      "<p><span>Stages:</span></p>",
      "<ul>" + stageList + "</ul>"
    ].join("");
  }

  function renderGenerateResult(result) {
    const urls = result.generated_urls || {};
    const personalization = result.proof && result.proof.personalization ? result.proof.personalization : null;
    const beforeCounts = result.proof && result.proof.before_counts ? result.proof.before_counts : {};
    const afterCounts = result.proof && result.proof.after_counts ? result.proof.after_counts : {};
    generateResult.hidden = false;
    generateResult.className = "result-box result-box-success";
    generateResult.innerHTML = [
      "<strong>Controlled generate completed.</strong>",
      result.operation_path ? "<p><span>Operation record:</span> " + escapeHtml(result.operation_path) + "</p>" : "",
      result.operation && result.operation.operation_id ? "<p><span>Operation ID:</span> " + escapeHtml(result.operation.operation_id) + "</p>" : "",
      "<p><span>Status:</span> " + escapeHtml(result.status || "unknown") + "</p>",
      "<p><span>Code:</span> " + escapeHtml(result.code || "unknown") + "</p>",
      "<p><span>Proof file:</span> " + escapeHtml(result.proof_path) + "</p>",
      "<p><span>Pages:</span> " + escapeHtml(formatCountChange(beforeCounts.pages, afterCounts.pages)) + "</p>",
      "<p><span>Properties:</span> " + escapeHtml(formatCountChange(beforeCounts.properties, afterCounts.properties)) + "</p>",
      "<p><span>Attachments:</span> " + escapeHtml(formatCountChange(beforeCounts.attachments, afterCounts.attachments)) + "</p>",
      personalization ? "<p><span>Personalization:</span> " + escapeHtml(personalization.source || "local_interpreter") + " -> " + escapeHtml((personalization.applied_fields || []).join(", ")) + "</p>" : "",
      "<p><span>Home:</span> " + escapeHtml(urls.home || urls.root || result.project.wp_url) + "</p>",
      "<p><span>Properties:</span> " + escapeHtml(urls.properties || "Unavailable") + "</p>",
      "<p><span>Contact:</span> " + escapeHtml(urls.contact || "Unavailable") + "</p>"
    ].join("");
  }

  function getSelectedGenerateProject() {
    const slug = String(generateProjectSlug.value || "").trim();
    return projectsCache.find((project) => project.slug === slug) || null;
  }

  function getNormalizedGeneratePrompt() {
    return String(generatePrompt && generatePrompt.value || "").trim();
  }

  function getGeneratePromptValidation(prompt) {
    if (!prompt) {
      return {
        valid: false,
        message: "Enter a prompt to preview the generate plan."
      };
    }

    if (prompt.length < 10) {
      return {
        valid: false,
        message: "Prompt must be at least 10 characters."
      };
    }

    if (prompt.length > 2000) {
      return {
        valid: false,
        message: "Prompt must be 2000 characters or fewer."
      };
    }

    return {
      valid: true,
      message: ""
    };
  }

  function resetGeneratePreview(message) {
    generatePreviewState = null;
    generateConfirmCheckbox.checked = false;
    if (message) {
      generatePreviewResult.hidden = false;
      generatePreviewResult.className = "result-box result-box-error";
      generatePreviewResult.innerHTML = "<strong>Preview required.</strong><p>" + escapeHtml(message) + "</p>";
    } else {
      generatePreviewResult.hidden = true;
      generatePreviewResult.innerHTML = "";
    }
    updateGenerateActionState();
  }

  function clearGenerateResult() {
    generateResult.hidden = true;
    generateResult.className = "result-box";
    generateResult.innerHTML = "";
  }

  function clearGenerationPoll() {
    if (generationStatusPollTimer) {
      window.clearTimeout(generationStatusPollTimer);
      generationStatusPollTimer = null;
    }
  }

  function clearGenerationSelectionSettleTimer() {
    if (generationSelectionSettleTimer) {
      window.clearTimeout(generationSelectionSettleTimer);
      generationSelectionSettleTimer = null;
    }
  }

  function resetGenerationViewAbortController() {
    if (generationViewAbortController) {
      generationViewAbortController.abort();
    }
    generationViewAbortController = new AbortController();
    return generationViewAbortController;
  }

  function isActiveGenerationSelection(slug, requestId) {
    return requestId === generationView.requestId
      && String(generationView.slug || "") === String(slug || "").trim();
  }

  function getActiveGenerationRequest(slug, options) {
    return {
      slug: String(slug || "").trim(),
      requestId: options && options.requestId != null ? options.requestId : generationView.requestId,
      signal: options && options.signal ? options.signal : (generationViewAbortController ? generationViewAbortController.signal : null)
    };
  }

  function beginGenerationSelectionLoad(slug) {
    const selectedSlug = String(slug || "").trim();
    generationSelectionRequestId += 1;
    generationStatusLoading = Boolean(selectedSlug);
    generationView = {
      slug: selectedSlug,
      requestId: generationSelectionRequestId,
      loading: Boolean(selectedSlug),
      statusPayload: null,
      operationsPayload: null,
      sitePayload: null,
      error: null
    };
    clearGenerationPoll();
    clearGenerationSelectionSettleTimer();
    resetGenerationViewAbortController();
    generatePreviewState = null;
    generateConfirmCheckbox.checked = false;
    generatePreviewResult.hidden = true;
    generatePreviewResult.innerHTML = "";
    clearGenerateResult();
    renderGenerationSurface();
    updateGenerateActionState();
    return generationSelectionRequestId;
  }

  function updateGenerateActionState() {
    const project = getSelectedGenerateProject();
    const prompt = getNormalizedGeneratePrompt();
    const promptValidation = getGeneratePromptValidation(prompt);
    const readyToGenerate = Boolean(project && project.dependency_state && project.dependency_state.can_generate);
    const operationActive = project ? isProjectOperationActiveForSlug(project.slug) : false;
    const previewMatchesPrompt = Boolean(
      generatePreviewState
      && generatePreviewState.plan_id
      && generatePreviewState.prompt === prompt
      && generatePreviewState.stale !== true
    );

    generatePreviewButton.disabled = generationActionInFlight || generationStatusLoading || operationActive || !project || !readyToGenerate || !promptValidation.valid;
    generateSubmitButton.disabled = !(
      !generationActionInFlight
      && !generationStatusLoading
      && !operationActive
      && project
      && readyToGenerate
      && previewMatchesPrompt
      && generateConfirmCheckbox.checked === true
    );
  }

  function buildGeneratePreviewHtml(result, options) {
    const safeResult = result && typeof result === "object" ? result : {};
    const interpretedFields = safeResult.interpreted_fields && typeof safeResult.interpreted_fields === "object"
      ? safeResult.interpreted_fields
      : {};
    const fieldEntries = Object.entries(interpretedFields);
    const warnings = Array.isArray(safeResult.warnings) ? safeResult.warnings : [];
    const stale = Boolean(options && options.stale);

    return {
      className: stale ? "result-box result-box-error" : "result-box result-box-success",
      html: [
      "<strong>" + escapeHtml(stale ? "Preview is stale." : "Generate preview ready.") + "</strong>",
      stale ? "<p>The prompt changed after preview. Preview Plan again before Generate.</p>" : "",
      "<p><span>Plan ID:</span> " + escapeHtml(safeResult.plan_id || "Unavailable") + "</p>",
      "<p><span>Prompt hash:</span> " + escapeHtml(safeResult.prompt_hash || "Unavailable") + "</p>",
      "<p><span>Personalization source:</span> " + escapeHtml(safeResult.personalization_source || "local_interpreter") + "</p>",
      "<p><span>Provider called:</span> " + escapeHtml(String(safeResult.provider_called === true)) + "</p>",
      "<p><span>Can generate:</span> " + escapeHtml(String(safeResult.can_generate === true)) + "</p>",
      "<p><span>Dependency blockers:</span> " + escapeHtml((safeResult.dependency_blockers || []).length ? safeResult.dependency_blockers.join(", ") : "None") + "</p>",
      "<p><span>Estimated input tokens:</span> " + escapeHtml(String(safeResult.estimated_input_tokens != null ? safeResult.estimated_input_tokens : "Not available")) + "</p>",
      "<p><span>Estimated output tokens:</span> " + escapeHtml(String(safeResult.estimated_output_tokens != null ? safeResult.estimated_output_tokens : "Not available")) + "</p>",
      "<p><span>Estimated total tokens:</span> " + escapeHtml(String(safeResult.estimated_total_tokens != null ? safeResult.estimated_total_tokens : "Not available")) + "</p>",
      "<p><span>Estimated cost:</span> " + escapeHtml(String(safeResult.estimated_cost == null ? "Not available" : safeResult.estimated_cost)) + "</p>",
      "<p><span>Plan proof:</span> " + escapeHtml(safeResult.plan_proof_path || "Unavailable") + "</p>",
      "<p><span>Estimate proof:</span> " + escapeHtml(safeResult.estimate_proof_path || "Unavailable") + "</p>",
      fieldEntries.length
        ? "<p><span>Interpreted fields:</span></p><ul>" + fieldEntries.map(([key, value]) => "<li><strong>" + escapeHtml(key) + ":</strong> " + escapeHtml(value) + "</li>").join("") + "</ul>"
        : "<p><span>Interpreted fields:</span> None</p>",
      "<ul class=\"warning-list\">"
        + "<li>Generate will modify this WordPress project.</li>"
        + "<li>Local interpreter source only for this phase.</li>"
        + "<li>Full-site rollback is not available in this version.</li>"
        + "<li>Safe-field rollback is not the same as full-site rollback.</li>"
        + "</ul>",
      warnings.length ? "<ul class=\"warning-list\">" + warnings.map((warning) => "<li>" + escapeHtml(warning) + "</li>").join("") + "</ul>" : ""
      ].join("")
    };
  }

  function renderGeneratePreview(result, options) {
    const view = buildGeneratePreviewHtml(result, options);
    generatePreviewResult.hidden = false;
    generatePreviewResult.className = view.className;
    generatePreviewResult.innerHTML = view.html;
  }

  function buildGenerationStatusHtml(payload) {
    if (!payload || !payload.project) {
      return "<p class=\"empty-state\">Select a project to review generate readiness.</p>";
    }

    const setup = payload.setup || {};
    const latestPlan = payload.latest_plan || null;
    const latestOperation = payload.current_operation || payload.latest_operation || null;
    const site = payload.site || {};
    const blockers = setup.dependencies && Array.isArray(setup.dependencies.blockers)
      ? setup.dependencies.blockers
      : [];
    const readinessMessage = setup.ready_to_generate === true
      ? "Preview Plan and Generate are available after a valid prompt and explicit confirmation."
      : "Finish Project Setup before previewing or running Generate.";
    const generatedUrls = site.generated_urls || {};
    const siteLinks = [
      generatedUrls.home || generatedUrls.root ? "<a class=\"site-link\" href=\"" + escapeHtml(generatedUrls.home || generatedUrls.root) + "\" target=\"_blank\" rel=\"noreferrer\">Open Home</a>" : "",
      generatedUrls.properties ? "<a class=\"site-link\" href=\"" + escapeHtml(generatedUrls.properties) + "\" target=\"_blank\" rel=\"noreferrer\">Open Properties</a>" : "",
      generatedUrls.contact ? "<a class=\"site-link\" href=\"" + escapeHtml(generatedUrls.contact) + "\" target=\"_blank\" rel=\"noreferrer\">Open Contact</a>" : ""
    ].filter(Boolean).join("");

    return [
      "<article class=\"project-card\">",
      "  <div class=\"project-card__header\">",
      "    <h3>" + escapeHtml(payload.project.site_name) + "</h3>",
      "    <span class=\"status-pill\">" + escapeHtml(setup.ready_to_generate ? "Ready to Generate" : "Blocked") + "</span>",
      "  </div>",
      "  <dl>",
      "    <div><dt>Project</dt><dd>" + escapeHtml(payload.project.slug) + "</dd></div>",
      "    <div><dt>WordPress</dt><dd>" + escapeHtml(payload.project.wp_url || "Unavailable") + "</dd></div>",
      "    <div><dt>Dependencies</dt><dd>" + escapeHtml(setup.dependencies && setup.dependencies.status || "unknown") + "</dd></div>",
      "    <div><dt>Ready to Generate</dt><dd>" + escapeHtml(String(setup.ready_to_generate === true)) + "</dd></div>",
      "    <div><dt>Latest plan</dt><dd>" + escapeHtml(latestPlan && latestPlan.plan_id || "None") + "</dd></div>",
      "    <div><dt>Interpreter</dt><dd>" + escapeHtml(latestPlan && latestPlan.personalization_source || "local_interpreter") + "</dd></div>",
      "    <div><dt>Latest operation</dt><dd>" + escapeHtml(latestOperation && latestOperation.status || "none") + "</dd></div>",
      "    <div><dt>Operation step</dt><dd>" + escapeHtml(latestOperation && (latestOperation.stage || latestOperation.status_detail) || "n/a") + "</dd></div>",
      "    <div><dt>Generate proof</dt><dd>" + escapeHtml(site.latest_generate_proof_path || "Unavailable") + "</dd></div>",
      "  </dl>",
      blockers.length ? "  <p class=\"project-note\">Blockers: " + escapeHtml(blockers.join(" | ")) + "</p>" : "  <p class=\"project-note\">" + escapeHtml(readinessMessage) + "</p>",
      latestOperation && latestOperation.operation_path ? "  <p class=\"project-note\">Operation record: " + escapeHtml(latestOperation.operation_path) + "</p>" : "",
      siteLinks ? "  <div class=\"site-links\">" + siteLinks + "</div>" : "",
      "</article>"
    ].join("\n");
  }

  function formatOperationTime(value) {
    return value ? String(value) : "Unavailable";
  }

  function formatOperationDuration(operation) {
    const start = Date.parse(operation && (operation.started_at || operation.requested_at) || "");
    const end = Date.parse(operation && operation.completed_at || "");
    if (!Number.isFinite(start)) {
      return "Unavailable";
    }
    const durationMs = (Number.isFinite(end) ? end : Date.now()) - start;
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return "Unavailable";
    }
    const seconds = Math.round(durationMs / 1000);
    if (seconds < 60) {
      return String(seconds) + "s";
    }
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return String(minutes) + "m " + String(remainder) + "s";
  }

  function buildProjectOperationsHtml(payload) {
    if (!payload || !payload.project) {
      return "<p class=\"empty-state\">Select a project to view operation history.</p>";
    }

    const activeOperation = payload.active_operation || null;
    const operations = Array.isArray(payload.operations) ? payload.operations : [];
    const operationRows = operations.map((operation) => {
      const summary = operation.result_summary && typeof operation.result_summary === "object"
        ? operation.result_summary
        : {};
      const error = operation.error && typeof operation.error === "object"
        ? operation.error
        : {};
      const detailParts = [
        operation.stage ? "stage=" + operation.stage : "",
        operation.proof_ref ? "proof=" + operation.proof_ref : "",
        summary.code ? "code=" + summary.code : "",
        error.code ? "error=" + error.code : "",
        operation.legacy ? "legacy=true" : ""
      ].filter(Boolean);
      return [
        "<article class=\"project-card\">",
        "  <div class=\"project-card__header\">",
        "    <h3>" + escapeHtml(operation.operation_type || "operation") + "</h3>",
        "    <span class=\"status-pill\">" + escapeHtml(operation.status || "unknown") + "</span>",
        "  </div>",
        "  <dl>",
        "    <div><dt>ID</dt><dd>" + escapeHtml(operation.operation_id || "Unavailable") + "</dd></div>",
        "    <div><dt>Requested</dt><dd>" + escapeHtml(formatOperationTime(operation.requested_at)) + "</dd></div>",
        "    <div><dt>Started</dt><dd>" + escapeHtml(formatOperationTime(operation.started_at)) + "</dd></div>",
        "    <div><dt>Completed</dt><dd>" + escapeHtml(formatOperationTime(operation.completed_at)) + "</dd></div>",
        "    <div><dt>Duration</dt><dd>" + escapeHtml(formatOperationDuration(operation)) + "</dd></div>",
        "  </dl>",
        detailParts.length ? "  <p class=\"project-note\">" + escapeHtml(detailParts.join(" | ")) + "</p>" : "",
        "</article>"
      ].join("\n");
    }).join("\n");

    return [
      "<article class=\"project-card\">",
      "  <div class=\"project-card__header\">",
      "    <h3>" + escapeHtml(payload.project.slug || "Project") + "</h3>",
      "    <span class=\"status-pill\">" + escapeHtml(activeOperation ? "operation running" : "idle") + "</span>",
      "  </div>",
      activeOperation
        ? "  <p class=\"project-note\">Active operation: " + escapeHtml(activeOperation.operation_type || "operation") + " (" + escapeHtml(activeOperation.status || "unknown") + ")</p>"
        : "  <p class=\"project-note\">No active project mutation operation.</p>",
      "</article>",
      operationRows || "<p class=\"empty-state\">No project operations have been recorded yet.</p>"
    ].join("\n");
  }

  function buildGenerationStatusFromProjectCache(project) {
    if (!project) {
      return "<p class=\"empty-state\">Select a project to review generate readiness.</p>";
    }

    const dependencyState = project.dependency_state || {};
    const blockers = Array.isArray(dependencyState.blockers) ? dependencyState.blockers : [];
    const readyToGenerate = dependencyState.can_generate === true;
    const generation = project.generation || {};
    const readinessMessage = readyToGenerate
      ? "Preview Plan and Generate are available after a valid prompt and explicit confirmation."
      : "Finish Project Setup before previewing or running Generate.";

    return [
      "<article class=\"project-card\">",
      "  <div class=\"project-card__header\">",
      "    <h3>" + escapeHtml(project.site_name || project.slug || "Project") + "</h3>",
      "    <span class=\"status-pill\">" + escapeHtml(readyToGenerate ? "Ready to Generate" : "Blocked") + "</span>",
      "  </div>",
      "  <dl>",
      "    <div><dt>Project</dt><dd>" + escapeHtml(project.slug || "Unavailable") + "</dd></div>",
      "    <div><dt>WordPress</dt><dd>" + escapeHtml(project.wp_url || "Unavailable") + "</dd></div>",
      "    <div><dt>Dependencies</dt><dd>" + escapeHtml(dependencyState.status || "unknown") + "</dd></div>",
      "    <div><dt>Ready to Generate</dt><dd>" + escapeHtml(String(readyToGenerate)) + "</dd></div>",
      "    <div><dt>Latest plan</dt><dd>" + escapeHtml(project.current_run_id || "None") + "</dd></div>",
      "    <div><dt>Interpreter</dt><dd>local_interpreter</dd></div>",
      "    <div><dt>Latest operation</dt><dd>" + escapeHtml(generation.status || "none") + "</dd></div>",
      "    <div><dt>Operation step</dt><dd>n/a</dd></div>",
      "    <div><dt>Generate proof</dt><dd>Unavailable</dd></div>",
      "  </dl>",
      blockers.length
        ? "  <p class=\"project-note\">Blockers: " + escapeHtml(blockers.join(" | ")) + "</p>"
        : "  <p class=\"project-note\">" + escapeHtml(readinessMessage) + "</p>",
      "</article>"
    ].join("\n");
  }

  function updateGenerationPolling(payload) {
    clearGenerationPoll();

    const operation = payload && (payload.current_operation || payload.latest_operation);
    if (!operation || operation.status !== "running") {
      return;
    }

    generationStatusPollTimer = window.setTimeout(() => {
      loadGenerationStatus(generationView.slug, { requestId: generationView.requestId }).catch((error) => {
        if (isActiveGenerationSelection(generationView.slug, generationView.requestId)) {
          generationView.error = error.message;
          renderGenerationSurface();
        }
      });
    }, 2000);
  }

  function startGenerationWatch(slug, planId) {
    clearGenerationPoll();
    generationView.loading = true;
    generationView.error = null;
    generationView.statusPayload = {
      project: {
        site_name: String(slug || ""),
        slug: String(slug || ""),
        wp_url: ""
      },
      setup: {
        ready_to_generate: true,
        dependencies: {
          status: "running",
          blockers: []
        }
      },
      latest_plan: {
        plan_id: String(planId || ""),
        personalization_source: "local_interpreter"
      },
      current_operation: {
        operation_type: "controlled_generate",
        status: "running",
        stage: "preparing"
      },
      latest_operation: {
        operation_type: "controlled_generate",
        status: "running",
        stage: "preparing"
      },
      site: {
        latest_generate_proof_path: null,
        generated_urls: {}
      }
    };
    generationView.operationsPayload = {
      ok: true,
      project: generationView.statusPayload.project,
      active_operation: {
        operation_type: "controlled_generate",
        status: "running",
        stage: "preparing"
      },
      operations: []
    };
    renderGenerationSurface();
    refreshSetupMutationAvailability();

    const poll = async () => {
      if (!generationActionInFlight) {
        return;
      }
      try {
        await loadGenerationStatus(slug, { requestId: generationView.requestId });
      } catch (error) {
        // Keep the optimistic running card if polling is temporarily unavailable.
      } finally {
        if (generationActionInFlight) {
          generationStatusPollTimer = window.setTimeout(poll, 2000);
        }
      }
    };

    generationStatusPollTimer = window.setTimeout(poll, 400);
  }

  function formatCountChange(beforeValue, afterValue) {
    if (beforeValue == null && afterValue == null) {
      return "Unavailable";
    }

    if (beforeValue == null) {
      return "? -> " + String(afterValue);
    }

    if (afterValue == null) {
      return String(beforeValue) + " -> ?";
    }

    return String(beforeValue) + " -> " + String(afterValue);
  }

  function buildSiteStatusHtml(payload) {
    const site = payload.site || {};
    const urls = site.generated_urls || {};
    const counts = site.counts_summary || {};
    const beforeCounts = counts.before || {};
    const afterCounts = counts.after || {};
    const personalization = site.personalization || null;
    const warnings = Array.isArray(site.warnings) ? site.warnings : [];

    if (!site.latest_generate_proof_id && !site.generated_site_present) {
      return null;
    }

    const links = [
      urls.home || urls.root ? "<a class=\"site-link\" href=\"" + escapeHtml(urls.home || urls.root) + "\" target=\"_blank\" rel=\"noreferrer\">Open Home</a>" : "",
      urls.properties ? "<a class=\"site-link\" href=\"" + escapeHtml(urls.properties) + "\" target=\"_blank\" rel=\"noreferrer\">Open Properties</a>" : "",
      urls.contact ? "<a class=\"site-link\" href=\"" + escapeHtml(urls.contact) + "\" target=\"_blank\" rel=\"noreferrer\">Open Contact</a>" : "",
      site.frontend_edit_available && site.frontend_edit_url ? "<a class=\"site-link\" href=\"" + escapeHtml(site.frontend_edit_url) + "\" target=\"_blank\" rel=\"noreferrer\">Open Frontend Edit</a>" : "",
      site.frontend_edit_available && site.frontend_edit_login_url ? "<a class=\"site-link\" href=\"" + escapeHtml(site.frontend_edit_login_url) + "\" target=\"_blank\" rel=\"noreferrer\">Login to Edit</a>" : ""
    ].filter(Boolean).join("");

    return [
      "<article class=\"project-card\">",
      "  <div class=\"project-card__header\">",
      "    <h3>" + escapeHtml(payload.project.site_name) + "</h3>",
      "    <span class=\"status-pill\">Generate " + escapeHtml(site.generation_status || "unknown") + "</span>",
      "  </div>",
      "  <dl>",
      "    <div><dt>Proof</dt><dd>" + escapeHtml(site.latest_generate_proof_id || "Unavailable") + "</dd></div>",
      "    <div><dt>Proof path</dt><dd>" + escapeHtml(site.latest_generate_proof_path || "Unavailable") + "</dd></div>",
      "    <div><dt>Status</dt><dd>" + escapeHtml(site.controlled_generate_status || site.generation_status || "unknown") + "</dd></div>",
      "    <div><dt>Code</dt><dd>" + escapeHtml(site.controlled_generate_code || "Unavailable") + "</dd></div>",
      "    <div><dt>Pages</dt><dd>" + escapeHtml(formatCountChange(beforeCounts.pages, afterCounts.pages)) + "</dd></div>",
      "    <div><dt>Properties</dt><dd>" + escapeHtml(formatCountChange(beforeCounts.properties, afterCounts.properties)) + "</dd></div>",
      "    <div><dt>Attachments</dt><dd>" + escapeHtml(formatCountChange(beforeCounts.attachments, afterCounts.attachments)) + "</dd></div>",
      "    <div><dt>Frontend Edit</dt><dd>" + escapeHtml(site.frontend_edit_available ? "Available" : "Unavailable") + "</dd></div>",
      "    <div><dt>Auth</dt><dd>" + escapeHtml(site.frontend_edit_auth_required ? "WordPress admin login required" : "No extra login required") + "</dd></div>",
      "    <div><dt>Personalization</dt><dd>" + escapeHtml(personalization ? (personalization.source || "local_interpreter") : "Unavailable") + "</dd></div>",
      "    <div><dt>Applied fields</dt><dd>" + escapeHtml(personalization ? ((personalization.applied_fields || []).join(", ") || "None") : "Unavailable") + "</dd></div>",
      "  </dl>",
      links ? "  <div class=\"site-links\">" + links + "</div>" : "",
      site.frontend_edit_available ? "  <p class=\"project-note\">Frontend editing requires a WordPress admin browser session.</p>" : "",
      "  <p class=\"project-note\">" + escapeHtml(site.next_suggested_action || "Review the generated site.") + "</p>",
      warnings.length ? "  <ul class=\"warning-list\">" + warnings.map((warning) => "<li>" + escapeHtml(warning) + "</li>").join("") + "</ul>" : "",
      "</article>"
    ].join("\n");
  }

  function renderGenerationSurface() {
    const selectedSlug = String(generationView.slug || "");
    generationStatus.dataset.projectSlug = selectedSlug;
    generationStatus.dataset.requestId = String(generationView.requestId || 0);
    projectOperations.dataset.projectSlug = selectedSlug;
    projectOperations.dataset.requestId = String(generationView.requestId || 0);
    siteStatus.dataset.projectSlug = selectedSlug;
    siteStatus.dataset.requestId = String(generationView.requestId || 0);

    if (!selectedSlug) {
      setGenerationStatusEmpty("Select a project to review generate readiness.");
      setProjectOperationsEmpty("Select a project to view operation history.");
      setSiteStatusEmpty("Select a project to view generated site proof.");
      updateGenerateActionState();
      return;
    }

    if (generationView.loading && !generationView.operationsPayload) {
      setProjectOperationsEmpty("Loading operation history for " + selectedSlug + "...");
    } else if (
      generationView.operationsPayload
      && generationView.operationsPayload.project
      && String(generationView.operationsPayload.project.slug || "") === selectedSlug
    ) {
      projectOperations.innerHTML = buildProjectOperationsHtml(generationView.operationsPayload);
    } else if (generationView.error) {
      setProjectOperationsEmpty("Operation history is temporarily unavailable.");
    } else {
      setProjectOperationsEmpty("Operation history has not been loaded yet.");
    }

    if (generationView.loading && !generationView.statusPayload) {
      setGenerationStatusEmpty("Loading generate readiness for " + selectedSlug + "...");
    } else if (
      generationView.statusPayload
      && generationView.statusPayload.project
      && String(generationView.statusPayload.project.slug || "") === selectedSlug
    ) {
      generationStatus.innerHTML = buildGenerationStatusHtml(generationView.statusPayload);
    } else if (generationView.error) {
      generationStatus.innerHTML = "<p class=\"empty-state\">" + escapeHtml(generationView.error) + "</p>";
    } else {
      const cachedProject = projectsCache.find((entry) => entry.slug === selectedSlug);
      generationStatus.innerHTML = buildGenerationStatusFromProjectCache(cachedProject);
    }

    if (generationView.loading && !generationView.sitePayload) {
      setSiteStatusEmpty("Loading generated site status for " + selectedSlug + "...");
    } else if (
      generationView.sitePayload
      && generationView.sitePayload.project
      && String(generationView.sitePayload.project.slug || "") === selectedSlug
    ) {
      const siteMarkup = buildSiteStatusHtml(generationView.sitePayload);
      if (siteMarkup) {
        siteStatus.innerHTML = siteMarkup;
      } else {
        setSiteStatusEmpty("Run controlled generate to populate generated site proof.");
      }
    } else if (generationView.error) {
      setSiteStatusEmpty("Run controlled generate to populate generated site proof.");
    } else {
      const cachedProject = projectsCache.find((entry) => entry.slug === selectedSlug);
      if (cachedProject && cachedProject.generation && cachedProject.generation.last_proof_id) {
        setSiteStatusEmpty("Loading generated site status for " + selectedSlug + "...");
      } else {
        setSiteStatusEmpty("Run controlled generate to populate generated site proof.");
      }
    }

    updateGenerateActionState();
  }

  function renderManagedState(payload) {
    if (!payload.exists || !payload.summary) {
      setManagedStateEmpty("Managed state has not been refreshed yet.");
      return;
    }

    const summary = payload.summary;
    const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    const rollback = payload.rollback || null;
    const rollbackCandidates = Array.isArray(payload.rollback_candidates) ? payload.rollback_candidates : [];
    const rollbackCandidate = rollbackCandidates.find((candidate) => candidate.rollback_eligible) || rollbackCandidates[0] || null;
    const activeOperation = payload.active_operation || null;
    const effectiveSafeFields = Array.isArray(summary.effective_safe_fields) ? summary.effective_safe_fields : [];
    const effectiveWarnings = Array.isArray(summary.effective_safe_field_warnings) ? summary.effective_safe_field_warnings : [];
    managedState.innerHTML = [
      "<article class=\"project-card\">",
      "  <div class=\"project-card__header\">",
      "    <h3>" + escapeHtml(payload.project.site_name) + "</h3>",
      "    <span class=\"status-pill\">State v" + escapeHtml(String(summary.version)) + "</span>",
      "  </div>",
      "  <dl>",
      "    <div><dt>State</dt><dd>Available</dd></div>",
      "    <div><dt>Updated</dt><dd>" + escapeHtml(summary.last_updated || "Unknown") + "</dd></div>",
      "    <div><dt>Pages</dt><dd>" + escapeHtml(String(summary.pages)) + "</dd></div>",
      "    <div><dt>Properties</dt><dd>" + escapeHtml(String(summary.property_count)) + "</dd></div>",
      "    <div><dt>Attachments</dt><dd>" + escapeHtml(String(summary.attachment_count)) + "</dd></div>",
      "    <div><dt>Personalization</dt><dd>" + escapeHtml(summary.personalization_source || "unknown") + "</dd></div>",
      "    <div><dt>User overrides</dt><dd>" + escapeHtml(String(summary.user_overrides_count)) + "</dd></div>",
      "    <div><dt>Protected fields</dt><dd>" + escapeHtml(summary.protected_fields.length ? summary.protected_fields.join(", ") : "None") + "</dd></div>",
      "    <div><dt>Last apply</dt><dd>" + escapeHtml(summary.latest_apply_method || "None") + "</dd></div>",
      "    <div><dt>Active operation</dt><dd>" + escapeHtml(activeOperation ? (activeOperation.operation_type + " / " + activeOperation.status) : "None") + "</dd></div>",
      "    <div><dt>Effective fields</dt><dd>" + escapeHtml(String(summary.effective_safe_fields_count || 0)) + "</dd></div>",
      "  </dl>",
      effectiveSafeFields.length
        ? "  <ul class=\"warning-list\">" + effectiveSafeFields.map((field) => "<li><strong>" + escapeHtml(field.field_key) + ":</strong> " + escapeHtml(field.value) + " <em>[" + escapeHtml(field.source + (field.protected ? ", protected" : "") + ", render:" + field.rendered_check) + "]</em></li>").join("") + "</ul>"
        : "",
      rollbackCandidate && rollback && rollback.available && rollback.safe
        ? [
          "  <label class=\"checkbox-row\">",
          "    <input type=\"checkbox\" id=\"state-rollback-confirm-checkbox\">",
          "    <span>I understand this will roll back the selected safe-field apply only.</span>",
          "  </label>",
          "  <p><button type=\"button\" class=\"button\" id=\"state-rollback-button\" data-apply-operation-id=\"" + escapeHtml(rollbackCandidate.apply_operation_id || "") + "\" disabled>Rollback Safe-Field Apply</button></p>"
        ].join("")
        : "",
      rollback && rollback.available && !rollback.safe
        ? "  <p class=\"project-note\">Rollback blocked: confirmation required.</p>"
        : "",
      rollback && !rollback.available
        ? "  <p class=\"project-note\">" + escapeHtml(rollback.message || "No rollback-ready apply is available.") + "</p>"
        : "",
      "  <p class=\"project-note\">State path: " + escapeHtml(summary.state_path) + "</p>",
      effectiveWarnings.length ? "  <ul class=\"warning-list\">" + effectiveWarnings.map((warning) => "<li>" + escapeHtml(warning) + "</li>").join("") + "</ul>" : "",
      warnings.length ? "  <ul class=\"warning-list\">" + warnings.map((warning) => "<li>" + escapeHtml(warning) + "</li>").join("") + "</ul>" : "",
      "</article>"
    ].join("\n");

    const rollbackButton = document.getElementById("state-rollback-button");
    const rollbackConfirm = document.getElementById("state-rollback-confirm-checkbox");
    if (rollbackButton && rollbackConfirm) {
      rollbackConfirm.addEventListener("change", () => {
        rollbackButton.disabled = !rollbackConfirm.checked;
      });
    }
    if (rollbackButton) {
      rollbackButton.addEventListener("click", async () => {
        const slug = String(generateProjectSlug.value || "").trim();
        const requestId = stateChangeView.requestId;
        const applyOperationId = rollbackButton.getAttribute("data-apply-operation-id") || "";
        rollbackButton.disabled = true;
        try {
          const response = await fetch("/api/projects/" + encodeURIComponent(slug) + "/state/rollback", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": createRequestIdempotencyKey("state-rollback")
            },
            body: JSON.stringify({
              apply_operation_id: applyOperationId,
              confirm_rollback: true
            })
          });
          const rollbackResult = await response.json();
          if (!isActiveStateSelection(slug, requestId)) {
            return;
          }
          if (!response.ok) {
            showResult(stateRollbackResult, rollbackResult, true);
            return;
          }

          renderStateRollbackResult(rollbackResult);
          await loadProjects();
          await loadManagedState(generateProjectSlug.value, { requestId: stateChangeView.requestId });
          await loadSiteStatus(generateProjectSlug.value);
          await loadProofPack(generateProjectSlug.value);
        } catch (error) {
          if (isActiveStateSelection(slug, requestId)) {
            showResult(stateRollbackResult, { error: error.message }, true);
          }
        } finally {
          rollbackButton.disabled = !(rollbackConfirm && rollbackConfirm.checked);
        }
      });
    }
  }

  function renderProofPackStatus(payload) {
    const summary = payload.summary || null;
    const stateSummary = payload.state_summary || {};
    const siteSummary = payload.site_summary || {};
    const readiness = summary && summary.readiness && typeof summary.readiness === "object"
      ? summary.readiness
      : (payload.readiness && typeof payload.readiness === "object" ? payload.readiness : {});
    const generatedReadiness = readiness.generated_site_ready || {};
    const aiHistoryReadiness = readiness.ai_safe_apply_history_ready || {};
    const secretsReadiness = readiness.secrets_ready || {};
    const evaluatorReadiness = readiness.alpha_evaluator_ready || {};
    const effectiveSafeFieldPayload = payload.effective_safe_fields && typeof payload.effective_safe_fields === "object"
      ? payload.effective_safe_fields
      : {};
    const siteCounts = siteSummary.counts_summary && siteSummary.counts_summary.after
      ? siteSummary.counts_summary.after
      : {};
    const effectiveFields = Array.isArray(effectiveSafeFieldPayload.fields)
      ? effectiveSafeFieldPayload.fields
      : [];
    const protectedFields = Array.isArray(summary && summary.protected_fields)
      ? summary.protected_fields
      : (Array.isArray(stateSummary.protected_fields) ? stateSummary.protected_fields : []);
    const missingProofCategories = Array.isArray(summary && summary.missing_proof_categories)
      ? summary.missing_proof_categories
      : [];
    const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];

    if (!payload.exists || !summary) {
      setProofPackEmpty("No alpha proof pack has been generated yet. Use Generate Proof Pack to collect the current evaluator summary.");
      return;
    }

    proofPackStatus.innerHTML = [
      "<article class=\"project-card\">",
      "  <div class=\"project-card__header\">",
      "    <h3>" + escapeHtml(payload.project.site_name) + "</h3>",
      "    <span class=\"status-pill\">" + escapeHtml(summary.readiness_status || "unknown") + "</span>",
      "  </div>",
      "  <dl>",
      "    <div><dt>Proof pack</dt><dd>" + escapeHtml(summary.proof_id || "Unavailable") + "</dd></div>",
      "    <div><dt>Generated</dt><dd>" + escapeHtml(summary.generated_at || "Unavailable") + "</dd></div>",
      "    <div><dt>Overall readiness</dt><dd>" + escapeHtml(evaluatorReadiness.status || summary.readiness_status || "unknown") + "</dd></div>",
      "    <div><dt>Generated site</dt><dd>" + escapeHtml(generatedReadiness.status || "unknown") + "</dd></div>",
      "    <div><dt>AI history</dt><dd>" + escapeHtml(aiHistoryReadiness.status || "unknown") + "</dd></div>",
      "    <div><dt>Secrets</dt><dd>" + escapeHtml(secretsReadiness.status || "unknown") + "</dd></div>",
      "    <div><dt>JSON path</dt><dd>" + escapeHtml(payload.json_path || "Unavailable") + "</dd></div>",
      "    <div><dt>Markdown path</dt><dd>" + escapeHtml(payload.markdown_path || "Unavailable") + "</dd></div>",
      "    <div><dt>Effective mutation</dt><dd>" + escapeHtml(stateSummary.latest_effective_mutation_method || summary.current_effective_mutation || "Unavailable") + "</dd></div>",
      "    <div><dt>Latest rollback proof</dt><dd>" + escapeHtml(stateSummary.latest_rollback_proof_path || summary.latest_rollback_proof_path || "Unavailable") + "</dd></div>",
      "    <div><dt>Protected fields</dt><dd>" + escapeHtml(protectedFields.length ? protectedFields.join(", ") : "None") + "</dd></div>",
      "    <div><dt>Pages</dt><dd>" + escapeHtml(String(stateSummary.pages || (summary.counts && summary.counts.pages) || siteCounts.pages || 0)) + "</dd></div>",
      "    <div><dt>Properties</dt><dd>" + escapeHtml(String(stateSummary.property_count || (summary.counts && summary.counts.properties) || siteCounts.properties || 0)) + "</dd></div>",
      "    <div><dt>Attachments</dt><dd>" + escapeHtml(String(stateSummary.attachment_count || (summary.counts && summary.counts.attachments) || siteCounts.attachments || 0)) + "</dd></div>",
      "    <div><dt>Home</dt><dd>" + escapeHtml(String((summary.url_status && summary.url_status.home) || (siteSummary.url_status && siteSummary.url_status.home) || "Unavailable")) + "</dd></div>",
      "    <div><dt>Properties URL</dt><dd>" + escapeHtml(String((summary.url_status && summary.url_status.properties) || (siteSummary.url_status && siteSummary.url_status.properties) || "Unavailable")) + "</dd></div>",
      "    <div><dt>Contact URL</dt><dd>" + escapeHtml(String((summary.url_status && summary.url_status.contact) || (siteSummary.url_status && siteSummary.url_status.contact) || "Unavailable")) + "</dd></div>",
      "  </dl>",
      effectiveFields.length
        ? "  <ul class=\"warning-list\">" + effectiveFields.map((field) => "<li><strong>" + escapeHtml(field.field_key) + ":</strong> " + escapeHtml(field.value) + " <em>[" + escapeHtml(field.source + (field.protected ? ", protected" : "") + ", render:" + field.rendered_check) + "]</em></li>").join("") + "</ul>"
        : "",
      evaluatorReadiness.reason
        ? "  <p class=\"project-note\">" + escapeHtml(evaluatorReadiness.reason) + "</p>"
        : "",
      missingProofCategories.length
        ? "  <p class=\"project-note\">Missing proof categories: " + escapeHtml(missingProofCategories.join(", ")) + "</p>"
        : "",
      "  <ul class=\"warning-list\">",
      "    <li>Live AI planning only</li>",
      "    <li>Field-only safe apply proven</li>",
      "    <li>Rollback proven</li>",
      "    <li>No raw key persistence</li>",
      "    <li>secrets/ai.env absent</li>",
      "  </ul>",
      warnings.length ? "  <ul class=\"warning-list\">" + warnings.map((warning) => "<li>" + escapeHtml(warning) + "</li>").join("") + "</ul>" : "",
      "</article>"
    ].join("\n");
  }

  function renderStatePlanResult(result) {
    const plan = result.plan || {};
    const conflicts = Array.isArray(plan.conflicts) ? plan.conflicts : [];
    const protectedFields = Array.isArray(plan.current && plan.current.protected_fields)
      ? plan.current.protected_fields
      : [];
    const fieldScope = plan.field_scope && typeof plan.field_scope === "object"
      ? plan.field_scope
      : { included_fields: [], excluded_fields: [], preserved_protected_fields: [] };
    const includedFields = Array.isArray(fieldScope.included_fields) ? fieldScope.included_fields : [];
    const excludedFields = Array.isArray(fieldScope.excluded_fields) ? fieldScope.excluded_fields : [];
    const preservedProtectedFields = Array.isArray(fieldScope.preserved_protected_fields)
      ? fieldScope.preserved_protected_fields
      : [];
    const requiresConfirmationFields = Array.isArray(fieldScope.requires_confirmation_fields)
      ? fieldScope.requires_confirmation_fields
      : [];
    const confirmationRequired = plan.confirmation_required && typeof plan.confirmation_required === "object"
      ? plan.confirmation_required
      : null;
    const planId = result.plan_id || plan.plan_id || "";
    const unsupportedFields = Array.isArray(result.unsupported_fields) ? result.unsupported_fields : [];
    const safeCanApply = !conflicts.length && includedFields.length > 0;
    const changeList = Array.isArray(plan.diff && plan.diff.field_changes)
      ? plan.diff.field_changes.map((entry) => {
        return "<li><strong>" + escapeHtml(entry.field_key) + ":</strong> "
          + escapeHtml(entry.change_type + " -> effective: " + (entry.effective_value || "(empty)"))
          + (entry.protected ? " <em>(protected)</em>" : "")
          + (entry.included_in_apply ? " <em>(included)</em>" : "")
          + (entry.excluded_reason ? " <em>(" + escapeHtml(entry.excluded_reason) + ")</em>" : "")
          + "</li>";
      }).join("")
      : "";
    const conflictList = conflicts.map((conflict) => {
      return "<li><strong>" + escapeHtml(conflict.field_key) + ":</strong> " + escapeHtml(conflict.message || "Requires confirmation") + "</li>";
    }).join("");

    statePlanResult.hidden = false;
    statePlanResult.className = conflicts.length ? "result-box result-box-error" : "result-box result-box-success";
    statePlanResult.innerHTML = [
      "<strong>AI site change plan created.</strong>",
      "<p><span>Plan ID:</span> " + escapeHtml(planId || "unknown") + "</p>",
      "<p><span>Proof file:</span> " + escapeHtml(result.proof_path || "Unavailable") + "</p>",
      "<p><span>AI source:</span> " + escapeHtml(result.ai_source || (plan.source && (plan.source.ai_source || plan.source.prompt_personalization_source)) || "local_interpreter") + "</p>",
      "<p><span>Provider called:</span> " + escapeHtml(String(result.provider_called === true || plan.provider_called === true)) + "</p>",
      result.estimate_id ? "<p><span>Estimate ID:</span> " + escapeHtml(result.estimate_id) + "</p>" : "",
      result.ai_candidate_proof_path ? "<p><span>AI candidate proof:</span> " + escapeHtml(result.ai_candidate_proof_path) + "</p>" : "",
      "<p><span>Field changes:</span> " + escapeHtml(String(plan.diff && plan.diff.field_changes ? plan.diff.field_changes.length : 0)) + "</p>",
      "<p><span>Preserved protected fields:</span> " + escapeHtml(preservedProtectedFields.length ? preservedProtectedFields.join(", ") : "None") + "</p>",
      "<p><span>Excluded fields:</span> " + escapeHtml(excludedFields.length ? excludedFields.join(", ") : "None") + "</p>",
      "<p><span>Included fields:</span> " + escapeHtml(includedFields.length ? includedFields.join(", ") : "None") + "</p>",
      "<p><span>Unsupported fields:</span> " + escapeHtml(unsupportedFields.length ? unsupportedFields.join(", ") : "None") + "</p>",
      "<p><span>Requires confirmation fields:</span> " + escapeHtml(requiresConfirmationFields.length ? requiresConfirmationFields.join(", ") : "None") + "</p>",
      "<p><span>Conflicts:</span> " + escapeHtml(String(conflicts.length)) + "</p>",
      "<p><span>Protected fields:</span> " + escapeHtml(protectedFields.length ? protectedFields.join(", ") : "None") + "</p>",
      "<p><span>Can apply without confirmation:</span> " + escapeHtml(String(plan.can_apply_without_confirmation === true)) + "</p>",
      safeCanApply
        ? [
          "<label class=\"checkbox-row\">",
          "  <input type=\"checkbox\" id=\"state-apply-confirm-checkbox\">",
          "  <span>I understand this will apply supported safe fields to this WordPress project.</span>",
          "</label>",
          confirmationRequired && confirmationRequired.required
            ? "<label class=\"checkbox-row\"><input type=\"checkbox\" id=\"state-protected-overwrite-confirm-checkbox\"><span>I explicitly confirm protected field overwrite for: " + escapeHtml((confirmationRequired.fields || []).join(", ")) + "</span></label>"
            : "",
          "<p><button type=\"button\" class=\"button\" id=\"state-apply-button\" data-plan-id=\"" + escapeHtml(planId) + "\" disabled>Apply Safe Changes</button></p>"
        ].join("")
        : (confirmationRequired && confirmationRequired.required
          ? "<p class=\"project-note\">Overwrite confirmation required for: " + escapeHtml((confirmationRequired.fields || []).join(", ")) + "</p>"
          : (conflicts.length
          ? "<p class=\"project-note\">Apply blocked: confirmation required.</p>"
          : "<p class=\"project-note\">No applyable field changes remain after preserving protected fields.</p>")),
      changeList ? "<p><span>Field changes:</span></p><ul>" + changeList + "</ul>" : "",
      conflictList ? "<p><span>Conflicts:</span></p><ul>" + conflictList + "</ul>" : ""
    ].join("");

    const applyButton = document.getElementById("state-apply-button");
    const applyConfirm = document.getElementById("state-apply-confirm-checkbox");
    const protectedConfirm = document.getElementById("state-protected-overwrite-confirm-checkbox");
    function updateApplyButton() {
      if (!applyButton || !applyConfirm) {
        return;
      }
      const protectedOk = !protectedConfirm || protectedConfirm.checked;
      applyButton.disabled = !applyConfirm.checked || !protectedOk;
    }
    if (applyConfirm) {
      applyConfirm.addEventListener("change", updateApplyButton);
    }
    if (protectedConfirm) {
      protectedConfirm.addEventListener("change", updateApplyButton);
    }
    if (applyButton) {
      applyButton.addEventListener("click", async () => {
        const slug = String(generateProjectSlug.value || "").trim();
        const requestId = stateChangeView.requestId;
        const selectedPlanId = applyButton.getAttribute("data-plan-id") || "";
        applyButton.disabled = true;
        try {
          const response = await fetch("/api/projects/" + encodeURIComponent(slug) + "/state/apply", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": createRequestIdempotencyKey("state-apply")
            },
            body: JSON.stringify({
              plan_id: selectedPlanId,
              confirm_apply: true,
              confirm_protected_overwrite: Boolean(protectedConfirm && protectedConfirm.checked)
            })
          });
          const applyResult = await response.json();
          if (!isActiveStateSelection(slug, requestId)) {
            return;
          }
          if (!response.ok) {
            showResult(statePlanResult, applyResult, true);
            return;
          }

          renderStateApplyResult(applyResult);
          await loadProjects();
          await loadManagedState(generateProjectSlug.value, { requestId: stateChangeView.requestId });
          await loadSiteStatus(generateProjectSlug.value);
          await loadProofPack(generateProjectSlug.value);
        } catch (error) {
          if (isActiveStateSelection(slug, requestId)) {
            showResult(statePlanResult, { error: error.message }, true);
          }
        } finally {
          updateApplyButton();
        }
      });
    }
  }

  function renderStateApplyResult(result) {
    const apply = result.apply || {};
    const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
    const confirmation = apply.confirmation && typeof apply.confirmation === "object"
      ? apply.confirmation
      : (result.proof && result.proof.confirmation && typeof result.proof.confirmation === "object" ? result.proof.confirmation : null);
    statePlanResult.hidden = false;
    statePlanResult.className = result.status === "ok" ? "result-box result-box-success" : "result-box result-box-error";
    statePlanResult.innerHTML = [
      "<strong>Managed state apply " + escapeHtml(result.status || "unknown") + ".</strong>",
      "<p><span>Code:</span> " + escapeHtml(result.code || "unknown") + "</p>",
      "<p><span>Apply method:</span> " + escapeHtml(result.apply_method || apply.apply_method || "unknown") + "</p>",
      "<p><span>Proof file:</span> " + escapeHtml(result.proof_path || "Unavailable") + "</p>",
      "<p><span>State path:</span> " + escapeHtml(result.state_path || "Unavailable") + "</p>",
      "<p><span>Applied fields:</span> " + escapeHtml((apply.applied_fields || []).length ? apply.applied_fields.join(", ") : "None") + "</p>",
      "<p><span>Ignored fields:</span> " + escapeHtml((apply.ignored_fields || []).length ? apply.ignored_fields.join(", ") : "None") + "</p>",
      "<p><span>Field-only manifest:</span> " + escapeHtml((result.field_only_apply && result.field_only_apply.agent_manifest) || (apply.field_only_apply && apply.field_only_apply.agent_manifest) || "Unavailable") + "</p>",
      confirmation && confirmation.required
        ? "<p><span>Overwrite confirmation:</span> " + escapeHtml(confirmation.confirmed ? "confirmed" : "required") + "</p>"
        : "",
      confirmation && confirmation.required
        ? "<p><span>Confirmation fields:</span> " + escapeHtml(((confirmation.confirmed_fields || confirmation.required_fields || []).length ? (confirmation.confirmed_fields || confirmation.required_fields).join(", ") : "None")) + "</p>"
        : "",
      apply.confirmation && Array.isArray(apply.confirmation.overwritten_protected_fields)
        ? "<p><span>Overwritten protected fields:</span> " + escapeHtml(apply.confirmation.overwritten_protected_fields.length ? apply.confirmation.overwritten_protected_fields.join(", ") : "None") + "</p>"
        : "",
      conflicts.length ? "<p><span>Conflicts:</span> " + escapeHtml(String(conflicts.length)) + "</p>" : "",
      conflicts.length ? "<ul>" + conflicts.map((conflict) => "<li>" + escapeHtml(conflict.message || conflict.field_key || "Conflict") + "</li>").join("") + "</ul>" : ""
    ].join("");
  }

  function renderStateRollbackResult(result) {
    const rollback = result.rollback || {};
    const protectedConflicts = Array.isArray(result.protected_conflicts) ? result.protected_conflicts : [];
    stateRollbackResult.hidden = false;
    stateRollbackResult.className = result.status === "ok" ? "result-box result-box-success" : "result-box result-box-error";
    stateRollbackResult.innerHTML = [
      "<strong>Managed state rollback " + escapeHtml(result.status || "unknown") + ".</strong>",
      "<p><span>Code:</span> " + escapeHtml(result.code || "unknown") + "</p>",
      "<p><span>Proof file:</span> " + escapeHtml(result.proof_path || "Unavailable") + "</p>",
      "<p><span>State path:</span> " + escapeHtml(result.state_path || "Unavailable") + "</p>",
      result.status === "ok"
        ? "<p><span>Rollback fields:</span> " + escapeHtml(Object.keys(rollback.rollback_fields || {}).join(", ")) + "</p>"
        : "",
      protectedConflicts.length
        ? "<ul>" + protectedConflicts.map((conflict) => "<li>" + escapeHtml(conflict.message || conflict.field_key || "Conflict") + "</li>").join("") + "</ul>"
        : ""
    ].join("");
  }

  async function loadSetupStatus(slug) {
    const selectedSlug = String(slug || "").trim();
    if (!selectedSlug) {
      setSetupEmpty("Select a project to view guided setup.");
      return;
    }

    const requestId = ++loadSetupStatusRequestId;
    const response = await fetch("/api/projects/" + encodeURIComponent(selectedSlug) + "/setup");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Unable to load setup status.");
    }

    if (requestId !== loadSetupStatusRequestId) {
      return;
    }

    renderSetupStatus(payload);
  }

  async function runSetupAction(action, dependencyKey) {
    const slug = String(setupProjectSlug.value || "").trim();
    if (!slug || setupActionInFlight) {
      return;
    }

    setupActionInFlight = true;
    try {
      if (action === "refresh") {
        await loadSetupStatus(slug);
        return;
      }

      if (action === "install-required") {
        const rows = lastSetupPayload && lastSetupPayload.setup && lastSetupPayload.setup.dependencies
          ? lastSetupPayload.setup.dependencies.rows || []
          : [];
        for (const row of rows) {
          if (row.source_available && !row.active) {
            const response = await fetch("/api/projects/" + encodeURIComponent(slug) + "/install-dependency", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": createRequestIdempotencyKey("setup-install-required-" + row.key)
              },
              body: JSON.stringify({ dependency: row.key })
            });
            const result = await response.json();
            if (!response.ok) {
              showResult(setupResult, result, true);
              return;
            }
            renderSetupResult(result, "Approved dependency installed.");
          }
        }
        await loadProjects();
        return;
      }

      let endpoint = null;
      let payload = {};
      let successTitle = "Completed.";

      if (action === "provision") {
        endpoint = "/api/projects/" + encodeURIComponent(slug) + "/provision";
        successTitle = "WordPress provisioned.";
      } else if (action === "install-agent") {
        endpoint = "/api/projects/" + encodeURIComponent(slug) + "/install-agent";
        successTitle = "Site Factory Agent installed.";
      } else if (action === "install-dependency") {
        endpoint = "/api/projects/" + encodeURIComponent(slug) + "/install-dependency";
        payload = { dependency: dependencyKey };
        successTitle = "Approved dependency installed.";
      } else {
        throw new Error("Unsupported setup action: " + action);
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createRequestIdempotencyKey("setup-" + action)
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) {
        showResult(setupResult, result, true);
        return;
      }

      renderSetupResult(result, successTitle);
      await loadProjects();
      await loadProjectOperations(slug, { requestId: generationView.requestId }).catch(() => {});
    } catch (error) {
      showResult(setupResult, { error: error.message }, true);
    } finally {
      setupActionInFlight = false;
      await loadSetupStatus(setupProjectSlug.value).catch(() => {});
    }
  }

  async function loadSiteStatus(slug, options) {
    const activeRequest = getActiveGenerationRequest(slug, options);
    const selectedSlug = activeRequest.slug;
    const requestId = activeRequest.requestId;
    const requestSignal = activeRequest.signal;
    if (!selectedSlug) {
      generationView.sitePayload = null;
      generationView.error = null;
      renderGenerationSurface();
      return;
    }

    if (!isActiveGenerationSelection(selectedSlug, requestId)) {
      return;
    }

    const project = projectsCache.find((entry) => entry.slug === selectedSlug);
    if (!project || !(project.generation && project.generation.last_proof_id)) {
      if (!isActiveGenerationSelection(selectedSlug, requestId)) {
        return;
      }
      generationView.sitePayload = null;
      generationView.error = null;
      renderGenerationSurface();
      return;
    }

    const response = await fetch("/api/projects/" + encodeURIComponent(selectedSlug) + "/site", {
      signal: requestSignal || undefined
    });
    const payload = await response.json();
    if (!isActiveGenerationSelection(selectedSlug, requestId)) {
      return;
    }
    if (!response.ok) {
      throw new Error(payload.error || "Unable to load generated site status.");
    }

    generationView.sitePayload = payload;
    generationView.error = null;
    renderGenerationSurface();
  }

  async function loadProjectOperations(slug, options) {
    const activeRequest = getActiveGenerationRequest(slug, options);
    const selectedSlug = activeRequest.slug;
    const requestId = activeRequest.requestId;
    const requestSignal = activeRequest.signal;
    if (!selectedSlug) {
      generationView.operationsPayload = null;
      generationView.error = null;
      renderGenerationSurface();
      return;
    }

    if (!isActiveGenerationSelection(selectedSlug, requestId)) {
      return;
    }

    const response = await fetch("/api/projects/" + encodeURIComponent(selectedSlug) + "/operations?limit=20", {
      signal: requestSignal || undefined
    });
    const payload = await response.json();
    if (!isActiveGenerationSelection(selectedSlug, requestId)) {
      return;
    }
    if (!response.ok) {
      throw new Error(payload.error || "Unable to load project operations.");
    }

    generationView.operationsPayload = payload;
    generationView.error = null;
    renderGenerationSurface();
    refreshSetupMutationAvailability();
  }

  async function loadGenerationStatus(slug, options) {
    const activeRequest = getActiveGenerationRequest(slug, options);
    const selectedSlug = activeRequest.slug;
    const requestId = activeRequest.requestId;
    const requestSignal = activeRequest.signal;
    if (!selectedSlug) {
      generationView.statusPayload = null;
      generationView.error = null;
      renderGenerationSurface();
      updateGenerateActionState();
      return;
    }

    if (!isActiveGenerationSelection(selectedSlug, requestId)) {
      return;
    }

    const response = await fetch("/api/projects/" + encodeURIComponent(selectedSlug) + "/generation", {
      signal: requestSignal || undefined
    });
    const payload = await response.json();
    if (!isActiveGenerationSelection(selectedSlug, requestId)) {
      return;
    }
    if (!response.ok) {
      throw new Error(payload.error || "Unable to load generation status.");
    }

    generationView.statusPayload = payload;
    generationView.operationsPayload = {
      ok: true,
      project: payload.project,
      active_operation: payload.current_operation || null,
      operations: Array.isArray(payload.operations) ? payload.operations : []
    };
    generationView.error = null;
    renderGenerationSurface();
    refreshSetupMutationAvailability();
    updateGenerationPolling(payload);
  }

  async function loadGenerationViewForSelection(slug) {
    const selectedSlug = String(slug || "").trim();
    if (selectedSlug && String(generateProjectSlug.value || "").trim() !== selectedSlug) {
      return;
    }
    const requestId = beginGenerationSelectionLoad(selectedSlug);

    if (!selectedSlug) {
      generationStatusLoading = false;
      updateGenerateActionState();
      return;
    }

    try {
      await Promise.all([
        loadGenerationStatus(selectedSlug, { requestId }),
        loadProjectOperations(selectedSlug, { requestId }),
        loadSiteStatus(selectedSlug, { requestId })
      ]);

      generationSelectionSettleTimer = window.setTimeout(async () => {
        if (!isActiveGenerationSelection(selectedSlug, requestId)) {
          return;
        }
        try {
          await loadGenerationStatus(selectedSlug, { requestId });
          await loadProjectOperations(selectedSlug, { requestId });
          await loadSiteStatus(selectedSlug, { requestId });
        } catch (error) {
          if (isActiveGenerationSelection(selectedSlug, requestId)) {
            generationView.error = error.message;
            renderGenerationSurface();
          }
        }
      }, 1200);
    } catch (error) {
      if (!isActiveGenerationSelection(selectedSlug, requestId)) {
        return;
      }
      generationView.error = error.message;
      renderGenerationSurface();
    } finally {
      if (isActiveGenerationSelection(selectedSlug, requestId)) {
        generationStatusLoading = false;
        generationView.loading = false;
        updateGenerateActionState();
      }
    }
  }

  async function loadManagedState(slug, options) {
    const selectedSlug = String(slug || "").trim();
    if (!selectedSlug) {
      setManagedStateEmpty("Select a project to view managed state.");
      return;
    }

    const requestId = options && options.requestId ? options.requestId : stateChangeView.requestId;
    if (!requestId || stateChangeView.slug !== selectedSlug) {
      stateChangeView.slug = selectedSlug;
      stateChangeView.requestId = requestId || ++stateChangeRequestId;
    }
    if (stateChangeAbortController) {
      stateChangeAbortController.abort();
    }
    stateChangeAbortController = new AbortController();
    stateChangeView.loading = true;
    renderStateChangeView();
    const response = await fetch("/api/projects/" + encodeURIComponent(selectedSlug) + "/state", {
      signal: stateChangeAbortController.signal
    });
    const payload = await response.json();
    if (!isActiveStateSelection(selectedSlug, requestId)) {
      return;
    }
    if (!response.ok) {
      stateChangeView.error = payload.error || "Unable to load managed state.";
      stateChangeView.loading = false;
      renderStateChangeView();
      throw new Error(stateChangeView.error);
    }

    stateChangeView.payload = payload;
    stateChangeView.error = null;
    stateChangeView.loading = false;
    renderStateChangeView();
  }

  async function loadProofPack(slug) {
    const selectedSlug = String(slug || "").trim();
    if (!selectedSlug) {
      setProofPackEmpty("Select a project to view the alpha proof pack.");
      return;
    }

    const response = await fetch("/api/projects/" + encodeURIComponent(selectedSlug) + "/proof-pack");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Unable to load alpha proof pack.");
    }

    renderProofPackStatus(payload);
  }

  async function loadProjects(options) {
    const preserveGeneratePreview = Boolean(options && options.preserveGeneratePreview);
    const requestId = ++loadProjectsRequestId;
    const response = await fetch("/api/projects");
    const payload = await response.json();
    if (requestId !== loadProjectsRequestId) {
      return;
    }
    renderProjects(payload.projects || []);
    if (requestId !== loadProjectsRequestId) {
      return;
    }
    const setupSlugSnapshot = String(setupProjectSlug.value || "").trim();
    const generateSlugSnapshot = String(generateProjectSlug.value || "").trim();
    await loadSetupStatus(setupSlugSnapshot);
    if (requestId !== loadProjectsRequestId || String(generateProjectSlug.value || "").trim() !== generateSlugSnapshot) {
      return;
    }
      if (preserveGeneratePreview) {
        const activeGenerationRequestId = generationView.requestId;
        generationStatusLoading = true;
        generationView.loading = true;
        renderGenerationSurface();
        updateGenerateActionState();
        try {
          await loadGenerationStatus(generateSlugSnapshot, { requestId: activeGenerationRequestId });
          await loadProjectOperations(generateSlugSnapshot, { requestId: activeGenerationRequestId });
          await loadSiteStatus(generateSlugSnapshot, { requestId: activeGenerationRequestId });
        } finally {
          if (isActiveGenerationSelection(generateSlugSnapshot, activeGenerationRequestId)) {
            generationStatusLoading = false;
            generationView.loading = false;
            renderGenerationSurface();
            updateGenerateActionState();
          }
        }
      } else {
        await loadGenerationViewForSelection(generateSlugSnapshot);
    }
    if (requestId !== loadProjectsRequestId || String(generateProjectSlug.value || "").trim() !== generateSlugSnapshot) {
      return;
    }
    const managedStateRequestId = stateChangeView.slug === generateSlugSnapshot
      ? stateChangeView.requestId
      : resetStateChangeView(generateSlugSnapshot);
    await loadManagedState(generateSlugSnapshot, { requestId: managedStateRequestId });
    if (requestId !== loadProjectsRequestId || String(generateProjectSlug.value || "").trim() !== generateSlugSnapshot) {
      return;
    }
    await loadProofPack(generateSlugSnapshot);
  }

  setupProjectSlug.addEventListener("change", () => {
    loadProjectsRequestId += 1;
    loadSetupStatusRequestId += 1;
    preferredSelectedSlug = setupProjectSlug.value;
    planProjectSlug.value = setupProjectSlug.value;
    generateProjectSlug.value = setupProjectSlug.value;
    const stateRequestId = resetStateChangeView(setupProjectSlug.value);
    Promise.all([
      loadSetupStatus(setupProjectSlug.value),
      loadGenerationViewForSelection(setupProjectSlug.value),
      loadManagedState(setupProjectSlug.value, { requestId: stateRequestId }),
      loadProofPack(setupProjectSlug.value)
    ]).catch((error) => {
      showResult(createResult, { error: error.message }, true);
    });
  });

  planProjectSlug.addEventListener("change", () => {
    loadProjectsRequestId += 1;
    loadSetupStatusRequestId += 1;
    preferredSelectedSlug = planProjectSlug.value;
    setupProjectSlug.value = planProjectSlug.value;
    generateProjectSlug.value = planProjectSlug.value;
    const stateRequestId = resetStateChangeView(planProjectSlug.value);
    Promise.all([
      loadSetupStatus(planProjectSlug.value),
      loadGenerationViewForSelection(planProjectSlug.value),
      loadManagedState(planProjectSlug.value, { requestId: stateRequestId }),
      loadProofPack(planProjectSlug.value)
    ]).catch((error) => {
      showResult(createResult, { error: error.message }, true);
    });
  });
  generateProjectSlug.addEventListener("change", () => {
    loadProjectsRequestId += 1;
    loadSetupStatusRequestId += 1;
    preferredSelectedSlug = generateProjectSlug.value;
    setupProjectSlug.value = generateProjectSlug.value;
    planProjectSlug.value = generateProjectSlug.value;
    const stateRequestId = resetStateChangeView(generateProjectSlug.value);
    Promise.all([
      loadSetupStatus(generateProjectSlug.value),
      loadGenerationViewForSelection(generateProjectSlug.value),
      loadManagedState(generateProjectSlug.value, { requestId: stateRequestId }),
      loadProofPack(generateProjectSlug.value)
    ]).catch((error) => {
      showResult(createResult, { error: error.message }, true);
    });
  });

  generatePrompt.addEventListener("input", () => {
    if (generatePreviewState && generatePreviewState.prompt !== getNormalizedGeneratePrompt()) {
      generatePreviewState.stale = true;
      renderGeneratePreview(generatePreviewState.result, { stale: true });
    }
    updateGenerateActionState();
  });

  generateConfirmCheckbox.addEventListener("change", () => {
    updateGenerateActionState();
  });

  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(createForm);
    const submitButton = createForm.querySelector("button[type=\"submit\"]");
    const payload = {
      name: formData.get("name"),
      slug: formData.get("slug"),
      port: Number(formData.get("port"))
    };

    submitButton.disabled = true;
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (!response.ok) {
        showResult(createResult, result, true);
        return;
      }

      showResult(createResult, Object.assign({ title: "Project scaffold created." }, result), false);
      createForm.reset();
      createForm.elements.port.value = "8120";
      preferredSelectedSlug = result.project && result.project.slug ? result.project.slug : "";
      loadProjectsRequestId += 1;
      loadSetupStatusRequestId += 1;
      await loadProjects();
      if (result.project && result.project.slug) {
        setupProjectSlug.value = result.project.slug;
        planProjectSlug.value = result.project.slug;
        generateProjectSlug.value = result.project.slug;
        await loadSetupStatus(result.project.slug);
        await loadGenerationViewForSelection(result.project.slug);
      }
    } finally {
      submitButton.disabled = false;
    }
  });

  planForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(planForm);
    const slug = String(formData.get("slug") || "").trim();
    const prompt = String(formData.get("prompt") || "").trim();

    const response = await fetch("/api/projects/" + encodeURIComponent(slug) + "/plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt,
        projectsRoot: config.projectsRoot
      })
    });

    const result = await response.json();
    if (!response.ok) {
      showResult(planResult, result, true);
      return;
    }

    renderPlanResult(result);
    await loadProjects();
  });

  generatePreviewButton.addEventListener("click", async () => {
    const slug = String(generateProjectSlug.value || "").trim();
    const selectionRequestId = generationSelectionRequestId;
    const prompt = getNormalizedGeneratePrompt();
    const promptValidation = getGeneratePromptValidation(prompt);

    if (!promptValidation.valid) {
      resetGeneratePreview(promptValidation.message);
      return;
    }

    generationActionInFlight = true;
    updateGenerateActionState();
    generateResult.hidden = true;

    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(slug) + "/generation/plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ prompt })
      });
      const result = await response.json();
      if (!isActiveGenerationSelection(slug, selectionRequestId)) {
        return;
      }
      if (!response.ok) {
        showResult(generatePreviewResult, result, true);
        return;
      }

      generatePreviewState = {
        plan_id: result.plan_id,
        prompt,
        result,
        stale: false
      };
      generateConfirmCheckbox.checked = false;
      renderGeneratePreview(result);
      await loadProjects({ preserveGeneratePreview: true });
    } catch (error) {
      if (isActiveGenerationSelection(slug, selectionRequestId)) {
        showResult(generatePreviewResult, { error: error.message }, true);
      }
    } finally {
      generationActionInFlight = false;
      updateGenerateActionState();
    }
  });

  generateForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const slug = String(generateProjectSlug.value || "").trim();
    const selectionRequestId = generationSelectionRequestId;
    const prompt = getNormalizedGeneratePrompt();
    const promptValidation = getGeneratePromptValidation(prompt);
    if (!promptValidation.valid) {
      resetGeneratePreview(promptValidation.message);
      return;
    }

    if (!generatePreviewState || generatePreviewState.stale || generatePreviewState.prompt !== prompt) {
      resetGeneratePreview("Preview Plan again before Generate.");
      return;
    }

    generationActionInFlight = true;
    updateGenerateActionState();
    startGenerationWatch(slug, generatePreviewState.plan_id);

    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(slug) + "/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createRequestIdempotencyKey("controlled-generate")
        },
        body: JSON.stringify({
          plan_id: generatePreviewState.plan_id,
          confirm_generate: true
        })
      });

      const result = await response.json();
      if (!isActiveGenerationSelection(slug, selectionRequestId)) {
        return;
      }
      if (!response.ok) {
        showResult(generateResult, result, true);
        await loadGenerationStatus(slug, { requestId: selectionRequestId });
        return;
      }

      renderGenerateResult(result);
      generatePreviewState = null;
      generateConfirmCheckbox.checked = false;
      await loadProjects();
      await loadGenerationStatus(slug, { requestId: selectionRequestId });
    } catch (error) {
      if (isActiveGenerationSelection(slug, selectionRequestId)) {
        showResult(generateResult, { error: error.message }, true);
      }
    } finally {
      generationActionInFlight = false;
      updateGenerateActionState();
    }
  });

  refreshStateButton.addEventListener("click", async () => {
    const slug = String(generateProjectSlug.value || "").trim();
    const requestId = stateChangeView.slug === slug ? stateChangeView.requestId : resetStateChangeView(slug);
    if (!slug) {
      setManagedStateEmpty("Select a project to refresh managed state.");
      return;
    }

    const response = await fetch("/api/projects/" + encodeURIComponent(slug) + "/state/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });
    const result = await response.json();
    if (!isActiveStateSelection(slug, requestId)) {
      return;
    }
    if (!response.ok) {
      showResult(createResult, result, true);
      return;
    }

    await loadManagedState(slug, { requestId });
    await loadProofPack(slug);
  });

  statePlanForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const slug = String(generateProjectSlug.value || "").trim();
    const prompt = String(statePlanPrompt.value || "").trim();
    const overwriteFields = stateOverwriteHeroTitleCheckbox && stateOverwriteHeroTitleCheckbox.checked
      ? ["hero_title"]
      : [];
    const requestId = stateChangeView.slug === slug ? stateChangeView.requestId : resetStateChangeView(slug);

    if (!slug) {
      setManagedStateEmpty("Select a project before planning against managed state.");
      return;
    }

    statePlanResult.hidden = false;
    statePlanResult.className = "result-box";
    statePlanResult.innerHTML = "<strong>Previewing AI site changes...</strong>";
    stateRollbackResult.hidden = true;

    const response = await fetch("/api/projects/" + encodeURIComponent(slug) + "/state/plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt,
        overwrite_fields: overwriteFields
      })
    });
    const result = await response.json();
    if (!isActiveStateSelection(slug, requestId)) {
      return;
    }
    if (!response.ok) {
      showResult(statePlanResult, result, true);
      return;
    }

    stateChangeView.plan = result;
    renderStatePlanResult(result);
  });

  statePlanPrompt.addEventListener("input", () => {
    stateChangeView.plan = null;
    stateChangeView.apply = null;
    stateChangeView.rollback = null;
    statePlanResult.hidden = true;
    statePlanResult.innerHTML = "";
    stateRollbackResult.hidden = true;
    stateRollbackResult.innerHTML = "";
  });

  if (stateOverwriteHeroTitleCheckbox) {
    stateOverwriteHeroTitleCheckbox.addEventListener("change", () => {
      stateChangeView.plan = null;
      stateChangeView.apply = null;
      stateChangeView.rollback = null;
      statePlanResult.hidden = true;
      statePlanResult.innerHTML = "";
      stateRollbackResult.hidden = true;
      stateRollbackResult.innerHTML = "";
    });
  }

  proofPackRefreshButton.addEventListener("click", async () => {
    const slug = String(generateProjectSlug.value || "").trim();
    if (!slug) {
      setProofPackEmpty("Select a project to refresh the alpha proof pack.");
      return;
    }

    try {
      await loadProofPack(slug);
    } catch (error) {
      showResult(proofPackResult, { error: error.message }, true);
    }
  });

  proofPackGenerateButton.addEventListener("click", async () => {
    const slug = String(generateProjectSlug.value || "").trim();
    if (!slug) {
      setProofPackEmpty("Select a project before generating a proof pack.");
      return;
    }

    proofPackGenerateButton.disabled = true;
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(slug) + "/proof-pack/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });
      const result = await response.json();
      if (!response.ok) {
        showResult(proofPackResult, result, true);
        return;
      }

      proofPackResult.hidden = false;
      proofPackResult.className = "result-box result-box-success";
      proofPackResult.innerHTML = [
        "<strong>Alpha proof pack generated.</strong>",
        "<p><span>JSON:</span> " + escapeHtml(result.json_path || "Unavailable") + "</p>",
        "<p><span>Markdown:</span> " + escapeHtml(result.markdown_path || "Unavailable") + "</p>",
        "<p><span>Readiness:</span> " + escapeHtml(result.summary && result.summary.readiness_status || "unknown") + "</p>",
        "<p><span>Overall:</span> " + escapeHtml(result.summary && result.summary.readiness && result.summary.readiness.alpha_evaluator_ready && result.summary.readiness.alpha_evaluator_ready.status || "unknown") + "</p>"
      ].join("");

      await loadProofPack(slug);
    } catch (error) {
      showResult(proofPackResult, { error: error.message }, true);
    } finally {
      proofPackGenerateButton.disabled = false;
    }
  });

  setupStatus.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-setup-action]");
    if (!button) {
      return;
    }

    runSetupAction(button.getAttribute("data-setup-action"), button.getAttribute("data-dependency")).catch((error) => {
      showResult(setupResult, { error: error.message }, true);
    });
  });

  if (setupProjectForm) {
    setupProjectForm.addEventListener("submit", (event) => {
      event.preventDefault();
    });
  }

  if (createForm && createForm.elements.name && createForm.elements.slug) {
    let slugTouched = false;
    createForm.elements.slug.addEventListener("input", () => {
      slugTouched = String(createForm.elements.slug.value || "").trim().length > 0;
    });
    createForm.elements.name.addEventListener("input", () => {
      if (!slugTouched) {
        createForm.elements.slug.value = slugifyProjectName(createForm.elements.name.value);
      }
    });
  }

  loadProjects().catch((error) => {
    showResult(createResult, { error: error.message }, true);
  });
})();
