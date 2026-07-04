"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  assertSafeRuntimePath,
  defaultGeneratedSiteMetadata,
  readProjectBySlug,
  resolveProjectsRoot,
  saveProjectRecord,
  writeJsonFile
} = require("./project-store");
const { requestJson } = require("./agent-client");

function timestampCompact() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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
        proof: readJsonFile(expectedPath)
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
    proof: readJsonFile(candidates[0].filePath)
  };
}

function deriveGeneratedUrls(project, proof) {
  const urls = Object.assign({}, defaultGeneratedSiteMetadata().urls);
  const fromProject = project.generated_site && project.generated_site.urls ? project.generated_site.urls : {};
  const fromProof = proof && proof.generated_urls ? proof.generated_urls : {};

  Object.assign(urls, fromProof, fromProject);

  if (!asString(urls.home) && asString(urls.root)) {
    urls.home = urls.root;
  }

  if (!asString(urls.root) && asString(urls.home)) {
    urls.root = urls.home;
  }

  return urls;
}

function deriveFrontendEditStatus(project, generatedUrls) {
  const capabilityMap = project.agent
    && project.agent.capabilities
    && project.agent.capabilities.capabilities
    && typeof project.agent.capabilities.capabilities === "object"
      ? project.agent.capabilities.capabilities
      : {};
  const explicitUrl = asString(generatedUrls.frontend_edit);
  const candidateUrl = explicitUrl || asString(generatedUrls.home) || asString(generatedUrls.contact);

  if (capabilityMap.frontend_safe_edit !== true) {
    return {
      available: false,
      url: explicitUrl || null,
      reason: "Agent does not currently advertise frontend safe edit."
    };
  }

  if (!candidateUrl) {
    return {
      available: false,
      url: null,
      reason: "Generated page URL for frontend safe edit is not available yet."
    };
  }

  return {
    available: true,
    url: candidateUrl,
    reason: "Frontend safe edit reuses the generated page URL for the admin overlay."
  };
}

function buildCountsSummary(proof) {
  if (!proof) {
    return null;
  }

  return {
    before: proof.before_counts || null,
    after: proof.after_counts || null
  };
}

async function checkUrl(targetUrl, warnings) {
  if (!targetUrl) {
    return 0;
  }

  try {
    const response = await requestJson(targetUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/json"
      },
      timeoutMs: 5000
    });
    return response.statusCode;
  } catch (error) {
    warnings.push("URL check failed for " + targetUrl + ": " + error.message);
    return 0;
  }
}

async function verifyGeneratedUrls(generatedUrls, frontendEditUrl, warnings) {
  const targets = {
    home: asString(generatedUrls.home) || asString(generatedUrls.root),
    properties: asString(generatedUrls.properties),
    contact: asString(generatedUrls.contact)
  };

  if (frontendEditUrl) {
    targets.frontend_edit = frontendEditUrl;
  }

  const statusMap = {};
  for (const [key, targetUrl] of Object.entries(targets)) {
    if (!targetUrl) {
      continue;
    }
    statusMap[key] = await checkUrl(targetUrl, warnings);
  }

  return statusMap;
}

function nextSuggestedAction(status) {
  if (!status.generated_site_present) {
    return "Run controlled generate after planning and dependency checks pass.";
  }

  if (status.frontend_edit_available) {
    return "Open Home or Frontend Edit to review the generated site.";
  }

  return "Open Home to review the generated site.";
}

function maybePersistDiscoveredFrontendEdit(projectState, frontendEditUrl) {
  if (!frontendEditUrl) {
    return false;
  }

  const currentUrls = projectState.project.generated_site && projectState.project.generated_site.urls
    ? projectState.project.generated_site.urls
    : {};
  if (asString(currentUrls.frontend_edit) === frontendEditUrl) {
    return false;
  }

  projectState.project.generated_site = Object.assign({}, defaultGeneratedSiteMetadata(), projectState.project.generated_site || {}, {
    present: projectState.project.generated_site && projectState.project.generated_site.present === true,
    urls: Object.assign({}, currentUrls, {
      frontend_edit: frontendEditUrl
    })
  });
  saveProjectRecord(projectState, projectState.project);
  return true;
}

