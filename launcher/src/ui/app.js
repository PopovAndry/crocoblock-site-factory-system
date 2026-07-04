"use strict";

(function bootstrapLauncher() {
  const config = window.FactoryLauncherConfig || {};
  const projectList = document.getElementById("project-list");
  const createForm = document.getElementById("create-project-form");
  const createResult = document.getElementById("create-result");

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderProjects(projects) {
    if (!projects.length) {
      projectList.innerHTML = "<p class=\"empty-state\">No projects yet. Create the first scaffold to prepare a runtime folder.</p>";
      return;
    }

    projectList.innerHTML = projects.map((project) => {
      const runtimeStatus = project.runtime && project.runtime.status ? project.runtime.status : "not_provisioned";
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
        "    <div><dt>Created</dt><dd>" + escapeHtml(project.created_at || "") + "</dd></div>",
        "  </dl>",
        "</article>"
      ].join("\n");
    }).join("\n");
  }

  function showResult(payload, isError) {
    createResult.hidden = false;
    createResult.className = isError ? "result-box result-box-error" : "result-box result-box-success";

    if (isError) {
      createResult.innerHTML = "<strong>Project scaffold failed.</strong><p>" + escapeHtml(payload.error || "Unknown error") + "</p>";
      return;
    }

    createResult.innerHTML = [
      "<strong>Project scaffold created.</strong>",
      "<p><span>Path:</span> " + escapeHtml(payload.project.runtime_path) + "</p>",
      "<p><span>Files written:</span> " + escapeHtml(payload.files_written.join(", ")) + "</p>",
      "<p><span>Next step:</span> " + escapeHtml(payload.next_step) + "</p>"
    ].join("");
  }

  async function loadProjects() {
    const response = await fetch("/api/projects");
    const payload = await response.json();
    renderProjects(payload.projects || []);
  }

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
      showResult(result, true);
      return;
    }

    showResult(result, false);
    createForm.reset();
    createForm.elements.projectsRoot.value = config.projectsRoot || "";
    createForm.elements.port.value = "8120";
    await loadProjects();
  });

  loadProjects().catch((error) => {
    showResult({ error: error.message }, true);
  });
})();
