"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  assertSafeRuntimePath,
  defaultGeneratedSiteMetadata,
  ensureDirectory,
  readProjectBySlug,
  resolveProjectsRoot,
  saveProjectRecord,
  writeJsonFile
} = require("./project-store");
const {
  fetchJsonWithBasicAuth,
  fetchJsonWithCookie,
  requestJson,
  waitForUrl
} = require("./agent-client");
const {
  createRestNonce,
  loginWithAdminCookie
} = require("./install-agent");
const { fetchDependencyStatus } = require("./dependencies");
const {
  buildPlanningContextFromPersonalization,
  derivePromptPersonalization,
  summarizeAppliedFieldKeys
} = require("./prompt-personalization");
const { runCommand } = require("./runtime-tools");

const STATE_SCHEMA = "factory_state";
const STATE_VERSION = 1;
const STATE_PLAN_SCHEMA = "factory_state_plan";
const STATE_PLAN_VERSION = 1;
const STATE_APPLY_SCHEMA = "factory_state_apply";
const STATE_APPLY_VERSION = 1;
const STATE_ROLLBACK_SCHEMA = "factory_state_rollback";
const STATE_ROLLBACK_VERSION = 1;
const DOCKER_TIMEOUT_MS = 180000;
const STATE_APPLY_ALLOWLIST = [ "agency_name", "hero_title", "hero_subtitle", "hero_cta_text" ];
const STAGE_DEFINITIONS = [
  {
    name: "site_plan",
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

function shouldFallbackToCookieAuth(error) {
  if (!error) {
    return false;
  }

  if (typeof error.statusCode === "number") {
    return error.statusCode === 401 || error.statusCode === 403;
  }

  return /stored application password/i.test(String(error.message || ""));
}

function stateNow() {
  return new Date().toISOString();
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function decodeHtmlEntities(value) {
  const input = asString(value);
  if (!input) {
    return "";
  }

  const named = input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&ndash;/gi, "-")
    .replace(/&mdash;/gi, "-")
    .replace(/&minus;/gi, "-")
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "-");

  return named
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)));
}

function normalizeRenderedSearchText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function renderedHtmlContainsValue(html, value) {
  const normalizedHtml = normalizeRenderedSearchText(html);
  const normalizedValue = normalizeRenderedSearchText(value);
  if (!normalizedHtml || !normalizedValue) {
    return false;
  }

  return normalizedHtml.includes(normalizedValue);
}

