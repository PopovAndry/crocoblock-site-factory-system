"use strict";

(function createWebsiteUiModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.FactoryCreateWebsiteUi = api;
    api.bootstrap(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createWebsiteUiFactory() {
  const STORAGE_SLUG = "factory-create-website-slug";
  const STORAGE_KEY = "factory-create-website-request-key";
  const STEP_ORDER = ["type", "details", "review", "progress"];

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function collapse(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function validateDetails(values) {
    const errors = {};
    const limits = { project_name: 80, agency_name: 80, city: 80 };
    for (const [field, limit] of Object.entries(limits)) {
      const value = collapse(values && values[field]);
      if (!value) {
        errors[field] = "This field is required.";
      } else if (value.length > limit) {
        errors[field] = "Use " + String(limit) + " characters or fewer.";
      } else if (/[<>\u0000-\u001f\u007f]/u.test(value)) {
        errors[field] = "Remove markup or unsupported characters.";
      }
    }
    if (/[/\\]|(?:^|\s)\.\.(?:\s|$)|^[A-Za-z]:|^\\\\|file:/i.test(collapse(values && values.project_name))) {
      errors.project_name = "Use a project name, not a path.";
    }
    const phone = collapse(values && values.phone);
    const digits = phone.replace(/\D/g, "");
    if (!phone) {
      errors.phone = "This field is required.";
    } else if (!/^\+?[0-9() .-]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
      errors.phone = "Enter a valid phone number.";
    }
    const email = collapse(values && values.email);
    if (!email) {
      errors.email = "This field is required.";
    } else if (email.length > 120 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
      errors.email = "Enter a valid email address.";
    }
    return errors;
  }

  function createModel(initial) {
    const state = Object.assign({
      step: "type",
      profile: "real-estate",
      details: {
        project_name: "",
        agency_name: "",
        city: "",
        phone: "",
        email: ""
      },
      errors: {},
      submitting: false,
      status: null
    }, initial || {});
    return {
      state,
      selectType() {
        state.step = "details";
        return state;
      },
      review(details) {
        const errors = validateDetails(details);
        state.details = Object.fromEntries(Object.entries(details).map(([key, value]) => [key, collapse(value)]));
        state.errors = errors;
        if (!Object.keys(errors).length) {
          state.step = "review";
        }
        return state;
      },
      edit() {
        state.step = "details";
        return state;
      },
      progress(status) {
        state.step = "progress";
        state.status = status || state.status;
        return state;
      }
    };
  }

  function technicalDetailsAreSanitized(details) {
    const serialized = JSON.stringify(details || []);
    return !/[A-Za-z]:[\\/]|(?:password|secret|authorization|bearer|operation_id|runtime_path|command)/i.test(serialized);
  }

  function bootstrap(windowObject) {
    const window = windowObject;
    const document = window.document;
    const entry = document.getElementById("create-website-button");
    const flow = document.getElementById("create-website-flow");
    const content = document.getElementById("create-website-content");
    const title = document.getElementById("create-website-title");
    const close = document.getElementById("create-website-close");
    const steps = document.getElementById("create-website-steps");
    if (!entry || !flow || !content || !title || !close || !steps) {
      return;
    }

    const config = window.FactoryLauncherConfig || {};
    const model = createModel();
    let csrfToken = "";
    let pollTimer = null;

    function requestKey() {
      let key = window.sessionStorage.getItem(STORAGE_KEY);
      if (!key) {
        const suffix = window.crypto && window.crypto.randomUUID
          ? window.crypto.randomUUID()
          : Date.now().toString(36) + Math.random().toString(36).slice(2);
        key = "create-website:" + suffix;
        window.sessionStorage.setItem(STORAGE_KEY, key);
      }
      return key;
    }

    async function mutationFetch(url, options, refresh) {
      if (!csrfToken || refresh) {
        const session = await fetch(config.sessionPath || "/api/security/session", { cache: "no-store" });
        const sessionPayload = await session.json();
        if (!session.ok || !sessionPayload.csrf_token) {
          throw new Error("Launcher security session is unavailable.");
        }
        csrfToken = sessionPayload.csrf_token;
      }
      const requestOptions = Object.assign({}, options || {});
      requestOptions.headers = new Headers(requestOptions.headers || {});
      requestOptions.headers.set("X-Factory-CSRF-Token", csrfToken);
      const response = await fetch(url, requestOptions);
      if (response.status === 403 && !refresh) {
        const payload = await response.clone().json().catch(() => ({}));
        if (payload.code === "csrf_token_required" || payload.code === "csrf_token_invalid") {
          return mutationFetch(url, options, true);
        }
      }
      return response;
    }

    function updateSteps() {
      const current = STEP_ORDER.indexOf(model.state.step);
      for (const item of steps.querySelectorAll("li")) {
        const index = STEP_ORDER.indexOf(item.getAttribute("data-step"));
        item.dataset.state = index < current ? "complete" : index === current ? "active" : "pending";
      }
    }

    function field(name, label, type, autocomplete) {
      const value = model.state.details[name] || "";
      const error = model.state.errors[name] || "";
      return [
        "<label class=\"create-field\"><span>" + escapeHtml(label) + "</span>",
        "<input name=\"" + escapeHtml(name) + "\" type=\"" + escapeHtml(type || "text") + "\" value=\"" + escapeHtml(value) + "\" autocomplete=\"" + escapeHtml(autocomplete || "off") + "\" aria-invalid=\"" + String(Boolean(error)) + "\"" + (error ? " aria-describedby=\"error-" + escapeHtml(name) + "\"" : "") + ">",
        error ? "<small class=\"field-error\" id=\"error-" + escapeHtml(name) + "\">" + escapeHtml(error) + "</small>" : "",
        "</label>"
      ].join("");
    }

    function renderType() {
      title.textContent = "Choose website type";
      content.innerHTML = [
        "<div class=\"website-type-grid\">",
        "<article class=\"website-type-card\"><p class=\"section-kicker\">Available</p><h3>Real Estate</h3><p>A complete presentation website for a real estate agency.</p>",
        "<ul><li>Homepage</li><li>Property catalogue and filters</li><li>Property pages</li><li>Contact page</li></ul>",
        "<button type=\"button\" class=\"button\" data-create-action=\"select-type\">Continue</button></article>",
        "</div>"
      ].join("");
    }

    function renderDetails() {
      title.textContent = "Business Details";
      content.innerHTML = [
        "<form id=\"create-website-details-form\" class=\"create-details-form\" novalidate>",
        field("project_name", "Project name", "text", "organization-title"),
        field("agency_name", "Agency name", "text", "organization"),
        field("city", "City", "text", "address-level2"),
        field("phone", "Phone", "tel", "tel"),
        field("email", "Email", "email", "email"),
        "<div class=\"read-only-values\"><span>Design <strong>Real Estate presentation</strong></span><span>Language <strong>English</strong></span></div>",
        "<div class=\"create-actions\"><button type=\"button\" class=\"button button-secondary\" data-create-action=\"back-type\">Back</button><button type=\"submit\" class=\"button\">Review</button></div>",
        "</form>"
      ].join("");
    }

    function summaryRow(label, value) {
      return "<div><dt>" + escapeHtml(label) + "</dt><dd>" + escapeHtml(value) + "</dd></div>";
    }

    function renderReview() {
      const details = model.state.details;
      title.textContent = "Review";
      content.innerHTML = [
        "<div class=\"create-review-grid\"><section><h3>Business</h3><dl>",
        summaryRow("Agency", details.agency_name), summaryRow("City", details.city), summaryRow("Phone", details.phone), summaryRow("Email", details.email),
        "</dl></section><section><h3>Website</h3><ul><li>Homepage</li><li>Properties Archive</li><li>Property Single pages</li><li>Contact</li><li>30 demonstration properties</li><li>Property filters</li><li>Responsive presentation</li><li>Existing safety and validation workflow</li></ul></section></div>",
        "<div class=\"create-actions\"><button type=\"button\" class=\"button button-secondary\" data-create-action=\"edit\">Edit Details</button><button type=\"button\" class=\"button\" data-create-action=\"create\"" + (model.state.submitting ? " disabled" : "") + ">" + (model.state.submitting ? "Starting…" : "Create Website") + "</button></div>"
      ].join("");
    }

    function renderProgress(payload) {
      title.textContent = payload && payload.status === "ready" ? "Website Ready" : payload && payload.status === "failed" ? "Setup failed" : "Creating your website";
      const progress = Array.isArray(payload && payload.progress) ? payload.progress : [];
      content.innerHTML = [
        "<ol class=\"create-progress-list\">",
        progress.map((stage) => "<li data-state=\"" + escapeHtml(stage.status) + "\"><span class=\"progress-marker\" aria-hidden=\"true\"></span><strong>" + escapeHtml(stage.label) + "</strong><small>" + escapeHtml(stage.status) + "</small></li>").join(""),
        "</ol>",
        "<details class=\"create-technical-details\"><summary>Technical details</summary><dl>",
        (payload && technicalDetailsAreSanitized(payload.technical_details) ? payload.technical_details : []).map((item) => summaryRow(item.stage, item.status)).join(""),
        "</dl></details>"
      ].join("");
    }

    function renderReady(payload) {
      const result = payload.result || {};
      title.textContent = "Your website is ready";
      content.innerHTML = [
        "<div class=\"website-ready\"><p class=\"ready-mark\" aria-hidden=\"true\">✓</p><h3>" + escapeHtml(payload.project && payload.project.name || "Website") + "</h3><p>Creation and validation finished successfully.</p>",
        "<dl>", summaryRow("Website", payload.project && payload.project.website_url || "Ready"), summaryRow("Pages created", String(result.pages_created || 0)), summaryRow("Properties created", String(result.properties_created || 0)), summaryRow("Validation", result.validation_passed ? "Passed" : "Not passed"), "</dl>",
        "<div class=\"create-actions\"><a class=\"button\" href=\"" + escapeHtml(payload.project && payload.project.website_url || "#") + "\" target=\"_blank\" rel=\"noreferrer\">Open Website</a><button type=\"button\" class=\"button button-secondary\" data-create-action=\"view-project\">View Project</button></div></div>"
      ].join("");
    }

    function renderFailure(payload) {
      const failure = payload.failure || {};
      title.textContent = "We couldn’t finish creating the website.";
      content.innerHTML = [
        "<div class=\"create-failure\"><h3>Setup failed</h3><p>" + escapeHtml(failure.message || "The operation did not report success.") + "</p>",
        "<p>The website was not marked ready.</p>",
        "<details class=\"create-technical-details\"><summary>Technical details</summary><dl>",
        (technicalDetailsAreSanitized(payload.technical_details) ? payload.technical_details : []).map((item) => summaryRow(item.stage, item.status)).join(""),
        "</dl></details><div class=\"create-actions\"><button type=\"button\" class=\"button button-secondary\" data-create-action=\"return-projects\">Return to Projects</button></div></div>"
      ].join("");
    }

    function render() {
      updateSteps();
      if (model.state.step === "type") renderType();
      if (model.state.step === "details") renderDetails();
      if (model.state.step === "review") renderReview();
      if (model.state.step === "progress") {
        if (model.state.status && model.state.status.status === "ready") renderReady(model.state.status);
        else if (model.state.status && model.state.status.status === "failed") renderFailure(model.state.status);
        else renderProgress(model.state.status || { progress: [] });
      }
    }

    function openFlow() {
      flow.hidden = false;
      render();
      flow.scrollIntoView({ behavior: "smooth", block: "start" });
      const first = content.querySelector("button, input");
      if (first) first.focus({ preventScroll: true });
    }

    function stopPolling() {
      if (pollTimer) window.clearTimeout(pollTimer);
      pollTimer = null;
    }

    async function poll(slug) {
      stopPolling();
      try {
        const response = await fetch("/api/create-websites/" + encodeURIComponent(slug), { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Website progress is unavailable.");
        model.progress(payload);
        render();
        if (payload.status === "running") {
          pollTimer = window.setTimeout(() => poll(slug), 1500);
        }
      } catch (error) {
        pollTimer = window.setTimeout(() => poll(slug), 2500);
      }
    }

    async function submitCreate() {
      if (model.state.submitting) return;
      model.state.submitting = true;
      render();
      const request = Object.assign({ profile: "real-estate" }, model.state.details);
      try {
        const response = await mutationFetch("/api/create-websites", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey() },
          body: JSON.stringify(request)
        });
        const payload = await response.json();
        if (!response.ok) {
          model.state.errors = payload.field_errors || {};
          if (Object.keys(model.state.errors).length) {
            model.state.step = "details";
            render();
            return;
          }
          throw new Error(payload.error || "Website creation could not start.");
        }
        window.sessionStorage.setItem(STORAGE_SLUG, payload.project.slug);
        model.progress(payload);
        render();
        if (payload.status === "running") poll(payload.project.slug);
      } catch (error) {
        model.progress({
          status: "failed",
          failure: { message: collapse(error.message) || "The operation did not report success." },
          technical_details: []
        });
        render();
      } finally {
        model.state.submitting = false;
      }
    }

    entry.addEventListener("click", openFlow);
    close.addEventListener("click", () => {
      if (model.state.status && model.state.status.status === "running") {
        flow.hidden = true;
        return;
      }
      stopPolling();
      flow.hidden = true;
    });
    content.addEventListener("click", (event) => {
      const button = event.target.closest("[data-create-action]");
      if (!button) return;
      const action = button.getAttribute("data-create-action");
      if (action === "select-type") model.selectType();
      if (action === "back-type") model.state.step = "type";
      if (action === "edit") model.edit();
      if (action === "create") submitCreate();
      if (action === "return-projects") {
        window.sessionStorage.removeItem(STORAGE_SLUG);
        window.sessionStorage.removeItem(STORAGE_KEY);
        flow.hidden = true;
        document.getElementById("projects").scrollIntoView({ behavior: "smooth" });
      }
      if (action === "view-project") {
        window.sessionStorage.removeItem(STORAGE_SLUG);
        window.sessionStorage.removeItem(STORAGE_KEY);
        window.location.assign("/#workspace");
      }
      render();
    });
    content.addEventListener("submit", (event) => {
      if (event.target.id !== "create-website-details-form") return;
      event.preventDefault();
      const values = Object.fromEntries(new window.FormData(event.target).entries());
      model.review(values);
      render();
      const invalid = content.querySelector("[aria-invalid=\"true\"]");
      if (invalid) invalid.focus();
    });

    const activeSlug = window.sessionStorage.getItem(STORAGE_SLUG);
    if (activeSlug) {
      model.progress({ status: "running", progress: [] });
      openFlow();
      poll(activeSlug);
    }
  }

  return {
    STEP_ORDER,
    bootstrap,
    createModel,
    technicalDetailsAreSanitized,
    validateDetails
  };
});
