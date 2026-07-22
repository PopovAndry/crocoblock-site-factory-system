"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  assertSafeRuntimePath,
  defaultGeneratedSiteMetadata,
  defaultGenerationMetadata,
  readProjectBySlug,
  resolveProjectsRoot,
  saveProjectRecord,
  writeJsonFile
} = require("./project-store");
const {
  fetchJsonWithSignedAuth,
  requestJson,
  waitForUrl
} = require("./agent-client");
const {
  requireAgentSigningCredential
} = require("./agent-credential-store");
const { fetchDependencyStatus } = require("./dependencies");
const { runCommand } = require("./runtime-tools");
const {
  buildPlanningContextFromPersonalization,
  derivePromptPersonalization
} = require("./prompt-personalization");

const DOCKER_TIMEOUT_MS = 180000;
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
        generate_preflight: results.generate_preflight,
        context: input.context
      };
    }
  }
];

function timestampCompact() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function toBooleanTrue(value) {
  return value === true || value === "true";
}

function assertControlledGenerateResultSuccessful(executeData) {
  const status = String(executeData && executeData.status ? executeData.status : "error").trim().toLowerCase();

  if (status === "ok" || status === "warning") {
    return;
  }

  const error = new Error("Controlled generate Agent validation did not complete successfully.");
  error.code = "controlled_generate_validation_failed";
  throw error;
}

async function postAgentJson(projectState, targetUrl, payload, proofId, warnings) {
  const requestBody = JSON.stringify(payload);
  const requestTimeoutMs = payload && payload.execute ? 300000 : 120000;
  const credential = requireAgentSigningCredential(projectState);
  warnings.push("Agent generate request used signed Launcher authentication.");
  return fetchJsonWithSignedAuth(targetUrl, credential, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(requestBody)
    },
    body: requestBody,
    timeoutMs: requestTimeoutMs
  });
}

async function getAgentJson(projectState, targetUrl, proofId, warnings) {
  const credential = requireAgentSigningCredential(projectState);
  warnings.push("Agent generate read request used signed Launcher authentication.");
  return fetchJsonWithSignedAuth(targetUrl, credential, {
    method: "GET",
    timeoutMs: 30000
  });
}

function readRunFile(projectState, runId) {
  const runPath = path.join(projectState.runtimePath, "runs", runId + ".json");

  if (!fs.existsSync(runPath)) {
    throw new Error("Latest planning run file is missing: " + runPath);
  }

  return {
    runPath,
    run: JSON.parse(fs.readFileSync(runPath, "utf8"))
  };
}

function assertPlanningRunReady(run) {
  const allowedStatuses = ["ok", "warning"];

  if (!allowedStatuses.includes(String(run.status || ""))) {
    throw new Error("Latest planning run is not ready for generate.");
  }

  if (toBooleanTrue(run.applies_changes)) {
    throw new Error("Latest planning run is invalid because applies_changes=true.");
  }

  if (!Array.isArray(run.stages) || run.stages.length === 0) {
    throw new Error("Latest planning run has no stages.");
  }

  for (const stage of run.stages) {
    if (toBooleanTrue(stage.applies_changes)) {
      throw new Error("Latest planning run is invalid because stage " + stage.name + " reported applies_changes=true.");
    }

    if (toBooleanTrue(stage.provider_called)) {
      throw new Error("Latest planning run is invalid because stage " + stage.name + " reported provider_called=true.");
    }
  }
}

async function reportGenerateProgress(options, statusDetail, detail) {
  if (!options || typeof options.onProgress !== "function") {
    return;
  }

  await options.onProgress(String(statusDetail || "running"), detail && typeof detail === "object" ? detail : {});
}

async function runDockerCompose(runtimePath, proofStem, args, options) {
  return runCommand("docker", ["compose"].concat(args), {
    cwd: runtimePath,
    logPath: path.join(runtimePath, "logs", proofStem + "-" + options.logSuffix + ".log"),
    timeoutMs: options.timeoutMs || DOCKER_TIMEOUT_MS,
    ignoreExitCode: Boolean(options.ignoreExitCode)
  });
}

