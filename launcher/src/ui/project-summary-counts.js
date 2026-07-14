"use strict";

(function initProjectSummaryCounts(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.FactoryProjectSummaryCounts = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createProjectSummaryCounts() {
  function normalizeCount(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeCounts(source) {
    if (!source || typeof source !== "object") {
      return null;
    }
    const counts = {
      pages: normalizeCount(source.pages),
      properties: normalizeCount(source.properties),
      attachments: normalizeCount(source.attachments)
    };
    return counts.pages === null && counts.properties === null && counts.attachments === null
      ? null
      : counts;
  }

  function extractCounts(container) {
    if (!container || typeof container !== "object") {
      return null;
    }
    return normalizeCounts(
      container.counts_summary
      && container.counts_summary.after
      && typeof container.counts_summary.after === "object"
        ? container.counts_summary.after
        : container.counts
    );
  }

  function extractPayloadCounts(payload, slug) {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const payloadSlug = String(payload.project && payload.project.slug || "").trim();
    if (!payloadSlug || payloadSlug !== String(slug || "").trim()) {
      return null;
    }
    return extractCounts(payload.site || payload.generated_site || payload);
  }

  function extractProjectCounts(project) {
    if (!project || typeof project !== "object") {
      return null;
    }
    return extractCounts(project.generated_site || project.site || project);
  }

  function resolveProjectSummaryCounts(options) {
    const project = options && options.project && typeof options.project === "object"
      ? options.project
      : null;
    const selectedSlug = String(options && options.selectedSlug || "").trim();
    const generationView = options && options.generationView && typeof options.generationView === "object"
      ? options.generationView
      : {};
    const pendingSelectionHydration = Boolean(options && options.pendingSelectionHydration);
    const projectSlug = String(project && project.slug || "").trim();
    const isSelected = Boolean(projectSlug) && projectSlug === selectedSlug;

    if (isSelected) {
      const statusCounts = extractPayloadCounts(generationView.statusPayload, projectSlug);
      if (statusCounts) {
        return Object.assign({ status: "available", source: "generation_status" }, statusCounts);
      }

      const siteCounts = extractPayloadCounts(generationView.sitePayload, projectSlug);
      if (siteCounts) {
        return Object.assign({ status: "available", source: "site_status" }, siteCounts);
      }

      if (generationView.loading === true && String(generationView.slug || "").trim() === projectSlug) {
        return {
          status: "loading",
          source: "pending_generation_status",
          pages: null,
          properties: null,
          attachments: null
        };
      }

      if (pendingSelectionHydration) {
        return {
          status: "loading",
          source: "pending_project_hydration",
          pages: null,
          properties: null,
          attachments: null
        };
      }
    }

    const projectCounts = extractProjectCounts(project);
    if (projectCounts) {
      return Object.assign({ status: "available", source: "project_summary" }, projectCounts);
    }

    return {
      status: "unavailable",
      source: "missing",
      pages: null,
      properties: null,
      attachments: null
    };
  }

  return {
    normalizeCount,
    normalizeCounts,
    resolveProjectSummaryCounts
  };
});
