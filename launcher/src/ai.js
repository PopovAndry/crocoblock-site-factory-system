"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
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

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const LIVE_CANDIDATE_SCHEMA = "factory_ai_desired_state_candidate";
const LIVE_CANDIDATE_VERSION = 1;
const LIVE_ALLOWED_FIELDS = ["agency_name", "hero_title", "hero_subtitle", "hero_cta_text"];
const LIVE_FIELD_LIMITS = {
  agency_name: 120,
  hero_title: 160,
  hero_subtitle: 300,
  hero_cta_text: 80
};
const MODEL_PROFILES = {
  cheap: {
    key: "cheap",
    label: "Cheap",
    intended_use: "Short prompt review and low-cost planning drafts.",
    estimated_output_tokens: 800,
    recommended_for: ["short prompts", "light concept review", "early alpha planning"],
    openai_model: "gpt-4.1-mini"
  },
  balanced: {
    key: "balanced",
    label: "Balanced",
    intended_use: "Default choice for multi-stage planning and diff review.",
    estimated_output_tokens: 1200,
    recommended_for: ["site planning", "blueprint review", "most alpha launcher work"],
    openai_model: "gpt-4.1-mini"
  },
  reasoning: {
    key: "reasoning",
    label: "Reasoning",
    intended_use: "Deeper review for ambiguous, apply-critical, or debugging-heavy work.",
    estimated_output_tokens: 2000,
    recommended_for: ["complex prompts", "apply-critical review", "debugging"],
    openai_model: "gpt-4.1"
  }
};

function nowIso() {
  return new Date().toISOString();
}

function timestampCompact() {
  return nowIso().replace(/[:.]/g, "-");
}

function createId(prefix) {
  return prefix + "-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
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

function getOpenAiModel(profile) {
  return getModelProfile(profile).openai_model;
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

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function containsMarkup(value) {
  return /<[^>]+>/.test(String(value || ""));
}

function redactSecret(text, secret) {
  const input = String(text || "");
  const value = String(secret || "").trim();

  if (!value) {
    return input;
  }

  return input.split(value).join(maskSecret(value));
}

function parseEnvLikeContent(content) {
  const result = {};

  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    result[key] = value;
  }

  return result;
}

function stripJsonFences(content) {
  let value = String(content || "").trim();

  if (value.startsWith("```")) {
    value = value.replace(/^```(?:json)?\s*/i, "");
    value = value.replace(/\s*```$/i, "");
  }

  return value.trim();
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
    model: mode === "live" ? asString(merged.model) || getOpenAiModel(modelProfile) : "local_interpreter",
    key_status: mode === "mock" ? "not_required" : String(merged.key_status || "missing"),
    key_source: mode === "mock" ? null : (merged.key_source || null),
    key_env_name: mode === "mock" ? null : (merged.key_env_name || null),
    key_masked: mode === "mock" ? "" : String(merged.key_masked || ""),
    key_present: mode === "mock" ? false : Boolean(merged.key_present),
    key_tested: Boolean(merged.key_tested),
    key_tested_at: merged.key_tested_at || null,
    live_calls_enabled: Boolean(merged.live_calls_enabled),
    last_estimate: merged.last_estimate || null,
    last_live_call: merged.last_live_call || null,
    updated_at: merged.updated_at || nowIso()
  });
}

function getSecretsDir(projectState) {
  return path.join(projectState.runtimePath, "secrets");
}

function getAiSecretsPath(projectState) {
  return path.join(getSecretsDir(projectState), "ai.env");
}

function readAiSecretReference(projectState) {
  const secretsPath = getAiSecretsPath(projectState);

  if (!fs.existsSync(secretsPath)) {
    return {
      exists: false,
      path: secretsPath,
      provider: "",
      key: "",
      keyEnvName: ""
    };
  }

  const parsed = parseEnvLikeContent(fs.readFileSync(secretsPath, "utf8"));
  return {
    exists: true,
    path: secretsPath,
    provider: asString(parsed.FACTORY_AI_PROVIDER),
    key: asString(parsed.FACTORY_AI_KEY),
    keyEnvName: asString(parsed.FACTORY_AI_KEY_ENV)
  };
}

