"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assertOperationBelongsToProject,
  assertPlanBelongsToProject,
  buildWritableDesiredState,
  collectUnsupportedFields,
  normalizeOperationId,
  normalizeStatePlanId,
  rejectBrowserSuppliedStatePaths,
  summarizeStatePlanForClient,
  validateChangeRequestPrompt
} = require("../src/state-change-contract");
const {
  createProjectScaffold,
  readProjectBySlug
} = require("../src/project-store");
const {
  readStateStatus
} = require("../src/state");
const {
  listOperations
} = require("../src/project-operation-store");

let portCounter = 25100;

function createTempProjectsRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-state-change-"));
}

function createTempProject(projectsRoot, slug) {
  return createProjectScaffold({
    name: slug,
    slug,
    port: portCounter += 1,
    projectsRoot
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function writeStatePlan(runtimePath, plan) {
  const filePath = path.join(runtimePath, "state", "plans", String(plan.plan_id || "state-plan-test") + ".json");
  writeJson(filePath, plan);
  return filePath;
}

function writeStateApplyRecord(runtimePath, applyId, payload) {
  const safeApplyId = String(applyId || "state-apply-test");
  const filePath = path.join(runtimePath, "state", "applies", safeApplyId + ".json");
  writeJson(filePath, Object.assign({
    schema: "factory_state_apply",
    version: 1,
    apply_id: safeApplyId,
    status: "ok",
    applies_changes: true
  }, payload || {}));
  return filePath;
}

function buildProtectedPlan(slug, planId, options) {
  const proposedTitle = options && options.proposedTitle ? options.proposedTitle : "AI Proposed Protected Hero Title";
  const includedFields = options && Array.isArray(options.includedFields)
    ? options.includedFields
    : ["agency_name", "hero_title"];
  const requiresConfirmation = options && Array.isArray(options.requiresConfirmation)
    ? options.requiresConfirmation
    : ["hero_title"];
  const preservedProtectedFields = options && Array.isArray(options.preservedProtectedFields)
    ? options.preservedProtectedFields
    : [];

  return {
    schema: "factory_state_plan",
    version: 1,
    plan_id: planId,
    project_slug: slug,
    provider_called: false,
    source: {
      prompt_personalization_source: "local_interpreter",
      prompt_hash: "prompt-hash-" + planId
    },
    current: {
      slug,
      protected_fields: ["hero_title"],
      effective_values: {
        agency_name: "Owner Realty",
        hero_title: "Owner Protected Hero Title",
        hero_subtitle: "Owner subtitle",
        hero_cta_text: "Browse Owner Listings"
      }
    },
    proposed: {
      personalization: {
        agency_name: "Riverside Family Homes",
        hero_title: proposedTitle,
        hero_subtitle: "Family-friendly apartments near parks and schools.",
        hero_cta_text: "Browse Family Apartments"
      },
      design_profile: {}
    },
    diff: {
      field_changes: [
        {
          field_key: "agency_name",
          change_type: "update",
          effective_value: "Riverside Family Homes",
          included_in_apply: includedFields.includes("agency_name"),
          protected: false
        },
        {
          field_key: "hero_title",
          change_type: requiresConfirmation.length ? "overwrite_protected_requested" : "preserve_protected",
          effective_value: proposedTitle,
          included_in_apply: includedFields.includes("hero_title"),
          protected: true,
          overwrite_policy: "requires_explicit_confirmation"
        }
      ]
    },
    field_scope: {
      mode: "preserve_protected_by_default",
      included_fields: includedFields,
      excluded_fields: [],
      preserved_protected_fields: preservedProtectedFields,
      requires_confirmation_fields: requiresConfirmation
    },
    conflicts: [],
    warnings: [],
    can_apply_without_confirmation: requiresConfirmation.length === 0,
    confirmation_required: requiresConfirmation.length
      ? {
        required: true,
        fields: requiresConfirmation,
        reason: "protected_user_override_overwrite_requested",
        message: "Protected field hero_title will be overwritten only if explicitly confirmed."
      }
      : null
  };
}

async function requestJson(baseUrl, requestPath, options) {
  const requestOptions = Object.assign({}, options || {});
  const method = String(requestOptions.method || "GET").toUpperCase();
  const headers = Object.assign({
    "Content-Type": "application/json"
  }, requestOptions.headers || {});

  if (method !== "GET" && method !== "HEAD" && requestOptions.includeMutationToken !== false) {
    const sessionResponse = await fetch(baseUrl + "/api/security/session");
    const sessionPayload = await sessionResponse.json();
    const csrfToken = sessionPayload.csrf_token;
    assert.ok(csrfToken, "expected Launcher CSRF token for POST route tests");
    headers["X-Factory-CSRF-Token"] = csrfToken;
    headers.Origin = baseUrl;
  }

  delete requestOptions.includeMutationToken;
  requestOptions.headers = headers;

  const response = await fetch(baseUrl + requestPath, requestOptions);
  const body = await response.json();
  return { response, body };
}

async function withPatchedServer(stubs, callback) {
  const stateModulePath = require.resolve("../src/state");
  const serverModulePath = require.resolve("../src/server");
  const stateModule = require(stateModulePath);
  const originalState = {};

  for (const [key, value] of Object.entries(stubs || {})) {
    originalState[key] = stateModule[key];
    stateModule[key] = value;
  }

  delete require.cache[serverModulePath];
  const { createLauncherServer } = require(serverModulePath);
  const port = portCounter += 1;
  const server = createLauncherServer({
    host: "127.0.0.1",
    port,
    projectsRoot: callback.projectsRoot
  });

  try {
    await server.listen();
    return await callback({
      baseUrl: "http://127.0.0.1:" + port,
      createLauncherServer
    });
  } finally {
    await server.close().catch(() => {});
    for (const [key, value] of Object.entries(originalState)) {
      stateModule[key] = value;
    }
    delete require.cache[serverModulePath];
  }
}

test("validates state change prompt as a bounded string", () => {
  assert.equal(validateChangeRequestPrompt("  Update hero text safely.  "), "Update hero text safely.");
  assert.throws(() => validateChangeRequestPrompt("short"), /at least 10/);
  assert.throws(() => validateChangeRequestPrompt({ prompt: "bad" }), /string prompt/);
  assert.throws(() => validateChangeRequestPrompt("x".repeat(2001)), /2000 characters/);
});

test("normalizes server-issued plan and operation identifiers", () => {
  assert.equal(normalizeStatePlanId("state-plan-2026-07-11T01-02-03-000Z-abc123"), "state-plan-2026-07-11T01-02-03-000Z-abc123");
  assert.equal(normalizeOperationId("op-2026-07-11T01-02-03-000Z-abc123"), "op-2026-07-11T01-02-03-000Z-abc123");
  assert.throws(() => normalizeStatePlanId("../state-plan-x"), /valid state plan_id/);
  assert.throws(() => normalizeOperationId("state-apply-raw"), /valid operation id/);
});

test("rejects browser-submitted paths, field maps, and executable payloads", () => {
  assert.doesNotThrow(() => rejectBrowserSuppliedStatePaths({
    plan_id: "state-plan-2026-07-11T01-02-03-000Z-abc123",
    confirm_apply: true
  }));
  assert.throws(() => rejectBrowserSuppliedStatePaths({
    plan_id: "state-plan-2026-07-11T01-02-03-000Z-abc123",
    proof_path: "C:\\sf-factory-projects\\x\\proofs\\state-apply.json"
  }), (error) => error.code === "state_change_browser_payload_rejected" && error.rejected_fields.includes("proof_path"));
  assert.throws(() => rejectBrowserSuppliedStatePaths({
    fields: { hero_title: "client supplied" },
    shell: "echo unsafe"
  }), (error) => error.rejected_fields.includes("fields") && error.rejected_fields.includes("shell"));
});

test("enforces project ownership for plans and operations", () => {
  assert.doesNotThrow(() => assertPlanBelongsToProject({
    project_slug: "rc-opcoord-smoke-1"
  }, "rc-opcoord-smoke-1"));
  assert.throws(() => assertPlanBelongsToProject({
    project_slug: "alpha-e2e-smoke-1"
  }, "rc-opcoord-smoke-1"), (error) => error.code === "state_plan_project_mismatch");

  assert.doesNotThrow(() => assertOperationBelongsToProject({
    project_slug: "rc-opcoord-smoke-1"
  }, "rc-opcoord-smoke-1"));
  assert.throws(() => assertOperationBelongsToProject({
    project_slug: "alpha-e2e-smoke-1"
  }, "rc-opcoord-smoke-1"), (error) => error.code === "operation_project_mismatch");
});

test("summarizes writable desired state and unsupported fields without trusting browser field maps", () => {
  const summary = summarizeStatePlanForClient({
    proofPath: "C:\\proofs\\state-plan.json",
    plan: {
      schema: "factory_state_plan",
      version: 1,
      plan_id: "state-plan-2026-07-11T01-02-03-000Z-abc123",
      provider_called: false,
      source: {
        prompt_personalization_source: "local_interpreter"
      },
      current: {
        protected_fields: ["hero_title"]
      },
      proposed: {
        personalization: {
          hero_subtitle: "Family apartments near parks.",
          hero_cta_destination: "properties"
        }
      },
      diff: {
        field_changes: [
          {
            field_key: "hero_cta_destination",
            excluded_reason: "unsupported_field"
          }
        ]
      },
      field_scope: {
        included_fields: ["hero_subtitle"],
        excluded_fields: ["hero_title", "hero_cta_destination"],
        preserved_protected_fields: ["hero_title"],
        requires_confirmation_fields: []
      },
      conflicts: [],
      can_apply_without_confirmation: true,
      warnings: []
    }
  });

  assert.equal(summary.plan_id, "state-plan-2026-07-11T01-02-03-000Z-abc123");
  assert.deepEqual(summary.included_fields, ["hero_subtitle"]);
  assert.deepEqual(summary.writable_desired_state, {
    hero_subtitle: "Family apartments near parks."
  });
  assert.deepEqual(summary.unsupported_fields, ["hero_cta_destination"]);
  assert.equal(Object.prototype.hasOwnProperty.call(summary.writable_desired_state, "hero_cta_destination"), false);
  assert.deepEqual(buildWritableDesiredState({
    proposed: { personalization: { hero_title: "A", hero_cta_destination: "properties" } },
    field_scope: { included_fields: ["hero_title"] }
  }), { hero_title: "A" });
  assert.deepEqual(collectUnsupportedFields({
    diff: {
      field_changes: [
        { field_key: "hero_cta_destination", excluded_reason: "unsupported_field" },
        { field_key: "city", excluded_reason: "empty_or_unsupported_value" }
      ]
    }
  }), ["hero_cta_destination", "city"]);
});

test("state apply route rejects protected overwrite without explicit confirmation", async () => {
  const projectsRoot = createTempProjectsRoot();
  const scaffold = createTempProject(projectsRoot, "protected-no-confirm");
  const runtimePath = scaffold.project.runtime_path;
  const planId = "state-plan-2026-07-12T07-00-00-000Z-protected1";
  writeStatePlan(runtimePath, buildProtectedPlan("protected-no-confirm", planId));

  await withPatchedServer({
    applyStatePlan: async () => {
      throw new Error("applyStatePlan should not run without confirmation");
    }
  }, Object.assign(async ({ baseUrl }) => {
    const { response, body } = await requestJson(baseUrl, "/api/projects/protected-no-confirm/state/apply", {
      method: "POST",
      body: JSON.stringify({
        plan_id: planId,
        confirm_apply: true
      })
    });

    assert.equal(response.status, 409);
    assert.equal(body.code, "state_apply_protected_overwrite_confirmation_required");
    assert.deepEqual(body.required_fields, ["hero_title"]);
    assert.equal(listOperations({ slug: "protected-no-confirm", projectsRoot }).length, 0);
  }, { projectsRoot }));
});

test("state apply route requires explicit confirmation and replays the same idempotency key once", async () => {
  const projectsRoot = createTempProjectsRoot();
  const scaffold = createTempProject(projectsRoot, "protected-confirm");
  const runtimePath = scaffold.project.runtime_path;
  const planId = "state-plan-2026-07-12T07-00-00-000Z-protected2";
  const applyId = "state-apply-2026-07-12T07-00-00-000Z-apply01";
  let applyExecutions = 0;
  writeStatePlan(runtimePath, buildProtectedPlan("protected-confirm", planId));

  await withPatchedServer({
    applyStatePlan: async (options) => {
      applyExecutions += 1;
      writeStateApplyRecord(runtimePath, applyId, {
        plan_id: planId,
        project_slug: options.slug
      });
      return {
        project: readProjectBySlug(options.slug, projectsRoot).project,
        status: "ok",
        code: "state_plan_applied",
        proofPath: path.join(runtimePath, "proofs", "state-apply-test.json"),
        statePath: path.join(runtimePath, "state", "current.json"),
        apply: {
          apply_id: applyId,
          plan_id: planId,
          apply_method: "field_only_safe_apply",
          applied_fields: ["agency_name", "hero_title"],
          ignored_fields: [],
          warnings: [],
          confirmation: {
            required: true,
            confirmed: true,
            overwritten_protected_fields: ["hero_title"]
          }
        }
      };
    }
  }, Object.assign(async ({ baseUrl }) => {
    const sameKey = "apply-replay-key-0001";
    const requestBody = {
      plan_id: planId,
      confirm_apply: true,
      confirm_protected_overwrite: true
    };
    const first = await requestJson(baseUrl, "/api/projects/protected-confirm/state/apply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": sameKey
      },
      body: JSON.stringify(requestBody)
    });
    assert.equal(first.response.status, 200);
    assert.equal(first.body.code, "state_plan_applied");
    assert.equal(first.body.idempotent_replay, false);
    assert.equal(first.body.operation.safety.apply_used, true);
    assert.equal(first.body.operation.safety.rollback_used, false);

    const replay = await requestJson(baseUrl, "/api/projects/protected-confirm/state/apply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": sameKey
      },
      body: JSON.stringify(requestBody)
    });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.body.idempotent_replay, true);
    assert.equal(replay.body.operation.operation_id, first.body.operation.operation_id);
    assert.equal(Object.prototype.hasOwnProperty.call(replay.body.operation, "raw"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(replay.body.operation, "_filePath"), false);
    assert.equal(applyExecutions, 1);

    const secondPlanId = "state-plan-2026-07-12T07-00-00-000Z-protected3";
    writeStatePlan(runtimePath, buildProtectedPlan("protected-confirm", secondPlanId));

    const conflict = await requestJson(baseUrl, "/api/projects/protected-confirm/state/apply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": sameKey
      },
      body: JSON.stringify({
        plan_id: secondPlanId,
        confirm_apply: true,
        confirm_protected_overwrite: true
      })
    });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.body.code, "idempotency_key_conflict");
  }, { projectsRoot }));
});

