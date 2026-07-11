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
  const generateResult = document.getElementById("generate-result");
  const siteStatus = document.getElementById("site-status");
  const managedState = document.getElementById("managed-state");
  const proofPackStatus = document.getElementById("proof-pack-status");
  const proofPackRefreshButton = document.getElementById("proof-pack-refresh-button");
  const proofPackGenerateButton = document.getElementById("proof-pack-generate-button");
  const proofPackResult = document.getElementById("proof-pack-result");
  const refreshStateButton = document.getElementById("refresh-state-button");
  const statePlanForm = document.getElementById("state-plan-form");
  const statePlanPrompt = document.getElementById("state-plan-prompt");
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

  }

  function setupActionButton(label, action, disabled, extraAttributes) {
    return "<button type=\"button\" class=\"button\" data-setup-action=\"" + escapeHtml(action) + "\"" +
      (disabled ? " disabled" : "") +
      (extraAttributes || "") +
      ">" + escapeHtml(label) + "</button>";
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
    const missingSourceKeys = dependencyRows
      .filter((row) => !row.source_available)
      .map((row) => row.key);
    const installableRows = dependencyRows.filter((row) => row.source_available && !row.active);
    const dependencyRowsMarkup = dependencyRows.map((row) => {
      const disabled = setupActionInFlight || !setup.agent || setup.agent.status !== "ready" || !row.source_available || row.active;
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
      "      <div class=\"setup-actions\">" + setupActionButton("Provision WordPress", "provision", setupActionInFlight || setup.wordpress.status === "ready") + (setup.wordpress.wp_url ? " <a class=\"site-link\" href=\"" + escapeHtml(setup.wordpress.wp_url) + "\" target=\"_blank\" rel=\"noreferrer\">Open WordPress</a>" : "") + "</div>",
      "    </article>",
      "    <article class=\"setup-step-card\">",
      "      <div class=\"setup-step-card__header\"><h4>3. Agent</h4><span class=\"status-pill\">" + escapeHtml(setup.agent.status) + "</span></div>",
      "      <p class=\"project-note\">Installs the local Site Factory Agent plugin already shipped in this repository.</p>",
      "      <dl><div><dt>Health</dt><dd>" + escapeHtml(setup.agent.health_status || "Unavailable") + "</dd></div><div><dt>Capabilities</dt><dd>" + escapeHtml(setup.agent.capabilities_status || "Unavailable") + "</dd></div><div><dt>Proof</dt><dd>" + escapeHtml(setup.agent.proof_path || "Unavailable") + "</dd></div></dl>",
      "      <div class=\"setup-actions\">" + setupActionButton("Install Agent", "install-agent", setupActionInFlight || setup.wordpress.status !== "ready" || setup.agent.status === "ready") + "</div>",
      "    </article>",
      "    <article class=\"setup-step-card\">",
      "      <div class=\"setup-step-card__header\"><h4>4. Dependencies</h4><span class=\"status-pill\">" + escapeHtml(setup.dependencies.status) + "</span></div>",
      "      <p class=\"project-note\">Approved local ZIP sources are resolved server-side. The browser sends only dependency keys.</p>",
      "      <dl><div><dt>Can generate</dt><dd>" + escapeHtml(String(setup.dependencies.can_generate)) + "</dd></div><div><dt>Blockers</dt><dd>" + escapeHtml(setup.dependencies.blockers.length ? setup.dependencies.blockers.join(" | ") : "None") + "</dd></div><div><dt>Proof</dt><dd>" + escapeHtml(setup.dependencies.proof_path || "Unavailable") + "</dd></div></dl>",
      missingSourceKeys.length ? "      <p class=\"project-note\">Missing approved ZIPs: " + escapeHtml(missingSourceKeys.join(", ")) + "</p>" : "",
      installableRows.length ? "      <div class=\"setup-actions\">" + setupActionButton("Install Required Dependencies", "install-required", setupActionInFlight || setup.agent.status !== "ready") + "</div>" : "",
      dependencyRowsMarkup,
      "    </article>",
      "    <article class=\"setup-step-card\">",
      "      <div class=\"setup-step-card__header\"><h4>5. Ready to Generate</h4><span class=\"status-pill\">" + escapeHtml(readyToGenerate ? "ready" : "blocked") + "</span></div>",
      "      <p class=\"project-note\">" + escapeHtml(readyToGenerate ? "Required dependencies are active. Generate stays intentionally disabled in this phase." : (setup.dependencies.next_action || "Finish the setup blockers above.")) + "</p>",
      "    </article>",
      "  </div>",
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
    generateResult.hidden = false;
    generateResult.className = "result-box result-box-success";
    generateResult.innerHTML = [
      "<strong>Controlled generate completed.</strong>",
      "<p><span>Status:</span> " + escapeHtml(result.status || "unknown") + "</p>",
      "<p><span>Code:</span> " + escapeHtml(result.code || "unknown") + "</p>",
      "<p><span>Proof file:</span> " + escapeHtml(result.proof_path) + "</p>",
      personalization ? "<p><span>Personalization:</span> " + escapeHtml(personalization.source || "local_interpreter") + " -> " + escapeHtml((personalization.applied_fields || []).join(", ")) + "</p>" : "",
      "<p><span>Home:</span> " + escapeHtml(urls.home || urls.root || result.project.wp_url) + "</p>",
      "<p><span>Properties:</span> " + escapeHtml(urls.properties || "Unavailable") + "</p>",
      "<p><span>Contact:</span> " + escapeHtml(urls.contact || "Unavailable") + "</p>"
    ].join("");
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

  function renderSiteStatus(payload) {
    const site = payload.site || {};
    const urls = site.generated_urls || {};
    const counts = site.counts_summary || {};
    const beforeCounts = counts.before || {};
    const afterCounts = counts.after || {};
    const personalization = site.personalization || null;
    const warnings = Array.isArray(site.warnings) ? site.warnings : [];

    if (!site.latest_generate_proof_id && !site.generated_site_present) {
      setSiteStatusEmpty("Run controlled generate to populate generated site proof.");
      return;
    }

    const links = [
      urls.home || urls.root ? "<a class=\"site-link\" href=\"" + escapeHtml(urls.home || urls.root) + "\" target=\"_blank\" rel=\"noreferrer\">Open Home</a>" : "",
      urls.properties ? "<a class=\"site-link\" href=\"" + escapeHtml(urls.properties) + "\" target=\"_blank\" rel=\"noreferrer\">Open Properties</a>" : "",
      urls.contact ? "<a class=\"site-link\" href=\"" + escapeHtml(urls.contact) + "\" target=\"_blank\" rel=\"noreferrer\">Open Contact</a>" : "",
      site.frontend_edit_available && site.frontend_edit_url ? "<a class=\"site-link\" href=\"" + escapeHtml(site.frontend_edit_url) + "\" target=\"_blank\" rel=\"noreferrer\">Open Frontend Edit</a>" : "",
      site.frontend_edit_available && site.frontend_edit_login_url ? "<a class=\"site-link\" href=\"" + escapeHtml(site.frontend_edit_login_url) + "\" target=\"_blank\" rel=\"noreferrer\">Login to Edit</a>" : ""
    ].filter(Boolean).join("");

    siteStatus.innerHTML = [
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

  function renderManagedState(payload) {
    if (!payload.exists || !payload.summary) {
      setManagedStateEmpty("Managed state has not been refreshed yet.");
      return;
    }

    const summary = payload.summary;
    const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    const rollback = payload.rollback || null;
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
      "    <div><dt>Effective fields</dt><dd>" + escapeHtml(String(summary.effective_safe_fields_count || 0)) + "</dd></div>",
      "  </dl>",
      effectiveSafeFields.length
        ? "  <ul class=\"warning-list\">" + effectiveSafeFields.map((field) => "<li><strong>" + escapeHtml(field.field_key) + ":</strong> " + escapeHtml(field.value) + " <em>[" + escapeHtml(field.source + (field.protected ? ", protected" : "") + ", render:" + field.rendered_check) + "]</em></li>").join("") + "</ul>"
        : "",
      rollback && rollback.available && rollback.safe
        ? "  <p><button type=\"button\" class=\"button\" id=\"state-rollback-button\" data-apply-path=\"" + escapeHtml(rollback.apply_path || "latest") + "\">Rollback Last Apply</button></p>"
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
    if (rollbackButton) {
      rollbackButton.addEventListener("click", async () => {
        rollbackButton.disabled = true;
        try {
          const response = await fetch("/api/projects/" + encodeURIComponent(String(generateProjectSlug.value || "").trim()) + "/state/rollback", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              apply_path: rollbackButton.getAttribute("data-apply-path") || "latest"
            })
          });
          const rollbackResult = await response.json();
          if (!response.ok) {
            showResult(stateRollbackResult, rollbackResult, true);
            return;
          }

          renderStateRollbackResult(rollbackResult);
          await loadProjects();
          await loadManagedState(generateProjectSlug.value);
          await loadSiteStatus(generateProjectSlug.value);
          await loadProofPack(generateProjectSlug.value);
        } catch (error) {
          showResult(stateRollbackResult, { error: error.message }, true);
        } finally {
          rollbackButton.disabled = false;
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
      "<strong>Managed state plan created.</strong>",
      "<p><span>Plan ID:</span> " + escapeHtml(plan.plan_id || "unknown") + "</p>",
      "<p><span>Plan file:</span> " + escapeHtml(result.plan_path || "Unavailable") + "</p>",
      "<p><span>Proof file:</span> " + escapeHtml(result.proof_path || "Unavailable") + "</p>",
      "<p><span>AI source:</span> " + escapeHtml(result.ai_source || (plan.source && (plan.source.ai_source || plan.source.prompt_personalization_source)) || "local_interpreter") + "</p>",
      "<p><span>Provider called:</span> " + escapeHtml(String(result.provider_called === true || plan.provider_called === true)) + "</p>",
      result.estimate_id ? "<p><span>Estimate ID:</span> " + escapeHtml(result.estimate_id) + "</p>" : "",
      result.ai_candidate_proof_path ? "<p><span>AI candidate proof:</span> " + escapeHtml(result.ai_candidate_proof_path) + "</p>" : "",
      "<p><span>Field changes:</span> " + escapeHtml(String(plan.diff && plan.diff.field_changes ? plan.diff.field_changes.length : 0)) + "</p>",
      "<p><span>Preserved protected fields:</span> " + escapeHtml(preservedProtectedFields.length ? preservedProtectedFields.join(", ") : "None") + "</p>",
      "<p><span>Excluded fields:</span> " + escapeHtml(excludedFields.length ? excludedFields.join(", ") : "None") + "</p>",
      "<p><span>Included fields:</span> " + escapeHtml(includedFields.length ? includedFields.join(", ") : "None") + "</p>",
      "<p><span>Requires confirmation fields:</span> " + escapeHtml(requiresConfirmationFields.length ? requiresConfirmationFields.join(", ") : "None") + "</p>",
      "<p><span>Conflicts:</span> " + escapeHtml(String(conflicts.length)) + "</p>",
      "<p><span>Protected fields:</span> " + escapeHtml(protectedFields.length ? protectedFields.join(", ") : "None") + "</p>",
      "<p><span>Can apply without confirmation:</span> " + escapeHtml(String(plan.can_apply_without_confirmation === true)) + "</p>",
      plan.can_apply_without_confirmation === true && !conflicts.length && includedFields.length > 0
        ? "<p><button type=\"button\" class=\"button\" id=\"state-apply-button\" data-plan-path=\"" + escapeHtml(result.plan_path || "latest") + "\">Apply Plan</button></p>"
        : (confirmationRequired && confirmationRequired.required
          ? "<p class=\"project-note\">Overwrite confirmation required for: " + escapeHtml((confirmationRequired.fields || []).join(", ")) + "</p>"
          : (conflicts.length
          ? "<p class=\"project-note\">Apply blocked: confirmation required.</p>"
          : "<p class=\"project-note\">No applyable field changes remain after preserving protected fields.</p>")),
      changeList ? "<p><span>Field changes:</span></p><ul>" + changeList + "</ul>" : "",
      conflictList ? "<p><span>Conflicts:</span></p><ul>" + conflictList + "</ul>" : ""
    ].join("");

    const applyButton = document.getElementById("state-apply-button");
    if (applyButton) {
      applyButton.addEventListener("click", async () => {
        applyButton.disabled = true;
        try {
          const response = await fetch("/api/projects/" + encodeURIComponent(String(generateProjectSlug.value || "").trim()) + "/state/apply", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              plan_path: applyButton.getAttribute("data-plan-path") || "latest"
            })
          });
          const applyResult = await response.json();
          if (!response.ok) {
            showResult(statePlanResult, applyResult, true);
            return;
          }

          renderStateApplyResult(applyResult);
          await loadProjects();
          await loadManagedState(generateProjectSlug.value);
          await loadSiteStatus(generateProjectSlug.value);
          await loadProofPack(generateProjectSlug.value);
        } catch (error) {
          showResult(statePlanResult, { error: error.message }, true);
        } finally {
          applyButton.disabled = false;
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
                "Content-Type": "application/json"
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
          "Content-Type": "application/json"
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
    } catch (error) {
      showResult(setupResult, { error: error.message }, true);
    } finally {
      setupActionInFlight = false;
      await loadSetupStatus(setupProjectSlug.value).catch(() => {});
    }
  }

  async function loadSiteStatus(slug) {
    const selectedSlug = String(slug || "").trim();
    if (!selectedSlug) {
      setSiteStatusEmpty("Select a project to view generated site proof.");
      return;
    }

    const project = projectsCache.find((entry) => entry.slug === selectedSlug);
    if (!project || !(project.generation && project.generation.last_proof_id)) {
      setSiteStatusEmpty("Run controlled generate to populate generated site proof.");
      return;
    }

    const response = await fetch("/api/projects/" + encodeURIComponent(selectedSlug) + "/site");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Unable to load generated site status.");
    }

    renderSiteStatus(payload);
  }

  async function loadManagedState(slug) {
    const selectedSlug = String(slug || "").trim();
    if (!selectedSlug) {
      setManagedStateEmpty("Select a project to view managed state.");
      return;
    }

    const response = await fetch("/api/projects/" + encodeURIComponent(selectedSlug) + "/state");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Unable to load managed state.");
    }

    renderManagedState(payload);
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

  async function loadProjects() {
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
    await loadSetupStatus(setupProjectSlug.value);
    await loadSiteStatus(generateProjectSlug.value);
    await loadManagedState(generateProjectSlug.value);
    await loadProofPack(generateProjectSlug.value);
  }

  setupProjectSlug.addEventListener("change", () => {
    preferredSelectedSlug = setupProjectSlug.value;
    planProjectSlug.value = setupProjectSlug.value;
    generateProjectSlug.value = setupProjectSlug.value;
    Promise.all([
      loadSetupStatus(setupProjectSlug.value),
      loadSiteStatus(setupProjectSlug.value),
      loadManagedState(setupProjectSlug.value),
      loadProofPack(setupProjectSlug.value)
    ]).catch((error) => {
      showResult(createResult, { error: error.message }, true);
    });
  });

  planProjectSlug.addEventListener("change", () => {
    preferredSelectedSlug = planProjectSlug.value;
    setupProjectSlug.value = planProjectSlug.value;
    generateProjectSlug.value = planProjectSlug.value;
    loadProjects().catch((error) => {
      showResult(createResult, { error: error.message }, true);
    });
  });
  generateProjectSlug.addEventListener("change", () => {
    preferredSelectedSlug = generateProjectSlug.value;
    setupProjectSlug.value = generateProjectSlug.value;
    planProjectSlug.value = generateProjectSlug.value;
    Promise.all([
      loadSetupStatus(generateProjectSlug.value),
      loadSiteStatus(generateProjectSlug.value),
      loadManagedState(generateProjectSlug.value),
      loadProofPack(generateProjectSlug.value)
    ]).catch((error) => {
      showResult(createResult, { error: error.message }, true);
    });
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

  generateForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(generateForm);
    const slug = String(formData.get("slug") || "").trim();

    const response = await fetch("/api/projects/" + encodeURIComponent(slug) + "/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectsRoot: config.projectsRoot
      })
    });

    const result = await response.json();
    if (!response.ok) {
      showResult(generateResult, result, true);
      return;
    }

    renderGenerateResult(result);
    await loadProjects();
  });

  refreshStateButton.addEventListener("click", async () => {
    const slug = String(generateProjectSlug.value || "").trim();
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
    if (!response.ok) {
      showResult(createResult, result, true);
      return;
    }

    renderManagedState({
      exists: true,
      project: result.project,
      summary: result.summary,
      warnings: result.warnings || []
    });
    await loadProofPack(slug);
  });

  statePlanForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const slug = String(generateProjectSlug.value || "").trim();
    const prompt = String(statePlanPrompt.value || "").trim();

    if (!slug) {
      setManagedStateEmpty("Select a project before planning against managed state.");
      return;
    }

    const response = await fetch("/api/projects/" + encodeURIComponent(slug) + "/state/plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prompt })
    });
    const result = await response.json();
    if (!response.ok) {
      showResult(statePlanResult, result, true);
      return;
    }

    renderStatePlanResult(result);
  });

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