function safeJsonRead(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureStatePaths(runtimePath) {
  const statePath = path.join(runtimePath, "state");
  const snapshotsPath = path.join(statePath, "snapshots");
  const plansPath = path.join(statePath, "plans");
  const appliesPath = path.join(statePath, "applies");
  const rollbacksPath = path.join(statePath, "rollbacks");
  ensureDirectory(statePath);
  ensureDirectory(snapshotsPath);
  ensureDirectory(plansPath);
  ensureDirectory(appliesPath);
  ensureDirectory(rollbacksPath);
  return {
    statePath,
    snapshotsPath,
    plansPath,
    appliesPath,
    rollbacksPath,
    currentPath: path.join(statePath, "current.json")
  };
}

function findLatestProofFile(runtimePath, filePrefix, expectedProofId) {
  const proofsPath = path.join(runtimePath, "proofs");
  if (!fs.existsSync(proofsPath)) {
    return null;
  }

  if (expectedProofId) {
    const expectedPath = path.join(proofsPath, expectedProofId + ".json");
    if (fs.existsSync(expectedPath)) {
      return {
        proofPath: expectedPath,
        proof: safeJsonRead(expectedPath)
      };
    }
  }

  const candidates = fs.readdirSync(proofsPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(filePrefix) && entry.name.endsWith(".json"))
    .map((entry) => {
      const filePath = path.join(proofsPath, entry.name);
      return {
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  if (!candidates.length) {
    return null;
  }

  return {
    proofPath: candidates[0].filePath,
    proof: safeJsonRead(candidates[0].filePath)
  };
}

function findLatestMatchingFile(directoryPath, prefix, extension) {
  if (!fs.existsSync(directoryPath)) {
    return null;
  }

  const candidates = fs.readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(extension))
    .map((entry) => {
      const filePath = path.join(directoryPath, entry.name);
      return {
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return candidates.length ? candidates[0].filePath : null;
}

function findPersonalizationProofEntries(projectState, runtimePath) {
  const proofsPath = path.join(runtimePath, "proofs");
  const candidates = new Map();
  const preferredIds = [
    asString(projectState.project.generation && projectState.project.generation.last_rollback_proof_id),
    asString(projectState.project.generation && projectState.project.generation.last_apply_proof_id),
    asString(projectState.project.generation && projectState.project.generation.last_proof_id)
  ].filter(Boolean);

  for (const proofId of preferredIds) {
    const proofPath = path.join(proofsPath, proofId + ".json");
    if (fs.existsSync(proofPath)) {
      candidates.set(proofPath, {
        proofPath,
        proof: safeJsonRead(proofPath),
        mtimeMs: fs.statSync(proofPath).mtimeMs
      });
    }
  }

  if (fs.existsSync(proofsPath)) {
    for (const entry of fs.readdirSync(proofsPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      if (
        !entry.name.startsWith("generate-")
        && !entry.name.startsWith("state-apply-")
        && !entry.name.startsWith("state-rollback-")
      ) {
        continue;
      }

      const proofPath = path.join(proofsPath, entry.name);
      if (candidates.has(proofPath)) {
        continue;
      }

      candidates.set(proofPath, {
        proofPath,
        proof: safeJsonRead(proofPath),
        mtimeMs: fs.statSync(proofPath).mtimeMs
      });
    }
  }

  return Array.from(candidates.values()).sort((left, right) => left.mtimeMs - right.mtimeMs);
}

function findLatestPersonalizationProof(projectState, runtimePath) {
  const entries = findPersonalizationProofEntries(projectState, runtimePath);
  return entries.length ? entries[entries.length - 1] : null;
}

function resolveAgentRunsDirectory(runtimePath) {
  return path.join(runtimePath, "wordpress", "wp-content", "uploads", "crocoblock-site-factory", "runs");
}

function resolveManifestHostPath(runtimePath, manifestPath) {
  const hostPrefix = "/var/www/html/";
  const normalized = asString(manifestPath);

  if (!normalized) {
    return null;
  }

  if (normalized.startsWith(hostPrefix)) {
    const relative = normalized.slice(hostPrefix.length).replace(/\//g, path.sep);
    return path.join(runtimePath, "wordpress", relative);
  }

  return null;
}

function findLatestAgentManifest(runtimePath, generateProof, warnings) {
  const runsPath = resolveAgentRunsDirectory(runtimePath);
  const explicit = generateProof && generateProof.agent_manifest_summary && generateProof.agent_manifest_summary.manifest_path
    ? resolveManifestHostPath(runtimePath, generateProof.agent_manifest_summary.manifest_path)
    : null;

  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  if (explicit && !fs.existsSync(explicit)) {
    warnings.push("Latest agent manifest path from generate proof was not found on disk.");
  }

  if (!fs.existsSync(runsPath)) {
    warnings.push("Agent run manifest directory is missing.");
    return null;
  }

  const candidates = fs.readdirSync(runsPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const filePath = path.join(runsPath, entry.name);
      return {
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return candidates.length ? candidates[0].filePath : null;
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
    logSuffix: "state-count-" + postType,
    ignoreExitCode: true
  });

  if (result.code !== 0) {
    warnings.push("Count unavailable for post type " + postType + ".");
    return null;
  }

  return Number(String(result.stdout || "").trim() || 0);
}

async function readManagedPages(runtimePath, proofStem, warnings) {
  try {
    const pages = await readWpJson(
      runtimePath,
      proofStem,
      "(function(){ $items = []; $map = array('home' => 'home','properties' => 'properties','contact' => 'contact'); foreach ($map as $handle => $slug) { $page = get_page_by_path($slug, OBJECT, 'page'); if ($page) { $items[] = array('handle' => $handle, 'slug' => $slug, 'id' => (int) $page->ID, 'title' => get_the_title($page), 'url' => get_permalink($page)); } else { $items[] = array('handle' => $handle, 'slug' => $slug, 'id' => null, 'title' => null, 'url' => null); } } return $items; })()",
      "state-managed-pages"
    );

    if (!Array.isArray(pages)) {
      warnings.push("Managed page lookup returned an unexpected payload.");
      return [];
    }

    return pages.map((page) => {
      const handle = asString(page.handle) || asString(page.slug) || "unknown";
      if (!page.id) {
        warnings.push("Managed page ID unavailable for " + handle + ".");
      }

      return {
        handle,
        slug: asString(page.slug) || handle,
        page_id: page.id != null ? Number(page.id) : null,
        title: asString(page.title) || null,
        url: asString(page.url) || null,
        factory_owned: true,
        management_scope: "factory_generated_page"
      };
    });
  } catch (error) {
    warnings.push("Managed page lookup failed: " + error.message);
    return [];
  }
}

function buildOwnershipRecord(resources) {
  const managedResources = [];

  for (const page of resources.pages) {
    managedResources.push({
      type: "page",
      handle: page.handle,
      slug: page.slug,
      page_id: page.page_id,
      factory_owned: true,
      management_scope: page.management_scope
    });
  }

  if (resources.post_types && resources.post_types.property) {
    managedResources.push({
      type: "post_type",
      handle: "property",
      count: resources.post_types.property.count,
      factory_owned: true,
      management_scope: "factory_generated_content"
    });
  }

  managedResources.push({
    type: "attachments",
    handle: "attachments",
    count: resources.attachments.count,
    factory_owned: true,
    management_scope: "factory_generated_media"
  });

  return {
    mode: "factory_managed",
    managed_resources: managedResources
  };
}

function extractPersonalization(generateProof) {
  if (generateProof && generateProof.rollback_fields && typeof generateProof.rollback_fields === "object") {
    return {
      source: asString(generateProof.personalization && generateProof.personalization.source) || "state_apply_rollback_v1",
      provider_called: generateProof.provider_called === true,
      fields: generateProof.rollback_fields,
      design_profile: generateProof.personalization && generateProof.personalization.design_profile && typeof generateProof.personalization.design_profile === "object"
        ? generateProof.personalization.design_profile
        : {},
      applied_fields: Array.isArray(generateProof.applied_fields) ? generateProof.applied_fields : summarizeAppliedFieldKeys({ fields: generateProof.rollback_fields }),
      ignored_fields: Array.isArray(generateProof.ignored_fields) ? generateProof.ignored_fields : [],
      warnings: Array.isArray(generateProof.warnings) ? generateProof.warnings : []
    };
  }

  if (generateProof && generateProof.personalization && typeof generateProof.personalization === "object") {
    const personalization = generateProof.personalization;
    const appliedFields = Array.isArray(personalization.applied_fields)
      ? personalization.applied_fields
      : summarizeAppliedFieldKeys(personalization);

    return {
      source: asString(personalization.source) || "unknown",
      provider_called: personalization.provider_called === true,
      fields: personalization.fields && typeof personalization.fields === "object"
        ? personalization.fields
        : {},
      design_profile: personalization.design_profile && typeof personalization.design_profile === "object"
        ? personalization.design_profile
        : {},
      applied_fields: appliedFields,
      ignored_fields: Array.isArray(personalization.ignored_fields) ? personalization.ignored_fields : [],
      warnings: Array.isArray(personalization.warnings) ? personalization.warnings : []
    };
  }

  if (generateProof && generateProof.personalization && typeof generateProof.personalization === "object") {
    return {
      source: asString(generateProof.personalization.source) || "unknown",
      provider_called: generateProof.personalization.provider_called === true,
      fields: generateProof.personalization.fields && typeof generateProof.personalization.fields === "object"
        ? generateProof.personalization.fields
        : {},
      design_profile: generateProof.personalization.design_profile && typeof generateProof.personalization.design_profile === "object"
        ? generateProof.personalization.design_profile
        : {},
      applied_fields: Array.isArray(generateProof.personalization.applied_fields) ? generateProof.personalization.applied_fields : [],
      ignored_fields: Array.isArray(generateProof.personalization.ignored_fields) ? generateProof.personalization.ignored_fields : [],
      warnings: Array.isArray(generateProof.personalization.warnings) ? generateProof.personalization.warnings : []
    };
  }

  return {
    source: "unknown",
    provider_called: false,
    fields: {},
    design_profile: {},
    applied_fields: [],
    ignored_fields: [],
    warnings: []
  };
}

function mergeEffectivePersonalization(previousState, personalization, userOverrides) {
  const previousPersonalization = previousState && previousState.personalization && typeof previousState.personalization === "object"
    ? previousState.personalization
    : {};
  const nextPersonalization = personalization && typeof personalization === "object"
    ? personalization
    : {};
  const mergedFields = Object.assign(
    {},
    previousPersonalization.fields && typeof previousPersonalization.fields === "object" ? previousPersonalization.fields : {},
    nextPersonalization.fields && typeof nextPersonalization.fields === "object" ? nextPersonalization.fields : {}
  );

  for (const fieldKey of STATE_APPLY_ALLOWLIST) {
    const override = userOverrides && typeof userOverrides === "object" ? userOverrides[fieldKey] : null;
    const overrideValue = override && typeof override === "object" ? asString(override.value) : "";
    if (overrideValue) {
      mergedFields[fieldKey] = overrideValue;
    }
  }

  const filteredFields = {};
  for (const fieldKey of STATE_APPLY_ALLOWLIST) {
    const value = asString(mergedFields[fieldKey]);
    if (value) {
      filteredFields[fieldKey] = value;
    }
  }

  const previousIgnored = Array.isArray(previousPersonalization.ignored_fields) ? previousPersonalization.ignored_fields : [];
  const nextIgnored = Array.isArray(nextPersonalization.ignored_fields) ? nextPersonalization.ignored_fields : [];
  const ignoredFields = Array.from(new Set(previousIgnored.concat(nextIgnored)))
    .filter((fieldKey) => !Object.prototype.hasOwnProperty.call(filteredFields, fieldKey));
  const previousWarnings = Array.isArray(previousPersonalization.warnings) ? previousPersonalization.warnings : [];
  const nextWarnings = Array.isArray(nextPersonalization.warnings) ? nextPersonalization.warnings : [];

  return {
    source: asString(nextPersonalization.source) || asString(previousPersonalization.source) || "unknown",
    provider_called: nextPersonalization.provider_called === true || previousPersonalization.provider_called === true,
    fields: filteredFields,
    design_profile: nextPersonalization.design_profile && typeof nextPersonalization.design_profile === "object"
      ? nextPersonalization.design_profile
      : (previousPersonalization.design_profile && typeof previousPersonalization.design_profile === "object"
        ? previousPersonalization.design_profile
        : {}),
    applied_fields: Object.keys(filteredFields),
    ignored_fields: ignoredFields,
    warnings: Array.from(new Set(previousWarnings.concat(nextWarnings)))
  };
}

function collectStateApplyProofEntries(runtimePath, warnings) {
  const proofsPath = path.join(runtimePath, "proofs");
  if (!fs.existsSync(proofsPath)) {
    return [];
  }

  const entries = [];
  for (const entry of fs.readdirSync(proofsPath, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith("state-apply-") || !entry.name.endsWith(".json")) {
      continue;
    }

    const proofPath = path.join(proofsPath, entry.name);
    try {
      entries.push({
        proofPath,
        proof: safeJsonRead(proofPath),
        mtimeMs: fs.statSync(proofPath).mtimeMs
      });
    } catch (error) {
      warnings.push("Could not parse state apply proof " + entry.name + ".");
    }
  }

  return entries.sort((left, right) => left.mtimeMs - right.mtimeMs);
}

function normalizeEffectiveFieldSource(source) {
  const normalized = asString(source);
  switch (normalized) {
    case "frontend_safe_edit":
    case "confirmed_overwrite":
    case "safe_field_apply":
    case "personalization":
      return normalized;
    default:
      return normalized ? "personalization" : "unknown";
  }
}

function buildLatestPersonalizationFieldMap(personalizationProofEntries) {
  const fieldMap = {};

  for (const entry of personalizationProofEntries) {
    const personalization = extractPersonalization(entry.proof);
    const fieldSource = normalizeEffectiveFieldSource(personalization.source);
    const proofId = asString(entry.proof && (entry.proof.proof_id || entry.proof.apply_id || entry.proof.rollback_id)) || null;

    for (const fieldKey of STATE_APPLY_ALLOWLIST) {
      const value = asString(personalization.fields && personalization.fields[fieldKey]);
      if (!value) {
        continue;
      }

      fieldMap[fieldKey] = {
        value,
        source: fieldSource,
        proof_id: proofId,
        proof_path: entry.proofPath
      };
    }
  }

  return fieldMap;
}

function buildLatestFieldOnlyApplyFieldMap(runtimePath, warnings) {
  const entries = collectStateApplyProofEntries(runtimePath, warnings);
  const fieldMap = {};
  let latestApply = null;

  for (const entry of entries) {
    const proof = entry.proof && typeof entry.proof === "object" ? entry.proof : {};
    if (asString(proof.status) !== "ok" || asString(proof.apply_method) !== "field_only_safe_apply") {
      continue;
    }

    const appliedFields = Array.isArray(proof.applied_fields) ? proof.applied_fields : [];
    const afterValues = proof.after_values && typeof proof.after_values === "object" ? proof.after_values : {};
    const safeRenderContext = proof.safe_render_context && typeof proof.safe_render_context === "object" ? proof.safe_render_context : {};
    const effectiveAfter = proof.effective_safe_fields_after
      && proof.effective_safe_fields_after.fields
      && typeof proof.effective_safe_fields_after.fields === "object"
        ? proof.effective_safe_fields_after.fields
        : {};

    latestApply = {
      apply_id: asString(proof.apply_id) || null,
      apply_method: "field_only_safe_apply",
      proof_path: entry.proofPath,
      applied_fields: appliedFields.slice()
    };

    for (const fieldKey of appliedFields) {
      if (!STATE_APPLY_ALLOWLIST.includes(fieldKey)) {
        continue;
      }

      const effectiveEntry = effectiveAfter[fieldKey] && typeof effectiveAfter[fieldKey] === "object"
        ? effectiveAfter[fieldKey]
        : null;
      const value = asString(afterValues[fieldKey])
        || asString(effectiveEntry && effectiveEntry.value)
        || asString(safeRenderContext[fieldKey])
        || asString(proof.personalization && proof.personalization.fields && proof.personalization.fields[fieldKey]);

      if (!value) {
        continue;
      }

      fieldMap[fieldKey] = {
        value,
        source: "safe_field_apply",
        protected: false,
        last_apply_id: asString(proof.apply_id) || null,
        last_proof_path: entry.proofPath
      };
    }
  }

  return {
    fieldMap,
    latestApply
  };
}

function buildEffectiveSafeFields(previousState, personalization, userOverrides, personalizationFieldMap, fieldOnlyApplyMeta, homeHtmlBody, warnings) {
  const previousEffective = previousState
    && previousState.effective_safe_fields
    && previousState.effective_safe_fields.fields
    && typeof previousState.effective_safe_fields.fields === "object"
      ? previousState.effective_safe_fields.fields
      : {};
  const effectiveFields = {};
  const effectiveWarnings = [];

  for (const fieldKey of STATE_APPLY_ALLOWLIST) {
    const override = userOverrides && typeof userOverrides === "object" ? userOverrides[fieldKey] : null;
    const applyMeta = fieldOnlyApplyMeta && fieldOnlyApplyMeta.fieldMap ? fieldOnlyApplyMeta.fieldMap[fieldKey] : null;
    const personalizationValue = asString(personalization && personalization.fields && personalization.fields[fieldKey]);
    const personalizationMeta = personalizationFieldMap ? personalizationFieldMap[fieldKey] : null;
    const previousEntry = previousEffective[fieldKey] && typeof previousEffective[fieldKey] === "object"
      ? previousEffective[fieldKey]
      : {};

    let value = "";
    let source = "unknown";
    let protectedField = false;
    let lastApplyId = null;
    let lastProofPath = null;
    let overwritePolicy = null;
    let lastOverwriteConfirmation = null;

    if (override && override.protected === true && asString(override.value)) {
      value = asString(override.value);
      source = normalizeEffectiveFieldSource(override.source);
      protectedField = true;
      overwritePolicy = asString(override.overwrite_policy) || "ask_before_overwrite";
      lastOverwriteConfirmation = override.last_overwrite_confirmation && typeof override.last_overwrite_confirmation === "object"
        ? override.last_overwrite_confirmation
        : null;
      lastApplyId = lastOverwriteConfirmation && asString(lastOverwriteConfirmation.proof_id)
        ? asString(lastOverwriteConfirmation.proof_id)
        : (applyMeta && applyMeta.last_apply_id ? applyMeta.last_apply_id : (asString(previousEntry.last_apply_id) || null));
      lastProofPath = lastOverwriteConfirmation && asString(lastOverwriteConfirmation.proof_path)
        ? asString(lastOverwriteConfirmation.proof_path)
        : (asString(override.manifest) || (applyMeta && applyMeta.last_proof_path) || asString(previousEntry.last_proof_path) || null);
    } else if (applyMeta && asString(applyMeta.value)) {
      value = asString(applyMeta.value);
      source = "safe_field_apply";
      protectedField = false;
      lastApplyId = applyMeta.last_apply_id || null;
      lastProofPath = applyMeta.last_proof_path || null;
    } else if (personalizationValue) {
      value = personalizationValue;
      source = normalizeEffectiveFieldSource(personalization && personalization.source);
      protectedField = false;
      lastApplyId = personalizationMeta && personalizationMeta.proof_id ? personalizationMeta.proof_id : null;
      lastProofPath = personalizationMeta && personalizationMeta.proof_path ? personalizationMeta.proof_path : null;
    }

    let renderedCheck = "not_checked";
    if (value && typeof homeHtmlBody === "string") {
      renderedCheck = renderedHtmlContainsValue(homeHtmlBody, value) ? "present" : "missing";
    }

    effectiveFields[fieldKey] = {
      value,
      source,
      protected: protectedField,
      rendered_check: renderedCheck,
      last_apply_id: lastApplyId,
      last_proof_path: lastProofPath
    };

    if (overwritePolicy) {
      effectiveFields[fieldKey].overwrite_policy = overwritePolicy;
    }

    if (lastOverwriteConfirmation) {
      effectiveFields[fieldKey].last_overwrite_confirmation = lastOverwriteConfirmation;
    }

    if (renderedCheck === "missing" && value) {
      effectiveWarnings.push("Effective field " + fieldKey + " is not present in Home HTML.");
    }

    if (
      personalizationValue
      && value
      && personalizationValue !== value
      && source !== "personalization"
    ) {
      effectiveWarnings.push(
        "Personalization for " + fieldKey + " differs from the current effective value because the active source is " + source + "."
      );
    }
  }

  if (typeof homeHtmlBody !== "string") {
    effectiveWarnings.push("Home HTML render checks were not available during state refresh.");
  }

  warnings.push(...effectiveWarnings);

  return {
    source: "state_refresh",
    updated_at: stateNow(),
    latest_apply_method: fieldOnlyApplyMeta && fieldOnlyApplyMeta.latestApply
      ? fieldOnlyApplyMeta.latestApply.apply_method
      : null,
    latest_apply_id: fieldOnlyApplyMeta && fieldOnlyApplyMeta.latestApply
      ? fieldOnlyApplyMeta.latestApply.apply_id
      : null,
    latest_apply_proof_path: fieldOnlyApplyMeta && fieldOnlyApplyMeta.latestApply
      ? fieldOnlyApplyMeta.latestApply.proof_path
      : null,
    last_applied_fields: fieldOnlyApplyMeta && fieldOnlyApplyMeta.latestApply && Array.isArray(fieldOnlyApplyMeta.latestApply.applied_fields)
      ? fieldOnlyApplyMeta.latestApply.applied_fields
      : [],
    fields: effectiveFields,
    warnings: Array.from(new Set(effectiveWarnings))
  };
}

function summarizeEffectiveSafeFields(effectiveSafeFields) {
  const fields = effectiveSafeFields && effectiveSafeFields.fields && typeof effectiveSafeFields.fields === "object"
    ? effectiveSafeFields.fields
    : {};
  return STATE_APPLY_ALLOWLIST
    .map((fieldKey) => {
      const entry = fields[fieldKey] && typeof fields[fieldKey] === "object" ? fields[fieldKey] : null;
      if (!entry || !asString(entry.value)) {
        return null;
      }

      return {
        field_key: fieldKey,
        value: asString(entry.value),
        source: asString(entry.source) || "unknown",
        protected: entry.protected === true,
        rendered_check: asString(entry.rendered_check) || "not_checked",
        last_apply_id: asString(entry.last_apply_id) || null,
        last_proof_path: asString(entry.last_proof_path) || null
      };
    })
    .filter(Boolean);
}

function selectEffectiveSafeFieldEntries(effectiveSafeFields, fieldKeys) {
  const fields = effectiveSafeFields && effectiveSafeFields.fields && typeof effectiveSafeFields.fields === "object"
    ? effectiveSafeFields.fields
    : {};
  const selected = {};

  for (const fieldKey of Array.from(new Set(fieldKeys || []))) {
    if (!STATE_APPLY_ALLOWLIST.includes(fieldKey)) {
      continue;
    }

    if (fields[fieldKey] && typeof fields[fieldKey] === "object") {
      selected[fieldKey] = fields[fieldKey];
    }
  }

  return selected;
}

function parseFrontendSafeEditOverrides(runtimePath, warnings) {
  const runsPath = resolveAgentRunsDirectory(runtimePath);
  const overrides = {};

  if (!fs.existsSync(runsPath)) {
    warnings.push("Frontend safe edit manifest scan skipped because runs directory is missing.");
    return overrides;
  }

  const entries = fs.readdirSync(runsPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const filePath = path.join(runsPath, entry.name);
      return {
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs
      };
    })
    .sort((left, right) => left.mtimeMs - right.mtimeMs);

  for (const entry of entries) {
    let manifest;
    try {
      manifest = safeJsonRead(entry.filePath);
    } catch (error) {
      warnings.push("Could not parse manifest " + path.basename(entry.filePath) + ".");
      continue;
    }

    const applySource = asString(manifest.apply_source);
    const frontendSafeEdit = manifest.frontend_safe_edit && typeof manifest.frontend_safe_edit === "object"
      ? manifest.frontend_safe_edit
      : null;
    const fields = frontendSafeEdit && frontendSafeEdit.fields && typeof frontendSafeEdit.fields === "object"
      ? frontendSafeEdit.fields
      : null;

    if (applySource !== "frontend_safe_edit" && !fields) {
      continue;
    }

    if (!fields) {
      warnings.push("Frontend safe edit manifest " + path.basename(entry.filePath) + " did not expose parseable fields.");
      continue;
    }

    for (const [fieldKey, fieldState] of Object.entries(fields)) {
      if (!fieldState || typeof fieldState !== "object") {
        continue;
      }

      overrides[fieldKey] = {
        source: "frontend_safe_edit",
        protected: true,
        field_key: fieldKey,
        before: asString(fieldState.before_value) || "",
        after: asString(fieldState.after_value) || "",
        value: asString(fieldState.after_value) || asString(fieldState.value) || "",
        manifest: entry.filePath,
        updated_at: asString(manifest.timestamp) || new Date(entry.mtimeMs).toISOString(),
        overwrite_policy: "ask_before_overwrite"
      };
    }
  }

  return overrides;
}

function mergeConfirmedOverwriteOverrides(runtimePath, overrides, warnings) {
  const proofsPath = path.join(runtimePath, "proofs");
  if (!fs.existsSync(proofsPath)) {
    return overrides;
  }

  const candidates = fs.readdirSync(proofsPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith("state-apply-") && entry.name.endsWith(".json"))
    .map((entry) => {
      const filePath = path.join(proofsPath, entry.name);
      return {
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  let applyProof = null;
  let applyProofPath = null;
  let overwrittenFields = [];

  for (const candidate of candidates) {
    try {
      const parsed = safeJsonRead(candidate.filePath);
      const confirmation = parsed && parsed.confirmation && typeof parsed.confirmation === "object"
        ? parsed.confirmation
        : null;
      const candidateFields = confirmation && confirmation.confirmed === true
        ? normalizeConfirmationFieldRequests(confirmation.overwritten_protected_fields)
        : [];
      if (parsed && parsed.status === "ok" && candidateFields.length) {
        applyProof = parsed;
        applyProofPath = candidate.filePath;
        overwrittenFields = candidateFields;
        break;
      }
    } catch (error) {
      warnings.push("Confirmed overwrite merge skipped one unreadable state apply proof.");
    }
  }

  if (!applyProof || !overwrittenFields.length) {
    return overrides;
  }

  const afterValues = applyProof.after_values && typeof applyProof.after_values === "object"
    ? applyProof.after_values
    : {};
  const safeRenderContext = applyProof.safe_render_context && typeof applyProof.safe_render_context === "object"
    ? applyProof.safe_render_context
    : {};
  const personalizationFields = applyProof.personalization
    && applyProof.personalization.fields
    && typeof applyProof.personalization.fields === "object"
    ? applyProof.personalization.fields
    : {};
  const beforeValues = applyProof.before_values && typeof applyProof.before_values === "object"
    ? applyProof.before_values
    : {};
  const createdAt = asString(applyProof.created_at) || stateNow();

  for (const fieldKey of overwrittenFields) {
    const nextValue = asString(safeRenderContext[fieldKey]) || asString(personalizationFields[fieldKey]) || asString(afterValues[fieldKey]);
    if (!nextValue) {
      warnings.push("Confirmed overwrite proof did not include an after value for " + fieldKey + ".");
      continue;
    }

    overrides[fieldKey] = Object.assign({}, overrides[fieldKey] || {}, {
      source: "confirmed_overwrite",
      protected: true,
      field_key: fieldKey,
      before: asString(beforeValues[fieldKey]) || asString(overrides[fieldKey] && overrides[fieldKey].before) || "",
      after: nextValue,
      value: nextValue,
      manifest: applyProofPath,
      updated_at: createdAt,
      overwrite_policy: "ask_before_overwrite",
      overwritten_at: createdAt,
      previous_value: asString(beforeValues[fieldKey]) || "",
      last_overwrite_confirmation: {
        proof_path: applyProofPath,
        proof_id: asString(applyProof.apply_id) || null
      }
    });
  }

  return overrides;
}

function buildStateSummary(state, statePath) {
  const userOverrides = state && state.user_overrides && typeof state.user_overrides === "object" ? state.user_overrides : {};
  const protectedFields = Object.values(userOverrides)
    .filter((entry) => entry && entry.protected)
    .map((entry) => entry.field_key);
  const effectiveSafeFields = state && state.effective_safe_fields && typeof state.effective_safe_fields === "object"
    ? state.effective_safe_fields
    : {};
  const effectiveSafeFieldSummary = summarizeEffectiveSafeFields(effectiveSafeFields);

  return {
    schema: state.schema,
    version: state.version,
    generation_status: state.generation && state.generation.status || "unknown",
    last_updated: state.updated_at || null,
    pages: state.resources && state.resources.page_count != null
      ? Number(state.resources.page_count)
      : (Array.isArray(state.resources && state.resources.pages) ? state.resources.pages.length : 0),
    property_count: state.resources && state.resources.post_types && state.resources.post_types.property
      ? state.resources.post_types.property.count
      : 0,
    attachment_count: state.resources && state.resources.attachments ? state.resources.attachments.count : 0,
    personalization_source: state.personalization && state.personalization.source || "unknown",
    personalization_fields: Array.isArray(state.personalization && state.personalization.applied_fields)
      ? state.personalization.applied_fields
      : [],
    user_overrides_count: Object.keys(userOverrides).length,
    protected_fields: protectedFields,
    effective_safe_fields_count: effectiveSafeFieldSummary.length,
    effective_safe_fields: effectiveSafeFieldSummary,
    effective_safe_field_warnings: Array.isArray(effectiveSafeFields.warnings) ? effectiveSafeFields.warnings : [],
    latest_apply_method: asString(effectiveSafeFields.latest_apply_method) || null,
    latest_apply_id: asString(effectiveSafeFields.latest_apply_id) || null,
    last_applied_fields: Array.isArray(effectiveSafeFields.last_applied_fields) ? effectiveSafeFields.last_applied_fields : [],
    drift_status: state.drift && state.drift.status || "unknown",
    state_path: statePath
  };
}

function extractProtectedFields(userOverrides) {
  return Object.values(userOverrides || {})
    .filter((entry) => entry && entry.protected && entry.field_key)
    .map((entry) => entry.field_key);
}

function buildFieldDiffEntry(fieldKey, currentValues, proposedValues, userOverrides) {
  const override = userOverrides && userOverrides[fieldKey] && typeof userOverrides[fieldKey] === "object"
    ? userOverrides[fieldKey]
    : null;
  const currentPersonalizationValue = asString(currentValues && currentValues[fieldKey]);
  const proposedValue = asString(proposedValues && proposedValues[fieldKey]);
  const currentValue = override ? asString(override.value) : currentPersonalizationValue;
  let changeType = "unchanged";

  if (!currentValue && proposedValue) {
    changeType = "add";
  } else if (currentValue && !proposedValue) {
    changeType = "remove";
  } else if (currentValue !== proposedValue) {
    changeType = "update";
  }

  return {
    field_key: fieldKey,
    current_value: currentValue,
    proposed_value: proposedValue,
    effective_value: proposedValue,
    change_type: changeType,
    source: override ? "frontend_safe_edit_override" : "personalization",
    protected: override ? override.protected === true : false,
    included_in_apply: STATE_APPLY_ALLOWLIST.includes(fieldKey) && !!proposedValue && currentValue !== proposedValue,
    excluded_reason: null
  };
}

function normalizeFieldListInput(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => String(entry || "").split(","))
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeOverwriteFieldRequests(value) {
  return Array.from(new Set(
    normalizeFieldListInput(value).filter((fieldKey) => STATE_APPLY_ALLOWLIST.includes(fieldKey))
  ));
}

function buildStatePlan(state, prompt, options) {
  const createdAt = stateNow();
  const planId = "state-plan-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
  const overwriteFieldsRequested = normalizeOverwriteFieldRequests(options && options.overwriteFields);
  const currentPersonalization = state.personalization && typeof state.personalization === "object"
    ? state.personalization
    : {};
  const currentFields = currentPersonalization.fields && typeof currentPersonalization.fields === "object"
    ? currentPersonalization.fields
    : {};
  const userOverrides = state.user_overrides && typeof state.user_overrides === "object"
    ? state.user_overrides
    : {};
  const protectedFields = extractProtectedFields(userOverrides);
  const proposedPersonalization = derivePromptPersonalization(prompt);
  const proposedFields = proposedPersonalization.fields && typeof proposedPersonalization.fields === "object"
    ? proposedPersonalization.fields
    : {};
  const allFieldKeys = Array.from(new Set(
    Object.keys(currentFields)
      .concat(Object.keys(proposedFields))
      .concat(Object.keys(userOverrides))
  )).sort();

  const fieldChanges = [];
  const unchangedFields = [];
  const newFields = [];
  const removedFields = [];
  const conflicts = [];
  const warnings = [];
  const includedFields = [];
  const excludedFields = [];
  const preservedProtectedFields = [];
  const requiresConfirmationFields = [];
  let confirmationRequired = null;

  for (const fieldKey of allFieldKeys) {
    const entry = buildFieldDiffEntry(fieldKey, currentFields, proposedFields, userOverrides);
    const hasProtectedValueChange = entry.protected
      && entry.change_type !== "unchanged"
      && userOverrides[fieldKey]
      && asString(userOverrides[fieldKey].value) !== proposedValueOrEmpty(proposedFields[fieldKey]);
    const overwriteRequested = hasProtectedValueChange && overwriteFieldsRequested.includes(fieldKey);

    if (overwriteRequested) {
      entry.effective_value = proposedValueOrEmpty(proposedFields[fieldKey]);
      entry.change_type = "overwrite_protected_requested";
      entry.included_in_apply = true;
      entry.excluded_reason = null;
      entry.overwrite_policy = "requires_explicit_confirmation";
      includedFields.push(fieldKey);
      requiresConfirmationFields.push(fieldKey);
      warnings.push(
        "Protected field " + fieldKey + " is included in apply scope only after explicit overwrite confirmation."
      );
    } else if (hasProtectedValueChange) {
      entry.effective_value = asString(userOverrides[fieldKey].value);
      entry.change_type = "preserve_protected";
      entry.included_in_apply = false;
      entry.excluded_reason = "protected_user_override_preserved";
      preservedProtectedFields.push(fieldKey);
      excludedFields.push(fieldKey);
      warnings.push("Protected field " + fieldKey + " is preserved by default and excluded from apply scope.");
    } else if (entry.change_type === "unchanged") {
      entry.included_in_apply = false;
    } else if (STATE_APPLY_ALLOWLIST.includes(fieldKey) && asString(entry.effective_value)) {
      entry.included_in_apply = true;
      includedFields.push(fieldKey);
    } else {
      entry.included_in_apply = false;
      if (!STATE_APPLY_ALLOWLIST.includes(fieldKey)) {
        entry.excluded_reason = "unsupported_field";
        excludedFields.push(fieldKey);
      } else if (!asString(entry.effective_value)) {
        entry.excluded_reason = "empty_or_unsupported_value";
        excludedFields.push(fieldKey);
      }
    }

    if (entry.change_type === "unchanged") {
      unchangedFields.push(entry.field_key);
    } else {
      fieldChanges.push(entry);
      if (entry.change_type === "add") {
        newFields.push(entry.field_key);
      }
      if (entry.change_type === "remove") {
        removedFields.push(entry.field_key);
      }
    }

  }

  if (Array.isArray(currentPersonalization.warnings) && currentPersonalization.warnings.length) {
    warnings.push.apply(warnings, currentPersonalization.warnings);
  }
  if (Array.isArray(proposedPersonalization.warnings) && proposedPersonalization.warnings.length) {
    warnings.push.apply(warnings, proposedPersonalization.warnings);
  }
  warnings.push("Plan/diff is read-only in State v1.");

  if (requiresConfirmationFields.length) {
    confirmationRequired = {
      required: true,
      fields: Array.from(new Set(requiresConfirmationFields)),
      reason: "protected_user_override_overwrite_requested",
      message: "Protected field " + Array.from(new Set(requiresConfirmationFields)).join(", ")
        + " will be overwritten only if explicitly confirmed."
    };
  }

  return {
    schema: STATE_PLAN_SCHEMA,
    version: STATE_PLAN_VERSION,
    plan_id: planId,
    project_slug: state.project_slug,
    wp_url: state.wp_url,
    created_at: createdAt,
    applies_changes: false,
    provider_called: false,
    source: {
      state_path: null,
      current_state_updated_at: state.updated_at || null,
      prompt_personalization_source: proposedPersonalization.source || "local_interpreter"
    },
    prompt: String(prompt || ""),
    current: {
      personalization: currentFields,
      user_overrides: userOverrides,
      protected_fields: protectedFields
    },
    proposed: {
      personalization: proposedFields,
      design_profile: proposedPersonalization.design_profile && typeof proposedPersonalization.design_profile === "object"
        ? proposedPersonalization.design_profile
        : {}
    },
    diff: {
      field_changes: fieldChanges,
      unchanged_fields: unchangedFields,
      new_fields: newFields,
      removed_fields: removedFields
    },
    field_scope: {
      mode: "preserve_protected_by_default",
      included_fields: Array.from(new Set(includedFields)),
      excluded_fields: Array.from(new Set(excludedFields)),
      preserved_protected_fields: Array.from(new Set(preservedProtectedFields)),
      requires_confirmation_fields: Array.from(new Set(requiresConfirmationFields))
    },
    conflicts,
    preservation: {
      protected_fields_preserved: preservedProtectedFields.length > 0,
      requires_user_confirmation: Boolean(confirmationRequired) || conflicts.length > 0
    },
    can_apply_without_confirmation: conflicts.length === 0 && !confirmationRequired,
    confirmation_required: confirmationRequired,
    warnings: Array.from(new Set(warnings))
  };
}

function proposedValueOrEmpty(value) {
  return asString(value);
}

async function buildState(projectState) {
  const warnings = [];
  const runtimePath = projectState.runtimePath;
  const currentStatePath = path.join(runtimePath, "state", "current.json");
  const previousState = fs.existsSync(currentStatePath) ? safeJsonRead(currentStatePath) : null;
  const personalizationProofEntries = findPersonalizationProofEntries(projectState, runtimePath);
  const generateProofEntry = personalizationProofEntries
    .filter((entry) => path.basename(entry.proofPath).startsWith("generate-"))
    .slice(-1)[0] || null;
  const latestPersonalizationProofEntry = personalizationProofEntries.length
    ? personalizationProofEntries[personalizationProofEntries.length - 1]
    : null;
  const generateProof = generateProofEntry ? generateProofEntry.proof : null;
  const latestAgentManifest = findLatestAgentManifest(runtimePath, generateProof, warnings);
  const proofStem = "state-refresh-" + timestampCompact();
  let homeHtmlBody = null;

  const pages = await readManagedPages(runtimePath, proofStem, warnings);
  const fallbackCounts = generateProof && generateProof.after_counts ? generateProof.after_counts : {};
  const propertyCount = await countPostType(runtimePath, proofStem, "property", warnings);
  const attachmentCount = await countPostType(runtimePath, proofStem, "attachment", warnings);
  const pageCount = await countPostType(runtimePath, proofStem, "page", warnings);

  try {
    homeHtmlBody = (await readHomeHtml(projectState.project.wp_url)).body;
  } catch (error) {
    warnings.push("Home HTML render check failed during state refresh: " + error.message);
  }

  const resources = {
    pages,
    post_types: {
      property: {
        count: propertyCount != null ? propertyCount : Number(fallbackCounts.properties || 0),
        factory_owned: true,
        management_scope: "factory_generated_content"
      }
    },
    attachments: {
      count: attachmentCount != null ? attachmentCount : Number(fallbackCounts.attachments || 0),
      factory_owned: true,
      management_scope: "factory_generated_media"
    },
    page_count: pageCount != null ? pageCount : Number(fallbackCounts.pages || 0)
  };

  const userOverrides = mergeConfirmedOverwriteOverrides(
    runtimePath,
    parseFrontendSafeEditOverrides(runtimePath, warnings),
    warnings
  );
  const personalizationFieldMap = buildLatestPersonalizationFieldMap(personalizationProofEntries);
  const fieldOnlyApplyMeta = buildLatestFieldOnlyApplyFieldMap(runtimePath, warnings);
  let personalization = {
    source: "unknown",
    provider_called: false,
    fields: {},
    design_profile: {},
    applied_fields: [],
    ignored_fields: [],
    warnings: []
  };

  for (const entry of personalizationProofEntries) {
    personalization = mergeEffectivePersonalization({ personalization }, extractPersonalization(entry.proof), {});
  }

  personalization = mergeEffectivePersonalization(previousState, personalization, {});
  const effectiveSafeFields = buildEffectiveSafeFields(
    previousState,
    personalization,
    userOverrides,
    personalizationFieldMap,
    fieldOnlyApplyMeta,
    homeHtmlBody,
    warnings
  );

  const state = {
    schema: STATE_SCHEMA,
    version: STATE_VERSION,
    project_slug: projectState.project.slug,
    project_id: projectState.project.project_id,
    wp_url: projectState.project.wp_url,
    created_at: stateNow(),
    updated_at: stateNow(),
    source: {
      latest_generate_proof: generateProofEntry ? generateProofEntry.proofPath : null,
      latest_personalization_proof: latestPersonalizationProofEntry ? latestPersonalizationProofEntry.proofPath : null,
      latest_agent_manifest: latestAgentManifest
    },
    generation: {
      status: asString(projectState.project.generation && projectState.project.generation.status) || "unknown",
      last_run_id: asString(projectState.project.generation && projectState.project.generation.last_generate_run_id)
        || asString(projectState.project.current_run_id)
        || null,
      last_generate_proof_id: asString(projectState.project.generation && projectState.project.generation.last_proof_id) || null,
      preset: "real_estate"
    },
    ownership: buildOwnershipRecord(resources),
    resources,
    personalization,
    user_overrides: userOverrides,
    effective_safe_fields: effectiveSafeFields,
    drift: {
      status: "not_checked",
      warnings: ["Drift detection is not implemented in State v1."]
    },
    warnings
  };

  return state;
}

async function refreshState(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  const safeRuntimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const statePaths = ensureStatePaths(safeRuntimePath);
  const createdAt = stateNow();
  const proofId = "state-refresh-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
  const state = await buildState(projectState);

  state.created_at = fs.existsSync(statePaths.currentPath)
    ? (safeJsonRead(statePaths.currentPath).created_at || createdAt)
    : createdAt;
  state.updated_at = createdAt;

  projectState.project.generated_site = Object.assign(
    {},
    defaultGeneratedSiteMetadata(),
    projectState.project.generated_site || {},
    {
      personalization_last_applied: state.personalization
    }
  );
  saveProjectRecord(projectState, projectState.project);

  const snapshotPath = path.join(statePaths.snapshotsPath, "state-" + timestampCompact() + ".json");
  writeJsonFile(statePaths.currentPath, state);
  writeJsonFile(snapshotPath, state);

  const proof = {
    proof_id: proofId,
    project_id: projectState.project.project_id,
    slug: projectState.project.slug,
    wp_url: projectState.project.wp_url,
    state_path: statePaths.currentPath,
    snapshot_path: snapshotPath,
    summary: buildStateSummary(state, statePaths.currentPath),
    effective_safe_fields: state.effective_safe_fields || null,
    applies_changes: false,
    mutation_scope: "launcher_project_metadata_only",
    created_at: createdAt,
    warnings: state.warnings
  };
  const proofPath = path.join(safeRuntimePath, "proofs", proofId + ".json");
  writeJsonFile(proofPath, proof);

  return {
    project: projectState.project,
    state,
    statePath: statePaths.currentPath,
    snapshotPath,
    proof,
    proofPath,
    summary: buildStateSummary(state, statePaths.currentPath)
  };
}

function readStateStatus(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  const safeRuntimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const statePaths = ensureStatePaths(safeRuntimePath);
  const exists = fs.existsSync(statePaths.currentPath);

  if (!exists) {
    return {
      project: projectState.project,
      exists: false,
      statePath: statePaths.currentPath,
      summary: null,
      warnings: ["Managed state has not been refreshed yet."]
    };
  }

  const state = safeJsonRead(statePaths.currentPath);
  const warnings = []
    .concat(Array.isArray(state.warnings) ? state.warnings : [])
    .concat(
      state.effective_safe_fields && Array.isArray(state.effective_safe_fields.warnings)
        ? state.effective_safe_fields.warnings
        : []
    );
  return {
    project: projectState.project,
    exists: true,
    statePath: statePaths.currentPath,
    state,
    summary: buildStateSummary(state, statePaths.currentPath),
    warnings: Array.from(new Set(warnings)),
    rollback: buildRollbackUiSummary(statePaths, state)
  };
}

function planState(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  const safeRuntimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const statePaths = ensureStatePaths(safeRuntimePath);
  const prompt = String(options.prompt || "").trim();

  if (!prompt) {
    throw new Error("state plan requires a non-empty --prompt value.");
  }

  if (!fs.existsSync(statePaths.currentPath)) {
    throw new Error(
      "Managed state is missing. Run: node launcher/src/cli.js state --slug " +
      projectState.project.slug +
      " refresh"
    );
  }

  const state = safeJsonRead(statePaths.currentPath);
  const plan = buildStatePlan(state, prompt, {
    overwriteFields: options.overwriteFields
  });
  plan.source.state_path = statePaths.currentPath;

  const planPath = path.join(statePaths.plansPath, "state-plan-" + timestampCompact() + ".json");
  const proofId = "state-plan-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
  const proofPath = path.join(safeRuntimePath, "proofs", proofId + ".json");
  const protectedFields = Array.isArray(plan.current.protected_fields) ? plan.current.protected_fields : [];
  const fieldScope = plan.field_scope && typeof plan.field_scope === "object" ? plan.field_scope : {
    mode: "preserve_protected_by_default",
    included_fields: [],
    excluded_fields: [],
    preserved_protected_fields: [],
    requires_confirmation_fields: []
  };
  const appliedFieldKeys = Array.isArray(fieldScope.included_fields) ? fieldScope.included_fields : [];
  const proof = {
    proof_id: proofId,
    project_id: projectState.project.project_id,
    slug: projectState.project.slug,
    wp_url: projectState.project.wp_url,
    state_path: statePaths.currentPath,
    plan_id: plan.plan_id,
    prompt_personalization: {
      source: plan.source.prompt_personalization_source,
      provider_called: false,
      fields: plan.proposed.personalization,
      design_profile: plan.proposed.design_profile,
      applied_fields: appliedFieldKeys
    },
    diff_summary: {
      field_changes: plan.diff.field_changes.length,
      unchanged_fields: plan.diff.unchanged_fields.length,
      new_fields: plan.diff.new_fields.length,
      removed_fields: plan.diff.removed_fields.length
    },
    field_scope: fieldScope,
    preserved_protected_fields: Array.isArray(fieldScope.preserved_protected_fields) ? fieldScope.preserved_protected_fields : [],
    excluded_fields: Array.isArray(fieldScope.excluded_fields) ? fieldScope.excluded_fields : [],
    included_fields: appliedFieldKeys,
    conflicts: plan.conflicts,
    protected_fields: protectedFields,
    requires_user_confirmation: plan.preservation.requires_user_confirmation,
    can_apply_without_confirmation: plan.can_apply_without_confirmation,
    confirmation_required: plan.confirmation_required || null,
    applies_changes: false,
    provider_called: false,
    no_wp_mutation: true,
    mutation_scope: "launcher_project_metadata_only",
    created_at: plan.created_at,
    warnings: plan.warnings
  };

  writeJsonFile(planPath, plan);
  writeJsonFile(proofPath, proof);

  return {
    project: projectState.project,
    statePath: statePaths.currentPath,
    plan,
    planPath,
    proof,
    proofPath
  };
}

function toBooleanTrue(value) {
  return value === true || value === "true";
}

function resolveStatePlanPath(statePaths, runtimePath, planPathValue) {
  const raw = asString(planPathValue);
  if (!raw || raw === "latest") {
    const latestPath = findLatestMatchingFile(statePaths.plansPath, "state-plan-", ".json");
    if (!latestPath) {
      throw new Error("No state plan files were found. Run state plan first.");
    }
    return latestPath;
  }

  if (path.isAbsolute(raw)) {
    return raw;
  }

  return path.resolve(runtimePath, raw);
}

function buildBlockedApplyProof(projectState, reason, code, conflicts, statePath) {
  const createdAt = stateNow();
  return {
    schema: STATE_APPLY_SCHEMA,
    version: STATE_APPLY_VERSION,
    apply_id: "state-apply-blocked-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex"),
    project_slug: projectState.project.slug,
    wp_url: projectState.project.wp_url,
    created_at: createdAt,
    plan_id: null,
    plan_path: null,
    applies_changes: false,
    provider_called: false,
    status: "blocked",
    code,
    blocked: true,
    reason,
    applied_fields: [],
    ignored_fields: [],
    preserved_protected_fields: [],
    conflicts: Array.isArray(conflicts) ? conflicts : [],
    confirmation: {
      required: false,
      confirmed: false,
      required_fields: []
    },
    before_values: {},
    after_values: {},
    agent_manifest: null,
    state_before_path: statePath || null,
    state_after_path: statePath || null,
    warnings: [],
    no_wp_mutation: true,
    mutation_scope: "launcher_project_metadata_only"
  };
}

function normalizeConfirmationFieldRequests(value) {
  return Array.from(new Set(
    normalizeFieldListInput(value).filter((fieldKey) => STATE_APPLY_ALLOWLIST.includes(fieldKey))
  ));
}

function buildBlockedRollbackProof(projectState, reason, code, conflicts, statePath, sourceApplyId, sourceApplyPath) {
  return {
    schema: STATE_ROLLBACK_SCHEMA,
    version: STATE_ROLLBACK_VERSION,
    rollback_id: "state-rollback-blocked-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex"),
    project_slug: projectState.project.slug,
    wp_url: projectState.project.wp_url,
    created_at: stateNow(),
    source_apply_id: sourceApplyId || null,
    source_apply_path: sourceApplyPath || null,
    state_before_rollback_path: statePath || null,
    target_previous_state_path: null,
    state_after_rollback_path: statePath || null,
    applies_changes: false,
    provider_called: false,
    status: "blocked",
    code,
    blocked: true,
    reason,
    rollback_fields: {},
    applied_fields: [],
    ignored_fields: [],
    preserved_protected_fields: [],
    protected_conflicts: Array.isArray(conflicts) ? conflicts : [],
    before_values: {},
    after_values: {},
    agent_manifest: null,
    warnings: [],
    no_wp_mutation: true,
    mutation_scope: "launcher_project_metadata_only"
  };
}

function deriveEffectiveCurrentValues(state) {
  const effectiveSafeFields = state && state.effective_safe_fields && state.effective_safe_fields.fields && typeof state.effective_safe_fields.fields === "object"
    ? state.effective_safe_fields.fields
    : null;
  const personalizationFields = state.personalization && state.personalization.fields && typeof state.personalization.fields === "object"
    ? state.personalization.fields
    : {};
  const values = {};

  for (const key of STATE_APPLY_ALLOWLIST) {
    if (effectiveSafeFields && effectiveSafeFields[key] && typeof effectiveSafeFields[key] === "object") {
      values[key] = asString(effectiveSafeFields[key].value);
    } else {
      values[key] = asString(personalizationFields[key]);
    }
  }

  return values;
}

function derivePersonalizationValues(state) {
  const fields = state && state.personalization && state.personalization.fields && typeof state.personalization.fields === "object"
    ? state.personalization.fields
    : {};
  const values = {};

  for (const key of STATE_APPLY_ALLOWLIST) {
    values[key] = asString(fields[key]);
  }

  return values;
}

function normalizePlanFieldScope(plan) {
  const fieldScope = plan && plan.field_scope && typeof plan.field_scope === "object" ? plan.field_scope : {};
  return {
    mode: asString(fieldScope.mode) || "preserve_protected_by_default",
    included_fields: Array.isArray(fieldScope.included_fields)
      ? fieldScope.included_fields.filter((fieldKey) => STATE_APPLY_ALLOWLIST.includes(fieldKey))
      : [],
    excluded_fields: Array.isArray(fieldScope.excluded_fields)
      ? fieldScope.excluded_fields.filter((fieldKey) => typeof fieldKey === "string")
      : [],
    preserved_protected_fields: Array.isArray(fieldScope.preserved_protected_fields)
      ? fieldScope.preserved_protected_fields.filter((fieldKey) => STATE_APPLY_ALLOWLIST.includes(fieldKey))
      : [],
    requires_confirmation_fields: Array.isArray(fieldScope.requires_confirmation_fields)
      ? fieldScope.requires_confirmation_fields.filter((fieldKey) => typeof fieldKey === "string")
      : []
  };
}

function buildApplyIntentFields(plan, normalizedFieldScope) {
  const proposed = plan && plan.proposed && plan.proposed.personalization && typeof plan.proposed.personalization === "object"
    ? plan.proposed.personalization
    : {};
  const applyIntentFields = {};

  for (const fieldKey of normalizedFieldScope.included_fields) {
    const value = asString(proposed[fieldKey]);
    if (value) {
      applyIntentFields[fieldKey] = value;
    }
  }

  return applyIntentFields;
}

function buildEffectiveRenderContext(state, plan, normalizedFieldScope) {
  const currentValues = deriveEffectiveCurrentValues(state);
  const applyIntentFields = buildApplyIntentFields(plan, normalizedFieldScope);
  const safeRenderContext = {};
  const preservedRenderValues = {};
  const missingPreservedFields = [];

  for (const fieldKey of STATE_APPLY_ALLOWLIST) {
    if (Object.prototype.hasOwnProperty.call(applyIntentFields, fieldKey)) {
      safeRenderContext[fieldKey] = asString(applyIntentFields[fieldKey]);
      continue;
    }

    if (normalizedFieldScope.preserved_protected_fields.includes(fieldKey)) {
      const preservedValue = asString(currentValues[fieldKey]);
      if (!preservedValue) {
        missingPreservedFields.push(fieldKey);
        continue;
      }
      safeRenderContext[fieldKey] = preservedValue;
      preservedRenderValues[fieldKey] = preservedValue;
      continue;
    }

    const currentValue = asString(currentValues[fieldKey]);
    if (currentValue) {
      safeRenderContext[fieldKey] = currentValue;
    }
  }

  if (missingPreservedFields.length) {
    const blockedError = new Error(
      "Missing preserved render value for protected field(s): " + missingPreservedFields.join(", ")
    );
    blockedError.blockedCode = "state_plan_missing_preserved_render_value";
    blockedError.blockedConflicts = missingPreservedFields.map((fieldKey) => ({
      type: "missing_preserved_render_value",
      severity: "blocked",
      field_key: fieldKey,
      message: "Protected field " + fieldKey + " is excluded from apply but has no effective render value."
    }));
    throw blockedError;
  }

  return {
    applyIntentFields,
    safeRenderContext,
    renderContextFields: Object.keys(safeRenderContext),
    preservedRenderValues
  };
}

function buildPromptPersonalization(fields, designProfile, source) {
  const safeFields = {};
  for (const key of STATE_APPLY_ALLOWLIST) {
    if (Object.prototype.hasOwnProperty.call(fields || {}, key)) {
      safeFields[key] = asString(fields[key]);
    }
  }

  return {
    source: asString(source) || "local_interpreter",
    applies_changes: true,
    provider_called: false,
    fields: safeFields,
    design_profile: designProfile && typeof designProfile === "object" ? designProfile : {},
    warnings: []
  };
}

function resolveStateApplyMethod(plan, normalizedFieldScope) {
  if (!plan || typeof plan !== "object") {
    return {
      method: "unsupported",
      reason: "missing_plan"
    };
  }

  if (!plan.field_scope || typeof plan.field_scope !== "object") {
    return {
      method: "unsupported",
      reason: "missing_field_scope"
    };
  }

  const includedFields = Array.isArray(normalizedFieldScope && normalizedFieldScope.included_fields)
    ? normalizedFieldScope.included_fields
    : [];

  if (!includedFields.length) {
    return {
      method: "unsupported",
      reason: "no_included_fields"
    };
  }

  const unsupported = includedFields.filter((fieldKey) => !STATE_APPLY_ALLOWLIST.includes(fieldKey));
  if (unsupported.length) {
    return {
      method: "unsupported",
      reason: "unsupported_included_fields",
      fields: unsupported
    };
  }

  return {
    method: "field_only_safe_apply",
    reason: "safe_allowlist_only"
  };
}

async function getAgentJson(projectState, targetUrl, proofId, warnings) {
  try {
    if (!projectState.env.WP_APP_PASSWORD) {
      throw new Error("Launcher project is missing a stored application password.");
    }

    return await fetchJsonWithBasicAuth(targetUrl, projectState.env.WP_ADMIN_USER, projectState.env.WP_APP_PASSWORD);
  } catch (error) {
    if (!shouldFallbackToCookieAuth(error)) {
      throw error;
    }

    const cookieHeader = await loginWithAdminCookie(projectState);
    const restNonce = await createRestNonce(projectState, proofId);
    warnings.push("State apply auth fell back to admin cookie context.");
    return fetchJsonWithCookie(targetUrl, cookieHeader, restNonce);
  }
}

async function postAgentJson(projectState, targetUrl, payload, proofId, warnings) {
  const requestBody = JSON.stringify(payload);
  const requestTimeoutMs = payload && payload.execute ? 300000 : 120000;

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
      body: requestBody,
      timeoutMs: requestTimeoutMs
    });
  } catch (error) {
    if (!shouldFallbackToCookieAuth(error)) {
      throw error;
    }

    const cookieHeader = await loginWithAdminCookie(projectState);
    const restNonce = await createRestNonce(projectState, proofId);
    warnings.push("State apply auth fell back to admin cookie context.");
    return fetchJsonWithCookie(targetUrl, cookieHeader, restNonce, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody)
      },
      body: requestBody,
      timeoutMs: requestTimeoutMs
    });
  }
}

async function readRuntimeCounts(projectState, proofStem, warnings) {
  return {
    pages: await countPostType(projectState.runtimePath, proofStem, "page", warnings),
    properties: await countPostType(projectState.runtimePath, proofStem, "property", warnings),
    attachments: await countPostType(projectState.runtimePath, proofStem, "attachment", warnings),
    active_theme: await readWpJson(projectState.runtimePath, proofStem, "wp_get_theme()->get_stylesheet()", "state-apply-active-theme")
  };
}

async function readHomeHtml(targetUrl) {
  const response = await requestJson(targetUrl, {
    method: "GET",
    headers: {
      Accept: "text/html"
    },
    timeoutMs: 30000
  });

  return {
    statusCode: response.statusCode,
    body: response.body
  };
}

async function rerunPlanningChain(projectState, prompt, promptPersonalization, proofId, warnings) {
  const restBase = String(projectState.project.agent && projectState.project.agent.rest_base || "");
  const context = buildPlanningContextFromPersonalization(promptPersonalization);
  const results = {};

  for (const stage of STAGE_DEFINITIONS) {
    const endpoint = restBase + stage.route;
    const payload = stage.buildPayload({
      prompt,
      context
    }, results);
    const response = await postAgentJson(projectState, endpoint, payload, proofId, warnings);
    const data = response.json || {};

    if (toBooleanTrue(data.applies_changes)) {
      throw new Error("Read-only contract violation at " + stage.name + ": applies_changes=true");
    }

    if (toBooleanTrue(data.provider_called)) {
      throw new Error("Read-only planning stage " + stage.name + " unexpectedly reported provider_called=true.");
    }

    results[stage.name] = data;
  }

  return {
    context,
    results
  };
}

async function validateStateApplyPreconditions(projectState, proofId, warnings) {
  if ((projectState.project.runtime && projectState.project.runtime.status) !== "provisioned") {
    throw new Error("Launcher project must be provisioned before state apply.");
  }

  if ((projectState.project.agent && projectState.project.agent.status) !== "installed") {
    throw new Error("Site Factory Agent must be installed before state apply.");
  }

  await waitForUrl(projectState.project.wp_url);

  const restBase = asString(projectState.project.agent && projectState.project.agent.rest_base);
  if (!restBase) {
    throw new Error("Launcher project is missing agent.rest_base.");
  }

  const health = (await getAgentJson(projectState, restBase + "/agent/health", proofId, warnings)).json || {};
  if (asString(health.status) !== "ok") {
    throw new Error("Agent health check did not return ok.");
  }

  const capabilities = (await getAgentJson(projectState, restBase + "/agent/capabilities", proofId, warnings)).json || {};
  if (!capabilities.capabilities || capabilities.capabilities.controlled_generate !== true) {
    throw new Error("Agent capabilities do not advertise controlled_generate=true.");
  }

  const dependencyStatus = await fetchDependencyStatus(projectState, warnings);
  if (!dependencyStatus.summary.can_generate || dependencyStatus.summary.blockers.length > 0) {
    throw new Error("Dependency recheck blocked state apply.");
  }

  return {
    restBase,
    health,
    capabilities,
    dependencyStatus
  };
}

async function validateFieldOnlyApplyPreconditions(projectState, proofId, warnings) {
  if ((projectState.project.runtime && projectState.project.runtime.status) !== "provisioned") {
    throw new Error("Launcher project must be provisioned before state apply.");
  }

  if ((projectState.project.agent && projectState.project.agent.status) !== "installed") {
    throw new Error("Site Factory Agent must be installed before state apply.");
  }

  await waitForUrl(projectState.project.wp_url);

  const restBase = asString(projectState.project.agent && projectState.project.agent.rest_base);
  if (!restBase) {
    throw new Error("Launcher project is missing agent.rest_base.");
  }

  const health = (await getAgentJson(projectState, restBase + "/agent/health", proofId, warnings)).json || {};
  if (asString(health.status) !== "ok") {
    throw new Error("Agent health check did not return ok.");
  }

  const capabilities = (await getAgentJson(projectState, restBase + "/agent/capabilities", proofId, warnings)).json || {};
  if (!capabilities.capabilities || capabilities.capabilities.safe_fields_apply !== true) {
    throw new Error("Agent capabilities do not advertise safe_fields_apply=true.");
  }

  if (capabilities.capabilities.frontend_safe_edit !== true) {
    throw new Error("Agent capabilities do not advertise frontend_safe_edit=true.");
  }

  return {
    restBase,
    health,
    capabilities
  };
}

function buildPromptPersonalizationFromPlan(plan) {
  const proposed = plan.proposed && typeof plan.proposed === "object" ? plan.proposed : {};
  const fields = proposed.personalization && typeof proposed.personalization === "object"
    ? proposed.personalization
    : {};
  const designProfile = proposed.design_profile && typeof proposed.design_profile === "object"
    ? proposed.design_profile
    : {};
  const applyFields = {};
  const fieldScope = plan.field_scope && typeof plan.field_scope === "object" ? plan.field_scope : null;
  const includedFields = fieldScope && Array.isArray(fieldScope.included_fields)
    ? fieldScope.included_fields.filter((fieldKey) => STATE_APPLY_ALLOWLIST.includes(fieldKey))
    : null;
  const fieldKeys = includedFields || STATE_APPLY_ALLOWLIST;

  for (const key of fieldKeys) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      applyFields[key] = asString(fields[key]);
    }
  }

  return buildPromptPersonalization(
    applyFields,
    designProfile,
    asString(plan.source && plan.source.prompt_personalization_source) || "local_interpreter"
  );
}