async function runWpCli(runtimePath, proofStem, wpArgs, options) {
  return runDockerCompose(runtimePath, proofStem, [
    "run", "--rm", "-T", "--entrypoint", "php", "wpcli",
    "-d", "memory_limit=512M",
    "/usr/local/bin/wp"
  ].concat(wpArgs), options || {});
}

async function readWpJson(runtimePath, proofStem, phpExpression, logSuffix) {
  const result = await runWpCli(runtimePath, proofStem, [
    "eval",
    "echo wp_json_encode(" + phpExpression + ");",
    "--path=/var/www/html",
    "--allow-root"
  ], {
    logSuffix,
    ignoreExitCode: false
  });

  const trimmed = String(result.stdout || "").trim();
  return trimmed ? JSON.parse(trimmed) : null;
}

async function countPostType(runtimePath, proofStem, postType, warnings) {
  const result = await runWpCli(runtimePath, proofStem, [
    "post", "list",
    "--post_type=" + postType,
    "--format=count",
    "--allow-root",
    "--path=/var/www/html"
  ], {
    logSuffix: "count-" + postType,
    ignoreExitCode: true
  });

  if (result.code !== 0) {
    warnings.push("Count unavailable for post type " + postType + ".");
    return null;
  }

  return Number(String(result.stdout || "").trim() || 0);
}

async function readRuntimeCounts(projectState, proofStem, warnings) {
  const runtimePath = projectState.runtimePath;
  const pages = await countPostType(runtimePath, proofStem, "page", warnings);
  const posts = await countPostType(runtimePath, proofStem, "post", warnings);
  const properties = await countPostType(runtimePath, proofStem, "property", warnings);
  const attachments = await countPostType(runtimePath, proofStem, "attachment", warnings);
  const activeTheme = await readWpJson(runtimePath, proofStem, "wp_get_theme()->get_stylesheet()", "active-theme");
  const kavaActive = (await runWpCli(runtimePath, proofStem, [
    "theme", "is-active", "kava", "--path=/var/www/html", "--allow-root"
  ], {
    logSuffix: "theme-kava-active",
    ignoreExitCode: true
  })).code === 0;
  const jetEngineActive = (await runWpCli(runtimePath, proofStem, [
    "plugin", "is-active", "jet-engine", "--path=/var/www/html", "--allow-root"
  ], {
    logSuffix: "plugin-jet-engine-active",
    ignoreExitCode: true
  })).code === 0;
  const jetSmartFiltersActive = (await runWpCli(runtimePath, proofStem, [
    "plugin", "is-active", "jet-smart-filters", "--path=/var/www/html", "--allow-root"
  ], {
    logSuffix: "plugin-jet-smart-filters-active",
    ignoreExitCode: true
  })).code === 0;

  return {
    pages,
    posts,
    properties,
    attachments,
    active_theme: activeTheme,
    plugins: {
      kava: kavaActive,
      "jet-engine": jetEngineActive,
      "jet-smart-filters": jetSmartFiltersActive
    }
  };
}

function readGeneratedUrlsFromPages(pages, wpUrl) {
  const urls = {
    root: wpUrl,
    home: wpUrl
  };

  for (const page of pages) {
    const slug = String(page.post_name || "").toLowerCase();
    const title = String(page.post_title || "").toLowerCase();

    if (!urls.properties && (slug === "properties" || title === "properties")) {
      urls.properties = page.url;
    }

    if (!urls.contact && (slug === "contact" || title === "contact")) {
      urls.contact = page.url;
    }
  }

  return urls;
}