function hydrateAiState(projectState, ai) {
  const normalized = normalizeAiState(ai);
  const secret = readAiSecretReference(projectState);

  if (normalized.mode === "mock") {
    return Object.assign({}, normalized, {
      key_present: false,
      live_calls_enabled: false
    });
  }

  const keyPresent = Boolean(secret.key);
  return Object.assign({}, normalized, {
    provider: "openai",
    model: getOpenAiModel(normalized.model_profile),
    key_source: normalized.key_source || (keyPresent ? "env" : null),
    key_env_name: normalized.key_env_name || secret.keyEnvName || null,
    key_masked: normalized.key_masked || (keyPresent ? maskSecret(secret.key) : ""),
    key_present: keyPresent,
    key_status: keyPresent ? (normalized.key_status || "configured_locally") : "missing"
  });
}

function buildAiConfigProof(projectState, aiState, warnings) {
  return {
    proof_id: createId("ai-config"),
    project_id: projectState.project.project_id,
    slug: projectState.project.slug,
    mode: aiState.mode,
    provider: aiState.provider,
    model_profile: aiState.model_profile,
    model: aiState.model,
    key_status: aiState.key_status,
    key_source: aiState.key_source,
    key_env_name: aiState.key_env_name,
    key_masked: aiState.key_masked,
    live_calls_enabled: aiState.live_calls_enabled === true,
    applies_changes: true,
    mutation_scope: "launcher_project_metadata_and_secret_only",
    created_at: nowIso(),
    warnings
  };
}

function buildAiEstimateProof(projectState, aiState, estimate) {
  return {
    proof_id: estimate.proof_id,
    estimate_id: estimate.estimate_id,
    project_id: projectState.project.project_id,
    slug: projectState.project.slug,
    mode: aiState.mode,
    provider: aiState.provider,
    model_profile: aiState.model_profile,
    model: aiState.model,
    provider_called: false,
    estimated_input_tokens: estimate.estimated_input_tokens,
    estimated_output_tokens: estimate.estimated_output_tokens,
    estimated_total_tokens: estimate.estimated_total_tokens,
    estimated_cost: estimate.estimated_cost || null,
    uncertainty: estimate.uncertainty,
    applies_changes: false,
    mutation_scope: "launcher_project_metadata_only",
    created_at: estimate.created_at
  };
}

function buildAiLiveToggleProof(projectState, aiState, enabled) {
  return {
    proof_id: createId(enabled ? "ai-live-enable" : "ai-live-disable"),
    project_id: projectState.project.project_id,
    slug: projectState.project.slug,
    mode: aiState.mode,
    provider: aiState.provider,
    model_profile: aiState.model_profile,
    model: aiState.model,
    key_status: aiState.key_status,
    key_source: aiState.key_source,
    key_env_name: aiState.key_env_name,
    key_masked: aiState.key_masked,
    live_calls_enabled: aiState.live_calls_enabled === true,
    applies_changes: true,
    mutation_scope: "launcher_project_metadata_only",
    created_at: nowIso(),
    warnings: enabled
      ? ["Live AI calls are enabled only for explicit desired-state planning commands."]
      : ["Live AI calls were disabled."]
  };
}

function buildLivePromptMessages(prompt) {
  return [
    {
      role: "system",
      content: [
        "You produce a strict desired-state candidate for Crocoblock Site Factory.",
        "Return JSON only. Do not use markdown fences.",
        "Do not include HTML, CSS, JavaScript, URLs, WordPress instructions, plugin instructions, or apply instructions.",
        "Output only this schema: schema, version, source, provider, model, provider_called, fields, design_profile, warnings.",
        "schema must be factory_ai_desired_state_candidate.",
        "version must be 1.",
        "source must be live_provider.",
        "provider must be openai.",
        "provider_called must be true.",
        "Allowed fields keys only: agency_name, hero_title, hero_subtitle, hero_cta_text.",
        "All field values must be plain strings with no markup.",
        "design_profile may contain tone and style_slug as plain strings.",
        "Do not include unknown keys."
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Convert this prompt into a desired-state safe-field candidate for the real_estate alpha flow.",
        prompt: String(prompt || ""),
        required_fields: LIVE_ALLOWED_FIELDS,
        field_requirements: {
          agency_name: "plain string, max 120 chars",
          hero_title: "plain string, max 160 chars",
          hero_subtitle: "plain string, max 300 chars",
          hero_cta_text: "plain string, max 80 chars"
        }
      })
    }
  ];
}

