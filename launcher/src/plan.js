"use strict";

const path = require("path");
const crypto = require("crypto");
const {
  assertSafeRuntimePath,
  readProjectBySlug,
  resolveProjectsRoot,
  saveProjectRecord,
  writeJsonFile
} = require("./project-store");
const {
  fetchJsonWithBasicAuth,
  fetchJsonWithCookie,
  waitForUrl
} = require("./agent-client");
const {
  createRestNonce,
  loginWithAdminCookie
} = require("./install-agent");
const {
  estimateInputTokens,
  estimateOutputTokens,
  normalizeAiState
} = require("./ai");
const {
  buildPlanningContextFromPersonalization,
  derivePromptPersonalization,
  summarizeAppliedFieldKeys
} = require("./prompt-personalization");

const STAGE_DEFINITIONS = [
  {
    name: "site_plan",
    label: "Site Plan",
    route: "/ai/site-plan",
    buildPayload(input) {
      return {
        prompt: input.prompt,
        site_type: "real_estate",
        context: input.context
      };
    }
  },
  {
    name: "blueprint_candidate",
    label: "Blueprint Candidate",
    route: "/ai/blueprint-candidate",
    buildPayload(input, results) {
      return {
        prompt: input.prompt,
        site_type: "real_estate",
        vertical: "real_estate",
        site_plan: results.site_plan,
        context: input.context
      };
    }
  },
  {
    name: "preview_diff",
    label: "Preview Diff",
    route: "/ai/preview-diff",
    buildPayload(input, results) {
      return {
        prompt: input.prompt,
        site_type: "real_estate",
        vertical: "real_estate",
        site_plan: results.site_plan,
        blueprint_candidate: results.blueprint_candidate,
        context: input.context
      };
    }
  },
  {
    name: "generate_gate",
    label: "Generate Gate",
    route: "/ai/generate-gate",
    buildPayload(input, results) {
      return {
        prompt: input.prompt,
        site_type: "real_estate",
        vertical: "real_estate",
        site_plan: results.site_plan,
        blueprint_candidate: results.blueprint_candidate,
        preview_diff: results.preview_diff,
        context: input.context
      };
    }
  },
  {
    name: "generate_preflight",
    label: "Generate Preflight",
    route: "/ai/generate-preflight",
    buildPayload(input, results) {
      return {
        prompt: input.prompt,
        site_type: "real_estate",
        vertical: "real_estate",
        site_plan: results.site_plan,
        blueprint_candidate: results.blueprint_candidate,
        preview_diff: results.preview_diff,
        generate_gate: results.generate_gate,
        context: input.context
      };
    }
  },
  {
    name: "generate_confirmation",
    label: "Generate Confirmation",
    route: "/ai/generate-confirmation",
    buildPayload(input, results) {
      return {
        prompt: input.prompt,
        site_type: "real_estate",
        vertical: "real_estate",
        site_plan: results.site_plan,
        blueprint_candidate: results.blueprint_candidate,
        preview_diff: results.preview_diff,
        generate_gate: results.generate_gate,
        generate_preflight: results.generate_preflight,
        context: input.context
      };
    }
  }
];

function timestampCompact() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function makeRunId() {
  return "run-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
}

function toBooleanTrue(value) {
  return value === true || value === "true";
}

function summarizeStage(name, data) {
  if (!data || typeof data !== "object") {
    return {};
  }

  switch (name) {
    case "site_plan":
      return {
        site_type: data.site_type || null,
        vertical: data.vertical || null,
        recommended_preset: data.recommended_preset || null,
        next_step: data.next_step || null
      };
    case "blueprint_candidate":
      return {
        status: data.status || null,
        vertical: data.vertical || null,
        recommended_preset: data.recommended_preset || null,
        candidate_site_name: data.candidate_site_name || data.site_name || null
      };
    case "preview_diff":
      return {
        status: data.status || null,
        creates: data.diff_summary && data.diff_summary.creates,
        updates: data.diff_summary && data.diff_summary.updates,
        warnings: data.diff_summary && data.diff_summary.warnings
      };
    case "generate_gate":
      return {
        status: data.status || null,
        can_generate: data.can_generate,
        blocking_reasons: Array.isArray(data.blocking_reasons) ? data.blocking_reasons.slice(0, 3) : []
      };
    case "generate_preflight":
      return {
        status: data.status || null,
        preflight_ready: data.preflight_ready,
        blocking_reasons: Array.isArray(data.blocking_reasons) ? data.blocking_reasons.slice(0, 3) : []
      };
    case "generate_confirmation":
      return {
        status: data.status || null,
        confirmation_ready: data.confirmation_ready,
        final_recheck_required: data.final_recheck_required,
        blocking_reasons: Array.isArray(data.blocking_reasons) ? data.blocking_reasons.slice(0, 3) : []
      };
    default:
      return {
        status: data.status || null,
        code: data.code || null
      };
  }
}

function hashPrompt(prompt) {
  return crypto.createHash("sha256").update(String(prompt || ""), "utf8").digest("hex");
}

async function postAgentJson(projectState, targetUrl, payload, proofId, warnings) {
  const requestBody = JSON.stringify(payload);

  try {
    if (!projectState.env.WP_APP_PASSWORD) {
      throw new Error("Launcher project is missing a stored application password.");
    }

    return await fetchJsonWithBasicAuth(targetUrl, projectState.env.WP_ADMIN_USER, projectState.env.WP_APP_PASSWORD, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody)
      },
      body: requestBody
    });
  } catch (error) {
    const cookieHeader = await loginWithAdminCookie(projectState);
    const restNonce = await createRestNonce(projectState, proofId);
    warnings.push("Agent planning auth fell back to admin cookie context.");
    return fetchJsonWithCookie(targetUrl, cookieHeader, restNonce, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody)
      },
      body: requestBody
    });
  }
}

