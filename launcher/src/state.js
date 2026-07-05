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

function stateNow() {
  return new Date().toISOString();
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
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

function findLatestPersonalizationProof(projectState, runtimePath) {
  const proofsPath = path.join(runtimePath, "proofs");
  const preferredIds = [
    asString(projectState.project.generation && projectState.project.generation.last_rollback_proof_id),
    asString(projectState.project.generation && projectState.project.generation.last_apply_proof_id),
    asString(projectState.project.generation && projectState.project.generation.last_proof_id)
  ].filter(Boolean);

  for (const proofId of preferredIds) {
    const proofPath = path.join(proofsPath, proofId + ".json");
    if (fs.existsSync(proofPath)) {
      return {
        proofPath,
        proof: safeJsonRead(proofPath)
      };
    }
  }

  const latestRollbackPath = findLatestMatchingFile(proofsPath, "state-rollback-", ".json");
  const latestApplyPath = findLatestMatchingFile(proofsPath, "state-apply-", ".json");
  const latestGeneratePath = findLatestMatchingFile(proofsPath, "generate-", ".json");
  const candidates = [latestRollbackPath, latestApplyPath, latestGeneratePath]
    .filter(Boolean)
    .map((filePath) => ({
      filePath,
      mtimeMs: fs.statSync(filePath).mtimeMs
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  if (!candidates.length) {
    return null;
  }

  return {
    proofPath: candidates[0].filePath,
    proof: safeJsonRead(candidates[0].filePath)
  };
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

function buildStateSummary(state, statePath) {
  const userOverrides = state && state.user_overrides && typeof state.user_overrides === "object" ? state.user_overrides : {};
  const protectedFields = Object.values(userOverrides)
    .filter((entry) => entry && entry.protected)
    .map((entry) => entry.field_key);

  return {
    schema: state.schema,
    version: state.version,
    generation_status: state.generation && state.generation.status || "unknown",
    last_updated: state.updated_at || null,
    pages: Array.isArray(state.resources && state.resources.pages) ? state.resources.pages.length : 0,
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
    change_type: changeType,
    source: override ? "frontend_safe_edit_override" : "personalization",
    protected: override ? override.protected === true : false
  };
}

function buildStatePlan(state, prompt) {
  const createdAt = stateNow();
  const planId = "state-plan-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
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

  for (const fieldKey of allFieldKeys) {
    const entry = buildFieldDiffEntry(fieldKey, currentFields, proposedFields, userOverrides);

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

    if (
      entry.protected &&
      entry.change_type !== "unchanged" &&
      userOverrides[fieldKey] &&
      asString(userOverrides[fieldKey].value) !== proposedValueOrEmpty(proposedFields[fieldKey])
    ) {
      conflicts.push({
        type: "protected_user_override",
        severity: "requires_confirmation",
        field_key: fieldKey,
        current_user_value: asString(userOverrides[fieldKey].value),
        proposed_value: proposedValueOrEmpty(proposedFields[fieldKey]),
        overwrite_policy: asString(userOverrides[fieldKey].overwrite_policy) || "ask_before_overwrite",
        message: "Field " + fieldKey + " was edited on the frontend and is protected. Ask before overwrite."
      });
    }
  }

  if (Array.isArray(currentPersonalization.warnings) && currentPersonalization.warnings.length) {
    warnings.push.apply(warnings, currentPersonalization.warnings);
  }
  if (Array.isArray(proposedPersonalization.warnings) && proposedPersonalization.warnings.length) {
    warnings.push.apply(warnings, proposedPersonalization.warnings);
  }
  warnings.push("Plan/diff is read-only in State v1.");

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
    conflicts,
    preservation: {
      protected_fields_preserved: true,
      requires_user_confirmation: conflicts.length > 0
    },
    can_apply_without_confirmation: conflicts.length === 0,
    warnings
  };
}

function proposedValueOrEmpty(value) {
  return asString(value);
}

async function buildState(projectState) {
  const warnings = [];
  const runtimePath = projectState.runtimePath;
  const generateProofEntry = findLatestPersonalizationProof(projectState, runtimePath);
  const generateProof = generateProofEntry ? generateProofEntry.proof : null;
  const latestAgentManifest = findLatestAgentManifest(runtimePath, generateProof, warnings);
  const proofStem = "state-refresh-" + timestampCompact();

  const pages = await readManagedPages(runtimePath, proofStem, warnings);
  const fallbackCounts = generateProof && generateProof.after_counts ? generateProof.after_counts : {};
  const propertyCount = await countPostType(runtimePath, proofStem, "property", warnings);
  const attachmentCount = await countPostType(runtimePath, proofStem, "attachment", warnings);
  const pageCount = await countPostType(runtimePath, proofStem, "page", warnings);

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
    personalization: extractPersonalization(generateProof),
    user_overrides: parseFrontendSafeEditOverrides(runtimePath, warnings),
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
  return {
    project: projectState.project,
    exists: true,
    statePath: statePaths.currentPath,
    state,
    summary: buildStateSummary(state, statePaths.currentPath),
    warnings: Array.isArray(state.warnings) ? state.warnings : [],
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
  const plan = buildStatePlan(state, prompt);
  plan.source.state_path = statePaths.currentPath;

  const planPath = path.join(statePaths.plansPath, "state-plan-" + timestampCompact() + ".json");
  const proofId = "state-plan-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
  const proofPath = path.join(safeRuntimePath, "proofs", proofId + ".json");
  const protectedFields = Array.isArray(plan.current.protected_fields) ? plan.current.protected_fields : [];
  const appliedFieldKeys = summarizeAppliedFieldKeys({
    fields: plan.proposed.personalization
  });
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
    conflicts: plan.conflicts,
    protected_fields: protectedFields,
    requires_user_confirmation: plan.preservation.requires_user_confirmation,
    can_apply_without_confirmation: plan.can_apply_without_confirmation,
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
  const personalizationFields = state.personalization && state.personalization.fields && typeof state.personalization.fields === "object"
    ? state.personalization.fields
    : {};
  const userOverrides = state.user_overrides && typeof state.user_overrides === "object"
    ? state.user_overrides
    : {};
  const values = {};

  for (const key of STATE_APPLY_ALLOWLIST) {
    if (userOverrides[key] && typeof userOverrides[key] === "object" && asString(userOverrides[key].value)) {
      values[key] = asString(userOverrides[key].value);
      continue;
    }

    values[key] = asString(personalizationFields[key]);
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

async function getAgentJson(projectState, targetUrl, proofId, warnings) {
  try {
    if (!projectState.env.WP_APP_PASSWORD) {
      throw new Error("Launcher project is missing a stored application password.");
    }

    return await fetchJsonWithBasicAuth(targetUrl, projectState.env.WP_ADMIN_USER, projectState.env.WP_APP_PASSWORD);
  } catch (error) {
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

function buildPromptPersonalizationFromPlan(plan) {
  const proposed = plan.proposed && typeof plan.proposed === "object" ? plan.proposed : {};
  const fields = proposed.personalization && typeof proposed.personalization === "object"
    ? proposed.personalization
    : {};
  const designProfile = proposed.design_profile && typeof proposed.design_profile === "object"
    ? proposed.design_profile
    : {};
  const applyFields = {};

  for (const key of STATE_APPLY_ALLOWLIST) {
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

function validateStatePlanForApply(state, plan) {
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

  if (plan.can_apply_without_confirmation !== true || (Array.isArray(plan.conflicts) && plan.conflicts.length > 0)) {
    const blockedError = new Error("Plan has protected user override conflicts and requires explicit confirmation.");
    blockedError.blockedCode = "state_plan_requires_confirmation";
    blockedError.blockedConflicts = Array.isArray(plan.conflicts) ? plan.conflicts : [];
    throw blockedError;
  }

  const userOverrides = state.user_overrides && typeof state.user_overrides === "object" ? state.user_overrides : {};
  const proposed = plan.proposed && plan.proposed.personalization && typeof plan.proposed.personalization === "object"
    ? plan.proposed.personalization
    : {};
  const lateConflicts = [];

  for (const [fieldKey, override] of Object.entries(userOverrides)) {
    if (!override || override.protected !== true) {
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

  if (!state) {
    throw new Error(
      "Managed state is missing. Run: node launcher/src/cli.js state --slug " +
      projectState.project.slug +
      " refresh"
    );
  }

  const beforeStateCopyPath = path.join(statePaths.appliesPath, "state-before-" + timestampCompact() + ".json");
  writeJsonFile(beforeStateCopyPath, state);

  try {
    validateStatePlanForApply(state, plan);
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
  const promptPersonalization = buildPromptPersonalizationFromPlan(plan);
  const proposedFields = promptPersonalization.fields;
  const appliedFields = [];
  const ignoredFields = [];

  for (const [key, value] of Object.entries(plan.proposed && plan.proposed.personalization && typeof plan.proposed.personalization === "object" ? plan.proposed.personalization : {})) {
    if (STATE_APPLY_ALLOWLIST.includes(key) && asString(value)) {
      appliedFields.push(key);
    } else {
      ignoredFields.push(key);
    }
  }

  const preservedProtectedFields = extractProtectedFields(state.user_overrides || {});
  let enteredMutationBoundary = false;
  let executeData = null;
  let preconditions = null;
  let afterCounts = null;
  let refreshResult = null;
  let homeHtmlBefore = null;
  let homeHtmlAfter = null;

  try {
    preconditions = await validateStateApplyPreconditions(projectState, applyId, warnings);
    const prompt = asString(plan.prompt);
    if (!prompt) {
      throw new Error("Selected state plan is missing its prompt.");
    }

    homeHtmlBefore = await readHomeHtml(projectState.project.wp_url);
    const runtimeCountsBefore = await readRuntimeCounts(projectState, applyId + "-before", warnings);
    const rerun = await rerunPlanningChain(projectState, prompt, promptPersonalization, applyId, warnings);
    const gate = rerun.results.generate_gate || {};
    const preflight = rerun.results.generate_preflight || {};
    const confirmation = rerun.results.generate_confirmation || {};

    if (!toBooleanTrue(gate.can_generate)) {
      throw new Error("State apply gate blocked controlled apply.");
    }

    if (!toBooleanTrue(preflight.preflight_ready)) {
      throw new Error("State apply preflight blocked controlled apply.");
    }

    if (!toBooleanTrue(confirmation.confirmation_ready)) {
      throw new Error("State apply confirmation blocked controlled apply.");
    }

    if (Array.isArray(confirmation.blocking_reasons) && confirmation.blocking_reasons.length > 0) {
      throw new Error("State apply confirmation returned blocking reasons.");
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
    const previewResponse = await postAgentJson(projectState, preconditions.restBase + "/ai/controlled-generate", previewPayload, applyId, warnings);
    const previewData = previewResponse.json || {};

    if (toBooleanTrue(previewData.applies_changes)) {
      throw new Error("Controlled apply preview unexpectedly reported applies_changes=true.");
    }

    if (toBooleanTrue(previewData.provider_called)) {
      throw new Error("Controlled apply preview unexpectedly reported provider_called=true.");
    }

    if (!previewData.confirmation_required_phrase) {
      throw new Error("Controlled apply preview did not return a confirmation phrase.");
    }

    const executePayload = Object.assign({}, previewPayload, {
      execute: true,
      confirmation_phrase: previewData.confirmation_required_phrase
    });
    enteredMutationBoundary = true;
    const executeResponse = await postAgentJson(projectState, preconditions.restBase + "/ai/controlled-generate", executePayload, applyId, warnings);
    executeData = executeResponse.json || {};

    afterCounts = await readRuntimeCounts(projectState, applyId + "-after", warnings);
    homeHtmlAfter = await readHomeHtml(projectState.project.wp_url);

    const mutationStarted = toBooleanTrue(executeData.applies_changes)
      || asString(executeData.mutation_status) === "unknown_after_apply_started"
      || asString(executeData.mutation_status) === "completed";

    if (!mutationStarted) {
      throw new Error("Controlled apply did not enter the mutation boundary: " + String(executeData.message || executeData.code || "unknown apply error"));
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
      applies_changes: true,
      provider_called: false,
      status: "ok",
      code: "state_plan_applied",
      applied_fields: appliedFields,
      ignored_fields: ignoredFields,
      preserved_protected_fields: preservedProtectedFields,
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
        applied_fields: appliedFields,
        ignored_fields: ignoredFields,
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
      status: asString(executeData.status) || "ok",
      last_apply_proof_id: path.basename(proofPath, ".json")
    });
    projectState.project.generated_site = Object.assign({}, defaultGeneratedSiteMetadata(), projectState.project.generated_site || {}, {
      present: true,
      personalization_last_applied: {
        source: promptPersonalization.source,
        provider_called: false,
        fields: proposedFields,
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
    const applyRecord = Object.assign({}, baseApplyRecord, {
      after_values: afterValues,
      home_html_before_contains: {
        agency_name: homeHtmlBefore.body.includes(asString(effectiveBeforeValues.agency_name)),
        hero_title: homeHtmlBefore.body.includes(asString(effectiveBeforeValues.hero_title))
      },
      home_html_after_contains: {
        agency_name: homeHtmlAfter.body.includes(asString(afterValues.agency_name)),
        hero_title: homeHtmlAfter.body.includes(asString(afterValues.hero_title)),
        hero_subtitle: homeHtmlAfter.body.includes(asString(afterValues.hero_subtitle)),
        hero_cta_text: homeHtmlAfter.body.includes(asString(afterValues.hero_cta_text))
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
      applied_fields,
      ignored_fields,
      preserved_protected_fields: preservedProtectedFields,
      conflicts,
      before_values: effectiveBeforeValues,
      after_values: {},
      before_counts: beforeCounts,
      after_counts,
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
        agency_name: homeHtmlBefore.body.includes(asString(effectiveBeforeValues.agency_name)),
        hero_title: homeHtmlBefore.body.includes(asString(effectiveBeforeValues.hero_title))
      },
      home_html_after_contains: {
        agency_name: homeHtmlAfter.body.includes(asString(afterValues.agency_name)),
        hero_title: homeHtmlAfter.body.includes(asString(afterValues.hero_title)),
        hero_subtitle: homeHtmlAfter.body.includes(asString(afterValues.hero_subtitle)),
        hero_cta_text: homeHtmlAfter.body.includes(asString(afterValues.hero_cta_text))
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
