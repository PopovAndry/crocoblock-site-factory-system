"use strict";

(function bootstrapLauncher() {
  const config = window.FactoryLauncherConfig || {};
  const projectList = document.getElementById("project-list");
  const createForm = document.getElementById("create-project-form");
  const createResult = document.getElementById("create-result");
  const planForm = document.getElementById("plan-project-form");
  const planProjectSlug = document.getElementById("plan-project-slug");
  const planResult = document.getElementById("plan-result");
  const latestRun = document.getElementById("latest-run");
  const generateForm = document.getElementById("generate-project-form");
  const generateProjectSlug = document.getElementById("generate-project-slug");
  const generateResult = document.getElementById("generate-result");
  const siteStatus = document.getElementById("site-status");
  const managedState = document.getElementById("managed-state");
  const refreshStateButton = document.getElementById("refresh-state-button");
  const statePlanForm = document.getElementById("state-plan-form");
  const statePlanPrompt = document.getElementById("state-plan-prompt");
  const statePlanResult = document.getElementById("state-plan-result");
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

  function setSiteStatusEmpty(message) {
    siteStatus.innerHTML = "<p class=\"empty-state\">" + escapeHtml(message) + "</p>";
  }

  function setManagedStateEmpty(message) {
    managedState.innerHTML = "<p class=\"empty-state\">" + escapeHtml(message) + "</p>";
  }

  function renderProjects(projects) {
    projectsCache = projects.slice();

    if (!projects.length) {
      projectList.innerHTML = "<p class=\"empty-state\">No projects yet. Create the first scaffold to prepare a runtime folder.</p>";
      planProjectSlug.innerHTML = "<option value=\"\">Create a project first</option>";
      planProjectSlug.disabled = true;
      generateProjectSlug.innerHTML = "<option value=\"\">Create a project first</option>";
      generateProjectSlug.disabled = true;
      latestRun.innerHTML = "<p class=\"empty-state\">No planning runs yet.</p>";
      setSiteStatusEmpty("No generated site result yet.");
      setManagedStateEmpty("Refresh state after generate or frontend edits.");
      milestoneGenerate.disabled = true;
      totalTokens.textContent = "0";
      aiMode.textContent = "mock";
      aiProvider.textContent = "mock";
      aiModel.textContent = "balanced";
      aiKeyStatus.textContent = "not_required";
      aiLastEstimate.textContent = "Not recorded";
      return;
    }

    const previousPlanSlug = planProjectSlug.value;
    const previousGenerateSlug = generateProjectSlug.value;
    planProjectSlug.disabled = false;
    generateProjectSlug.disabled = false;
    const projectOptions = projects.map((project) => {
      return "<option value=\"" + escapeHtml(project.slug) + "\">" + escapeHtml(project.site_name + " (" + project.slug + ")") + "</option>";
    }).join("");
    planProjectSlug.innerHTML = projectOptions;
    generateProjectSlug.innerHTML = projectOptions;

    planProjectSlug.value = projects.some((project) => project.slug === previousPlanSlug) ? previousPlanSlug : projects[0].slug;
    generateProjectSlug.value = projects.some((project) => project.slug === previousGenerateSlug) ? previousGenerateSlug : planProjectSlug.value;

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
      "  </dl>",
      "  <p class=\"project-note\">State path: " + escapeHtml(summary.state_path) + "</p>",
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
    const changeList = Array.isArray(plan.diff && plan.diff.field_changes)
      ? plan.diff.field_changes.map((entry) => {
        return "<li><strong>" + escapeHtml(entry.field_key) + ":</strong> "
          + escapeHtml(entry.change_type + " -> " + (entry.proposed_value || "(empty)"))
          + (entry.protected ? " <em>(protected)</em>" : "")
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
      "<p><span>Field changes:</span> " + escapeHtml(String(plan.diff && plan.diff.field_changes ? plan.diff.field_changes.length : 0)) + "</p>",
      "<p><span>Conflicts:</span> " + escapeHtml(String(conflicts.length)) + "</p>",
      "<p><span>Protected fields:</span> " + escapeHtml(protectedFields.length ? protectedFields.join(", ") : "None") + "</p>",
      "<p><span>Can apply without confirmation:</span> " + escapeHtml(String(plan.can_apply_without_confirmation === true)) + "</p>",
      changeList ? "<p><span>Field changes:</span></p><ul>" + changeList + "</ul>" : "",
      conflictList ? "<p><span>Conflicts:</span></p><ul>" + conflictList + "</ul>" : ""
    ].join("");
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

  async function loadProjects() {
    const response = await fetch("/api/projects");
    const payload = await response.json();
    renderProjects(payload.projects || []);
    await loadSiteStatus(generateProjectSlug.value);
    await loadManagedState(generateProjectSlug.value);
  }

  planProjectSlug.addEventListener("change", () => {
    loadProjects().catch((error) => {
      showResult(createResult, { error: error.message }, true);
    });
  });
  generateProjectSlug.addEventListener("change", () => {
    Promise.all([
      loadSiteStatus(generateProjectSlug.value),
      loadManagedState(generateProjectSlug.value)
    ]).catch((error) => {
      showResult(createResult, { error: error.message }, true);
    });
  });

  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(createForm);
    const payload = {
      name: formData.get("name"),
      port: Number(formData.get("port")),
      projectsRoot: formData.get("projectsRoot") || config.projectsRoot
    };

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
    createForm.elements.projectsRoot.value = config.projectsRoot || "";
    createForm.elements.port.value = "8120";
    await loadProjects();
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

  loadProjects().catch((error) => {
    showResult(createResult, { error: error.message }, true);
  });
})();
