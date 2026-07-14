"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeCount,
  resolveProjectSummaryCounts
} = require("../src/ui/project-summary-counts");

function createProject(slug, overrides) {
  return Object.assign({
    slug,
    generated_site: {
      present: false,
      urls: {}
    }
  }, overrides || {});
}

function createGenerationView(overrides) {
  return Object.assign({
    slug: "",
    loading: false,
    statusPayload: null,
    sitePayload: null
  }, overrides || {});
}

test("canonical generation payload maps counts to the selected project summary", () => {
  const result = resolveProjectSummaryCounts({
    project: createProject("pm-demo-kyiv-2"),
    selectedSlug: "pm-demo-kyiv-2",
    generationView: createGenerationView({
      slug: "pm-demo-kyiv-2",
      statusPayload: {
        project: { slug: "pm-demo-kyiv-2" },
        site: {
          counts_summary: {
            after: {
              pages: 6,
              properties: 30,
              attachments: 22
            }
          }
        }
      }
    })
  });

  assert.equal(result.status, "available");
  assert.equal(result.source, "generation_status");
  assert.equal(result.pages, 6);
  assert.equal(result.properties, 30);
  assert.equal(result.attachments, 22);
});

test("zero counts remain numeric zero instead of unavailable", () => {
  assert.equal(normalizeCount(0), 0);
  assert.equal(normalizeCount("0"), 0);

  const result = resolveProjectSummaryCounts({
    project: createProject("empty-demo"),
    selectedSlug: "empty-demo",
    generationView: createGenerationView({
      slug: "empty-demo",
      statusPayload: {
        project: { slug: "empty-demo" },
        site: {
          counts_summary: {
            after: {
              pages: 0,
              properties: 0,
              attachments: 0
            }
          }
        }
      }
    })
  });

  assert.equal(result.pages, 0);
  assert.equal(result.properties, 0);
  assert.equal(result.attachments, 0);
});

test("pending selected-project load does not reuse stale previous-project values", () => {
  const result = resolveProjectSummaryCounts({
    project: createProject("blocked-project"),
    selectedSlug: "blocked-project",
    generationView: createGenerationView({
      slug: "blocked-project",
      loading: true,
      statusPayload: {
        project: { slug: "pm-demo-kyiv-2" },
        site: {
          counts_summary: {
            after: {
              pages: 6,
              properties: 30,
              attachments: 22
            }
          }
        }
      }
    })
  });

  assert.equal(result.status, "loading");
  assert.equal(result.pages, null);
  assert.equal(result.properties, null);
  assert.equal(result.attachments, null);
});

test("missing canonical data returns unavailable when nothing truthful exists", () => {
  const result = resolveProjectSummaryCounts({
    project: createProject("no-proof-project"),
    selectedSlug: "no-proof-project",
    generationView: createGenerationView({
      slug: "no-proof-project",
      loading: false
    })
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.pages, null);
  assert.equal(result.properties, null);
  assert.equal(result.attachments, null);
});

test("initial selected-project hydration prefers loading over unavailable", () => {
  const result = resolveProjectSummaryCounts({
    project: createProject("pm-demo-kyiv-2"),
    selectedSlug: "pm-demo-kyiv-2",
    pendingSelectionHydration: true,
    generationView: createGenerationView({
      slug: "",
      loading: false
    })
  });

  assert.equal(result.status, "loading");
  assert.equal(result.source, "pending_project_hydration");
  assert.equal(result.pages, null);
  assert.equal(result.properties, null);
  assert.equal(result.attachments, null);
});

test("project A payload cannot populate project B", () => {
  const result = resolveProjectSummaryCounts({
    project: createProject("project-b"),
    selectedSlug: "project-b",
    generationView: createGenerationView({
      slug: "project-b",
      statusPayload: {
        project: { slug: "project-a" },
        site: {
          counts_summary: {
            after: {
              pages: 6,
              properties: 30,
              attachments: 22
            }
          }
        }
      }
    })
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.pages, null);
  assert.equal(result.properties, null);
  assert.equal(result.attachments, null);
});

test("persisted site payload reconstructs counts after restart for the selected project", () => {
  const result = resolveProjectSummaryCounts({
    project: createProject("pm-demo-kyiv-2"),
    selectedSlug: "pm-demo-kyiv-2",
    generationView: createGenerationView({
      slug: "pm-demo-kyiv-2",
      sitePayload: {
        project: { slug: "pm-demo-kyiv-2" },
        site: {
          counts_summary: {
            after: {
              pages: 6,
              properties: 30,
              attachments: 22
            }
          }
        }
      }
    })
  });

  assert.equal(result.status, "available");
  assert.equal(result.source, "site_status");
  assert.equal(result.pages, 6);
  assert.equal(result.properties, 30);
  assert.equal(result.attachments, 22);
});

test("blocked project does not inherit generated-project counts from another selection", () => {
  const result = resolveProjectSummaryCounts({
    project: createProject("rc-setup-ui-lock-smoke-1"),
    selectedSlug: "rc-setup-ui-lock-smoke-1",
    generationView: createGenerationView({
      slug: "rc-setup-ui-lock-smoke-1",
      statusPayload: {
        project: { slug: "pm-demo-kyiv-2" },
        site: {
          counts_summary: {
            after: {
              pages: 6,
              properties: 30,
              attachments: 22
            }
          }
        }
      }
    })
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.pages, null);
  assert.equal(result.properties, null);
  assert.equal(result.attachments, null);
});
