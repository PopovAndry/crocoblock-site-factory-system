"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  assertSafeRuntimePath,
  defaultAiMetadata,
  ensureDirectory,
  readProjectBySlug,
  resolveProjectsRoot,
  saveProjectRecord,
  writeJsonFile
} = require("./project-store");

const MODEL_PROFILES = {
  cheap: {
    key: "cheap",
    label: "Cheap",
    intended_use: "Short prompt review and low-cost planning drafts.",
    estimated_output_tokens: 800,
    recommended_for: ["short prompts", "light concept review", "early alpha planning"]
  },
  balanced: {
    key: "balanced",
    label: "Balanced",
    intended_use: "Default choice for multi-stage planning and diff review.",
    estimated_output_tokens: 1200,
    recommended_for: ["site planning", "blueprint review", "most alpha launcher work"]
  },
  reasoning: {
    key: "reasoning",
    label: "Reasoning",
    intended_use: "Deeper review for ambiguous, apply-critical, or debugging-heavy work.",
    estimated_output_tokens: 2000,
    recommended_for: ["complex prompts", "apply-critical review", "debugging"]
  }
};

function nowIso() {
  return new Date().toISOString();
}

function timestampCompact() {
  return nowIso().replace(/[:.]/g, "-");
}

function safeModelProfile(input) {
  const normalized = String(input || "").trim().toLowerCase();

  if (normalized === "fast") {
    return "cheap";
  }

  if (Object.prototype.hasOwnProperty.call(MODEL_PROFILES, normalized)) {
    return normalized;
  }

  return "balanced";
}

function getModelProfile(profile) {
  return MODEL_PROFILES[safeModelProfile(profile)];
}

function estimateInputTokens(prompt) {
  return Math.max(1, Math.ceil(String(prompt || "").length / 4));
}

function estimateOutputTokens(profile) {
  return getModelProfile(profile).estimated_output_tokens;
}

function maskSecret(secret) {
  const value = String(secret || "").trim();

  if (!value) {
    return "";
  }

  const prefix = value.startsWith("sk-") ? "sk-" : "";
  const suffix = value.slice(-4);
  return prefix + "..." + suffix;
}

function normalizeAiState(ai) {
  const merged = Object.assign(defaultAiMetadata(), ai || {});
  const modelProfile = safeModelProfile(merged.model_profile);
  const mode = String(merged.mode || "mock").trim().toLowerCase() === "live" ? "live" : "mock";
  const provider = mode === "live" ? "openai" : "mock";

  return Object.assign({}, merged, {
    mode,
    provider,
    model_profile: modelProfile,
    key_status: mode === "mock" ? "not_required" : String(merged.key_status || "missing"),
    key_source: mode === "mock" ? null : (merged.key_source || null),
    key_env_name: mode === "mock" ? null : (merged.key_env_name || null),
    key_masked: mode === "mock" ? "" : String(merged.key_masked || ""),
    key_tested: Boolean(merged.key_tested),
    key_tested_at: merged.key_tested_at || null,
    live_calls_enabled: false,
    updated_at: merged.updated_at || nowIso()
  });
}

function getSecretsDir(projectState) {
  return path.join(projectState.runtimePath, "secrets");
}

function getAiSecretsPath(projectState) {
  return path.join(getSecretsDir(projectState), "ai.env");
}

function buildAiConfigProof(projectState, aiState, warnings) {
  return {
    proof_id: "ai-config-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex"),
    project_id: projectState.project.project_id,
    slug: projectState.project.slug,
    mode: aiState.mode,
    provider: aiState.provider,
    model_profile: aiState.model_profile,
    key_status: aiState.key_status,
    key_source: aiState.key_source,
    key_env_name: aiState.key_env_name,
    key_masked: aiState.key_masked,
    live_calls_enabled: false,
    applies_changes: true,
    mutation_scope: "launcher_project_metadata_and_secret_only",
    created_at: nowIso(),
    warnings
  };
}

function buildAiEstimateProof(projectState, aiState, estimate) {
  return {
    proof_id: "ai-estimate-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex"),
    project_id: projectState.project.project_id,
    slug: projectState.project.slug,
    mode: aiState.mode,
    provider: aiState.provider,
    model_profile: aiState.model_profile,
    estimated_input_tokens: estimate.estimated_input_tokens,
    estimated_output_tokens: estimate.estimated_output_tokens,
    estimated_total_tokens: estimate.estimated_total_tokens,
    uncertainty: estimate.uncertainty,
    applies_changes: false,
    mutation_scope: "launcher_project_metadata_only",
    created_at: nowIso()
  };
}

function writeProof(projectState, proof) {
  const proofPath = path.join(projectState.runtimePath, "proofs", proof.proof_id + ".json");
  writeJsonFile(proofPath, proof);
  return proofPath;
}

function loadProjectState(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  projectState.project.ai = normalizeAiState(projectState.project.ai);
  return {
    projectsRoot,
    projectState
  };
}

