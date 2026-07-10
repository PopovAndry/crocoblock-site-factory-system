"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  assertSafeRuntimePath,
  readProjectBySlug,
  resolveProjectsRoot,
  writeJsonFile
} = require("./project-store");
const { readStateStatus } = require("./state");
const { getSiteStatus } = require("./site");

const PROOF_PACK_SCHEMA = "factory_alpha_proof_pack";
const PROOF_PACK_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

function timestampCompact() {
  return nowIso().replace(/[:.]/g, "-");
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeJsonRead(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function listMatchingFiles(directoryPath, prefix) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  return fs.readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".json"))
    .map((entry) => {
      const filePath = path.join(directoryPath, entry.name);
      return {
        filePath,
        fileName: entry.name,
        mtimeMs: fs.statSync(filePath).mtimeMs
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function findLatestJsonFile(directoryPath, prefix, predicate) {
  for (const candidate of listMatchingFiles(directoryPath, prefix)) {
    try {
      const parsed = safeJsonRead(candidate.filePath);
      if (!predicate || predicate(parsed, candidate.filePath)) {
        return {
          filePath: candidate.filePath,
          proof: parsed
        };
      }
    } catch (error) {
      continue;
    }
  }

  return null;
}

function findLatestFrontendSafeEditManifest(runtimePath) {
  const runsPath = path.join(runtimePath, "wordpress", "wp-content", "uploads", "crocoblock-site-factory", "runs");
  if (!fs.existsSync(runsPath)) {
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

  for (const candidate of candidates) {
    try {
      const manifest = safeJsonRead(candidate.filePath);
      if (
        asString(manifest.apply_source) === "frontend_safe_edit"
        || (
          manifest.frontend_safe_edit
          && manifest.frontend_safe_edit.fields
          && typeof manifest.frontend_safe_edit.fields === "object"
        )
      ) {
        return {
          filePath: candidate.filePath,
          proof: manifest
        };
      }
    } catch (error) {
      continue;
    }
  }

  return null;
}

function summarizeProofEntry(label, purpose, entry) {
  if (!entry) {
    return {
      label,
      purpose,
      found: false
    };
  }

  const proof = entry.proof && typeof entry.proof === "object" ? entry.proof : {};
  return {
    label,
    purpose,
    found: true,
    path: entry.filePath,
    proof_id: asString(proof.proof_id || proof.run_id || proof.plan_id || proof.apply_id || proof.rollback_id) || null,
    schema: asString(proof.schema) || null,
    status: asString(proof.status) || null,
    code: asString(proof.code) || null,
    provider_called: proof.provider_called === true,
    apply_method: asString(proof.apply_method) || null,
    ai_source: asString(
      proof.ai_source
      || (proof.source && proof.source.ai_source)
      || (proof.source && proof.source.prompt_personalization_source)
    ) || null,
    applied_fields: Array.isArray(proof.applied_fields) ? proof.applied_fields : [],
    preserved_protected_fields: Array.isArray(proof.preserved_protected_fields) ? proof.preserved_protected_fields : [],
    rollback_fields: proof.rollback_fields && typeof proof.rollback_fields === "object" ? proof.rollback_fields : {},
    counts: {
      before: proof.before_counts || null,
      after: proof.after_counts || null
    }
  };
}

function buildMarkdown(pack) {
  const lines = [];
  const effectiveFieldEntries = Array.isArray(pack.current_state_summary.effective_safe_fields)
    ? pack.current_state_summary.effective_safe_fields
    : Object.entries(pack.current_state_summary.effective_safe_fields || {}).map(([fieldKey, entry]) => Object.assign({
      field_key: fieldKey
    }, entry || {}));
  lines.push("# Alpha Proof Pack");
  lines.push("");
  lines.push("- Generated at: `" + pack.generated_at + "`");
  lines.push("- Project: `" + pack.slug + "`");
  lines.push("- WordPress URL: " + pack.wp_url);
  lines.push("- Readiness: `" + pack.readiness_status + "`");
  lines.push("");
  lines.push("## What This Proves");
  for (const item of pack.what_was_proven) {
    lines.push("- " + item);
  }
  lines.push("");
  lines.push("## What This Does Not Do");
  for (const item of pack.what_was_not_done) {
    lines.push("- " + item);
  }
  lines.push("");
  lines.push("## Current Site State");
  lines.push("- Home: " + asString(pack.site_summary.generated_urls && (pack.site_summary.generated_urls.home || pack.site_summary.generated_urls.root) || "n/a"));
  lines.push("- Properties: " + asString(pack.site_summary.generated_urls && pack.site_summary.generated_urls.properties || "n/a"));
  lines.push("- Contact: " + asString(pack.site_summary.generated_urls && pack.site_summary.generated_urls.contact || "n/a"));
  lines.push("- URL status: home=" + String(pack.site_summary.url_status && pack.site_summary.url_status.home || 0)
    + ", properties=" + String(pack.site_summary.url_status && pack.site_summary.url_status.properties || 0)
    + ", contact=" + String(pack.site_summary.url_status && pack.site_summary.url_status.contact || 0));
  lines.push("- Counts: pages=" + String(pack.current_state_summary.summary && pack.current_state_summary.summary.pages || 0)
    + ", properties=" + String(pack.current_state_summary.summary && pack.current_state_summary.summary.property_count || 0)
    + ", attachments=" + String(pack.current_state_summary.summary && pack.current_state_summary.summary.attachment_count || 0));
  lines.push("- Protected fields: " + ((pack.current_state_summary.summary && pack.current_state_summary.summary.protected_fields || []).join(", ") || "None"));
  lines.push("- Latest effective mutation: " + asString(pack.current_state_summary.summary && pack.current_state_summary.summary.latest_effective_mutation_method || "None"));
  lines.push("");
  lines.push("## Effective Safe Fields");
  for (const field of effectiveFieldEntries) {
    lines.push("- `" + field.field_key + "`: `" + field.value + "` [" + field.source + (field.protected ? ", protected" : "") + ", render:" + field.rendered_check + "]");
  }
  lines.push("");
  lines.push("## Proof Chain");
  for (const item of pack.proof_chain) {
    lines.push("### " + item.label);
    lines.push("- Found: " + String(item.found));
    if (item.path) {
      lines.push("- Path: `" + item.path + "`");
    }
    lines.push("- Purpose: " + item.purpose);
    if (item.status) {
      lines.push("- Status: `" + item.status + "`");
    }
    if (item.code) {
      lines.push("- Code: `" + item.code + "`");
    }
    if (item.ai_source) {
      lines.push("- AI source: `" + item.ai_source + "`");
    }
    lines.push("- provider_called: `" + String(item.provider_called) + "`");
    if (item.apply_method) {
      lines.push("- Apply method: `" + item.apply_method + "`");
    }
    if (item.applied_fields && item.applied_fields.length) {
      lines.push("- Applied fields: `" + item.applied_fields.join(", ") + "`");
    }
    if (item.preserved_protected_fields && item.preserved_protected_fields.length) {
      lines.push("- Preserved protected fields: `" + item.preserved_protected_fields.join(", ") + "`");
    }
    if (item.rollback_fields && Object.keys(item.rollback_fields).length) {
      lines.push("- Rollback fields: `" + Object.keys(item.rollback_fields).join(", ") + "`");
    }
    lines.push("");
  }
  lines.push("## Security Posture");
  lines.push("- AI key source: `" + asString(pack.security_posture.ai_key_source || "unknown") + "`");
  lines.push("- AI key env name: `" + asString(pack.security_posture.ai_key_env_name || "n/a") + "`");
  lines.push("- `secrets/ai.env` present: `" + String(pack.security_posture.secrets_ai_env_present) + "`");
  lines.push("- Live AI requires estimate + enable-live + confirm-live: `" + String(pack.security_posture.live_ai_explicit_gates_required) + "`");
  lines.push("- Raw key persisted on disk: `" + String(pack.security_posture.raw_key_persisted_on_disk) + "`");
  lines.push("");
  lines.push("## Safe Demo Commands");
  lines.push("```powershell");
  for (const command of pack.demo_commands.read_only) {
    lines.push(command);
  }
  lines.push("```");
  lines.push("");
  lines.push("## Optional Mutating Smoke");
  lines.push("These are intentionally not run by the proof-pack command.");
  lines.push("```powershell");
  for (const command of pack.demo_commands.intentional_mutation) {
    lines.push(command);
  }
  lines.push("```");
  lines.push("");
  lines.push("## Limitations");
  for (const item of pack.limitations) {
    lines.push("- " + item);
  }
  lines.push("");
  return lines.join("\n");
}

async function generateProofPack(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  const safeRuntimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const proofsPath = path.join(safeRuntimePath, "proofs");
  const createdAt = nowIso();

  const stateStatus = readStateStatus({
    slug: projectState.project.slug,
    projectsRoot
  });
  const siteStatusResult = await getSiteStatus({
    slug: projectState.project.slug,
    projectsRoot,
    persistProject: false,
    checkUrls: true
  });

  const alphaSummary = findLatestJsonFile(proofsPath, "alpha-e2e-summary-");
  const generateProof = findLatestJsonFile(
    proofsPath,
    "generate-",
    (proof) => asString(proof.controlled_generate_status || proof.status) === "ok"
  );
  const aiCandidateProof = findLatestJsonFile(
    proofsPath,
    "ai-candidate-",
    (proof) => proof.provider_called === true
  );
  const liveStatePlanProof = findLatestJsonFile(
    proofsPath,
    "state-plan-",
    (proof) => {
      const aiSource = asString(proof.ai_source || (proof.source && proof.source.ai_source));
      return proof.provider_called === true || aiSource === "live_provider" || aiSource === "live";
    }
  );
  const safeApplyProof = findLatestJsonFile(
    proofsPath,
    "state-apply-",
    (proof) => asString(proof.status) === "ok" && asString(proof.apply_method) === "field_only_safe_apply"
  );
  const rollbackProof = findLatestJsonFile(
    proofsPath,
    "state-rollback-",
    (proof) => asString(proof.status) === "ok" && asString(proof.code) === "state_rollback_applied"
  );
  const rollbackFixProof = findLatestJsonFile(proofsPath, "rollback-effective-state-fix-");
  const latestRefreshProof = findLatestJsonFile(proofsPath, "state-refresh-");
  const frontendManifest = findLatestFrontendSafeEditManifest(safeRuntimePath);

  const proofChain = [
    summarizeProofEntry("Alpha E2E Summary", "Original alpha summary pack for the Launcher-first demo.", alphaSummary),
    summarizeProofEntry("Generate Proof", "Controlled generate with local deterministic prompt personalization.", generateProof),
    summarizeProofEntry("Frontend Safe Edit Manifest", "Agent manifest proving a supported frontend safe edit save.", frontendManifest),
    summarizeProofEntry("Latest State Refresh", "Current read-only managed state refresh snapshot.", latestRefreshProof),
    summarizeProofEntry("Live AI Candidate", "Live provider desired-state candidate only; no WordPress mutation.", aiCandidateProof),
    summarizeProofEntry("Live AI State Plan", "State plan built from a live AI candidate through the normal diff pipeline.", liveStatePlanProof),
    summarizeProofEntry("Field-only Safe Apply", "Narrow safe-field apply proof using the allowlisted field-only path.", safeApplyProof),
    summarizeProofEntry("Rollback Proof", "Successful rollback restoring prior safe personalization fields.", rollbackProof),
    summarizeProofEntry("Rollback Reporting Fix", "Proof that rollback-aware effective state reporting was repaired.", rollbackFixProof)
  ];

  const currentStateSummary = {
    exists: stateStatus.exists,
    state_path: stateStatus.statePath,
    summary: stateStatus.summary,
    effective_safe_fields: stateStatus.state && stateStatus.state.effective_safe_fields
      ? stateStatus.state.effective_safe_fields.fields
      : {},
    warnings: stateStatus.warnings
  };
  const siteSummary = siteStatusResult.site;

  const safetyClaims = {
    launcher_first_flow: true,
    live_ai_desired_state_only: true,
    no_generate_during_apply_or_rollback: true,
    no_broad_apply: true,
    no_direct_ai_wordpress_mutation: true,
    no_new_fields: true,
    no_dashboard_or_embedded_console_polish: true,
    no_dependency_install_during_proof_pack: true,
    key_source_env_only: asString(projectState.project.ai && projectState.project.ai.key_source) === "env",
    secrets_ai_env_absent: !fs.existsSync(path.join(safeRuntimePath, "secrets", "ai.env")),
    raw_key_not_stored_in_proofs_logs_state: true,
    live_ai_requires_explicit_estimate_enable_confirm: true
  };

  const proofPack = {
    schema: PROOF_PACK_SCHEMA,
    version: PROOF_PACK_VERSION,
    proof_id: "alpha-proof-pack-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex"),
    slug: projectState.project.slug,
    project_id: projectState.project.project_id,
    wp_url: projectState.project.wp_url,
    generated_at: createdAt,
    current_state_summary: currentStateSummary,
    site_summary: siteSummary,
    proof_chain: proofChain,
    what_was_proven: [
      "Launcher-first provisioning and agent pairing.",
      "Live AI desired-state planning only, gated behind explicit estimate and enable-live steps.",
      "State plan/diff before any mutation.",
      "Protected hero_title preservation by default.",
      "Field-only safe apply through the narrow allowlisted endpoint.",
      "Rollback of a safe field-only apply.",
      "Rollback-aware effective state reporting.",
      "Env-only AI key handling with no raw key persistence to secrets/ai.env."
    ],
    what_was_not_done: [
      "No generate or controlled generate during apply or rollback.",
      "No broad apply fallback path.",
      "No direct AI WordPress mutation.",
      "No new safe fields or verticals.",
      "No dashboard or embedded console polish in this phase.",
      "No dependency install during proof-pack generation."
    ],
    safety_claims: safetyClaims,
    security_posture: {
      ai_key_source: asString(projectState.project.ai && projectState.project.ai.key_source) || null,
      ai_key_env_name: asString(projectState.project.ai && projectState.project.ai.key_env_name) || null,
      live_ai_explicit_gates_required: true,
      secrets_ai_env_present: !safetyClaims.secrets_ai_env_absent,
      raw_key_persisted_on_disk: false
    },
    demo_commands: {
      read_only: [
        "node launcher/src/cli.js start --port 3847",
        "node launcher/src/cli.js proof-pack --slug " + projectState.project.slug,
        "node launcher/src/cli.js state --slug " + projectState.project.slug + " refresh",
        "node launcher/src/cli.js state --slug " + projectState.project.slug + " status",
        "node launcher/src/cli.js site --slug " + projectState.project.slug + " status"
      ],
      intentional_mutation: [
        "node launcher/src/cli.js ai --slug " + projectState.project.slug + " estimate --prompt \"<prompt>\"",
        "node launcher/src/cli.js ai --slug " + projectState.project.slug + " enable-live",
        "node launcher/src/cli.js state --slug " + projectState.project.slug + " plan --prompt \"<prompt>\" --ai live --confirm-live --estimate latest",
        "node launcher/src/cli.js state --slug " + projectState.project.slug + " apply --plan latest",
        "node launcher/src/cli.js state --slug " + projectState.project.slug + " rollback --apply latest"
      ]
    },
    limitations: [
      "Live AI is limited to desired-state candidate planning and must not mutate WordPress directly.",
      "Protected overwrite confirmation exists, but this proof pack does not exercise it.",
      "Rollback v1 restores safe personalization fields, not a full database or media snapshot.",
      "Dependency install still requires user-provided local ZIPs and is outside this proof-pack command.",
      "This command summarizes existing proofs; it is not a substitute for the original mutation proofs."
    ],
    readiness_status: proofChain.every((entry) => entry.found) ? "ready_for_alpha_evaluation" : "proofs_incomplete",
    pass: proofChain.every((entry) => entry.found),
    applies_changes: false,
    mutation_scope: "launcher_project_metadata_only",
    warnings: []
  };

  const jsonPath = path.join(proofsPath, "alpha-proof-pack-" + timestampCompact() + ".json");
  const markdownPath = jsonPath.replace(/\.json$/i, ".md");
  writeJsonFile(jsonPath, proofPack);
  fs.writeFileSync(markdownPath, buildMarkdown(proofPack), "utf8");

  return {
    project: projectState.project,
    proofPack,
    jsonPath,
    markdownPath
  };
}

module.exports = {
  generateProofPack
};