async function planProject(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  const prompt = String(options.prompt || "").trim();
  const safeRuntimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const createdAt = new Date().toISOString();
  const runId = makeRunId();
  const proofId = "plan-" + runId;
  const warnings = [];

  if (!prompt) {
    throw new Error("plan requires a non-empty --prompt value.");
  }

  if ((projectState.project.runtime && projectState.project.runtime.status) !== "provisioned") {
    throw new Error("Launcher project must be provisioned before planning.");
  }

  if ((projectState.project.agent && projectState.project.agent.status) !== "installed") {
    throw new Error("Site Factory Agent must be installed before planning.");
  }

  const restBase = String(projectState.project.agent && projectState.project.agent.rest_base || "");
  if (!restBase) {
    throw new Error("Launcher project is missing agent.rest_base.");
  }

  await waitForUrl(projectState.project.wp_url);

  const aiState = normalizeAiState(projectState.project.ai);
  const modelProfile = aiState.model_profile;
  const estimatedInputTokens = estimateInputTokens(prompt);
  const estimatedOutputTokens = estimateOutputTokens(modelProfile);
  const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;
  const promptPersonalization = derivePromptPersonalization(prompt);
  const appliedFieldKeys = summarizeAppliedFieldKeys(promptPersonalization);
  const context = buildPlanningContextFromPersonalization(promptPersonalization);
  const results = {};
  const stages = [];
  let status = "ok";
  let anyProviderCalled = false;

  for (const stage of STAGE_DEFINITIONS) {
    const endpoint = restBase + stage.route;
    const payload = stage.buildPayload({
      prompt,
      context,
      modelProfile,
      aiMode: aiState.mode,
      provider: aiState.provider
    }, results);
    const response = await postAgentJson(projectState, endpoint, payload, proofId, warnings);
    const data = response.json || {};
    const appliesChanges = toBooleanTrue(data.applies_changes);
    const providerCalled = toBooleanTrue(data.provider_called);
    const stageRecord = {
      name: stage.name,
      label: stage.label,
      endpoint,
      http_status: response.statusCode,
      status: data.status || null,
      code: data.code || null,
      applies_changes: appliesChanges,
      provider_called: providerCalled,
      summary: summarizeStage(stage.name, data)
    };

    stages.push(stageRecord);

    if (appliesChanges) {
      status = "failed";
      warnings.push("Read-only contract violation at " + stage.name + ": applies_changes=true");
      break;
    }

    if (providerCalled) {
      anyProviderCalled = true;
      if (aiState.live_calls_enabled === true) {
        warnings.push("Live provider call observed at " + stage.name + ".");
      } else {
        status = "failed";
        warnings.push("Unexpected live provider call at " + stage.name + " while live calls are disabled in Launcher alpha.");
        break;
      }
    }

    results[stage.name] = data;
  }

  const stagesCompleted = stages.filter((stage) => !stage.applies_changes && !stage.provider_called).length;
  const run = {
    run_id: runId,
    project_id: projectState.project.project_id,
    slug: projectState.project.slug,
    prompt,
    prompt_hash: hashPrompt(prompt),
    prompt_personalization: promptPersonalization,
    generate_would_apply_personalization: appliedFieldKeys.length > 0,
    ai_mode: aiState.mode,
    ai_provider: aiState.provider,
    ai_key_status: aiState.key_status,
    model_profile: modelProfile,
    estimated_input_tokens: estimatedInputTokens,
    estimated_output_tokens: estimatedOutputTokens,
    estimated_total_tokens: estimatedTotalTokens,
    stages,
    created_at: createdAt,
    status,
    warnings,
    applies_changes: false
  };
  const proof = {
    proof_id: proofId,
    run_id: runId,
    project_id: projectState.project.project_id,
    slug: projectState.project.slug,
    wp_url: projectState.project.wp_url,
    agent_rest_base: restBase,
    ai_mode: aiState.mode,
    ai_provider: aiState.provider,
    ai_key_status: aiState.key_status,
    model_profile: modelProfile,
    prompt_hash: hashPrompt(prompt),
    prompt_personalization: promptPersonalization,
    personalization_applied_fields: appliedFieldKeys,
    generate_would_apply_personalization: appliedFieldKeys.length > 0,
    stages_completed: stagesCompleted,
    all_read_only: true,
    any_provider_called: anyProviderCalled,
    applies_changes: false,
    mutation_scope: "launcher_project_metadata_only",
    created_at: createdAt,
    warnings
  };
  const runPath = path.join(safeRuntimePath, "runs", runId + ".json");
  const proofPath = path.join(safeRuntimePath, "proofs", proofId + ".json");

  writeJsonFile(runPath, run);
  writeJsonFile(proofPath, proof);

  projectState.project.current_run_id = runId;
  projectState.project.ai = Object.assign({}, aiState, {
    updated_at: new Date().toISOString()
  });
  projectState.project.usage = Object.assign({}, projectState.project.usage || {}, {
    total_tokens: Number(projectState.project.usage && projectState.project.usage.total_tokens || 0) + estimatedTotalTokens,
    total_cost_estimate: projectState.project.usage && Object.prototype.hasOwnProperty.call(projectState.project.usage, "total_cost_estimate")
      ? projectState.project.usage.total_cost_estimate
      : null,
    last_estimate: {
      input: estimatedInputTokens,
      output: estimatedOutputTokens,
      total: estimatedTotalTokens,
      model_profile: modelProfile,
      run_id: runId
    }
  });
  saveProjectRecord(projectState, projectState.project);

  return {
    project: projectState.project,
    run,
    proof,
    runPath,
    proofPath,
    stagesCompleted
  };
}

module.exports = {
  planProject
};
