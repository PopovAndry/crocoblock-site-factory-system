"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  assertSafeRuntimePath,
  ensureDirectory,
  readProjectBySlug,
  resolveProjectsRoot,
  writeJsonFile
} = require("./project-store");
const {
  derivePromptPersonalization,
  summarizeAppliedFieldKeys
} = require("./prompt-personalization");
const { runCommand } = require("./runtime-tools");

const STATE_SCHEMA = "factory_state";
const STATE_VERSION = 1;
const STATE_PLAN_SCHEMA = "factory_state_plan";
const STATE_PLAN_VERSION = 1;
const DOCKER_TIMEOUT_MS = 180000;

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
  ensureDirectory(statePath);
  ensureDirectory(snapshotsPath);
  ensureDirectory(plansPath);
  return {
    statePath,
    snapshotsPath,
    plansPath,
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
  const generateProofEntry = findLatestProofFile(
    runtimePath,
    "generate-",
    projectState.project.generation && projectState.project.generation.last_proof_id
  );
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
    warnings: Array.isArray(state.warnings) ? state.warnings : []
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

module.exports = {
  STATE_SCHEMA,
  STATE_VERSION,
  STATE_PLAN_SCHEMA,
  STATE_PLAN_VERSION,
  planState,
  readStateStatus,
  refreshState
};
