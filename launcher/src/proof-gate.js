"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { isDeepStrictEqual } = require("node:util");
const {
  readProjectBySlug,
  resolveProjectsRoot,
  validateExplicitSlug
} = require("./project-store");
const { deriveProjectBinding, validateManifest } = require("./structural-snapshot-store");
const { baselineFingerprint, coverageFingerprint, exactCoverage, proposedChangeFingerprint } = require("./viewing-date-preview");

const PROOF_GATE_SCHEMA = "csf_proof_gate";
const PROOF_GATE_VERSION = 0;
const SUBMISSION_RECEIPTS_SCHEMA = "csf_viewing_date_submission_receipts";
const SUBMISSION_RECEIPTS_VERSION = 1;
const CLAIMS = [
  "transaction_lineage",
  "authoritative_outcomes",
  "business_submissions",
  "verification_chain",
  "restored_baseline"
];

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function hashBytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((entry) => stableStringify(entry)).join(",") + "]";
  return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
}

function operationId(value) {
  return typeof value === "string"
    && /^op-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{6}$/.test(value);
}

function planId(value) {
  return typeof value === "string"
    && /^viewing-date-plan-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

function snapshotId(value) {
  return typeof value === "string"
    && /^snapshot-\d{4}-\d{2}-\d{2}t\d{2}-\d{2}-\d{2}-\d{3}z-[a-f0-9]{12}$/.test(value);
}

function hasOnlyKeys(value, keys) {
  return plainObject(value)
    && Object.keys(value).sort().join(",") === keys.slice().sort().join(",");
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

function readOnlyJson(root, segments) {
  if (!Array.isArray(segments) || segments.some((segment) => typeof segment !== "string" || !/^[A-Za-z0-9_.-]+$/.test(segment))) {
    return { ok: false, code: "evidence_path_invalid" };
  }
  try {
    const canonicalRoot = fs.realpathSync(root);
    let current = canonicalRoot;
    for (let index = 0; index < segments.length; index += 1) {
      current = path.join(current, segments[index]);
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (index + 1 < segments.length && !stat.isDirectory()) || (index + 1 === segments.length && !stat.isFile())) {
        return { ok: false, code: "evidence_path_unsafe" };
      }
      if (!inside(canonicalRoot, fs.realpathSync(current))) return { ok: false, code: "evidence_path_unsafe" };
    }
    const bytes = fs.readFileSync(current);
    const parsed = JSON.parse(bytes.toString("utf8"));
    return plainObject(parsed) ? { ok: true, value: parsed, sha256: hashBytes(bytes) } : { ok: false, code: "evidence_json_invalid" };
  } catch (_) {
    return { ok: false, code: "evidence_missing_or_invalid" };
  }
}

function records(value) {
  return hasOnlyKeys(value, ["count", "fingerprint"])
    && Number.isInteger(value.count) && value.count >= 0 && sha256(value.fingerprint);
}

function baseline(value, binding) {
  return hasOnlyKeys(value, ["actions_sha256", "binding_sha256", "facts_sha256", "form_id", "form_sha256", "policy_sha256", "project_binding", "records"])
    && Number.isInteger(value.form_id) && value.form_id > 0
    && [value.actions_sha256, value.binding_sha256, value.facts_sha256, value.form_sha256, value.policy_sha256].every(sha256)
    && records(value.records)
    && isDeepStrictEqual(value.project_binding, binding);
}

function sortedUniqueNamedEntries(entries) {
  let previous = null;
  return Array.isArray(entries) && entries.every((entry) => {
    if (!plainObject(entry) || typeof entry.name !== "string" || entry.name.length === 0 || previous !== null && previous >= entry.name) return false;
    previous = entry.name;
    return true;
  });
}

function canonicalVerifyExistingSurface(surface) {
  if (!hasOnlyKeys(surface, ["other_factory_options", "rates", "replays"])
    || ![surface.other_factory_options, surface.rates, surface.replays].every(sortedUniqueNamedEntries)) return false;
  return surface.replays.every((entry) => hasOnlyKeys(entry, ["autoload", "name", "value"])
      && /^factory_agent_replay_[a-f0-9]{64}$/.test(entry.name) && /^[0-9]+$/.test(String(entry.value)) && typeof entry.autoload === "string")
    && surface.rates.every((entry) => hasOnlyKeys(entry, ["autoload", "name", "value"])
      && /^factory_agent_rate_[a-f0-9]{64}$/.test(entry.name) && /^[1-9][0-9]{0,2}$/.test(String(entry.value))
      && Number(entry.value) <= 600 && ["no", "off"].includes(entry.autoload))
    && surface.other_factory_options.every((entry) => hasOnlyKeys(entry, ["autoload", "name", "value_sha256"])
      && entry.name !== "factory_agent_signed_auth_credentials" && !entry.name.startsWith("factory_agent_replay_")
      && sha256(entry.value_sha256) && typeof entry.autoload === "string");
}

function completedRestoreJournal(value, restoreOperationId, project, metadata, binding) {
  return plainObject(value) && value.journal_schema_version === 1 && value.operation_id === restoreOperationId
    && value.project_slug === project.slug && value.restore_plan_id === metadata.plan_id
    && value.source_snapshot_id === metadata.viewing_date_snapshot_id && value.verification_completed === true
    && hasOnlyKeys(value.project_binding, ["binding_key", "fingerprint", "slug"])
    && value.project_binding.slug === project.slug && value.project_binding.fingerprint === binding.fingerprint
    && value.project_binding.binding_key === binding.binding_key;
}

function canonicalSubmissionReceipts(receipts, formId) {
  if (!Array.isArray(receipts) || receipts.length !== 2) return false;
  let previousRecordId = 0;
  const propertyIds = new Set();
  let datePresent = 0;
  let dateAbsent = 0;
  for (const receipt of receipts) {
    if (!hasOnlyKeys(receipt, ["form_id", "preferred_date_state", "property_id", "record_id", "status", "submit_type"])
      || !Number.isSafeInteger(receipt.record_id) || receipt.record_id <= previousRecordId
      || receipt.form_id !== formId || !Number.isSafeInteger(receipt.property_id) || receipt.property_id <= 0 || propertyIds.has(receipt.property_id)
      || receipt.status !== "success" || receipt.submit_type !== "ajax" || !["present", "absent"].includes(receipt.preferred_date_state)) return false;
    previousRecordId = receipt.record_id;
    propertyIds.add(receipt.property_id);
    if (receipt.preferred_date_state === "present") datePresent += 1;
    else dateAbsent += 1;
  }
  return datePresent === 1 && dateAbsent === 1;
}

function submissionReceiptArtifact(value, project, binding, plan, recovery, apply) {
  return hasOnlyKeys(value, ["apply_operation_id", "plan_id", "project_binding_fingerprint", "project_id", "project_slug", "receipts", "records", "schema", "snapshot_id", "version"])
    && value.schema === SUBMISSION_RECEIPTS_SCHEMA && value.version === SUBMISSION_RECEIPTS_VERSION
    && value.project_slug === project.slug && value.project_id === project.project_id && value.project_binding_fingerprint === binding.fingerprint
    && value.plan_id === plan.plan_id && value.snapshot_id === recovery.snapshot_id && value.apply_operation_id === apply.operation_id
    && records(value.records) && value.records.count === plan.baseline.records.count + 2
    && canonicalSubmissionReceipts(value.receipts, plan.baseline.form_id);
}

function healthAttemptEvidence(value, project) {
  return hasOnlyKeys(value, ["key_id", "method", "project_slug", "request_id", "response", "route", "state"])
    && value.method === "GET" && value.route === "/factory/v1/agent/health" && value.project_slug === project.slug
    && typeof value.key_id === "string" && value.key_id.length > 0 && typeof value.request_id === "string" && value.request_id.length > 0
    && value.state === "response_recorded" && hasOnlyKeys(value.response, ["signed_agent"]) && value.response.signed_agent === "ok";
}

function snapshotIdentityMatches(identity, manifest, manifestSha256) {
  if (!hasOnlyKeys(identity, ["artifacts_sha256", "manifest_sha256", "project_identity_fingerprint", "project_slug", "snapshot_id"])
    || !plainObject(manifest) || !Array.isArray(manifest.artifacts)) return false;
  const artifacts = manifest.artifacts.map((artifact) => artifact && ({
    type: artifact.type,
    relative_filename: artifact.relative_filename,
    digest_algorithm: artifact.digest_algorithm,
    digest: artifact.digest,
    size_bytes: artifact.size_bytes,
    capture_status: artifact.capture_status
  }));
  return identity.snapshot_id === manifest.snapshot_id && identity.project_slug === manifest.project_slug
    && identity.project_identity_fingerprint === manifest.project_identity_fingerprint
    && identity.manifest_sha256 === manifestSha256 && identity.artifacts_sha256 === hashBytes(JSON.stringify(artifacts));
}

function preparedRecovery(value, project, plan, binding) {
  const coverage = value && value.coverage;
  return hasOnlyKeys(value, ["baseline_sha256", "capture_not_invoked", "coverage", "coverage_schema", "coverage_sha256", "coverage_version", "created_at", "new_snapshot_created", "plan_id", "profile_id", "profile_version", "project_id", "project_identity_fingerprint", "project_slug", "proposed_change_sha256", "snapshot_id", "snapshot_identity", "snapshot_reused", "status", "version", "schema"])
    && value.schema === "csf_viewing_date_recovery_result" && value.version === 3
    && value.status === "prepared" && value.plan_id === plan.plan_id
    && value.project_slug === project.slug && value.project_id === project.project_id
    && value.project_identity_fingerprint === binding.fingerprint
    && value.profile_id === "add_optional_viewing_date" && value.profile_version === 1
    && snapshotId(value.snapshot_id) && value.baseline_sha256 === baselineFingerprint(plan)
    && value.proposed_change_sha256 === proposedChangeFingerprint(plan) && value.coverage_sha256 === coverageFingerprint(value.coverage)
    && plainObject(value.snapshot_identity) && value.snapshot_identity.snapshot_id === value.snapshot_id
    && value.snapshot_identity.project_slug === project.slug && value.snapshot_identity.project_identity_fingerprint === binding.fingerprint
    && sha256(value.snapshot_identity.manifest_sha256) && sha256(value.snapshot_identity.artifacts_sha256)
    && coverage && Boolean(exactCoverage(coverage));
}

function verifiedSnapshot(value, project, snapshot, binding) {
  let manifest;
  try {
    manifest = validateManifest(value, {
      expectedProjectSlug: project.slug,
      expectedProjectIdentityFingerprint: binding.fingerprint
    });
  } catch (_) {
    return false;
  }
  const artifacts = manifest.artifacts;
  const required = new Set(["database_dump", "wordpress_filesystem", "project_metadata"]);
  return manifest.snapshot_id === snapshot && manifest.project_slug === project.slug
    && manifest.project_identity_fingerprint === binding.fingerprint && manifest.project_binding_key === binding.binding_key
    && manifest.project_binding_basis === "local_rescue_project_id_v1" && manifest.status === "verified"
    && manifest.verification && manifest.verification.successful === true
    && Array.isArray(artifacts) && artifacts.length === 3
    && artifacts.every((artifact) => plainObject(artifact) && required.has(artifact.type)
      && typeof artifact.relative_filename === "string" && /^[A-Za-z0-9_.-]+$/.test(artifact.relative_filename)
      && artifact.digest_algorithm === "sha256" && sha256(artifact.digest)
      && Number.isInteger(artifact.size_bytes) && artifact.size_bytes > 0 && artifact.capture_status === "verified")
    && new Set(artifacts.map((artifact) => artifact.type)).size === required.size;
}

function restorePlanLineage(value, project, metadata, binding, snapshotManifest) {
  const immutable = value && value.immutable_source_fingerprint;
  const canonical = immutable && immutable.canonical;
  const expectedArtifacts = snapshotManifest && snapshotManifest.artifacts && snapshotManifest.artifacts.map((artifact) => ({
    type: artifact.type,
    digest_algorithm: artifact.digest_algorithm,
    digest: artifact.digest,
    size_bytes: artifact.size_bytes
  }));
  return plainObject(value) && value.schema === "factory_structural_restore_plan" && value.schema_version === 1 && value.policy_version === 1
    && value.plan_id === metadata.plan_id && value.project_slug === project.slug && value.project_binding_key === binding.binding_key
    && value.project_identity_fingerprint === binding.fingerprint && value.snapshot_id === metadata.viewing_date_snapshot_id && value.readiness === "ready"
    && plainObject(immutable) && plainObject(canonical) && canonical.policy_version === 1 && canonical.snapshot_id === value.snapshot_id
    && canonical.manifest_schema_version === 1 && canonical.manifest_digest === hashBytes(stableStringify(snapshotManifest))
    && hasOnlyKeys(canonical.project_binding, ["basis", "binding_key", "fingerprint", "slug"])
    && canonical.project_binding.slug === project.slug && canonical.project_binding.binding_key === binding.binding_key
    && canonical.project_binding.fingerprint === binding.fingerprint && canonical.project_binding.basis === "local_rescue_project_id_v1"
    && isDeepStrictEqual(canonical.artifacts, expectedArtifacts);
}

function addGap(result, claim, code) {
  const target = result.claims[claim];
  target.status = "NOT_PROVEN";
  if (!target.gaps.includes(code)) target.gaps.push(code);
  if (!result.evidence_gaps.includes(code)) result.evidence_gaps.push(code);
}

function passClaim(result, claim) {
  const target = result.claims[claim];
  if (target.gaps.length === 0) target.status = "PASS";
}

function emptyResult(slug, restoreOperationId) {
  return {
    schema: PROOF_GATE_SCHEMA,
    version: PROOF_GATE_VERSION,
    verdict: "BLOCKED",
    transaction: { project_slug: slug || null, restore_operation_id: restoreOperationId || null },
    claims: Object.fromEntries(CLAIMS.map((claim) => [claim, { status: "NOT_PROVEN", gaps: [] }])),
    evidence_gaps: [],
    evidence_limits: []
  };
}

function evaluateProofGate(options) {
  let slug;
  let restoreOperationId;
  try {
    slug = validateExplicitSlug(options && options.slug);
    restoreOperationId = String(options && options.restoreOperationId || "");
  } catch (_) {
    return emptyResult(null, null);
  }
  const result = emptyResult(slug, restoreOperationId);
  if (!operationId(restoreOperationId)) {
    for (const claim of CLAIMS) addGap(result, claim, "restore_operation_id_invalid");
    return result;
  }

  let projectState;
  try {
    projectState = readProjectBySlug(slug, resolveProjectsRoot(options && options.projectsRoot));
  } catch (_) {
    for (const claim of CLAIMS) addGap(result, claim, "project_evidence_unavailable");
    return result;
  }
  const project = projectState.project;
  const binding = deriveProjectBinding(project);
  const runtimePath = projectState.runtimePath;
  const restoreRead = readOnlyJson(runtimePath, ["runs", "operations", restoreOperationId + ".json"]);
  if (!restoreRead.ok) {
    for (const claim of CLAIMS) addGap(result, claim, restoreRead.code);
    return result;
  }
  const restore = restoreRead.value;
  const metadata = restore.metadata;
  if (!plainObject(restore) || restore.schema !== "factory_project_operation" || restore.version !== 1
    || restore.operation_id !== restoreOperationId || restore.project_slug !== project.slug
    || restore.operation_type !== "viewing_date_restore" || restore.status !== "succeeded" || restore.stage !== "completed"
    || !hasOnlyKeys(metadata, ["plan_id", "restore_scope", "viewing_date_apply_operation_id", "viewing_date_plan_id", "viewing_date_project_binding_fingerprint", "viewing_date_project_id", "viewing_date_snapshot_id"])
    || metadata.restore_scope !== "managed_website_same_project" || typeof metadata.plan_id !== "string" || !/^restore-plan-[a-z0-9-]+$/.test(metadata.plan_id) || !planId(metadata.viewing_date_plan_id)
    || !snapshotId(metadata.viewing_date_snapshot_id) || !operationId(metadata.viewing_date_apply_operation_id)
    || metadata.viewing_date_project_id !== project.project_id || metadata.viewing_date_project_binding_fingerprint !== binding.fingerprint) {
    for (const claim of CLAIMS) addGap(result, claim, "restore_operation_invalid");
    return result;
  }

  const planRead = readOnlyJson(runtimePath, ["proofs", "viewing-date-preview-v1", "plans", metadata.viewing_date_plan_id + ".json"]);
  const recoveryRead = readOnlyJson(runtimePath, ["proofs", "viewing-date-preview-v1", "recovery-results", metadata.viewing_date_plan_id + ".json"]);
  const applyRead = readOnlyJson(runtimePath, ["runs", "operations", metadata.viewing_date_apply_operation_id + ".json"]);
  const restorePlanRead = readOnlyJson(runtimePath, ["runs", "restore-plans", metadata.plan_id + ".json"]);
  const snapshotRead = readOnlyJson(path.join(resolveProjectsRoot(options && options.projectsRoot), ".factory-recovery", "snapshots", binding.binding_key), [metadata.viewing_date_snapshot_id, "manifest.json"]);
  if (!planRead.ok || !recoveryRead.ok || !applyRead.ok || !restorePlanRead.ok || !snapshotRead.ok) {
    for (const claim of CLAIMS) addGap(result, claim, "transaction_lineage_evidence_missing");
    return result;
  }
  const plan = planRead.value;
  const recovery = recoveryRead.value;
  const apply = applyRead.value;
  if (!plainObject(plan) || plan.schema !== "csf_viewing_date_preview" || plan.version !== 1
    || plan.plan_id !== metadata.viewing_date_plan_id || plan.project_slug !== project.slug || plan.project_id !== project.project_id
    || plan.profile !== "add_optional_viewing_date@1" || plan.profile_id !== "add_optional_viewing_date" || plan.profile_version !== 1
    || !baseline(plan.baseline, binding) || !plainObject(plan.expected) || plan.expected.form_sha256 === plan.baseline.form_sha256 || !sha256(plan.expected.form_sha256)
    || !preparedRecovery(recovery, project, plan, binding) || recovery.snapshot_id !== metadata.viewing_date_snapshot_id
    || !verifiedSnapshot(snapshotRead.value, project, recovery.snapshot_id, binding)
    || !snapshotIdentityMatches(recovery.snapshot_identity, snapshotRead.value, snapshotRead.sha256)
    || !restorePlanLineage(restorePlanRead.value, project, metadata, binding, snapshotRead.value)) {
    for (const claim of CLAIMS) addGap(result, claim, "transaction_lineage_conflict");
  } else {
    passClaim(result, "transaction_lineage");
  }

  const after = apply && apply.result_summary && apply.result_summary.after_state;
  if (!plainObject(apply) || apply.schema !== "factory_project_operation" || apply.version !== 1
    || apply.operation_id !== metadata.viewing_date_apply_operation_id || apply.project_slug !== project.slug
    || apply.operation_type !== "viewing_date_apply" || apply.status !== "succeeded"
    || !plainObject(apply.metadata) || apply.metadata.plan_id !== plan.plan_id || apply.metadata.project_id !== project.project_id
    || apply.metadata.project_binding_fingerprint !== binding.fingerprint || apply.metadata.recovery_snapshot_id !== recovery.snapshot_id
    || !plainObject(apply.result_summary) || apply.result_summary.status !== "applied" || apply.result_summary.mutation_performed !== true
    || !plainObject(after) || after.form_id !== plan.baseline.form_id || after.form_sha256 !== plan.expected.form_sha256
    || ![after.actions_sha256, after.binding_sha256, after.policy_sha256].every(sha256) || after.policy_sha256 !== plan.baseline.policy_sha256
    || !records(after.records) || !isDeepStrictEqual(after.records, plan.baseline.records)) {
    addGap(result, "authoritative_outcomes", "apply_outcome_invalid");
  } else {
    passClaim(result, "authoritative_outcomes");
  }

  const identity = restore.result_summary && restore.result_summary.viewing_date_restore;
  const restored = identity && identity.restored_baseline;
  if (!plainObject(restore.result_summary) || restore.result_summary.restore_verified !== true
    || !plainObject(restore.result_summary.verification) || restore.result_summary.verification.successful !== true
    || !hasOnlyKeys(identity, ["apply_operation_id", "correlated_rate_guard", "correlated_replay_guard", "mutation_performed", "plan_id", "post_apply", "post_verification_completed", "preservation_mode", "preservation_version", "profile_id", "profile_version", "project_binding_fingerprint", "project_id", "project_slug", "recovery_result_schema", "recovery_result_version", "recovery_status", "restored_baseline", "runtime_authority_mode", "schema", "snapshot_id", "status", "version"])
    || identity.schema !== "csf_viewing_date_restore_identity" || identity.version !== 1
    || identity.project_slug !== project.slug || identity.project_id !== project.project_id || identity.project_binding_fingerprint !== binding.fingerprint
    || identity.plan_id !== plan.plan_id || identity.apply_operation_id !== apply.operation_id || identity.snapshot_id !== recovery.snapshot_id
    || identity.profile_id !== "add_optional_viewing_date" || identity.profile_version !== 1
    || identity.recovery_result_schema !== "csf_viewing_date_recovery_result" || identity.recovery_result_version !== 3
    || identity.recovery_status !== "prepared" || identity.preservation_mode !== "same_project_structural_restore" || identity.preservation_version !== 1
    || identity.runtime_authority_mode !== "same_project_runtime_authority_v1" || identity.status !== "restored" || identity.mutation_performed !== true
    || identity.post_verification_completed !== true || identity.correlated_replay_guard !== true || identity.correlated_rate_guard !== true
    || !hasOnlyKeys(identity.post_apply, ["actions_sha256", "binding_sha256", "form_id", "form_sha256", "policy_sha256"])
    || identity.post_apply.form_id !== after.form_id || identity.post_apply.form_sha256 !== after.form_sha256
    || identity.post_apply.actions_sha256 !== after.actions_sha256 || identity.post_apply.binding_sha256 !== after.binding_sha256 || identity.post_apply.policy_sha256 !== after.policy_sha256
    || !plainObject(restored) || restored.form_sha256 !== plan.baseline.form_sha256 || !isDeepStrictEqual(restored.records, plan.baseline.records)) {
    addGap(result, "authoritative_outcomes", "restore_outcome_invalid");
    addGap(result, "restored_baseline", "restored_baseline_invalid");
  } else {
    passClaim(result, "authoritative_outcomes");
    passClaim(result, "restored_baseline");
  }

  const journalRead = readOnlyJson(runtimePath, ["runs", "restore-work", restoreOperationId, "viewing-date-verify-existing.json"]);
  const completedJournalRead = readOnlyJson(runtimePath, ["runs", "restore-work", restoreOperationId, "restore-journal.json"]);
  const proofSegments = typeof restore.proof_ref === "string" ? restore.proof_ref.split("/") : [];
  const proofRead = proofSegments.length > 1 && proofSegments[0] === "proofs"
    ? readOnlyJson(runtimePath, proofSegments)
    : { ok: false, code: "restore_proof_invalid" };
  const journal = journalRead.value;
  const health = journal && journal.health;
  const hasHealthAttempt = Boolean(journal && Object.hasOwn(journal, "health_attempt"));
  if (!journalRead.ok || !completedJournalRead.ok || !proofRead.ok || !hasOnlyKeys(journal, hasHealthAttempt
    ? ["apply_operation_id", "b", "health_attempt", "health", "observation_nonce", "operation_id", "phase", "plan_id", "project_binding_fingerprint", "project_id", "project_slug", "schema", "snapshot_id", "version"]
    : ["apply_operation_id", "b", "health", "observation_nonce", "operation_id", "phase", "plan_id", "project_binding_fingerprint", "project_id", "project_slug", "schema", "snapshot_id", "version"])
    || journal.schema !== "csf_viewing_date_restore_verify_existing_journal" || journal.version !== 1 || journal.phase !== "health_recorded"
    || journal.operation_id !== restoreOperationId || journal.project_slug !== project.slug || journal.project_id !== project.project_id
    || journal.project_binding_fingerprint !== binding.fingerprint || journal.plan_id !== plan.plan_id || journal.snapshot_id !== recovery.snapshot_id || journal.apply_operation_id !== apply.operation_id
    || !sha256(journal.observation_nonce) || !hasOnlyKeys(journal.b, ["application_password_identity_sha256", "credential_hmac_sha256", "credential_metadata_sha256", "env_identity", "surface", "wp_config_sha256"])
    || ![journal.b.credential_metadata_sha256, journal.b.credential_hmac_sha256, journal.b.application_password_identity_sha256, journal.b.wp_config_sha256].every(sha256)
    || !hasOnlyKeys(journal.b.env_identity, ["dev", "ino", "sha256", "size"])
    || !Number.isInteger(journal.b.env_identity.dev) || !Number.isInteger(journal.b.env_identity.ino) || !Number.isInteger(journal.b.env_identity.size) || journal.b.env_identity.size < 0 || !sha256(journal.b.env_identity.sha256)
    || !canonicalVerifyExistingSurface(journal.b.surface)
    || !hasOnlyKeys(health, ["expires_at", "key_id", "method", "project_slug", "request_id", "route"])
    || health.method !== "GET" || health.route !== "/factory/v1/agent/health" || health.project_slug !== project.slug
    || typeof health.key_id !== "string" || health.key_id.length < 1 || typeof health.request_id !== "string" || health.request_id.length < 1 || !Number.isInteger(health.expires_at)
    || hasHealthAttempt && (!healthAttemptEvidence(journal.health_attempt, project) || journal.health_attempt.key_id !== health.key_id || journal.health_attempt.request_id !== health.request_id)
    || !completedRestoreJournal(completedJournalRead.value, restoreOperationId, project, metadata, binding)
    || !plainObject(proofRead.value) || proofRead.value.schema !== "factory_structural_restore_execution_proof" || proofRead.value.schema_version !== 1
    || proofRead.value.operation_id !== restoreOperationId || proofRead.value.project_slug !== project.slug || proofRead.value.source_snapshot_id !== recovery.snapshot_id
    || proofRead.value.status !== "succeeded" || !plainObject(proofRead.value.health) || proofRead.value.health.signed_agent !== "ok") {
    addGap(result, "verification_chain", "verification_chain_evidence_invalid");
  } else {
    passClaim(result, "verification_chain");
  }

  if (!hasHealthAttempt) {
    addGap(result, "verification_chain", "signed_health_cardinality_unproven");
  } else if (result.claims.verification_chain.status === "PASS") {
    result.evidence_limits.push("literal_signed_health_call_cardinality_unproven_without_transport_log");
  }

  const receiptRead = readOnlyJson(runtimePath, ["proofs", "viewing-date-preview-v1", "submission-receipts", plan.plan_id + ".json"]);
  if (!receiptRead.ok) {
    addGap(result, "business_submissions", "business_submission_receipts_missing");
  } else if (!submissionReceiptArtifact(receiptRead.value, project, binding, plan, recovery, apply)) {
    addGap(result, "business_submissions", "business_submission_evidence_invalid");
  } else {
    passClaim(result, "business_submissions");
  }
  result.evidence_gaps.sort();
  result.evidence_limits.sort();
  const insufficientOnly = result.evidence_gaps.length > 0 && result.evidence_gaps.every((gap) => ["business_submission_receipts_missing", "signed_health_cardinality_unproven"].includes(gap));
  result.verdict = result.evidence_gaps.length === 0 ? "PASS" : insufficientOnly ? "INSUFFICIENT_EVIDENCE" : "BLOCKED";
  return result;
}

module.exports = { PROOF_GATE_SCHEMA, PROOF_GATE_VERSION, evaluateProofGate };
