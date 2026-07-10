"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  assertSafeRuntimePath,
  readProjectBySlug,
  resolveProjectsRoot,
  writeJsonFile
} = require("./project-store");
const { refreshState } = require("./state");
const { getSiteStatus } = require("./site");
const { generateProofPack } = require("./proof-pack");

const ALPHA_SMOKE_SCHEMA = "factory_alpha_smoke_summary";
const ALPHA_SMOKE_VERSION = 1;
const SECRET_PATTERNS = [
  "Authorization",
  "Bearer",
  "OPENAI_API_KEY=",
  "WP_APP_PASSWORD",
  "DB_PASSWORD",
  "sk-"
];

function nowIso() {
  return new Date().toISOString();
}

function timestampCompact() {
  return nowIso().replace(/[:.]/g, "-");
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  return Array.from(new Set(asArray(values).filter((value) => typeof value === "string" && value.trim()))).sort();
}

function getRepoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function readGitValue(args) {
  try {
    return execFileSync("git", args, {
      cwd: getRepoRoot(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch (error) {
    return null;
  }
}

function ensureRequirement(value) {
  const normalized = String(value || "generated-site").trim().toLowerCase();
  if (normalized !== "generated-site" && normalized !== "full-alpha") {
    throw new Error("alpha-smoke requires --require generated-site|full-alpha.");
  }
  return normalized;
}

function scanFileForSecrets(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf8");
  const hits = [];
  for (const pattern of SECRET_PATTERNS) {
    if (content.includes(pattern)) {
      hits.push(pattern);
    }
  }
  return hits;
}

function buildCounts(stateRefreshResult, siteStatusResult, proofPackResult) {
  const summary = stateRefreshResult.summary || {};
  const proofCounts = proofPackResult.summary && proofPackResult.summary.counts ? proofPackResult.summary.counts : {};
  const siteCounts = siteStatusResult.site && siteStatusResult.site.counts_summary && siteStatusResult.site.counts_summary.after
    ? siteStatusResult.site.counts_summary.after
    : {};

  return {
    pages: Number(summary.pages || proofCounts.pages || siteCounts.pages || 0),
    properties: Number(summary.property_count || proofCounts.properties || siteCounts.properties || 0),
    attachments: Number(summary.attachment_count || proofCounts.attachments || siteCounts.attachments || 0)
  };
}

function buildUrls(siteStatusResult) {
  const urls = siteStatusResult.site && siteStatusResult.site.generated_urls ? siteStatusResult.site.generated_urls : {};
  const status = siteStatusResult.site && siteStatusResult.site.url_status ? siteStatusResult.site.url_status : {};

  return {
    home: {
      url: urls.home || urls.root || null,
      status: Number(status.home || 0)
    },
    properties: {
      url: urls.properties || null,
      status: Number(status.properties || 0)
    },
    contact: {
      url: urls.contact || null,
      status: Number(status.contact || 0)
    }
  };
}

function computeSmokeStatus(requirement, readiness) {
  const generated = readiness && readiness.generated_site_ready ? readiness.generated_site_ready : {};
  const aiHistory = readiness && readiness.ai_safe_apply_history_ready ? readiness.ai_safe_apply_history_ready : {};
  const secrets = readiness && readiness.secrets_ready ? readiness.secrets_ready : {};
  const overall = readiness && readiness.alpha_evaluator_ready ? readiness.alpha_evaluator_ready : {};

  const generatedReady = asString(generated.status) === "ready";
  const secretsReady = asString(secrets.status) === "ready";
  const aiHistoryReady = asString(aiHistory.status) === "ready";
  const overallReady = asString(overall.status) === "ready";

  if (requirement === "generated-site") {
    if (generatedReady && secretsReady) {
      return {
        status: "pass",
        exitCode: 0
      };
    }
    return {
      status: "fail",
      exitCode: 1
    };
  }

  if (generatedReady && secretsReady && aiHistoryReady && overallReady) {
    return {
      status: "pass",
      exitCode: 0
    };
  }

  if (generatedReady && secretsReady) {
    return {
      status: "partial",
      exitCode: 1
    };
  }

  return {
    status: "fail",
    exitCode: 1
  };
}

function collectReadinessMessages(readiness, requirement) {
  const generated = readiness && readiness.generated_site_ready ? readiness.generated_site_ready : {};
  const aiHistory = readiness && readiness.ai_safe_apply_history_ready ? readiness.ai_safe_apply_history_ready : {};
  const secrets = readiness && readiness.secrets_ready ? readiness.secrets_ready : {};
  const overall = readiness && readiness.alpha_evaluator_ready ? readiness.alpha_evaluator_ready : {};

  const blockers = uniqueStrings(
    []
      .concat(asArray(generated.blockers))
      .concat(asArray(secrets.blockers))
      .concat(requirement === "full-alpha" ? asArray(overall.blockers) : [])
  );
  const warnings = uniqueStrings(
    []
      .concat(asArray(generated.warnings))
      .concat(asArray(aiHistory.warnings))
      .concat(asArray(secrets.warnings))
      .concat(asArray(overall.warnings))
  );
  const notes = [];

  if (requirement === "generated-site" && asString(aiHistory.status) !== "ready") {
    notes.push("AI safe-apply/rollback history is missing on this runtime, but that is not a generation failure for generated-site smoke.");
  }

  if (requirement === "full-alpha" && asString(aiHistory.status) !== "ready") {
    notes.push("Full-alpha requirement failed because the live AI safe-apply/rollback proof chain is incomplete on this runtime.");
  }

  if (asString(overall.reason)) {
    notes.push(overall.reason);
  }

  return {
    blockers,
    warnings,
    notes: uniqueStrings(notes)
  };
}

async function runAlphaSmoke(options) {
  const requirement = ensureRequirement(options && options.requirement);
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  const safeRuntimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const createdAt = nowIso();

  const repo = {
    head: readGitValue(["rev-parse", "--short", "HEAD"]),
    branch: readGitValue(["rev-parse", "--abbrev-ref", "HEAD"])
  };

  const stateRefreshResult = await refreshState({
    slug: projectState.project.slug,
    projectsRoot
  });
  const siteStatusResult = await getSiteStatus({
    slug: projectState.project.slug,
    projectsRoot,
    persistProject: false,
    checkUrls: true
  });
  const proofPackResult = await generateProofPack({
    slug: projectState.project.slug,
    projectsRoot
  });

  const readiness = proofPackResult.proofPack && proofPackResult.proofPack.readiness
    ? proofPackResult.proofPack.readiness
    : {};
  const smokeStatus = computeSmokeStatus(requirement, readiness);
  const readinessMessages = collectReadinessMessages(readiness, requirement);
  const counts = buildCounts(stateRefreshResult, siteStatusResult, proofPackResult);
  const urls = buildUrls(siteStatusResult);
  const secretsPath = path.join(safeRuntimePath, "secrets", "ai.env");
  const secretsAiEnvAbsent = !fs.existsSync(secretsPath);
  const summaryProofPath = path.join(safeRuntimePath, "proofs", "alpha-smoke-" + timestampCompact() + ".json");

  let summary = {
    schema: ALPHA_SMOKE_SCHEMA,
    version: ALPHA_SMOKE_VERSION,
    created_at: createdAt,
    slug: projectState.project.slug,
    project_root: safeRuntimePath,
    wp_url: projectState.project.wp_url,
    repo,
    requirement,
    status: smokeStatus.status,
    exit_code_recommended: smokeStatus.exitCode,
    steps: {
      state_refresh: {
        status: "ok",
        state_path: stateRefreshResult.statePath,
        snapshot_path: stateRefreshResult.snapshotPath,
        proof_path: stateRefreshResult.proofPath,
        warnings: uniqueStrings(stateRefreshResult.state && stateRefreshResult.state.warnings)
      },
      site_status: {
        status: "ok",
        generated_site_present: siteStatusResult.site.generated_site_present === true,
        generation_status: siteStatusResult.site.generation_status,
        proof_path: siteStatusResult.site.latest_generate_proof_path || null,
        warnings: uniqueStrings(siteStatusResult.site.warnings)
      },
      proof_pack: {
        status: "ok",
        proof_id: proofPackResult.summary ? proofPackResult.summary.proof_id : null,
        readiness_status: proofPackResult.summary ? proofPackResult.summary.readiness_status : "unknown",
        json_path: proofPackResult.jsonPath,
        markdown_path: proofPackResult.markdownPath,
        warnings: uniqueStrings(proofPackResult.proofPack && proofPackResult.proofPack.warnings)
      },
      secret_check: {
        status: secretsAiEnvAbsent ? "ok" : "fail",
        secrets_ai_env_absent: secretsAiEnvAbsent,
        scanned_files: [
          proofPackResult.jsonPath,
          proofPackResult.markdownPath,
          summaryProofPath
        ]
      }
    },
    readiness,
    counts,
    urls,
    proofs: {
      proof_pack_json: proofPackResult.jsonPath,
      proof_pack_md: proofPackResult.markdownPath,
      alpha_smoke_summary: summaryProofPath
    },
    safety: {
      live_ai_used: false,
      apply_used: false,
      rollback_used: false,
      generate_used: false,
      dependency_install_used: false,
      wp_content_mutation_used: false,
      secrets_ai_env_absent: secretsAiEnvAbsent,
      raw_secret_hits: []
    },
    blockers: readinessMessages.blockers,
    warnings: readinessMessages.warnings,
    notes: readinessMessages.notes
  };

  writeJsonFile(summaryProofPath, summary);

  const rawSecretHits = uniqueStrings(
    []
      .concat(scanFileForSecrets(proofPackResult.jsonPath))
      .concat(scanFileForSecrets(proofPackResult.markdownPath))
      .concat(scanFileForSecrets(summaryProofPath))
  );

  summary.safety.raw_secret_hits = rawSecretHits;
  summary.steps.secret_check.raw_secret_hits = rawSecretHits;
  if (!secretsAiEnvAbsent) {
    summary.blockers = uniqueStrings(summary.blockers.concat("secrets/ai.env is present for this project."));
  }
  if (rawSecretHits.length) {
    summary.blockers = uniqueStrings(summary.blockers.concat("Secret-like patterns were found in generated proof files."));
  }

  if (!secretsAiEnvAbsent || rawSecretHits.length) {
    summary.status = "fail";
    summary.exit_code_recommended = 1;
  }

  writeJsonFile(summaryProofPath, summary);

  return summary;
}

module.exports = {
  runAlphaSmoke
};