function requestOpenAiJson(apiKey, payload) {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify(payload);
    const request = https.request(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody),
        Authorization: "Bearer " + apiKey
      },
      timeout: 30000
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let parsed = null;

        try {
          parsed = body ? JSON.parse(body) : null;
        } catch (error) {
          parsed = null;
        }

        resolve({
          statusCode: response.statusCode || 0,
          body,
          json: parsed
        });
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("OpenAI request timed out."));
    });
    request.on("error", reject);
    request.write(requestBody);
    request.end();
  });
}

function extractChatCompletionContent(responseJson) {
  const content = responseJson
    && responseJson.choices
    && responseJson.choices[0]
    && responseJson.choices[0].message
    && typeof responseJson.choices[0].message.content === "string"
    ? responseJson.choices[0].message.content
    : "";

  return stripJsonFences(content);
}

function buildUsageSummary(providerCalled, modelProfile, model, usage) {
  const safeUsage = usage && typeof usage === "object" ? usage : {};
  return {
    provider_called: providerCalled === true,
    provider: "openai",
    model_profile: safeModelProfile(modelProfile),
    model: asString(model),
    input_tokens: Number.isFinite(Number(safeUsage.prompt_tokens)) ? Number(safeUsage.prompt_tokens) : null,
    output_tokens: Number.isFinite(Number(safeUsage.completion_tokens)) ? Number(safeUsage.completion_tokens) : null,
    total_tokens: Number.isFinite(Number(safeUsage.total_tokens)) ? Number(safeUsage.total_tokens) : null,
    cost: null,
    cost_currency: "USD",
    cost_is_estimated: false
  };
}

function validateSafeFieldValue(fieldKey, value) {
  if (typeof value !== "string") {
    return "must_be_string";
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "empty_string";
  }

  if (containsMarkup(trimmed)) {
    return "markup_not_allowed";
  }

  if (trimmed.length > LIVE_FIELD_LIMITS[fieldKey]) {
    return "too_long";
  }

  return null;
}

function validateLiveDesiredStateCandidate(rawCandidate, metadata) {
  const candidate = rawCandidate && typeof rawCandidate === "object" ? rawCandidate : {};
  const rejectedFields = {};
  const warnings = [];

  if (asString(candidate.schema) !== LIVE_CANDIDATE_SCHEMA) {
    throw createInvalidCandidateError(metadata, "schema_mismatch", rejectedFields, warnings);
  }

  if (Number(candidate.version) !== LIVE_CANDIDATE_VERSION) {
    throw createInvalidCandidateError(metadata, "version_mismatch", rejectedFields, warnings);
  }

  const fields = candidate.fields && typeof candidate.fields === "object" && !Array.isArray(candidate.fields)
    ? candidate.fields
    : null;

  if (!fields) {
    throw createInvalidCandidateError(metadata, "fields_missing", rejectedFields, warnings);
  }

  const unknownFields = Object.keys(fields).filter((fieldKey) => !LIVE_ALLOWED_FIELDS.includes(fieldKey));
  if (unknownFields.length) {
    throw createInvalidCandidateError(metadata, "unknown_fields", rejectedFields, warnings, unknownFields);
  }

  const validatedFields = {};
  for (const fieldKey of LIVE_ALLOWED_FIELDS) {
    const reason = validateSafeFieldValue(fieldKey, fields[fieldKey]);
    if (reason) {
      rejectedFields[fieldKey] = reason;
    } else {
      validatedFields[fieldKey] = asString(fields[fieldKey]).replace(/\s+/g, " ").trim();
    }
  }

  if (Object.keys(rejectedFields).length > 0) {
    throw createInvalidCandidateError(metadata, "invalid_fields", rejectedFields, warnings);
  }

  const designProfileInput = candidate.design_profile && typeof candidate.design_profile === "object"
    ? candidate.design_profile
    : {};
  const designProfile = {};
  if (typeof designProfileInput.tone === "string" && !containsMarkup(designProfileInput.tone)) {
    designProfile.tone = asString(designProfileInput.tone).slice(0, 80);
  }
  if (typeof designProfileInput.style_slug === "string" && !containsMarkup(designProfileInput.style_slug)) {
    designProfile.style_slug = asString(designProfileInput.style_slug).slice(0, 80);
  }

  return {
    schema: LIVE_CANDIDATE_SCHEMA,
    version: LIVE_CANDIDATE_VERSION,
    source: "live_provider",
    provider: "openai",
    model: asString(metadata.model),
    provider_called: true,
    fields: validatedFields,
    design_profile: designProfile,
    warnings: Array.isArray(candidate.warnings)
      ? candidate.warnings.map((item) => asString(item)).filter(Boolean).slice(0, 10)
      : []
  };
}