async function readPublishedPages(projectState, proofStem, warnings) {
  const pages = await readWpJson(
    projectState.runtimePath,
    proofStem,
    "get_posts(array('post_type' => 'page','post_status' => 'publish','numberposts' => -1,'orderby' => 'menu_order title','order' => 'ASC'))",
    "published-pages"
  );

  if (!Array.isArray(pages)) {
    warnings.push("Published page lookup returned an unexpected payload.");
    return [];
  }

  const pageDetails = [];
  for (const page of pages) {
    const pageId = Number(page.ID || 0);
    if (!pageId) {
      continue;
    }

    const url = await readWpJson(projectState.runtimePath, proofStem, "get_permalink(" + pageId + ")", "page-url-" + pageId);
    pageDetails.push({
      ID: pageId,
      post_title: page.post_title || "",
      post_name: page.post_name || "",
      url
    });
  }

  return pageDetails;
}

async function readSinglePropertyUrl(projectState, proofStem, warnings) {
  const properties = await readWpJson(
    projectState.runtimePath,
    proofStem,
    "get_posts(array('post_type' => 'property','post_status' => 'publish','numberposts' => 1,'orderby' => 'ID','order' => 'ASC'))",
    "single-property"
  );

  if (!Array.isArray(properties) || properties.length === 0 || !properties[0].ID) {
    warnings.push("No published property URL was available after generate.");
    return null;
  }

  return readWpJson(projectState.runtimePath, proofStem, "get_permalink(" + Number(properties[0].ID) + ")", "single-property-url");
}

async function requestUrlStatus(targetUrl) {
  const response = await requestJson(targetUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/json"
    }
  });

  return response.statusCode;
}

async function verifyGeneratedUrls(urls, warnings) {
  const results = {};
  for (const [key, targetUrl] of Object.entries(urls)) {
    if (!targetUrl) {
      continue;
    }

    try {
      results[key] = await requestUrlStatus(targetUrl);
    } catch (error) {
      warnings.push("URL check failed for " + key + ": " + error.message);
      results[key] = 0;
    }
  }

  return results;
}

function readPreviousGenerateProof(projectState) {
  const proofId = projectState.project.generation && projectState.project.generation.last_proof_id;
  if (!proofId) {
    return null;
  }

  const proofPath = path.join(projectState.runtimePath, "proofs", proofId + ".json");
  if (!fs.existsSync(proofPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(proofPath, "utf8"));
  } catch (error) {
    return null;
  }
}

