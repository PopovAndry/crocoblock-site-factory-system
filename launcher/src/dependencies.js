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

function timestampCompact() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function toBooleanTrue(value) {
  return value === true || value === "true";
}

async function getAgentJson(projectState, targetUrl, warnings) {
  try {
    if (!projectState.env.WP_APP_PASSWORD) {
      throw new Error("Launcher project is missing a stored application password.");
    }

    return await fetchJsonWithBasicAuth(targetUrl, projectState.env.WP_ADMIN_USER, projectState.env.WP_APP_PASSWORD);
  } catch (error) {
    const cookieHeader = await loginWithAdminCookie(projectState);
    const restNonce = await createRestNonce(projectState, "dependencies-read-" + timestampCompact());
    warnings.push("Agent dependency auth fell back to admin cookie context.");
    return fetchJsonWithCookie(targetUrl, cookieHeader, restNonce);
  }
}

function summarizeDependencies(payload) {
  const dependencies = Array.isArray(payload.dependencies) ? payload.dependencies : [];
  const blockers = dependencies
    .filter((dependency) => toBooleanTrue(dependency.blocking))
    .map((dependency) => dependency.name + ": " + String(dependency.notes || "Required dependency is not ready."));
  const legalHandoffRequired = dependencies.some((dependency) => {
    return toBooleanTrue(dependency.blocking) && String(dependency.source_policy || "") === "official_crocoblock";
  });

  return {
    site_type: String(payload.site_type || "real_estate"),
    dependencies,
    blockers,
    can_generate: blockers.length === 0 && toBooleanTrue(payload.can_generate) !== false,
    legal_handoff_required: legalHandoffRequired
  };
}

function buildDependencyStateRecord(payload, summary, proofId, createdAt) {
  return {
    status: String(payload.status || "ok"),
    code: String(payload.code || "dependencies_ready"),
    site_type: summary.site_type,
    blockers: summary.blockers,
    can_generate: summary.can_generate,
    legal_handoff_required: summary.legal_handoff_required,
    dependencies: summary.dependencies,
    last_proof_id: proofId,
    checked_at: createdAt,
    next_action: summary.blockers.length
      ? "Install required dependencies via official/manual flow"
      : "Dependencies ready for future generate gate"
  };
}

async function fetchDependencyStatus(projectState, warnings) {
  const restBase = String(projectState.project.agent && projectState.project.agent.rest_base || "");
  if (!restBase) {
    throw new Error("Launcher project is missing agent.rest_base.");
  }

  await waitForUrl(projectState.project.wp_url);

  const response = await getAgentJson(projectState, restBase + "/agent/dependencies", warnings);
  const payload = response.json || {};
  const summary = summarizeDependencies(payload);

  return {
    restBase,
    response,
    payload,
    summary
  };
}

async function readDependencies(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  const safeRuntimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const createdAt = new Date().toISOString();
  const proofId = "dependencies-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
  const warnings = [];

  if ((projectState.project.runtime && projectState.project.runtime.status) !== "provisioned") {
    throw new Error("Launcher project must be provisioned before dependency checks.");
  }

  if ((projectState.project.agent && projectState.project.agent.status) !== "installed") {
    throw new Error("Site Factory Agent must be installed before dependency checks.");
  }

  const dependencyStatus = await fetchDependencyStatus(projectState, warnings);
  const payload = dependencyStatus.payload;
  const summary = dependencyStatus.summary;
  const proof = {
    proof_id: proofId,
    project_id: projectState.project.project_id,
    slug: projectState.project.slug,
    wp_url: projectState.project.wp_url,
    dependencies: summary.dependencies,
    blockers: summary.blockers,
    can_generate: summary.can_generate,
    legal_handoff_required: summary.legal_handoff_required,
    applies_changes: false,
    mutation_scope: "launcher_project_metadata_only",
    created_at: createdAt,
    warnings
  };
  const proofPath = path.join(safeRuntimePath, "proofs", proofId + ".json");

  writeJsonFile(proofPath, proof);

  projectState.project.dependency_state = buildDependencyStateRecord(payload, summary, proofId, createdAt);
  saveProjectRecord(projectState, projectState.project);

  return {
    project: projectState.project,
    proof,
    proofPath,
    dependencies: summary.dependencies,
    blockers: summary.blockers
  };
}

module.exports = {
  buildDependencyStateRecord,
  fetchDependencyStatus,
  readDependencies
};