test("state apply route serializes coordinator conflicts and creates only one successful apply", async () => {
  const projectsRoot = createTempProjectsRoot();
  const scaffold = createTempProject(projectsRoot, "apply-conflict");
  const runtimePath = scaffold.project.runtime_path;
  const planId = "state-plan-2026-07-12T07-00-00-000Z-conflict";
  let applyExecutions = 0;
  writeStatePlan(runtimePath, buildProtectedPlan("apply-conflict", planId, {
    requiresConfirmation: [],
    preservedProtectedFields: ["hero_title"],
    includedFields: ["agency_name"]
  }));

  await withPatchedServer({
    applyStatePlan: async (options) => {
      applyExecutions += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
      writeStateApplyRecord(runtimePath, "state-apply-conflict-1", {
        plan_id: planId,
        project_slug: options.slug
      });
      return {
        project: readProjectBySlug(options.slug, projectsRoot).project,
        status: "ok",
        code: "state_plan_applied",
        proofPath: path.join(runtimePath, "proofs", "state-apply-conflict.json"),
        statePath: path.join(runtimePath, "state", "current.json"),
        apply: {
          apply_id: "state-apply-conflict-1",
          plan_id: planId,
          apply_method: "field_only_safe_apply",
          applied_fields: ["agency_name"],
          ignored_fields: [],
          warnings: []
        }
      };
    }
  }, Object.assign(async ({ baseUrl }) => {
    const requestBody = {
      plan_id: planId,
      confirm_apply: true
    };
    const first = requestJson(baseUrl, "/api/projects/apply-conflict/state/apply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "apply-conflict-key-0001"
      },
      body: JSON.stringify(requestBody)
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const second = await requestJson(baseUrl, "/api/projects/apply-conflict/state/apply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "apply-conflict-key-0002"
      },
      body: JSON.stringify(requestBody)
    });

    const firstResult = await first;
    assert.equal(firstResult.response.status, 200);
    assert.equal(second.response.status, 409);
    assert.equal(second.body.code, "project_operation_in_progress");
    assert.equal(applyExecutions, 1);
    assert.equal(listOperations({ slug: "apply-conflict", projectsRoot })
      .filter((operation) => operation.operation_type === "state_apply" && operation.status === "succeeded").length, 1);
  }, { projectsRoot }));
});