function configureMockMode(projectState, modelProfile) {
  const nextState = normalizeAiState({
    mode: "mock",
    provider: "mock",
    model_profile: modelProfile,
    key_status: "not_required",
    key_source: null,
    key_env_name: null,
    key_masked: "",
    key_tested: false,
    key_tested_at: null,
    live_calls_enabled: false,
    last_estimate: projectState.project.ai && projectState.project.ai.last_estimate ? projectState.project.ai.last_estimate : null,
    updated_at: nowIso()
  });

  projectState.project.ai = nextState;
  saveProjectRecord(projectState, projectState.project);

  const proof = buildAiConfigProof(projectState, nextState, [
    "Mock mode keeps live provider calls disabled in this alpha slice."
  ]);
  const proofPath = writeProof(projectState, proof);

  return {
    project: projectState.project,
    ai: nextState,
    proof,
    proofPath
  };
}

function configureLiveMetadata(projectState, provider, modelProfile, keyEnvName) {
  if (String(provider || "").trim().toLowerCase() !== "openai") {
    throw new Error("Live mode metadata currently supports only --provider openai.");
  }

  const envName = String(keyEnvName || "").trim();
  if (!envName) {
    throw new Error("Live mode metadata requires --key-env <ENV_NAME>.");
  }

  const rawKey = process.env[envName];
  if (typeof rawKey !== "string" || !rawKey.trim()) {
    throw new Error("Environment variable " + envName + " is missing or empty.");
  }

  ensureDirectory(getSecretsDir(projectState));
  fs.writeFileSync(getAiSecretsPath(projectState), [
    "# Alpha local AI credentials. Do not use for production.",
    "FACTORY_AI_PROVIDER=openai",
    "FACTORY_AI_KEY=" + rawKey.trim(),
    "FACTORY_AI_KEY_ENV=" + envName,
    ""
  ].join("\n"), "utf8");

  const nextState = normalizeAiState({
    mode: "live",
    provider: "openai",
    model_profile: modelProfile,
    key_status: "configured_locally",
    key_source: "env",
    key_env_name: envName,
    key_masked: maskSecret(rawKey),
    key_tested: false,
    key_tested_at: null,
    live_calls_enabled: false,
    last_estimate: projectState.project.ai && projectState.project.ai.last_estimate ? projectState.project.ai.last_estimate : null,
    updated_at: nowIso()
  });

  projectState.project.ai = nextState;
  saveProjectRecord(projectState, projectState.project);

  const proof = buildAiConfigProof(projectState, nextState, [
    "Live provider metadata is stored locally, but live provider calls remain disabled in this alpha slice."
  ]);
  const proofPath = writeProof(projectState, proof);

  return {
    project: projectState.project,
    ai: nextState,
    proof,
    proofPath,
    secretsPath: getAiSecretsPath(projectState)
  };
}

function configureAi(options) {
  const { projectState } = loadProjectState(options);
  const modelProfile = safeModelProfile(options.modelProfile);
  const mode = String(options.mode || "").trim().toLowerCase();
  const provider = String(options.provider || "").trim().toLowerCase();

  if (mode === "mock") {
    return configureMockMode(projectState, modelProfile);
  }

  if (provider === "openai") {
    return configureLiveMetadata(projectState, provider, modelProfile, options.keyEnv);
  }

  throw new Error("AI configure requires either --mode mock or --provider openai with --key-env.");
}

function getAiStatus(options) {
  const { projectState } = loadProjectState(options);
  const ai = normalizeAiState(projectState.project.ai);
  return {
    project: projectState.project,
    ai,
    profiles: Object.values(MODEL_PROFILES)
  };
}

function estimateAi(options) {
  const { projectState } = loadProjectState(options);
  const prompt = String(options.prompt || "").trim();

  if (!prompt) {
    throw new Error("AI estimate requires --prompt \"<prompt>\".");
  }

  const ai = normalizeAiState(projectState.project.ai);
  const estimate = {
    model_profile: ai.model_profile,
    estimated_input_tokens: estimateInputTokens(prompt),
    estimated_output_tokens: estimateOutputTokens(ai.model_profile),
    estimated_total_tokens: estimateInputTokens(prompt) + estimateOutputTokens(ai.model_profile),
    uncertainty: "rough_local_estimate"
  };

  projectState.project.ai = Object.assign({}, ai, {
    last_estimate: Object.assign({
      prompt_length: prompt.length
    }, estimate),
    updated_at: nowIso()
  });
  projectState.project.usage = Object.assign({}, projectState.project.usage || {}, {
    last_estimate: {
      input: estimate.estimated_input_tokens,
      output: estimate.estimated_output_tokens,
      total: estimate.estimated_total_tokens,
      model_profile: ai.model_profile,
      run_id: null
    }
  });
  saveProjectRecord(projectState, projectState.project);

  const proof = buildAiEstimateProof(projectState, projectState.project.ai, estimate);
  const proofPath = writeProof(projectState, proof);

  return {
    project: projectState.project,
    ai: projectState.project.ai,
    estimate,
    proof,
    proofPath
  };
}

module.exports = {
  MODEL_PROFILES,
  configureAi,
  estimateAi,
  estimateInputTokens,
  estimateOutputTokens,
  getAiStatus,
  getModelProfile,
  maskSecret,
  normalizeAiState,
  safeModelProfile
};