function resolveStateApplyPath(statePaths, runtimePath, applyPathValue) {
  const raw = asString(applyPathValue);
  if (!raw || raw === "latest") {
    return null;
  }

  if (path.isAbsolute(raw)) {
    return raw;
  }

  return path.resolve(runtimePath, raw);
}

function readSuccessfulStateApplyRecord(applyPath) {
  if (!applyPath || !fs.existsSync(applyPath)) {
    return null;
  }

  let applyRecord;
  try {
    applyRecord = safeJsonRead(applyPath);
  } catch (error) {
    return null;
  }

  if (
    !applyRecord ||
    applyRecord.schema !== STATE_APPLY_SCHEMA ||
    asString(applyRecord.status) !== "ok" ||
    applyRecord.applies_changes !== true
  ) {
    return null;
  }

  return applyRecord;
}

function selectLatestRollbackCandidate(statePaths, currentState) {
  if (!fs.existsSync(statePaths.appliesPath)) {
    return null;
  }

  const currentValues = deriveEffectiveCurrentValues(currentState);
  const candidates = fs.readdirSync(statePaths.appliesPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith("state-apply-") && entry.name.endsWith(".json"))
    .map((entry) => {
      const filePath = path.join(statePaths.appliesPath, entry.name);
      return {
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  for (const candidate of candidates) {
    const applyRecord = readSuccessfulStateApplyRecord(candidate.filePath);
    if (!applyRecord || !applyRecord.state_before_path || !fs.existsSync(applyRecord.state_before_path)) {
      continue;
    }

    let previousState;
    try {
      previousState = safeJsonRead(applyRecord.state_before_path);
    } catch (error) {
      continue;
    }

    const rollbackValues = derivePersonalizationValues(previousState);
    const hasMeaningfulChange = STATE_APPLY_ALLOWLIST.some((key) => asString(rollbackValues[key]) !== asString(currentValues[key]));
    if (!hasMeaningfulChange) {
      continue;
    }

    return {
      applyPath: candidate.filePath,
      applyRecord,
      previousState
    };
  }

  return null;
}

function resolveRollbackCandidate(statePaths, runtimePath, currentState, applyPathValue) {
  const explicitPath = resolveStateApplyPath(statePaths, runtimePath, applyPathValue);
  if (explicitPath) {
    const applyRecord = readSuccessfulStateApplyRecord(explicitPath);
    if (!applyRecord) {
      throw new Error("Selected state apply record is unavailable or not rollback-eligible.");
    }

    if (!applyRecord.state_before_path || !fs.existsSync(applyRecord.state_before_path)) {
      throw new Error("Selected state apply record is missing its state_before_path snapshot.");
    }

    return {
      applyPath: explicitPath,
      applyRecord,
      previousState: safeJsonRead(applyRecord.state_before_path)
    };
  }

  return selectLatestRollbackCandidate(statePaths, currentState);
}

function buildRollbackPrompt(previousValues) {
  const agency = asString(previousValues.agency_name) || "the previous state";
  return "Rollback safe personalization to previous state for " + agency;
}

function validateStateRollbackCandidate(state, rollbackValues) {
  const userOverrides = state.user_overrides && typeof state.user_overrides === "object" ? state.user_overrides : {};
  const protectedConflicts = [];

  for (const [fieldKey, override] of Object.entries(userOverrides)) {
    if (!override || override.protected !== true) {
      continue;
    }

    const rollbackValue = asString(rollbackValues[fieldKey]);
    const currentValue = asString(override.value);

    if (rollbackValue && rollbackValue !== currentValue) {
      protectedConflicts.push({
        type: "protected_user_override",
        severity: "requires_confirmation",
        field_key: fieldKey,
        current_user_value: currentValue,
        rollback_value: rollbackValue,
        overwrite_policy: asString(override.overwrite_policy) || "ask_before_overwrite",
        message: "Field " + fieldKey + " was edited on the frontend and is protected. Ask before overwrite."
      });
    }
  }

  return protectedConflicts;
}

function buildRollbackUiSummary(statePaths, state) {
  const candidate = selectLatestRollbackCandidate(statePaths, state);
  if (!candidate) {
    return {
      available: false,
      safe: false,
      code: "rollback_unavailable",
      message: "No rollback-ready state apply is available."
    };
  }

  const rollbackValues = derivePersonalizationValues(candidate.previousState);
  const protectedConflicts = validateStateRollbackCandidate(state, rollbackValues);

  return {
    available: true,
    safe: protectedConflicts.length === 0,
    code: protectedConflicts.length ? "state_rollback_requires_confirmation" : "state_rollback_available",
    message: protectedConflicts.length
      ? "Rollback blocked: confirmation required."
      : "Rollback last apply is available.",
    apply_id: candidate.applyRecord.apply_id || null,
    apply_path: candidate.applyPath,
    protected_conflicts: protectedConflicts
  };
}

function validateStatePlanForApply(state, plan, options) {
  if (!plan || typeof plan !== "object") {
    throw new Error("State apply could not read the selected plan.");
  }

  if (plan.schema !== STATE_PLAN_SCHEMA) {
    throw new Error("Selected plan is not a factory_state_plan.");
  }

  if (asString(plan.project_slug) !== asString(state.project_slug)) {
    throw new Error("Selected plan belongs to a different project slug.");
  }

  if (toBooleanTrue(plan.applies_changes)) {
    throw new Error("Selected plan is invalid because applies_changes=true.");
  }

  if (toBooleanTrue(plan.provider_called)) {
    throw new Error("Selected plan is invalid because provider_called=true.");
  }

  const hasExplicitFieldScope = Boolean(plan && plan.field_scope && typeof plan.field_scope === "object");
  const normalizedFieldScope = normalizePlanFieldScope(plan);
  const includedPlanFields = hasExplicitFieldScope
    ? normalizedFieldScope.included_fields
    : null;
  const confirmedOverwriteFields = normalizeConfirmationFieldRequests(options && options.confirmOverwriteFields);
  const confirmationRequired = plan && plan.confirmation_required && typeof plan.confirmation_required === "object"
    ? plan.confirmation_required
    : null;
  const requiredConfirmationFields = confirmationRequired && confirmationRequired.required === true
    ? normalizeConfirmationFieldRequests(confirmationRequired.fields)
    : [];

  if (Array.isArray(plan.conflicts) && plan.conflicts.length > 0) {
    const blockedError = new Error("Plan has protected user override conflicts and requires explicit confirmation.");
    blockedError.blockedCode = "state_plan_requires_confirmation";
    blockedError.blockedConflicts = Array.isArray(plan.conflicts) ? plan.conflicts : [];
    throw blockedError;
  }

  if (requiredConfirmationFields.length) {
    const missingFields = requiredConfirmationFields.filter((fieldKey) => !confirmedOverwriteFields.includes(fieldKey));
    if (missingFields.length) {
      const blockedError = new Error("Plan requires explicit overwrite confirmation for protected fields.");
      blockedError.blockedCode = "state_plan_requires_overwrite_confirmation";
      blockedError.blockedConflicts = requiredConfirmationFields.map((fieldKey) => ({
        type: "protected_user_override_overwrite_requested",
        severity: "requires_confirmation",
        field_key: fieldKey,
        overwrite_policy: "requires_explicit_confirmation",
        message: "Protected field " + fieldKey + " will be overwritten only if explicitly confirmed."
      }));
      blockedError.confirmation = {
        required: true,
        confirmed: false,
        required_fields: requiredConfirmationFields,
        confirmed_fields: confirmedOverwriteFields
      };
      throw blockedError;
    }
  } else if (plan.can_apply_without_confirmation !== true) {
    const blockedError = new Error("Plan requires confirmation before apply.");
    blockedError.blockedCode = "state_plan_requires_confirmation";
    blockedError.blockedConflicts = [];
    throw blockedError;
  }

  if (includedPlanFields && includedPlanFields.length === 0) {
    const blockedError = new Error("Plan has no included fields after preserving protected overrides.");
    blockedError.blockedCode = "state_plan_no_included_fields";
    blockedError.blockedConflicts = [];
    throw blockedError;
  }

  const userOverrides = state.user_overrides && typeof state.user_overrides === "object" ? state.user_overrides : {};
  const proposed = plan.proposed && plan.proposed.personalization && typeof plan.proposed.personalization === "object"
    ? plan.proposed.personalization
    : {};
  const lateConflicts = [];
  const scopedKeys = includedPlanFields || Object.keys(proposed);

  for (const [fieldKey, override] of Object.entries(userOverrides)) {
    if (!override || override.protected !== true) {
      continue;
    }

    if (!scopedKeys.includes(fieldKey)) {
      continue;
    }

    if (requiredConfirmationFields.includes(fieldKey) && confirmedOverwriteFields.includes(fieldKey)) {
      continue;
    }

    const currentValue = asString(override.value);
    const proposedValue = asString(proposed[fieldKey]);

    if (proposedValue && proposedValue !== currentValue) {
      lateConflicts.push({
        type: "protected_user_override",
        severity: "requires_confirmation",
        field_key: fieldKey,
        current_user_value: currentValue,
        proposed_value: proposedValue,
        overwrite_policy: asString(override.overwrite_policy) || "ask_before_overwrite",
        message: "Field " + fieldKey + " was edited on the frontend and is protected. Ask before overwrite."
      });
    }
  }

  if (lateConflicts.length) {
    const blockedError = new Error("Plan has protected user override conflicts and requires explicit confirmation.");
    blockedError.blockedCode = "state_plan_requires_confirmation";
    blockedError.blockedConflicts = lateConflicts;
    throw blockedError;
  }
}

async function applyStatePlan(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  const safeRuntimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const statePaths = ensureStatePaths(safeRuntimePath);
  const createdAt = stateNow();
  const state = fs.existsSync(statePaths.currentPath) ? safeJsonRead(statePaths.currentPath) : null;
  const planPath = resolveStatePlanPath(statePaths, safeRuntimePath, options.planPath);
  const plan = fs.existsSync(planPath) ? safeJsonRead(planPath) : null;
  const warnings = [];
  const conflicts = [];
  const beforeCounts = state ? null : null;
  const confirmedOverwriteFields = normalizeConfirmationFieldRequests(options.confirmOverwriteFields);

  if (!state) {
    throw new Error(
      "Managed state is missing. Run: node launcher/src/cli.js state --slug " +
      projectState.project.slug +
      " refresh"
    );
  }

  const normalizedFieldScope = normalizePlanFieldScope(plan);
  const applyMethodDecision = resolveStateApplyMethod(plan, normalizedFieldScope);
  const beforeStateCopyPath = path.join(statePaths.appliesPath, "state-before-" + timestampCompact() + ".json");
  writeJsonFile(beforeStateCopyPath, state);

  try {
    validateStatePlanForApply(state, plan, {
      confirmOverwriteFields: confirmedOverwriteFields
    });
  } catch (error) {
    if (error.blockedCode) {
      const blockedProof = buildBlockedApplyProof(
        projectState,
        error.message,
        error.blockedCode,
        error.blockedConflicts || [],
        statePaths.currentPath
      );
      blockedProof.plan_id = plan && plan.plan_id ? plan.plan_id : null;
      blockedProof.plan_path = planPath;
      blockedProof.apply_method = applyMethodDecision.method;
      blockedProof.field_only_apply = {
        endpoint: "/wp-json/factory/v1/agent/safe-fields/apply",
        requested_fields: Array.isArray(normalizedFieldScope.included_fields) ? normalizedFieldScope.included_fields : [],
        applied_fields: [],
        ignored_fields: Array.isArray(normalizedFieldScope.excluded_fields) ? normalizedFieldScope.excluded_fields : [],
        agent_manifest: "",
        fallback_used: false
      };
      blockedProof.confirmation = error.confirmation || {
        required: Boolean(plan && plan.confirmation_required && plan.confirmation_required.required),
        confirmed: false,
        required_fields: normalizeConfirmationFieldRequests(plan && plan.confirmation_required && plan.confirmation_required.fields)
      };
      const blockedProofPath = path.join(safeRuntimePath, "proofs", "state-apply-blocked-" + timestampCompact() + ".json");
      writeJsonFile(blockedProofPath, blockedProof);

      return {
        project: projectState.project,
        status: "blocked",
        code: blockedProof.code,
        conflicts: blockedProof.conflicts,
        proof: blockedProof,
        proofPath: blockedProofPath,
        statePath: statePaths.currentPath
      };
    }

    throw error;
  }

  const applyTimestamp = timestampCompact();
  const applyId = "state-apply-" + applyTimestamp + "-" + crypto.randomBytes(3).toString("hex");
  const applyPath = path.join(statePaths.appliesPath, "state-apply-" + applyTimestamp + ".json");
  const proofPath = path.join(safeRuntimePath, "proofs", "state-apply-" + applyTimestamp + ".json");
  const effectiveBeforeValues = deriveEffectiveCurrentValues(state);
  const requiredConfirmationFields = normalizeConfirmationFieldRequests(plan && plan.confirmation_required && plan.confirmation_required.fields);
  let applyContext = null;
  const appliedFields = [];
  const ignoredFields = [];
  const scopedIncludedFields = normalizedFieldScope.included_fields.length ? normalizedFieldScope.included_fields : null;
  const scopedExcludedFields = normalizedFieldScope.excluded_fields;

  for (const [key, value] of Object.entries(plan.proposed && plan.proposed.personalization && typeof plan.proposed.personalization === "object" ? plan.proposed.personalization : {})) {
    const isIncluded = scopedIncludedFields ? scopedIncludedFields.includes(key) : STATE_APPLY_ALLOWLIST.includes(key);
    if (isIncluded && STATE_APPLY_ALLOWLIST.includes(key) && asString(value)) {
      appliedFields.push(key);
    } else {
      ignoredFields.push(key);
    }
  }

  for (const excludedField of scopedExcludedFields) {
    if (!ignoredFields.includes(excludedField)) {
      ignoredFields.push(excludedField);
    }
  }

  const overwrittenProtectedFields = requiredConfirmationFields.filter((fieldKey) => appliedFields.includes(fieldKey));
  const preservedProtectedFields = (
    normalizedFieldScope.preserved_protected_fields.length
      ? normalizedFieldScope.preserved_protected_fields
      : extractProtectedFields(state.user_overrides || {})
  ).filter((fieldKey) => !overwrittenProtectedFields.includes(fieldKey));

  if (applyMethodDecision.method !== "field_only_safe_apply") {
    const blockedProof = buildBlockedApplyProof(
      projectState,
      "State apply requires a broader mutation path that is not enabled in this slice.",
      "state_plan_broader_apply_not_enabled",
      [],
      statePaths.currentPath
    );
    blockedProof.plan_id = plan && plan.plan_id ? plan.plan_id : null;
    blockedProof.plan_path = planPath;
    blockedProof.apply_method = applyMethodDecision.method;
    blockedProof.field_only_apply = {
      endpoint: "/wp-json/factory/v1/agent/safe-fields/apply",
      requested_fields: appliedFields,
      applied_fields: [],
      ignored_fields: ignoredFields,
      agent_manifest: "",
      fallback_used: false
    };
    const blockedProofPath = path.join(safeRuntimePath, "proofs", "state-apply-blocked-" + timestampCompact() + ".json");
    writeJsonFile(blockedProofPath, blockedProof);

    return {
      project: projectState.project,
      status: "blocked",
      code: blockedProof.code,
      conflicts: [],
      proof: blockedProof,
      proofPath: blockedProofPath,
      statePath: statePaths.currentPath
    };
  }

  let enteredMutationBoundary = false;
  let executeData = null;
  let preconditions = null;
  let runtimeCountsBefore = null;
  let afterCounts = null;
  let refreshResult = null;
  let homeHtmlBefore = null;
  let homeHtmlAfter = null;

  try {
    applyContext = buildEffectiveRenderContext(state, plan, normalizedFieldScope);
    preconditions = await validateFieldOnlyApplyPreconditions(projectState, applyId, warnings);
    const promptPersonalization = buildPromptPersonalization(
      applyContext.safeRenderContext,
      plan.proposed && plan.proposed.design_profile && typeof plan.proposed.design_profile === "object"
        ? plan.proposed.design_profile
        : {},
      asString(plan.source && plan.source.prompt_personalization_source) || "local_interpreter"
    );
    const proposedFields = applyContext.applyIntentFields;
    homeHtmlBefore = await readHomeHtml(projectState.project.wp_url);
    runtimeCountsBefore = await readRuntimeCounts(projectState, applyId + "-before", warnings);

    const executePayload = {
      fields: applyContext.applyIntentFields,
      context: {
        source: "launcher_state_apply",
        plan_id: asString(plan.plan_id) || null,
        apply_id: applyId,
        safe_render_context: applyContext.safeRenderContext,
        preserved_fields: applyContext.preservedRenderValues,
        confirmation: {
          required: requiredConfirmationFields.length > 0,
          confirmed: requiredConfirmationFields.length > 0,
          confirmed_fields: confirmedOverwriteFields,
          overwritten_protected_fields: overwrittenProtectedFields
        }
      }
    };

    enteredMutationBoundary = Object.keys(executePayload.fields).length > 0;
    const executeResponse = await postAgentJson(
      projectState,
      preconditions.restBase + "/agent/safe-fields/apply",
      executePayload,
      applyId,
      warnings
    );
    executeData = executeResponse.json || {};

    afterCounts = await readRuntimeCounts(projectState, applyId + "-after", warnings);
    homeHtmlAfter = await readHomeHtml(projectState.project.wp_url);

    if (toBooleanTrue(executeData.provider_called)) {
      throw new Error("Field-only state apply unexpectedly reported provider_called=true.");
    }

    if (asString(executeData.status) === "blocked") {
      throw new Error("Field-only state apply was blocked: " + String(executeData.message || executeData.code || "unknown block"));
    }

    const mutationStarted = toBooleanTrue(executeData.applies_changes);

    if (!mutationStarted && asString(executeData.code) !== "agent_safe_fields_no_changes") {
      throw new Error("Field-only state apply did not report a completed narrow mutation: " + String(executeData.message || executeData.code || "unknown apply error"));
    }

    const baseApplyRecord = {
      schema: STATE_APPLY_SCHEMA,
      version: STATE_APPLY_VERSION,
      apply_id: applyId,
      project_slug: projectState.project.slug,
      wp_url: projectState.project.wp_url,
      created_at: createdAt,
      plan_id: asString(plan.plan_id) || null,
      plan_path: planPath,
      applies_changes: mutationStarted,
      provider_called: false,
      status: "ok",
      code: asString(executeData.code) === "agent_safe_fields_no_changes" ? "state_plan_no_changes" : "state_plan_applied",
      apply_method: "field_only_safe_apply",
      applied_fields: Array.isArray(executeData.applied_fields) ? executeData.applied_fields : appliedFields,
      ignored_fields: Array.isArray(executeData.ignored_fields) ? executeData.ignored_fields : ignoredFields,
      preserved_protected_fields: preservedProtectedFields,
      confirmation: {
        required: requiredConfirmationFields.length > 0,
        confirmed: requiredConfirmationFields.length > 0,
        confirmed_fields: confirmedOverwriteFields,
        confirmation_source: requiredConfirmationFields.length > 0 ? "cli_confirm_overwrite" : null,
        overwritten_protected_fields: overwrittenProtectedFields
      },
      render_context_fields: applyContext.renderContextFields,
      safe_render_context: applyContext.safeRenderContext,
      preserved_render_values: applyContext.preservedRenderValues,
      field_only_apply: Object.assign({
        endpoint: "/wp-json/factory/v1/agent/safe-fields/apply",
        requested_fields: Object.keys(applyContext.applyIntentFields),
        applied_fields: Array.isArray(executeData.applied_fields) ? executeData.applied_fields : appliedFields,
        ignored_fields: Array.isArray(executeData.ignored_fields) ? executeData.ignored_fields : ignoredFields,
        agent_manifest: asString(executeData.manifest_path) || "",
        fallback_used: false
      }, executeData.field_only_apply && typeof executeData.field_only_apply === "object" ? executeData.field_only_apply : {}),
      conflicts: [],
      before_values: effectiveBeforeValues,
      after_values: {},
      before_counts: runtimeCountsBefore,
      after_counts: afterCounts,
      personalization: {
        source: promptPersonalization.source,
        provider_called: false,
        fields: proposedFields,
        design_profile: promptPersonalization.design_profile,
        applied_fields: Array.isArray(executeData.applied_fields) ? executeData.applied_fields : appliedFields,
        ignored_fields: Array.isArray(executeData.ignored_fields) ? executeData.ignored_fields : ignoredFields,
        render_context_fields: applyContext.renderContextFields,
        warnings: warnings.slice()
      },
      agent_manifest: asString(executeData.manifest_path) || null,
      state_before_path: beforeStateCopyPath,
      state_after_path: null,
      state_current_path: null,
      warnings
    };

    writeJsonFile(applyPath, baseApplyRecord);
    writeJsonFile(proofPath, baseApplyRecord);

    projectState.project.generation = Object.assign({}, projectState.project.generation || {}, {
      status: mutationStarted ? (asString(executeData.status) || "ok") : "ok",
      last_apply_proof_id: path.basename(proofPath, ".json")
    });
    projectState.project.generated_site = Object.assign({}, defaultGeneratedSiteMetadata(), projectState.project.generated_site || {}, {
      present: true,
      personalization_last_applied: {
        source: promptPersonalization.source,
        provider_called: false,
        fields: proposedFields,
        design_profile: promptPersonalization.design_profile,
        applied_fields: Array.isArray(executeData.applied_fields) ? executeData.applied_fields : appliedFields,
        ignored_fields: Array.isArray(executeData.ignored_fields) ? executeData.ignored_fields : ignoredFields,
        render_context_fields: applyContext.renderContextFields,
        warnings: warnings.slice()
      }
    });
    saveProjectRecord(projectState, projectState.project);

    refreshResult = await refreshState({
      slug: projectState.project.slug,
      projectsRoot
    });

    const refreshedState = refreshResult.state;
    if (overwrittenProtectedFields.length) {
      const refreshedOverrides = refreshedState.user_overrides && typeof refreshedState.user_overrides === "object"
        ? refreshedState.user_overrides
        : {};
      for (const fieldKey of overwrittenProtectedFields) {
        const nextValue = asString(applyContext.safeRenderContext[fieldKey]) || asString(promptPersonalization.fields[fieldKey]);
        if (!nextValue) {
          continue;
        }

        refreshedOverrides[fieldKey] = Object.assign({}, refreshedOverrides[fieldKey] || {}, {
          source: "confirmed_overwrite",
          protected: true,
          field_key: fieldKey,
          before: asString(effectiveBeforeValues[fieldKey]) || "",
          after: nextValue,
          value: nextValue,
          manifest: proofPath,
          updated_at: createdAt,
          overwrite_policy: "ask_before_overwrite",
          overwritten_at: createdAt,
          previous_value: asString(effectiveBeforeValues[fieldKey]) || "",
          last_overwrite_confirmation: {
            proof_path: proofPath,
            proof_id: applyId
          }
        });
      }
      refreshedState.user_overrides = refreshedOverrides;
      writeJsonFile(refreshResult.statePath, refreshedState);
      writeJsonFile(refreshResult.snapshotPath, refreshedState);
    }
    const afterValues = deriveEffectiveCurrentValues(refreshedState);
    const effectiveFieldKeys = appliedFields
      .concat(preservedProtectedFields)
      .concat(overwrittenProtectedFields);
    const applyRecord = Object.assign({}, baseApplyRecord, {
      after_values: afterValues,
      effective_safe_fields_after: refreshedState.effective_safe_fields || null,
      effective_safe_field_updates: selectEffectiveSafeFieldEntries(
        refreshedState.effective_safe_fields || null,
        effectiveFieldKeys
      ),
      home_html_before_contains: {
        agency_name: renderedHtmlContainsValue(homeHtmlBefore.body, asString(effectiveBeforeValues.agency_name)),
        hero_title: renderedHtmlContainsValue(homeHtmlBefore.body, asString(effectiveBeforeValues.hero_title))
      },
      home_html_after_contains: {
        agency_name: renderedHtmlContainsValue(homeHtmlAfter.body, asString(afterValues.agency_name)),
        hero_title: renderedHtmlContainsValue(homeHtmlAfter.body, asString(afterValues.hero_title)),
        hero_subtitle: renderedHtmlContainsValue(homeHtmlAfter.body, asString(afterValues.hero_subtitle)),
        hero_cta_text: renderedHtmlContainsValue(homeHtmlAfter.body, asString(afterValues.hero_cta_text))
      },
      state_after_path: refreshResult.snapshotPath,
      state_current_path: refreshResult.statePath,
      warnings
    });

    writeJsonFile(applyPath, applyRecord);
    writeJsonFile(proofPath, applyRecord);

    return {
      project: projectState.project,
      status: "ok",
      code: "state_plan_applied",
      apply: applyRecord,
      applyPath,
      proofPath,
      statePath: refreshResult.statePath,
      summary: refreshResult.summary
    };
  } catch (error) {
    const applyRecord = {
      schema: STATE_APPLY_SCHEMA,
      version: STATE_APPLY_VERSION,
      apply_id: applyId,
      project_slug: projectState.project.slug,
      wp_url: projectState.project.wp_url,
      created_at: createdAt,
      plan_id: plan && plan.plan_id ? plan.plan_id : null,
      plan_path: planPath,
      applies_changes: enteredMutationBoundary,
      provider_called: false,
      status: enteredMutationBoundary ? "failed" : "blocked",
      code: enteredMutationBoundary ? "state_plan_apply_failed_after_boundary" : "state_plan_apply_failed",
      apply_method: "field_only_safe_apply",
      applied_fields: appliedFields,
      ignored_fields: ignoredFields,
      preserved_protected_fields: preservedProtectedFields,
      confirmation: {
        required: requiredConfirmationFields.length > 0,
        confirmed: false,
        required_fields: requiredConfirmationFields,
        confirmed_fields: confirmedOverwriteFields
      },
      render_context_fields: applyContext ? applyContext.renderContextFields : [],
      safe_render_context: applyContext ? applyContext.safeRenderContext : {},
      preserved_render_values: applyContext ? applyContext.preservedRenderValues : {},
      field_only_apply: {
        endpoint: "/wp-json/factory/v1/agent/safe-fields/apply",
        requested_fields: applyContext ? Object.keys(applyContext.applyIntentFields || {}) : appliedFields,
        applied_fields: executeData && Array.isArray(executeData.applied_fields) ? executeData.applied_fields : [],
        ignored_fields: executeData && Array.isArray(executeData.ignored_fields) ? executeData.ignored_fields : ignoredFields,
        agent_manifest: executeData && executeData.manifest_path ? executeData.manifest_path : "",
        fallback_used: false
      },
      conflicts,
      before_values: effectiveBeforeValues,
      after_values: {},
      effective_safe_fields_after: null,
      effective_safe_field_updates: {},
      before_counts: runtimeCountsBefore,
      after_counts: afterCounts,
      agent_manifest: executeData && executeData.manifest_path ? executeData.manifest_path : null,
      state_before_path: beforeStateCopyPath,
      state_after_path: statePaths.currentPath,
      warnings: warnings.concat([error.message]),
      mutation_status: enteredMutationBoundary
        ? (executeData && executeData.mutation_status ? executeData.mutation_status : "unknown_after_apply_started")
        : "not_started"
    };

    writeJsonFile(applyPath, applyRecord);
    writeJsonFile(proofPath, applyRecord);

    const enrichedError = new Error(error.message + " (proof: " + proofPath + ")");
    enrichedError.proofPath = proofPath;
    throw enrichedError;
  }
}

async function rollbackStateApply(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  const safeRuntimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const statePaths = ensureStatePaths(safeRuntimePath);
  const state = fs.existsSync(statePaths.currentPath) ? safeJsonRead(statePaths.currentPath) : null;
  const warnings = [];

  if (!state) {
    throw new Error(
      "Managed state is missing. Run: node launcher/src/cli.js state --slug " +
      projectState.project.slug +
      " refresh"
    );
  }

  const rollbackCandidate = resolveRollbackCandidate(statePaths, safeRuntimePath, state, options.applyPath);
  if (!rollbackCandidate) {
    return {
      project: projectState.project,
      status: "unavailable",
      code: "rollback_unavailable",
      proofPath: null,
      statePath: statePaths.currentPath,
      protectedConflicts: []
    };
  }

  const { applyPath, applyRecord, previousState } = rollbackCandidate;
  const rollbackValues = derivePersonalizationValues(previousState);
  const protectedConflicts = validateStateRollbackCandidate(state, rollbackValues);

  if (protectedConflicts.length > 0) {
    const blockedProof = buildBlockedRollbackProof(
      projectState,
      "Rollback would overwrite protected frontend overrides and requires explicit confirmation.",
      "state_rollback_requires_confirmation",
      protectedConflicts,
      statePaths.currentPath,
      applyRecord.apply_id,
      applyPath
    );
    blockedProof.target_previous_state_path = applyRecord.state_before_path || null;
    const blockedProofPath = path.join(safeRuntimePath, "proofs", "state-rollback-blocked-" + timestampCompact() + ".json");
    writeJsonFile(blockedProofPath, blockedProof);

    return {
      project: projectState.project,
      status: "blocked",
      code: blockedProof.code,
      proof: blockedProof,
      proofPath: blockedProofPath,
      statePath: statePaths.currentPath,
      protectedConflicts
    };
  }

  const rollbackTimestamp = timestampCompact();
  const rollbackId = "state-rollback-" + rollbackTimestamp + "-" + crypto.randomBytes(3).toString("hex");
  const rollbackPath = path.join(statePaths.rollbacksPath, "state-rollback-" + rollbackTimestamp + ".json");
  const proofPath = path.join(safeRuntimePath, "proofs", "state-rollback-" + rollbackTimestamp + ".json");
  const stateBeforeRollbackPath = path.join(statePaths.rollbacksPath, "state-before-rollback-" + rollbackTimestamp + ".json");
  writeJsonFile(stateBeforeRollbackPath, state);

  const effectiveBeforeValues = deriveEffectiveCurrentValues(state);
  const promptPersonalization = buildPromptPersonalization(
    rollbackValues,
    previousState.personalization && previousState.personalization.design_profile ? previousState.personalization.design_profile : {},
    "state_apply_rollback_v1"
  );
  const rollbackFields = Object.assign({}, rollbackValues);
  const appliedFields = STATE_APPLY_ALLOWLIST.filter((key) => asString(rollbackValues[key]));
  const ignoredFields = Object.keys(previousState.personalization && previousState.personalization.fields || {})
    .filter((key) => !STATE_APPLY_ALLOWLIST.includes(key));
  const preservedProtectedFields = extractProtectedFields(state.user_overrides || {});
  let enteredMutationBoundary = false;
  let executeData = null;
  let afterCounts = null;
  let homeHtmlBefore = null;
  let homeHtmlAfter = null;
  let refreshResult = null;

  try {
    const preconditions = await validateStateApplyPreconditions(projectState, rollbackId, warnings);
    const prompt = buildRollbackPrompt(rollbackValues);

    homeHtmlBefore = await readHomeHtml(projectState.project.wp_url);
    const runtimeCountsBefore = await readRuntimeCounts(projectState, rollbackId + "-before", warnings);
    const rerun = await rerunPlanningChain(projectState, prompt, promptPersonalization, rollbackId, warnings);
    const gate = rerun.results.generate_gate || {};
    const preflight = rerun.results.generate_preflight || {};
    const confirmation = rerun.results.generate_confirmation || {};

    if (!toBooleanTrue(gate.can_generate)) {
      throw new Error("State rollback gate blocked safe personalization rollback.");
    }

    if (!toBooleanTrue(preflight.preflight_ready)) {
      throw new Error("State rollback preflight blocked safe personalization rollback.");
    }

    if (!toBooleanTrue(confirmation.confirmation_ready)) {
      throw new Error("State rollback confirmation blocked safe personalization rollback.");
    }

    const previewPayload = {
      prompt,
      site_plan: rerun.results.site_plan,
      blueprint_candidate: rerun.results.blueprint_candidate,
      preview_diff: rerun.results.preview_diff,
      generate_gate: gate,
      generate_preflight: preflight,
      generate_confirmation: confirmation,
      execute: false,
      site_type: "real_estate",
      vertical: "real_estate",
      context: rerun.context
    };
    const previewResponse = await postAgentJson(projectState, preconditions.restBase + "/ai/controlled-generate", previewPayload, rollbackId, warnings);
    const previewData = previewResponse.json || {};

    if (toBooleanTrue(previewData.applies_changes)) {
      throw new Error("Rollback preview unexpectedly reported applies_changes=true.");
    }

    if (toBooleanTrue(previewData.provider_called)) {
      throw new Error("Rollback preview unexpectedly reported provider_called=true.");
    }

    if (!previewData.confirmation_required_phrase) {
      throw new Error("Rollback preview did not return a confirmation phrase.");
    }

    const executePayload = Object.assign({}, previewPayload, {
      execute: true,
      confirmation_phrase: previewData.confirmation_required_phrase
    });
    enteredMutationBoundary = true;
    const executeResponse = await postAgentJson(projectState, preconditions.restBase + "/ai/controlled-generate", executePayload, rollbackId, warnings);
    executeData = executeResponse.json || {};

    afterCounts = await readRuntimeCounts(projectState, rollbackId + "-after", warnings);
    homeHtmlAfter = await readHomeHtml(projectState.project.wp_url);

    const mutationStarted = toBooleanTrue(executeData.applies_changes)
      || asString(executeData.mutation_status) === "unknown_after_apply_started"
      || asString(executeData.mutation_status) === "completed";

    if (!mutationStarted) {
      throw new Error("State rollback did not enter the mutation boundary: " + String(executeData.message || executeData.code || "unknown rollback error"));
    }

    const baseRollbackRecord = {
      schema: STATE_ROLLBACK_SCHEMA,
      version: STATE_ROLLBACK_VERSION,
      rollback_id: rollbackId,
      project_slug: projectState.project.slug,
      wp_url: projectState.project.wp_url,
      created_at: stateNow(),
      source_apply_id: applyRecord.apply_id || null,
      source_apply_path: applyPath,
      state_before_rollback_path: stateBeforeRollbackPath,
      target_previous_state_path: applyRecord.state_before_path || null,
      state_after_rollback_path: null,
      state_current_path: null,
      applies_changes: true,
      provider_called: false,
      status: "ok",
      code: "state_rollback_applied",
      rollback_fields: rollbackFields,
      applied_fields: appliedFields,
      ignored_fields: ignoredFields,
      preserved_protected_fields: preservedProtectedFields,
      protected_conflicts: [],
      before_values: effectiveBeforeValues,
      after_values: {},
      before_counts: runtimeCountsBefore,
      after_counts: afterCounts,
      agent_manifest: asString(executeData.manifest_path) || null,
      warnings
    };

    writeJsonFile(rollbackPath, baseRollbackRecord);
    writeJsonFile(proofPath, baseRollbackRecord);

    projectState.project.generation = Object.assign({}, projectState.project.generation || {}, {
      status: asString(executeData.status) || "ok",
      last_rollback_proof_id: path.basename(proofPath, ".json")
    });
    projectState.project.generated_site = Object.assign({}, defaultGeneratedSiteMetadata(), projectState.project.generated_site || {}, {
      present: true,
      personalization_last_applied: {
        source: promptPersonalization.source,
        provider_called: false,
        fields: rollbackValues,
        design_profile: promptPersonalization.design_profile,
        applied_fields: appliedFields,
        ignored_fields: ignoredFields,
        warnings: warnings.slice()
      }
    });
    saveProjectRecord(projectState, projectState.project);

    refreshResult = await refreshState({
      slug: projectState.project.slug,
      projectsRoot
    });

    const refreshedState = refreshResult.state;
    const afterValues = deriveEffectiveCurrentValues(refreshedState);
    homeHtmlAfter = await readHomeHtml(projectState.project.wp_url);
    const rollbackRecord = Object.assign({}, baseRollbackRecord, {
      state_after_rollback_path: refreshResult.snapshotPath,
      state_current_path: refreshResult.statePath,
      after_values: afterValues,
      home_html_before_contains: {
        agency_name: renderedHtmlContainsValue(homeHtmlBefore.body, asString(effectiveBeforeValues.agency_name)),
        hero_title: renderedHtmlContainsValue(homeHtmlBefore.body, asString(effectiveBeforeValues.hero_title))
      },
      home_html_after_contains: {
        agency_name: renderedHtmlContainsValue(homeHtmlAfter.body, asString(afterValues.agency_name)),
        hero_title: renderedHtmlContainsValue(homeHtmlAfter.body, asString(afterValues.hero_title)),
        hero_subtitle: renderedHtmlContainsValue(homeHtmlAfter.body, asString(afterValues.hero_subtitle)),
        hero_cta_text: renderedHtmlContainsValue(homeHtmlAfter.body, asString(afterValues.hero_cta_text))
      },
      warnings
    });

    writeJsonFile(rollbackPath, rollbackRecord);
    writeJsonFile(proofPath, rollbackRecord);

    return {
      project: projectState.project,
      status: "ok",
      code: "state_rollback_applied",
      rollback: rollbackRecord,
      rollbackPath,
      proofPath,
      statePath: refreshResult.statePath,
      summary: refreshResult.summary
    };
  } catch (error) {
    const rollbackRecord = {
      schema: STATE_ROLLBACK_SCHEMA,
      version: STATE_ROLLBACK_VERSION,
      rollback_id: rollbackId,
      project_slug: projectState.project.slug,
      wp_url: projectState.project.wp_url,
      created_at: stateNow(),
      source_apply_id: applyRecord.apply_id || null,
      source_apply_path: applyPath,
      state_before_rollback_path: stateBeforeRollbackPath,
      target_previous_state_path: applyRecord.state_before_path || null,
      state_after_rollback_path: statePaths.currentPath,
      applies_changes: enteredMutationBoundary,
      provider_called: false,
      status: enteredMutationBoundary ? "failed" : "blocked",
      code: enteredMutationBoundary ? "state_rollback_failed_after_boundary" : "state_rollback_failed",
      rollback_fields: rollbackFields,
      applied_fields: appliedFields,
      ignored_fields: ignoredFields,
      preserved_protected_fields: preservedProtectedFields,
      protected_conflicts: [],
      before_values: effectiveBeforeValues,
      after_values: {},
      agent_manifest: executeData && executeData.manifest_path ? executeData.manifest_path : null,
      warnings: warnings.concat([error.message]),
      mutation_status: enteredMutationBoundary
        ? (executeData && executeData.mutation_status ? executeData.mutation_status : "unknown_after_apply_started")
        : "not_started"
    };

    writeJsonFile(rollbackPath, rollbackRecord);
    writeJsonFile(proofPath, rollbackRecord);

    const enrichedError = new Error(error.message + " (proof: " + proofPath + ")");
    enrichedError.proofPath = proofPath;
    throw enrichedError;
  }
}

module.exports = {
  STATE_SCHEMA,
  STATE_VERSION,
  STATE_PLAN_SCHEMA,
  STATE_PLAN_VERSION,
  STATE_APPLY_SCHEMA,
  STATE_APPLY_VERSION,
  STATE_ROLLBACK_SCHEMA,
  STATE_ROLLBACK_VERSION,
  applyStatePlan,
  rollbackStateApply,
  planState,
  readStateStatus,
  refreshState
};