function createInvalidCandidateError(metadata, reason, rejectedFields, warnings, unknownFields) {
  const error = new Error("Live AI candidate failed validation: " + reason.replace(/_/g, " "));
  error.code = "ai_candidate_invalid_schema";
  error.validation = {
    valid: false,
    reason,
    rejected_fields: rejectedFields || {},
    unknown_fields: Array.isArray(unknownFields) ? unknownFields : [],
    warnings: Array.isArray(warnings) ? warnings : []
  };
  error.provider_called = metadata.providerCalled === true;
  error.model = metadata.model;
  return error;
}

function buildLiveCandidateProof(projectState, detail) {
  return {
    proof_id: detail.proofId,
    project_id: projectState.project.project_id,
    slug: projectState.project.slug,
    wp_url: projectState.project.wp_url,
    prompt_hash: detail.promptHash,
    ai_source: detail.aiSource,
    provider: detail.provider,
    model_profile: detail.modelProfile,
    model: detail.model,
    estimate_id: detail.estimateId,
    provider_called: detail.providerCalled === true,
    validation: detail.validation,
    candidate: detail.candidate,
    usage: detail.usage,
    applies_changes: false,
    mutation_scope: "launcher_project_metadata_only",
    created_at: detail.createdAt,
    warnings: detail.warnings
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
  projectState.project.ai = hydrateAiState(projectState, projectState.project.ai);
  return {
    projectsRoot,
    projectState
  };
}

function configureMockMode(projectState, modelProfile) {
  const nextState = hydrateAiState(projectState, {
    mode: "mock",
    provider: "mock",
    model_profile: modelProfile,
    model: "local_interpreter",
    key_status: "not_required",
    key_source: null,
    key_env_name: null,
    key_masked: "",
    key_present: false,
    key_tested: false,
    key_tested_at: null,
    live_calls_enabled: false,
    last_estimate: projectState.project.ai && projectState.project.ai.last_estimate ? projectState.project.ai.last_estimate : null,
    last_live_call: projectState.project.ai && projectState.project.ai.last_live_call ? projectState.project.ai.last_live_call : null,
    updated_at: nowIso()
  });

  projectState.project.ai = nextState;
  saveProjectRecord(projectState, projectState.project);

  const proof = buildAiConfigProof(projectState, nextState, [
    "Mock mode keeps live provider calls disabled by default."
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

  const nextState = hydrateAiState(projectState, {
    mode: "live",
    provider: "openai",
    model_profile: modelProfile,
    model: getOpenAiModel(modelProfile),
    key_status: "configured_locally",
    key_source: "env",
    key_env_name: envName,
    key_masked: maskSecret(rawKey),
    key_present: true,
    key_tested: false,
    key_tested_at: null,
    live_calls_enabled: false,
    last_estimate: projectState.project.ai && projectState.project.ai.last_estimate ? projectState.project.ai.last_estimate : null,
    last_live_call: projectState.project.ai && projectState.project.ai.last_live_call ? projectState.project.ai.last_live_call : null,
    updated_at: nowIso()
  });

  projectState.project.ai = nextState;
  saveProjectRecord(projectState, projectState.project);

  const proof = buildAiConfigProof(projectState, nextState, [
    "Live provider metadata is stored locally. Provider calls still require explicit live enablement and per-plan confirmation."
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
  const ai = hydrateAiState(projectState, projectState.project.ai);
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

  const ai = hydrateAiState(projectState, projectState.project.ai);
  const estimate = {
    estimate_id: createId("estimate"),
    proof_id: createId("ai-estimate"),
    model_profile: ai.model_profile,
    model: ai.model,
    estimated_input_tokens: estimateInputTokens(prompt),
    estimated_output_tokens: estimateOutputTokens(ai.model_profile),
    estimated_total_tokens: estimateInputTokens(prompt) + estimateOutputTokens(ai.model_profile),
    estimated_cost: null,
    uncertainty: "rough_local_estimate",
    prompt_length: prompt.length,
    provider_called: false,
    created_at: nowIso()
  };

  projectState.project.ai = Object.assign({}, ai, {
    last_estimate: estimate,
    updated_at: nowIso()
  });
  projectState.project.usage = Object.assign({}, projectState.project.usage || {}, {
    last_estimate: {
      estimate_id: estimate.estimate_id,
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

  projectState.project.ai = Object.assign({}, projectState.project.ai, {
    last_estimate: Object.assign({}, estimate, {
      proof_id: proof.proof_id,
      proof_path: proofPath
    })
  });
  saveProjectRecord(projectState, projectState.project);

  return {
    project: projectState.project,
    ai: projectState.project.ai,
    estimate: projectState.project.ai.last_estimate,
    proof,
    proofPath
  };
}

function enableLiveAi(options) {
  const { projectState } = loadProjectState(options);
  const ai = hydrateAiState(projectState, projectState.project.ai);

  if (ai.mode !== "live" || ai.provider !== "openai") {
    const error = new Error("Live AI enablement requires provider metadata from: ai configure --provider openai --key-env <ENV_NAME>.");
    error.code = "ai_provider_not_configured";
    throw error;
  }

  if (!ai.key_present) {
    const error = new Error("Live AI enablement requires a configured key reference.");
    error.code = "ai_key_missing";
    throw error;
  }

  const nextState = Object.assign({}, ai, {
    live_calls_enabled: true,
    updated_at: nowIso()
  });
  projectState.project.ai = nextState;
  saveProjectRecord(projectState, projectState.project);

  const proof = buildAiLiveToggleProof(projectState, nextState, true);
  const proofPath = writeProof(projectState, proof);

  return {
    project: projectState.project,
    ai: nextState,
    proof,
    proofPath
  };
}

function resolveLatestEstimate(projectState, selection) {
  const value = asString(selection);
  const lastEstimate = projectState.project.ai && projectState.project.ai.last_estimate
    ? projectState.project.ai.last_estimate
    : null;

  if (!value || value === "latest") {
    if (!lastEstimate || !lastEstimate.estimate_id) {
      const error = new Error("A prior AI estimate is required before a live provider plan.");
      error.code = "ai_estimate_required";
      throw error;
    }
    return lastEstimate;
  }

  if (lastEstimate && lastEstimate.estimate_id === value) {
    return lastEstimate;
  }

  const error = new Error("Requested estimate was not found. Use --estimate latest after running ai estimate.");
  error.code = "ai_estimate_required";
  throw error;
}

function validateLiveAiGate(projectState, options) {
  const ai = hydrateAiState(projectState, projectState.project.ai);
  const estimate = resolveLatestEstimate(projectState, options.estimate);

  if (ai.mode !== "live" || ai.provider !== "openai") {
    const error = new Error("Live desired-state planning requires launcher AI provider metadata for OpenAI.");
    error.code = "ai_provider_not_configured";
    throw error;
  }

  if (!ai.live_calls_enabled) {
    const error = new Error("Live desired-state planning is disabled. Run: node launcher/src/cli.js ai --slug " + projectState.project.slug + " enable-live");
    error.code = "ai_live_calls_disabled";
    throw error;
  }

  if (options.confirmLive !== true) {
    const error = new Error("Live desired-state planning requires --confirm-live.");
    error.code = "ai_live_confirmation_required";
    throw error;
  }

  const secret = readAiSecretReference(projectState);
  if (!secret.key) {
    const error = new Error("Live desired-state planning requires a configured API key reference.");
    error.code = "ai_key_missing";
    throw error;
  }

  return {
    ai,
    estimate,
    secret
  };
}

async function createLiveDesiredStateCandidate(projectState, options) {
  const gate = validateLiveAiGate(projectState, options);
  const prompt = String(options.prompt || "").trim();
  const createdAt = nowIso();
  const proofId = createId("ai-candidate");
  const promptHash = crypto.createHash("sha256").update(prompt, "utf8").digest("hex");
  const messages = buildLivePromptMessages(prompt);
  const payload = {
    model: gate.ai.model,
    temperature: 0.2,
    max_tokens: estimateOutputTokens(gate.ai.model_profile),
    response_format: {
      type: "json_object"
    },
    messages
  };

  const response = await requestOpenAiJson(gate.secret.key, payload);
  const providerCalled = true;
  const usage = buildUsageSummary(providerCalled, gate.ai.model_profile, gate.ai.model, response.json && response.json.usage);
  const warnings = [];
  let candidate = null;
  let validation = {
    valid: false,
    reason: "not_checked",
    rejected_fields: {},
    unknown_fields: []
  };

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const providerMessage = response.json && response.json.error && response.json.error.message
      ? redactSecret(String(response.json.error.message), gate.secret.key)
      : "OpenAI returned an error response.";
    const proof = buildLiveCandidateProof(projectState, {
      proofId,
      promptHash,
      aiSource: "live_provider",
      provider: "openai",
      modelProfile: gate.ai.model_profile,
      model: gate.ai.model,
      estimateId: gate.estimate.estimate_id,
      providerCalled,
      validation: {
        valid: false,
        reason: "provider_http_error",
        rejected_fields: {},
        unknown_fields: []
      },
      candidate: null,
      usage,
      createdAt,
      warnings: [providerMessage]
    });
    const proofPath = writeProof(projectState, proof);
    projectState.project.ai = Object.assign({}, gate.ai, {
      last_live_call: {
        call_id: proofId,
        status: "error",
        code: "ai_provider_http_error",
        provider_called: true,
        model_profile: gate.ai.model_profile,
        model: gate.ai.model,
        estimate_id: gate.estimate.estimate_id,
        created_at: createdAt,
        proof_id: proof.proof_id
      },
      updated_at: nowIso()
    });
    saveProjectRecord(projectState, projectState.project);
    const error = new Error("Live provider request failed. Proof: " + proofPath);
    error.code = "ai_provider_http_error";
    error.proofPath = proofPath;
    error.provider_called = true;
    throw error;
  }

  let parsedCandidate = null;
  try {
    parsedCandidate = JSON.parse(extractChatCompletionContent(response.json));
    candidate = validateLiveDesiredStateCandidate(parsedCandidate, {
      providerCalled,
      model: gate.ai.model
    });
    validation = {
      valid: true,
      reason: "ok",
      rejected_fields: {},
      unknown_fields: []
    };
  } catch (error) {
    if (error && error.code === "ai_candidate_invalid_schema") {
      validation = error.validation || validation;
      warnings.push(error.message);
    } else {
      validation = {
        valid: false,
        reason: "provider_invalid_content",
        rejected_fields: {},
        unknown_fields: []
      };
      warnings.push("Live provider content could not be parsed as JSON.");
    }
  }

  const proof = buildLiveCandidateProof(projectState, {
    proofId,
    promptHash,
    aiSource: "live_provider",
    provider: "openai",
    modelProfile: gate.ai.model_profile,
    model: gate.ai.model,
    estimateId: gate.estimate.estimate_id,
    providerCalled,
    validation,
    candidate,
    usage,
    createdAt,
    warnings
  });
  const proofPath = writeProof(projectState, proof);

  projectState.project.ai = Object.assign({}, gate.ai, {
    last_live_call: {
      call_id: proofId,
      status: validation.valid ? "ok" : "error",
      code: validation.valid ? "ai_candidate_ready" : "ai_candidate_invalid_schema",
      provider_called: true,
      model_profile: gate.ai.model_profile,
      model: gate.ai.model,
      estimate_id: gate.estimate.estimate_id,
      created_at: createdAt,
      proof_id: proof.proof_id
    },
    updated_at: nowIso()
  });
  saveProjectRecord(projectState, projectState.project);

  if (!validation.valid || !candidate) {
    const error = new Error("Live AI candidate validation failed. Proof: " + proofPath);
    error.code = "ai_candidate_invalid_schema";
    error.proofPath = proofPath;
    error.provider_called = true;
    throw error;
  }

  return {
    ai: gate.ai,
    estimate: gate.estimate,
    candidate,
    proof,
    proofPath,
    usage
  };
}

module.exports = {
  LIVE_ALLOWED_FIELDS,
  LIVE_CANDIDATE_SCHEMA,
  LIVE_CANDIDATE_VERSION,
  MODEL_PROFILES,
  configureAi,
  createLiveDesiredStateCandidate,
  enableLiveAi,
  estimateAi,
  estimateInputTokens,
  estimateOutputTokens,
  getAiStatus,
  getModelProfile,
  getOpenAiModel,
  hydrateAiState,
  maskSecret,
  normalizeAiState,
  resolveLatestEstimate,
  safeModelProfile
};