test("state rollback route replays once and rejects an already rolled-back target with a new key", async () => {
  const projectsRoot = createTempProjectsRoot();
  const scaffold = createTempProject(projectsRoot, "rollback-replay");
  const runtimePath = scaffold.project.runtime_path;
  const planId = "state-plan-2026-07-12T07-00-00-000Z-rollback";
  const applyId = "state-apply-rollback-source-1";
  let applyExecutions = 0;
  let rollbackExecutions = 0;
  writeStatePlan(runtimePath, buildProtectedPlan("rollback-replay", planId, {
    requiresConfirmation: [],
    preservedProtectedFields: ["hero_title"],
    includedFields: ["agency_name"]
  }));

  await withPatchedServer({
    applyStatePlan: async (options) => {
      applyExecutions += 1;
      writeStateApplyRecord(runtimePath, applyId, {
        plan_id: planId,
        project_slug: options.slug
      });
      return {
        project: readProjectBySlug(options.slug, projectsRoot).project,
        status: "ok",
        code: "state_plan_applied",
        proofPath: path.join(runtimePath, "proofs", "state-apply-rollback-source.json"),
        statePath: path.join(runtimePath, "state", "current.json"),
        apply: {
          apply_id: applyId,
          plan_id: planId,
          apply_method: "field_only_safe_apply",
          applied_fields: ["agency_name"],
          ignored_fields: [],
          warnings: []
        }
      };
    },
    rollbackStateApply: async (options) => {
      rollbackExecutions += 1;
      return {
        project: readProjectBySlug(options.slug, projectsRoot).project,
        status: "ok",
        code: "state_rollback_applied",
        proofPath: path.join(runtimePath, "proofs", "state-rollback-test.json"),
        statePath: path.join(runtimePath, "state", "current.json"),
        rollback: {
          rollback_id: "state-rollback-test-1",
          source_apply_id: applyId,
          rollback_fields: {
            agency_name: "Owner Realty",
            hero_title: "Owner Protected Hero Title"
          },
          applied_fields: ["agency_name", "hero_title"],
          warnings: []
        }
      };
    }
  }, Object.assign(async ({ baseUrl }) => {
    const applyResponse = await requestJson(baseUrl, "/api/projects/rollback-replay/state/apply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "rollback-apply-key-0001"
      },
      body: JSON.stringify({
        plan_id: planId,
        confirm_apply: true
      })
    });
    assert.equal(applyResponse.response.status, 200);
    assert.equal(applyExecutions, 1);
    const applyOperationId = applyResponse.body.operation.operation_id;

    const rollbackKey = "rollback-replay-key-0001";
    const rollbackBody = {
      apply_operation_id: applyOperationId,
      confirm_rollback: true
    };
    const firstRollback = await requestJson(baseUrl, "/api/projects/rollback-replay/state/rollback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": rollbackKey
      },
      body: JSON.stringify(rollbackBody)
    });
    assert.equal(firstRollback.response.status, 200);
    assert.equal(firstRollback.body.idempotent_replay, false);
    assert.equal(firstRollback.body.operation.safety.apply_used, false);
    assert.equal(firstRollback.body.operation.safety.rollback_used, true);

    const replayRollback = await requestJson(baseUrl, "/api/projects/rollback-replay/state/rollback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": rollbackKey
      },
      body: JSON.stringify(rollbackBody)
    });
    assert.equal(replayRollback.response.status, 200);
    assert.equal(replayRollback.body.idempotent_replay, true);
    assert.equal(replayRollback.body.operation.operation_id, firstRollback.body.operation.operation_id);
    assert.equal(Object.prototype.hasOwnProperty.call(replayRollback.body.operation, "raw"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(replayRollback.body.operation, "_filePath"), false);
    assert.equal(rollbackExecutions, 1);

    const alreadyRolledBack = await requestJson(baseUrl, "/api/projects/rollback-replay/state/rollback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "rollback-replay-key-0002"
      },
      body: JSON.stringify(rollbackBody)
    });
    assert.equal(alreadyRolledBack.response.status, 409);
    assert.equal(alreadyRolledBack.body.code, "state_apply_already_rolled_back");

    const rollbackOperations = listOperations({ slug: "rollback-replay", projectsRoot })
      .filter((operation) => operation.operation_type === "state_rollback" && operation.status === "succeeded");
    assert.equal(rollbackOperations.length, 1);
  }, { projectsRoot }));
});