async function rerunPlanningChain(projectState, prompt, promptPersonalization, proofId, warnings) {
  const restBase = String(projectState.project.agent && projectState.project.agent.rest_base || "");
  const context = buildPlanningContextFromPersonalization(promptPersonalization);
  const results = {};
  const stages = [];

  for (const stage of STAGE_DEFINITIONS) {
    const endpoint = restBase + stage.route;
    const payload = stage.buildPayload({
      prompt,
      context
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
      provider_called: providerCalled
    };

    stages.push(stageRecord);

    if (appliesChanges) {
      throw new Error("Read-only contract violation at " + stage.name + ": applies_changes=true");
    }

    if (providerCalled) {
      throw new Error("Read-only planning stage " + stage.name + " unexpectedly reported provider_called=true.");
    }

    results[stage.name] = data;
  }

  return {
    context,
    results,
    stages
  };
}

async function validateGeneratePreconditions(projectState, proofId, warnings, requestedRunId) {
  const project = projectState.project;

  if ((project.runtime && project.runtime.status) !== "provisioned") {
    throw new Error("Launcher project must be provisioned before generate.");
  }

  if ((project.agent && project.agent.status) !== "installed") {
    throw new Error("Site Factory Agent must be installed before generate.");
  }

  if (!project.ai || !project.ai.mode) {
    throw new Error("Launcher AI mode is missing.");
  }

  if (!project.ai || !project.ai.model_profile) {
    throw new Error("Launcher AI model profile is missing.");
  }

  if (!project.dependency_state || !toBooleanTrue(project.dependency_state.can_generate) || (Array.isArray(project.dependency_state.blockers) && project.dependency_state.blockers.length > 0)) {
    throw new Error("Dependency state is not generate-ready.");
  }

  const targetRunId = String(requestedRunId || project.current_run_id || "").trim();
  if (!targetRunId) {
    throw new Error("Latest planning run is missing.");
  }

  const runState = readRunFile(projectState, targetRunId);
  assertPlanningRunReady(runState.run);

  await waitForUrl(project.wp_url);

  const restBase = String(project.agent && project.agent.rest_base || "");
  if (!restBase) {
    throw new Error("Launcher project is missing agent.rest_base.");
  }

  const health = (await getAgentJson(projectState, restBase + "/agent/health", proofId, warnings)).json || {};
  if (String(health.status || "") !== "ok") {
    throw new Error("Agent health check did not return ok.");
  }

  const capabilities = (await getAgentJson(projectState, restBase + "/agent/capabilities", proofId, warnings)).json || {};
  if (!capabilities.capabilities || capabilities.capabilities.controlled_generate !== true) {
    throw new Error("Agent capabilities do not advertise controlled_generate=true.");
  }

  const dependencyStatus = await fetchDependencyStatus(projectState, warnings);
  if (!dependencyStatus.summary.can_generate || dependencyStatus.summary.blockers.length > 0) {
    throw new Error("Dependency recheck blocked generate.");
  }

  return {
    runState,
    restBase,
    health,
    capabilities,
    dependencyStatus
  };
}

function deriveProjectUrls(project, controlledResponse, pageUrls, propertyUrl) {
  const urls = Object.assign({}, defaultGeneratedSiteMetadata().urls, pageUrls);

  if (controlledResponse && controlledResponse.generation_result && Array.isArray(controlledResponse.generation_result.results_summary)) {
    for (const item of controlledResponse.generation_result.results_summary) {
      if (item && typeof item === "object" && item.url && item.key && !urls[item.key]) {
        urls[item.key] = item.url;
      }
    }
  }

  if (propertyUrl) {
    urls.single_property = propertyUrl;
  }

  return urls;
}

function normalizePersonalizationOutcomes(executeData, promptPersonalization) {
  const desiredFields = Object.keys(promptPersonalization && promptPersonalization.fields || {});
  const desiredSet = new Set(desiredFields);
  const source = executeData && executeData.personalization_outcomes && typeof executeData.personalization_outcomes === "object"
    ? executeData.personalization_outcomes
    : {};
  const result = {
    applied_fields: [],
    preserved_fields: [],
    skipped_fields: [],
    failed_fields: []
  };
  const assigned = new Set();

  for (const outcomeKey of ["failed_fields", "preserved_fields", "skipped_fields", "applied_fields"]) {
    const fields = Array.isArray(source[outcomeKey]) ? source[outcomeKey] : [];
    for (const field of fields) {
      if (typeof field !== "string" || !desiredSet.has(field) || assigned.has(field)) {
        continue;
      }
      result[outcomeKey].push(field);
      assigned.add(field);
    }
  }

  for (const field of desiredFields) {
    if (!assigned.has(field)) {
      result.failed_fields.push(field);
    }
  }

  return result;
}

function pickPersonalizationValues(personalization, fieldKeys) {
  const fields = personalization && personalization.fields && typeof personalization.fields === "object"
    ? personalization.fields
    : {};

  return fieldKeys.reduce((values, fieldKey) => {
    if (Object.prototype.hasOwnProperty.call(fields, fieldKey)) {
      values[fieldKey] = fields[fieldKey];
    }
    return values;
  }, {});
}

async function generateProject(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  const safeRuntimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const createdAt = new Date().toISOString();
  const proofId = "generate-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
  const warnings = [];
  const errors = [];
  let preconditions = null;
  let prompt = "";
  let beforeCounts = null;
  let afterCounts = null;
  let generatedUrls = {};
  let urlStatus = {};
  let previewData = null;
  let executeData = null;
  let enteredMutationBoundary = false;
  let dependencyStateBefore = projectState.project.dependency_state || null;
  let promptPersonalization = null;
  let previousGenerateProof = null;
  let targetRunId = "";

  try {
    targetRunId = String(options.planId || options.runId || projectState.project.current_run_id || "").trim();
    await reportGenerateProgress(options, "validating", {
      plan_id: targetRunId || null
    });
    preconditions = await validateGeneratePreconditions(projectState, proofId, warnings, targetRunId);
    prompt = String(preconditions.runState.run.prompt || "").trim();

    if (!prompt) {
      throw new Error("Latest planning run prompt is missing.");
    }

    promptPersonalization = preconditions.runState.run.prompt_personalization
      && typeof preconditions.runState.run.prompt_personalization === "object"
      ? preconditions.runState.run.prompt_personalization
      : derivePromptPersonalization(prompt);
    previousGenerateProof = readPreviousGenerateProof(projectState);
    beforeCounts = await readRuntimeCounts(projectState, proofId, warnings);
    const rerun = await rerunPlanningChain(projectState, prompt, promptPersonalization, proofId, warnings);
    const gate = rerun.results.generate_gate || {};
    const preflight = rerun.results.generate_preflight || {};
    const confirmation = rerun.results.generate_confirmation || {};

    if (!toBooleanTrue(gate.can_generate)) {
      throw new Error("Generate gate blocked controlled generate.");
    }

    if (!toBooleanTrue(preflight.preflight_ready)) {
      throw new Error("Generate preflight blocked controlled generate.");
    }

    if (!toBooleanTrue(confirmation.confirmation_ready)) {
      throw new Error("Generate confirmation blocked controlled generate.");
    }

    if (Array.isArray(confirmation.blocking_reasons) && confirmation.blocking_reasons.length > 0) {
      throw new Error("Generate confirmation returned blocking reasons.");
    }

    const previewPayload = {
      prompt,
      generate_preflight: preflight,
      execute: false,
      site_type: "real_estate",
      vertical: "real_estate",
      context: rerun.context
    };
    const previewResponse = await postAgentJson(projectState, preconditions.restBase + "/ai/controlled-generate", previewPayload, proofId, warnings);
    previewData = previewResponse.json || {};

    if (toBooleanTrue(previewData.applies_changes)) {
      throw new Error("Controlled generate preview unexpectedly reported applies_changes=true.");
    }

    if (toBooleanTrue(previewData.provider_called)) {
      throw new Error("Controlled generate preview unexpectedly reported provider_called=true.");
    }

    if (!previewData.confirmation_required_phrase) {
      throw new Error("Controlled generate preview did not return a confirmation phrase.");
    }

    if (!toBooleanTrue(previewData.server_recomputed_preflight_ready) || !toBooleanTrue(previewData.server_recomputed_confirmation_ready)) {
      throw new Error("Controlled generate preview did not report ready preflight/confirmation.");
    }

    if (Array.isArray(previewData.blocking_reasons) && previewData.blocking_reasons.length > 0) {
      throw new Error("Controlled generate preview returned blocking reasons.");
    }

    const executePayload = Object.assign({}, previewPayload, {
      execute: true,
      confirmation_phrase: previewData.confirmation_required_phrase
    });

    enteredMutationBoundary = true;
    await reportGenerateProgress(options, "generating", {
      plan_id: preconditions.runState.run.run_id,
      prompt_hash: preconditions.runState.run.prompt_hash || null
    });
    const executeResponse = await postAgentJson(projectState, preconditions.restBase + "/ai/controlled-generate", executePayload, proofId, warnings);
    executeData = executeResponse.json || {};

    try {
      await reportGenerateProgress(options, "verifying", {
        plan_id: preconditions.runState.run.run_id
      });
      afterCounts = await readRuntimeCounts(projectState, proofId + "-after", warnings);
      const pages = await readPublishedPages(projectState, proofId + "-pages", warnings);
      const propertyUrl = await readSinglePropertyUrl(projectState, proofId + "-property", warnings);
      generatedUrls = deriveProjectUrls(projectState.project, executeData, readGeneratedUrlsFromPages(pages, projectState.project.wp_url), propertyUrl);
      urlStatus = await verifyGeneratedUrls(generatedUrls, warnings);
    } catch (error) {
      warnings.push("Post-generate verification was partial: " + error.message);
    }

    const personalizationOutcomes = normalizePersonalizationOutcomes(executeData, promptPersonalization);
    const personalizationBeforeValues = previousGenerateProof
      && previousGenerateProof.personalization
      && (previousGenerateProof.personalization.after_values || previousGenerateProof.personalization.fields)
        ? previousGenerateProof.personalization.after_values || previousGenerateProof.personalization.fields
        : null;
    const personalizationAfterValues = pickPersonalizationValues(promptPersonalization, personalizationOutcomes.applied_fields);
    const mutationStarted = toBooleanTrue(executeData.applies_changes) || String(executeData.mutation_status || "") === "unknown_after_apply_started" || String(executeData.mutation_status || "") === "completed";
    const proof = {
      proof_id: proofId,
      project_id: projectState.project.project_id,
      slug: projectState.project.slug,
      wp_url: projectState.project.wp_url,
      source_run_id: preconditions.runState.run.run_id,
      ai_mode: projectState.project.ai.mode,
      model_profile: projectState.project.ai.model_profile,
      dependency_state_before: dependencyStateBefore,
      before_counts: beforeCounts,
      after_counts: afterCounts,
      prompt,
      personalization: {
        source: promptPersonalization ? promptPersonalization.source : "local_interpreter",
        provider_called: false,
        fields: promptPersonalization ? promptPersonalization.fields : {},
        design_profile: promptPersonalization ? promptPersonalization.design_profile : {},
        applied_fields: personalizationOutcomes.applied_fields,
        preserved_fields: personalizationOutcomes.preserved_fields,
        skipped_fields: personalizationOutcomes.skipped_fields,
        failed_fields: personalizationOutcomes.failed_fields,
        ignored_fields: personalizationOutcomes.skipped_fields,
        warnings: promptPersonalization ? promptPersonalization.warnings : [],
        before_values: personalizationBeforeValues,
        after_values: personalizationAfterValues
      },
      controlled_generate_status: executeData.status || "error",
      controlled_generate_code: executeData.code || "controlled_generate_failed",
      generated_urls: generatedUrls,
      agent_manifest_summary: {
        manifest_path: executeData.manifest_path || null,
        generation_result: executeData.generation_result || null,
        validation_count: executeData.validation_count != null ? executeData.validation_count : null,
        execution_count: executeData.execution_count != null ? executeData.execution_count : null
      },
      applies_changes: mutationStarted,
      mutation_scope: "launcher_project_runtime_only",
      mutation_status: executeData.mutation_status || (mutationStarted ? "unknown_after_apply_started" : "not_started"),
      created_at: createdAt,
      warnings,
      errors
    };
    const proofPath = path.join(safeRuntimePath, "proofs", proofId + ".json");
    writeJsonFile(proofPath, proof);

    if (!mutationStarted) {
      throw new Error("Controlled generate did not enter the apply boundary: " + String(executeData.message || executeData.code || "unknown generate error"));
    }

    assertControlledGenerateResultSuccessful(executeData);

    projectState.project.generation = Object.assign({}, defaultGenerationMetadata(), projectState.project.generation || {}, {
      status: String(executeData.status || "error"),
      last_generate_run_id: preconditions.runState.run.run_id,
      last_proof_id: proofId,
      generated_at: createdAt,
      last_operation_id: options.operationId || null,
      last_plan_id: preconditions.runState.run.run_id
    });
    projectState.project.generated_site = Object.assign({}, defaultGeneratedSiteMetadata(), projectState.project.generated_site || {}, {
      present: toBooleanTrue(executeData.generated),
      urls: generatedUrls,
      personalization_last_applied: proof.personalization
    });
    saveProjectRecord(projectState, projectState.project);

    await reportGenerateProgress(options, "succeeded", {
      proof_path: proofPath,
      generated_urls: generatedUrls,
      before_counts: beforeCounts,
      after_counts: afterCounts
    });

    return {
      project: projectState.project,
      proof,
      proofPath,
      beforeCounts,
      afterCounts,
      executeData,
      generatedUrls,
      urlStatus,
      previewData
    };
  } catch (error) {
    errors.push(error.message);
    const personalizationOutcomes = normalizePersonalizationOutcomes(executeData, promptPersonalization);

    const proof = {
      proof_id: proofId,
      project_id: projectState.project.project_id,
      slug: projectState.project.slug,
      wp_url: projectState.project.wp_url,
      source_run_id: preconditions && preconditions.runState ? preconditions.runState.run.run_id : null,
      ai_mode: projectState.project.ai && projectState.project.ai.mode || null,
      model_profile: projectState.project.ai && projectState.project.ai.model_profile || null,
      dependency_state_before: dependencyStateBefore,
      before_counts: beforeCounts,
      after_counts: afterCounts,
      prompt,
      personalization: {
        source: promptPersonalization ? promptPersonalization.source : "local_interpreter",
        provider_called: false,
        fields: promptPersonalization ? promptPersonalization.fields : {},
        design_profile: promptPersonalization ? promptPersonalization.design_profile : {},
        applied_fields: personalizationOutcomes.applied_fields,
        preserved_fields: personalizationOutcomes.preserved_fields,
        skipped_fields: personalizationOutcomes.skipped_fields,
        failed_fields: personalizationOutcomes.failed_fields,
        ignored_fields: personalizationOutcomes.skipped_fields,
        warnings: promptPersonalization ? promptPersonalization.warnings : [],
        before_values: previousGenerateProof
          && previousGenerateProof.personalization
          && (previousGenerateProof.personalization.after_values || previousGenerateProof.personalization.fields)
            ? previousGenerateProof.personalization.after_values || previousGenerateProof.personalization.fields
            : null,
        after_values: pickPersonalizationValues(promptPersonalization, personalizationOutcomes.applied_fields)
      },
      controlled_generate_status: executeData && executeData.status ? executeData.status : "error",
      controlled_generate_code: executeData && executeData.code ? executeData.code : "launcher_generate_failed",
      generated_urls: generatedUrls,
      agent_manifest_summary: {
        manifest_path: executeData && executeData.manifest_path ? executeData.manifest_path : null,
        generation_result: executeData && executeData.generation_result ? executeData.generation_result : null,
        validation_count: executeData && executeData.validation_count != null ? executeData.validation_count : null,
        execution_count: executeData && executeData.execution_count != null ? executeData.execution_count : null
      },
      applies_changes: enteredMutationBoundary,
      mutation_scope: "launcher_project_runtime_only",
      mutation_status: enteredMutationBoundary
        ? (executeData && executeData.mutation_status ? executeData.mutation_status : "unknown_after_apply_started")
        : "not_started",
      created_at: createdAt,
      warnings,
      errors
    };
    const proofPath = path.join(safeRuntimePath, "proofs", proofId + ".json");
    writeJsonFile(proofPath, proof);

    if (enteredMutationBoundary) {
      projectState.project.generation = Object.assign({}, defaultGenerationMetadata(), projectState.project.generation || {}, {
        status: "error",
        last_generate_run_id: preconditions && preconditions.runState ? preconditions.runState.run.run_id : null,
        last_proof_id: proofId,
        generated_at: createdAt,
        last_operation_id: options.operationId || null,
        last_plan_id: preconditions && preconditions.runState ? preconditions.runState.run.run_id : (targetRunId || null)
      });
      saveProjectRecord(projectState, projectState.project);
    }

    await reportGenerateProgress(options, "failed", {
      proof_path: proofPath,
      error_message: error.message,
      entered_mutation_boundary: enteredMutationBoundary
    });

    const enrichedError = new Error(error.message + " (proof: " + proofPath + ")");
    enrichedError.proofPath = proofPath;
    throw enrichedError;
  }
}

module.exports = {
  assertControlledGenerateResultSuccessful,
  assertPlanningRunReady,
  generateProject,
  normalizePersonalizationOutcomes,
  readRunFile
};
