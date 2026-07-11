"use strict";

const path = require("path");
const { readProjectBySlug, resolveProjectsRoot } = require("./project-store");
const { fetchDependencyStatus } = require("./dependencies");
const { listApprovedDependencySources } = require("./dependency-sources");

function getProofPath(runtimePath, proofId) {
  if (!proofId) {
    return null;
  }

  return path.join(runtimePath, "proofs", proofId + ".json");
}

function summarizeDependencyRow(liveDependencies, approvedSources, dependencyKey) {
  const liveEntry = Array.isArray(liveDependencies)
    ? liveDependencies.find((entry) => String(entry.slug || entry.key || "").trim().toLowerCase() === dependencyKey)
    : null;
  const source = approvedSources.find((entry) => entry.key === dependencyKey) || null;

  return {
    key: dependencyKey,
    label: source ? source.label : dependencyKey,
    required: true,
    source_available: Boolean(source && source.exists),
    source_filename: source ? source.filename : null,
    source_size: source ? source.size : null,
    installed: Boolean(liveEntry && liveEntry.installed),
    active: Boolean(liveEntry && liveEntry.active),
    blocking: Boolean(liveEntry && liveEntry.blocking),
    notes: liveEntry && liveEntry.notes ? String(liveEntry.notes) : null
  };
}

async function getSetupStatus(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  const approvedSources = listApprovedDependencySources();
  const warnings = [];
  let dependencyState = projectState.project.dependency_state || null;
  let dependencyStatus = "not_started";
  let blockers = dependencyState && Array.isArray(dependencyState.blockers) ? dependencyState.blockers : [];
  let dependencies = [];

  if ((projectState.project.runtime && projectState.project.runtime.status) === "provisioned" &&
      (projectState.project.agent && projectState.project.agent.status) === "installed") {
    try {
      const liveDependencyStatus = await fetchDependencyStatus(projectState, warnings);
      dependencyState = Object.assign({}, dependencyState || {}, {
        status: String(liveDependencyStatus.payload.status || "ok"),
        code: String(liveDependencyStatus.payload.code || "dependencies_ready"),
        site_type: liveDependencyStatus.summary.site_type,
        blockers: liveDependencyStatus.summary.blockers,
        can_generate: liveDependencyStatus.summary.can_generate,
        legal_handoff_required: liveDependencyStatus.summary.legal_handoff_required,
        dependencies: liveDependencyStatus.summary.dependencies,
        checked_at: new Date().toISOString(),
        next_action: liveDependencyStatus.summary.blockers.length
          ? "Install required dependencies from approved ZIP sources."
          : "Dependencies ready for controlled generate."
      });
    } catch (error) {
      warnings.push("Dependency refresh failed: " + error.message);
    }
  }

  if (dependencyState) {
    blockers = Array.isArray(dependencyState.blockers) ? dependencyState.blockers : [];
    dependencies = Array.isArray(dependencyState.dependencies) ? dependencyState.dependencies : [];
    dependencyStatus = dependencyState.can_generate ? "ready" : "blocked";
  }

  const dependencyRows = approvedSources.map((source) => summarizeDependencyRow(dependencies, approvedSources, source.key));
  const runtimeProofPath = getProofPath(projectState.runtimePath, projectState.project.runtime && projectState.project.runtime.last_proof_id);
  const agentProofPath = getProofPath(projectState.runtimePath, projectState.project.runtime && projectState.project.runtime.last_agent_proof_id);
  const dependencyProofPath = getProofPath(projectState.runtimePath, dependencyState && dependencyState.last_proof_id);
  const readyToGenerate = Boolean(dependencyState && dependencyState.can_generate && blockers.length === 0);

  return {
    project: projectState.project,
    approved_sources: approvedSources,
    setup: {
      project: {
        status: "created",
        runtime_path: projectState.project.runtime_path,
        created_at: projectState.project.created_at
      },
      wordpress: {
        status: projectState.project.runtime && projectState.project.runtime.status === "provisioned" ? "ready" : "not_started",
        wp_url: projectState.project.wp_url,
        wp_json_ok: Boolean(projectState.project.runtime && projectState.project.runtime.wp_json_ok),
        proof_path: runtimeProofPath
      },
      agent: {
        status: projectState.project.agent && projectState.project.agent.status === "installed" ? "ready" : "not_started",
        health_status: projectState.project.agent && projectState.project.agent.health ? projectState.project.agent.health.status : null,
        capabilities_status: projectState.project.agent && projectState.project.agent.capabilities ? projectState.project.agent.capabilities.status : null,
        rest_base: projectState.project.agent && projectState.project.agent.rest_base || null,
        proof_path: agentProofPath
      },
      dependencies: {
        status: dependencyStatus,
        proof_path: dependencyProofPath,
        blockers,
        can_generate: Boolean(dependencyState && dependencyState.can_generate),
        next_action: dependencyState && dependencyState.next_action || "Install the required approved dependencies.",
        rows: dependencyRows
      },
      ready_to_generate: readyToGenerate
    },
    warnings
  };
}

module.exports = {
  getSetupStatus
};