test("state apply route rejects browser-supplied field maps even when a valid stored plan exists", async () => {
  const projectsRoot = createTempProjectsRoot();
  const scaffold = createTempProject(projectsRoot, "browser-fields-rejected");
  const runtimePath = scaffold.project.runtime_path;
  const planId = "state-plan-2026-07-12T07-00-00-000Z-fields";
  writeStatePlan(runtimePath, buildProtectedPlan("browser-fields-rejected", planId, {
    requiresConfirmation: [],
    preservedProtectedFields: ["hero_title"],
    includedFields: ["agency_name"]
  }));

  await withPatchedServer({
    applyStatePlan: async () => {
      throw new Error("applyStatePlan should not run when browser fields are supplied");
    }
  }, Object.assign(async ({ baseUrl }) => {
    const { response, body } = await requestJson(baseUrl, "/api/projects/browser-fields-rejected/state/apply", {
      method: "POST",
      body: JSON.stringify({
        plan_id: planId,
        confirm_apply: true,
        fields: {
          hero_title: "Client override"
        }
      })
    });
    assert.equal(response.status, 400);
    assert.equal(body.code, "state_change_browser_payload_rejected");
    assert.deepEqual(body.rejected_fields, ["fields"]);
  }, { projectsRoot }));
});

test("state plan route reports unsupported hero_cta_destination without treating it as writable desired state", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "unsupported-destination");
  const planId = "state-plan-2026-07-12T07-00-00-000Z-unsupported";

  await withPatchedServer({
    planState: async (options) => {
      return {
        project: readProjectBySlug(options.slug, projectsRoot).project,
        planPath: path.join(projectsRoot, options.slug, "state", "plans", planId + ".json"),
        proofPath: path.join(projectsRoot, options.slug, "proofs", "state-plan-test.json"),
        plan: {
          schema: "factory_state_plan",
          version: 1,
          plan_id: planId,
          project_slug: options.slug,
          provider_called: false,
          source: {
            prompt_personalization_source: "local_interpreter"
          },
          current: {
            slug: options.slug,
            protected_fields: ["hero_title"],
            effective_values: {
              hero_title: "Owner Protected Hero Title"
            }
          },
          proposed: {
            personalization: {
              hero_cta_text: "Browse Family Apartments",
              hero_cta_destination: "properties"
            },
            design_profile: {}
          },
          diff: {
            field_changes: [
              {
                field_key: "hero_cta_text",
                change_type: "update",
                effective_value: "Browse Family Apartments",
                included_in_apply: true,
                protected: false
              },
              {
                field_key: "hero_cta_destination",
                change_type: "preserve",
                effective_value: "properties",
                included_in_apply: false,
                excluded_reason: "unsupported_field",
                protected: false
              }
            ]
          },
          field_scope: {
            included_fields: ["hero_cta_text"],
            excluded_fields: ["hero_cta_destination"],
            preserved_protected_fields: ["hero_title"],
            requires_confirmation_fields: []
          },
          conflicts: [],
          warnings: [],
          can_apply_without_confirmation: true,
          confirmation_required: null
        }
      };
    }
  }, Object.assign(async ({ baseUrl }) => {
    const { response, body } = await requestJson(baseUrl, "/api/projects/unsupported-destination/state/plan", {
      method: "POST",
      body: JSON.stringify({
        prompt: "Update CTA text and route the CTA to the properties page safely."
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(body.included_fields, ["hero_cta_text"]);
    assert.deepEqual(body.unsupported_fields, ["hero_cta_destination"]);
    assert.equal(Object.prototype.hasOwnProperty.call(body.writable_desired_state, "hero_cta_destination"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(body.desired_state, "hero_cta_destination"), true);
  }, { projectsRoot }));
});

test("state rollback route rejects an already-rolled-back apply operation record", async () => {
  const projectsRoot = createTempProjectsRoot();
  const scaffold = createTempProject(projectsRoot, "rollback-already-done");
  const runtimePath = scaffold.project.runtime_path;
  const applyId = "state-apply-existing-1";
  const applyOperationId = "op-2026-07-12T07-00-00-000Z-applydone";
  writeStateApplyRecord(runtimePath, applyId, {
    project_slug: "rollback-already-done"
  });

  fs.mkdirSync(path.join(runtimePath, "runs", "operations"), { recursive: true });
  writeJson(path.join(runtimePath, "runs", "operations", applyOperationId + ".json"), {
    schema: "factory_project_operation",
    version: 1,
    operation_id: applyOperationId,
    project_slug: "rollback-already-done",
    operation_type: "state_apply",
    status: "succeeded",
    stage: "completed",
    requested_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    metadata: {
      plan_id: "state-plan-existing"
    },
    proof_ref: null,
    result_summary: {
      apply_id: applyId
    },
    error: {},
    safety: {
      live_ai_used: false,
      apply_used: true,
      rollback_used: false
    }
  });
  writeJson(path.join(runtimePath, "runs", "operations", "op-2026-07-12T07-00-00-000Z-rollbackdone.json"), {
    schema: "factory_project_operation",
    version: 1,
    operation_id: "op-2026-07-12T07-00-00-000Z-rollbackdone",
    project_slug: "rollback-already-done",
    operation_type: "state_rollback",
    status: "succeeded",
    stage: "completed",
    requested_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    metadata: {
      target_apply_operation_id: applyOperationId,
      source_apply_id: applyId
    },
    proof_ref: null,
    result_summary: {
      source_apply_id: applyId,
      rollback_fields: ["agency_name"]
    },
    error: {},
    safety: {
      live_ai_used: false,
      apply_used: false,
      rollback_used: true
    }
  });

  await withPatchedServer({
    rollbackStateApply: async () => {
      throw new Error("rollbackStateApply should not run for an already rolled-back target");
    }
  }, Object.assign(async ({ baseUrl }) => {
    const { response, body } = await requestJson(baseUrl, "/api/projects/rollback-already-done/state/rollback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "rollback-already-done-0001"
      },
      body: JSON.stringify({
        apply_operation_id: applyOperationId,
        confirm_rollback: true
      })
    });
    assert.equal(response.status, 409);
    assert.equal(body.code, "state_apply_already_rolled_back");
  }, { projectsRoot }));
});

test("rollback status restores the prior protected owner value instead of treating confirmed overwrite as a new conflict", () => {
  const projectsRoot = createTempProjectsRoot();
  const scaffold = createTempProject(projectsRoot, "rollback-protected-restore");
  const runtimePath = scaffold.project.runtime_path;
  const previousStatePath = path.join(runtimePath, "state", "applies", "state-before-rollback-protected.json");

  writeJson(previousStatePath, {
    schema: "factory_state",
    version: 1,
    project_slug: "rollback-protected-restore",
    personalization: {
      source: "state_apply_rollback_v1",
      provider_called: false,
      fields: {
        agency_name: "Owner Realty",
        hero_title: "Owner Realty - Homes and Properties in Mykolaiv",
        hero_subtitle: "Owner subtitle",
        hero_cta_text: "Browse Owner Listings"
      }
    },
    user_overrides: {
      hero_title: {
        source: "frontend_safe_edit",
        protected: true,
        value: "Owner Protected Hero Title",
        overwrite_policy: "ask_before_overwrite"
      }
    },
    effective_safe_fields: {
      fields: {
        agency_name: {
          value: "Owner Realty",
          source: "state_apply_rollback_v1",
          protected: false,
          rendered_check: "present"
        },
        hero_title: {
          value: "Owner Protected Hero Title",
          source: "frontend_safe_edit",
          protected: true,
          rendered_check: "present",
          overwrite_policy: "ask_before_overwrite"
        },
        hero_subtitle: {
          value: "Owner subtitle",
          source: "state_apply_rollback_v1",
          protected: false,
          rendered_check: "present"
        },
        hero_cta_text: {
          value: "Browse Owner Listings",
          source: "state_apply_rollback_v1",
          protected: false,
          rendered_check: "present"
        }
      },
      warnings: []
    },
    warnings: []
  });

  writeJson(path.join(runtimePath, "state", "current.json"), {
    schema: "factory_state",
    version: 1,
    project_slug: "rollback-protected-restore",
    updated_at: new Date().toISOString(),
    personalization: {
      source: "local_interpreter",
      provider_called: false,
      fields: {
        agency_name: "Homepage update",
        hero_title: "Homepage update - Homes and Properties in Mykolaiv",
        hero_subtitle: "Owner subtitle",
        hero_cta_text: "Browse Owner Listings"
      }
    },
    user_overrides: {
      hero_title: {
        source: "confirmed_overwrite",
        protected: true,
        value: "Homepage update - Homes and Properties in Mykolaiv",
        previous_value: "Owner Protected Hero Title",
        overwrite_policy: "ask_before_overwrite"
      }
    },
    effective_safe_fields: {
      fields: {
        agency_name: {
          value: "Homepage update",
          source: "safe_field_apply",
          protected: false,
          rendered_check: "present"
        },
        hero_title: {
          value: "Homepage update - Homes and Properties in Mykolaiv",
          source: "confirmed_overwrite",
          protected: true,
          rendered_check: "present",
          overwrite_policy: "ask_before_overwrite"
        },
        hero_subtitle: {
          value: "Owner subtitle",
          source: "state_apply_rollback_v1",
          protected: false,
          rendered_check: "present"
        },
        hero_cta_text: {
          value: "Browse Owner Listings",
          source: "state_apply_rollback_v1",
          protected: false,
          rendered_check: "present"
        }
      },
      warnings: []
    },
    warnings: []
  });

  writeStateApplyRecord(runtimePath, "state-apply-rollback-protected-1", {
    project_slug: "rollback-protected-restore",
    state_before_path: previousStatePath,
    applied_fields: ["agency_name", "hero_title"]
  });

  const status = readStateStatus({
    slug: "rollback-protected-restore",
    projectsRoot
  });

  assert.equal(status.rollback.available, true);
  assert.equal(status.rollback.safe, true);
  assert.equal(status.rollback.code, "state_rollback_available");
  assert.deepEqual(status.rollback.protected_conflicts, []);
  assert.equal(status.rollback.apply_id, "state-apply-rollback-protected-1");
});