async function getSiteStatus(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  assertSafeRuntimePath(projectState.runtimePath, projectsRoot);

  const latestProofEntry = findLatestProofFile(
    projectState.runtimePath,
    "generate-",
    projectState.project.generation && projectState.project.generation.last_proof_id
  );
  const latestProof = latestProofEntry ? latestProofEntry.proof : null;
  const generatedUrls = deriveGeneratedUrls(projectState.project, latestProof);
  const frontendEdit = deriveFrontendEditStatus(projectState.project, generatedUrls);
  const warnings = [];
  const countsSummary = buildCountsSummary(latestProof);

  if (frontendEdit.available) {
    generatedUrls.frontend_edit = frontendEdit.url;
  }

  if (options.persistProject !== false) {
    maybePersistDiscoveredFrontendEdit(projectState, frontendEdit.available ? frontendEdit.url : null);
  }

  const urlStatus = options.checkUrls === false
    ? {}
    : await verifyGeneratedUrls(generatedUrls, frontendEdit.available ? frontendEdit.url : null, warnings);

  const siteStatus = {
    project_id: projectState.project.project_id,
    site_name: projectState.project.site_name,
    slug: projectState.project.slug,
    runtime_path: projectState.runtimePath,
    wp_url: projectState.project.wp_url,
    generation_status: asString(projectState.project.generation && projectState.project.generation.status) || "not_generated",
    generated_site_present: Boolean(projectState.project.generated_site && projectState.project.generated_site.present),
    latest_generate_proof_id: latestProof && latestProof.proof_id ? latestProof.proof_id : (projectState.project.generation && projectState.project.generation.last_proof_id) || null,
    latest_generate_proof_path: latestProofEntry ? latestProofEntry.proofPath : null,
    generated_urls: generatedUrls,
    frontend_edit_url: frontendEdit.available ? frontendEdit.url : null,
    frontend_edit_available: frontendEdit.available,
    frontend_edit_reason: frontendEdit.reason,
    counts_summary: countsSummary,
    controlled_generate_status: latestProof ? latestProof.controlled_generate_status || null : null,
    controlled_generate_code: latestProof ? latestProof.controlled_generate_code || null : null,
    url_status: urlStatus,
    warnings,
    next_suggested_action: ""
  };

  siteStatus.next_suggested_action = nextSuggestedAction(siteStatus);

  return {
    project: projectState.project,
    site: siteStatus
  };
}

async function writeSiteSurfaceProof(options) {
  const statusResult = await getSiteStatus(Object.assign({}, options, {
    persistProject: true,
    checkUrls: options.checkUrls !== false
  }));
  const proofId = "site-surface-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
  const proof = {
    proof_id: proofId,
    project_id: statusResult.project.project_id,
    slug: statusResult.project.slug,
    wp_url: statusResult.project.wp_url,
    generation_status: statusResult.site.generation_status,
    generated_site_present: statusResult.site.generated_site_present,
    latest_generate_proof_id: statusResult.site.latest_generate_proof_id,
    generated_urls: statusResult.site.generated_urls,
    frontend_edit_url: statusResult.site.frontend_edit_url,
    frontend_edit_available: statusResult.site.frontend_edit_available,
    counts_summary: statusResult.site.counts_summary,
    applies_changes: false,
    mutation_scope: "launcher_project_metadata_only",
    created_at: new Date().toISOString(),
    warnings: statusResult.site.warnings
  };
  const proofPath = path.join(statusResult.site.runtime_path, "proofs", proofId + ".json");
  writeJsonFile(proofPath, proof);

  return {
    project: statusResult.project,
    site: statusResult.site,
    proof,
    proofPath
  };
}

module.exports = {
  getSiteStatus,
  writeSiteSurfaceProof
};
