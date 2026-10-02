"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { createProjectScaffold, readProjectBySlug } = require("../src/project-store");
const { deriveProjectBinding } = require("../src/structural-snapshot-store");
const { evaluateProofGate } = require("../src/proof-gate");

function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function stable(value) { return value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? "[" + value.map(stable).join(",") + "]" : "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}"; }
function write(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, JSON.stringify(value, null, 2)); }

function fixture() {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "factory-proof-gate-"));
  const slug = "proof-gate-fixture";
  createProjectScaffold({ name: "Proof Gate Fixture", slug, port: 36661, projectsRoot });
  const state = readProjectBySlug(slug, projectsRoot);
  const binding = deriveProjectBinding(state.project);
  const planId = "viewing-date-plan-11111111-1111-4111-8111-111111111111";
  const snapshotId = "snapshot-2026-10-01t19-40-43-963z-abcdef123456";
  const applyOperationId = "op-2026-10-01T19-41-48-835Z-abcdef";
  const restoreOperationId = "op-2026-10-01T19-46-32-101Z-fedcba";
  const baseline = {
    project_binding: binding, form_id: 12, form_sha256: "a".repeat(64), actions_sha256: "b".repeat(64), binding_sha256: "c".repeat(64), policy_sha256: "d".repeat(64), facts_sha256: "e".repeat(64), records: { count: 0, fingerprint: "f".repeat(64) }
  };
  const plan = { schema: "csf_viewing_date_preview", version: 1, plan_id: planId, project_slug: slug, project_id: state.project.project_id, profile: "add_optional_viewing_date@1", profile_id: "add_optional_viewing_date", profile_version: 1, baseline, proposed_delta: { add_optional_date_field: { native_block: "date" } }, expected: { form_sha256: "1".repeat(64) } };
  const coverage = { schema: "csf_viewing_date_recovery_scope_coverage", version: 1, database: { scope: "full_database", capture_authority: true, artifact_bytes_verified: true, affected_resources: ["request_viewing_form_post", "request_viewing_form_meta_actions_ownership", "request_viewing_policy_binding_option"], row_level_inspection: false, restore_verification_required: true }, wordpress_filesystem: { scope: "wordpress_filesystem_archive", artifact_bytes_verified: true, policy_file_verified: true }, project_metadata: { scope: "project_metadata", artifact_bytes_verified: true, project_identity_verified: true } };
  const manifest = { schema_version: 1, snapshot_id: snapshotId, project_slug: slug, project_identity_fingerprint: binding.fingerprint, project_binding_key: binding.binding_key, project_binding_basis: "local_rescue_project_id_v1", status: "verified", created_at: "2026-10-01T19:40:43.964Z", updated_at: "2026-10-01T19:40:46.430Z", snapshot_tier: "local_rescue", customer_label: "Recovery Point", source_operation_id: "op-test", consistency_mode: "coordinated_maintenance_db_filesystem_capture", captured_components: ["database", "logical_database_dump", "wordpress_filesystem", "sanitized_project_metadata"], excluded_components: [], artifacts: ["database_dump", "wordpress_filesystem", "project_metadata"].map((type, index) => ({ type, relative_filename: type + ".artifact", digest_algorithm: "sha256", digest: digest(type), size_bytes: index + 1, capture_status: "verified" })), software: { capture_service: "test" }, verification: { status: "artifacts_verified", successful: true, verified_at: "2026-10-01T19:40:46.430Z", checks: [], warnings: [] }, restore_compatibility: { status: "same_project_compatible", blocking: false, blockers: [], warnings: [] }, restore_result: null, provenance: { source: "test" } };
  const manifestRawSha256 = digest(JSON.stringify(manifest, null, 2));
  const manifestStableSha256 = digest(stable(manifest));
  const snapshotIdentity = { snapshot_id: snapshotId, project_slug: slug, project_identity_fingerprint: binding.fingerprint, manifest_sha256: manifestRawSha256, artifacts_sha256: digest(JSON.stringify(manifest.artifacts)) };
  const recovery = {
    schema: "csf_viewing_date_recovery_result", version: 3, coverage_schema: "csf_viewing_date_recovery_scope_coverage", coverage_version: 1, plan_id: planId, project_slug: slug, project_id: state.project.project_id, project_identity_fingerprint: binding.fingerprint, profile_id: "add_optional_viewing_date", profile_version: 1, baseline_sha256: digest(JSON.stringify(baseline)), proposed_change_sha256: digest(JSON.stringify({ proposed_delta: plan.proposed_delta, expected: plan.expected })), status: "prepared", snapshot_id: snapshotId,
    snapshot_identity: snapshotIdentity, snapshot_reused: false, new_snapshot_created: true, capture_not_invoked: false,
    coverage, coverage_sha256: digest(JSON.stringify(coverage)), created_at: "2026-10-01T19:40:55.650Z"
  };
  const apply = { schema: "factory_project_operation", version: 1, operation_id: applyOperationId, project_slug: slug, operation_type: "viewing_date_apply", status: "succeeded", metadata: { plan_id: planId, project_id: state.project.project_id, project_binding_fingerprint: binding.fingerprint, recovery_snapshot_id: snapshotId }, result_summary: { status: "applied", mutation_performed: true, after_state: { form_id: 12, form_sha256: plan.expected.form_sha256, actions_sha256: "7".repeat(64), binding_sha256: "8".repeat(64), policy_sha256: baseline.policy_sha256, records: baseline.records } } };
  const identity = { schema: "csf_viewing_date_restore_identity", version: 1, project_slug: slug, project_id: state.project.project_id, project_binding_fingerprint: binding.fingerprint, plan_id: planId, profile_id: "add_optional_viewing_date", profile_version: 1, apply_operation_id: applyOperationId, recovery_result_schema: "csf_viewing_date_recovery_result", recovery_result_version: 3, recovery_status: "prepared", snapshot_id: snapshotId, post_apply: { form_id: 12, form_sha256: plan.expected.form_sha256, actions_sha256: "7".repeat(64), binding_sha256: "8".repeat(64), policy_sha256: baseline.policy_sha256 }, restored_baseline: { form_sha256: baseline.form_sha256, records: baseline.records }, preservation_mode: "same_project_structural_restore", preservation_version: 1, runtime_authority_mode: "same_project_runtime_authority_v1", correlated_replay_guard: true, mutation_performed: true, post_verification_completed: true, status: "restored", correlated_rate_guard: true };
  const restore = { schema: "factory_project_operation", version: 1, operation_id: restoreOperationId, project_slug: slug, operation_type: "viewing_date_restore", status: "succeeded", stage: "completed", metadata: { restore_scope: "managed_website_same_project", plan_id: "restore-plan-2026-10-01t19-46-32-094z-abcdef", viewing_date_plan_id: planId, viewing_date_snapshot_id: snapshotId, viewing_date_apply_operation_id: applyOperationId, viewing_date_project_id: state.project.project_id, viewing_date_project_binding_fingerprint: binding.fingerprint }, proof_ref: "proofs/restore-execute.json", result_summary: { restore_verified: true, verification: { successful: true }, viewing_date_restore: identity } };
  const restorePlan = { schema: "factory_structural_restore_plan", schema_version: 1, policy_version: 1, plan_id: restore.metadata.plan_id, project_slug: slug, project_binding_key: binding.binding_key, project_identity_fingerprint: binding.fingerprint, snapshot_id: snapshotId, readiness: "ready", immutable_source_fingerprint: { canonical: { policy_version: 1, project_binding: { slug, binding_key: binding.binding_key, fingerprint: binding.fingerprint, basis: "local_rescue_project_id_v1" }, snapshot_id: snapshotId, manifest_schema_version: 1, manifest_digest: manifestStableSha256, artifacts: manifest.artifacts.map(({ type, digest_algorithm, digest: artifactDigest, size_bytes }) => ({ type, digest_algorithm, digest: artifactDigest, size_bytes })) } } };
  const journal = { schema: "csf_viewing_date_restore_verify_existing_journal", version: 1, operation_id: restoreOperationId, project_slug: slug, project_id: state.project.project_id, project_binding_fingerprint: binding.fingerprint, plan_id: planId, snapshot_id: snapshotId, apply_operation_id: applyOperationId, phase: "health_recorded", observation_nonce: "9".repeat(64), b: { credential_metadata_sha256: "a".repeat(64), credential_hmac_sha256: "b".repeat(64), application_password_identity_sha256: "c".repeat(64), env_identity: { dev: 1, ino: 2, sha256: "d".repeat(64), size: 3 }, wp_config_sha256: "e".repeat(64), surface: { other_factory_options: [], rates: [], replays: [] } }, health_attempt: { method: "GET", route: "/factory/v1/agent/health", project_slug: slug, key_id: "factory_agent_test", request_id: "request-test", state: "response_recorded", response: { signed_agent: "ok" } }, health: { method: "GET", route: "/factory/v1/agent/health", project_slug: slug, key_id: "factory_agent_test", request_id: "request-test", expires_at: 1790884340 } };
  const receipts = { schema: "csf_viewing_date_submission_receipts", version: 1, project_slug: slug, project_id: state.project.project_id, project_binding_fingerprint: binding.fingerprint, plan_id: planId, snapshot_id: snapshotId, apply_operation_id: applyOperationId, records: { count: 2, fingerprint: "f".repeat(64) }, receipts: [
    { record_id: 1, form_id: 12, property_id: 6, status: "success", submit_type: "ajax", preferred_date_state: "present" },
    { record_id: 2, form_id: 12, property_id: 7, status: "success", submit_type: "ajax", preferred_date_state: "absent" }
  ] };
  const completedJournal = { journal_schema_version: 1, operation_id: restoreOperationId, project_slug: slug, restore_plan_id: restore.metadata.plan_id, source_snapshot_id: snapshotId, verification_completed: true, project_binding: { slug, binding_key: binding.binding_key, fingerprint: binding.fingerprint } };
  const proof = { schema: "factory_structural_restore_execution_proof", schema_version: 1, operation_id: restoreOperationId, project_slug: slug, source_snapshot_id: snapshotId, status: "succeeded", health: { signed_agent: "ok" } };
  write(path.join(state.runtimePath, "proofs", "viewing-date-preview-v1", "plans", planId + ".json"), plan);
  write(path.join(state.runtimePath, "proofs", "viewing-date-preview-v1", "recovery-results", planId + ".json"), recovery);
  write(path.join(state.runtimePath, "runs", "operations", applyOperationId + ".json"), apply);
  write(path.join(state.runtimePath, "runs", "operations", restoreOperationId + ".json"), restore);
  write(path.join(state.runtimePath, "runs", "restore-plans", restore.metadata.plan_id + ".json"), restorePlan);
  write(path.join(state.runtimePath, "runs", "restore-work", restoreOperationId, "viewing-date-verify-existing.json"), journal);
  write(path.join(state.runtimePath, "runs", "restore-work", restoreOperationId, "restore-journal.json"), completedJournal);
  write(path.join(state.runtimePath, "proofs", "restore-execute.json"), proof);
  write(path.join(state.runtimePath, "proofs", "viewing-date-preview-v1", "submission-receipts", planId + ".json"), receipts);
  write(path.join(projectsRoot, ".factory-recovery", "snapshots", binding.binding_key, snapshotId, "manifest.json"), manifest);
  return { projectsRoot, slug, restoreOperationId, state, planId, applyOperationId };
}

test("Proof Gate v0 accepts complete transaction-bound receipt and health-attempt evidence", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.projectsRoot, { recursive: true, force: true }));
  const result = evaluateProofGate(value);
  assert.equal(result.verdict, "PASS");
  assert.equal(result.claims.transaction_lineage.status, "PASS");
  assert.equal(result.claims.authoritative_outcomes.status, "PASS");
  assert.deepEqual(result.claims.verification_chain, { status: "PASS", gaps: [] });
  assert.equal(result.claims.restored_baseline.status, "PASS");
  assert.deepEqual(result.claims.business_submissions, { status: "PASS", gaps: [] });
  assert.deepEqual(result.evidence_gaps, []);
  assert.deepEqual(result.evidence_limits, ["literal_signed_health_call_cardinality_unproven_without_transport_log"]);
});

test("Proof Gate v0 retains historical ST-1 as insufficient for its two missing claims", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.projectsRoot, { recursive: true, force: true }));
  const journalPath = path.join(value.state.runtimePath, "runs", "restore-work", value.restoreOperationId, "viewing-date-verify-existing.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  delete journal.health_attempt;
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  fs.unlinkSync(path.join(value.state.runtimePath, "proofs", "viewing-date-preview-v1", "submission-receipts", value.planId + ".json"));
  const result = evaluateProofGate(value);
  assert.equal(result.verdict, "INSUFFICIENT_EVIDENCE");
  assert.deepEqual(result.claims.verification_chain, { status: "NOT_PROVEN", gaps: ["signed_health_cardinality_unproven"] });
  assert.deepEqual(result.claims.business_submissions, { status: "NOT_PROVEN", gaps: ["business_submission_receipts_missing"] });
});

test("Proof Gate v0 rejects missing, duplicate, malformed, cross-transaction, and reordered receipts", (t) => {
  const cases = [
    ["missing", (value, receiptPath) => fs.unlinkSync(receiptPath), "INSUFFICIENT_EVIDENCE", "business_submission_receipts_missing"],
    ["duplicate", (_value, receiptPath) => { const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")); receipt.receipts[1].record_id = receipt.receipts[0].record_id; fs.writeFileSync(receiptPath, JSON.stringify(receipt)); }, "BLOCKED", "business_submission_evidence_invalid"],
    ["malformed", (_value, receiptPath) => { const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")); receipt.receipts[0].unexpected = true; fs.writeFileSync(receiptPath, JSON.stringify(receipt)); }, "BLOCKED", "business_submission_evidence_invalid"],
    ["incomplete record graph", (_value, receiptPath) => { const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")); receipt.records.count = 3; fs.writeFileSync(receiptPath, JSON.stringify(receipt)); }, "BLOCKED", "business_submission_evidence_invalid"],
    ["cross-transaction", (_value, receiptPath) => { const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")); receipt.apply_operation_id = "op-2026-10-01T19-41-48-835Z-deadbe"; fs.writeFileSync(receiptPath, JSON.stringify(receipt)); }, "BLOCKED", "business_submission_evidence_invalid"],
    ["reordered", (_value, receiptPath) => { const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")); receipt.receipts.reverse(); fs.writeFileSync(receiptPath, JSON.stringify(receipt)); }, "BLOCKED", "business_submission_evidence_invalid"]
  ];
  for (const [_name, mutate, verdict, gap] of cases) {
    const value = fixture();
    const receiptPath = path.join(value.state.runtimePath, "proofs", "viewing-date-preview-v1", "submission-receipts", value.planId + ".json");
    mutate(value, receiptPath);
    const result = evaluateProofGate(value);
    assert.equal(result.verdict, verdict);
    assert.equal(result.claims.business_submissions.gaps.includes(gap), true);
    fs.rmSync(value.projectsRoot, { recursive: true, force: true });
  }
});

test("Proof Gate v0 rejects malformed, cross-operation, or incomplete health-attempt evidence", (t) => {
  const cases = [
    ["missing response", (journal) => { journal.health_attempt.state = "reserved"; delete journal.health_attempt.response; }],
    ["cross operation request", (journal) => { journal.health_attempt.request_id = "other-request"; }],
    ["malformed response", (journal) => { journal.health_attempt.response.unexpected = true; }]
  ];
  for (const [_name, mutate] of cases) {
    const value = fixture();
    const journalPath = path.join(value.state.runtimePath, "runs", "restore-work", value.restoreOperationId, "viewing-date-verify-existing.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    mutate(journal);
    fs.writeFileSync(journalPath, JSON.stringify(journal));
    const result = evaluateProofGate(value);
    assert.equal(result.verdict, "BLOCKED");
    assert.equal(result.claims.verification_chain.gaps.includes("verification_chain_evidence_invalid"), true);
    fs.rmSync(value.projectsRoot, { recursive: true, force: true });
  }
});

test("Proof Gate v0 fails closed for conflicting transaction lineage", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.projectsRoot, { recursive: true, force: true }));
  const restorePath = path.join(value.state.runtimePath, "runs", "operations", value.restoreOperationId + ".json");
  const restore = JSON.parse(fs.readFileSync(restorePath, "utf8"));
  restore.metadata.viewing_date_apply_operation_id = "op-2026-10-01T19-41-48-835Z-deadbe";
  fs.writeFileSync(restorePath, JSON.stringify(restore));
  const result = evaluateProofGate(value);
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.claims.transaction_lineage.status, "NOT_PROVEN");
  assert.equal(result.claims.verification_chain.status, "NOT_PROVEN");
  assert.equal(result.evidence_gaps.includes("transaction_lineage_evidence_missing"), true);
});

test("Proof Gate v0 fails closed when the persisted health journal is malformed", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.projectsRoot, { recursive: true, force: true }));
  const journalPath = path.join(value.state.runtimePath, "runs", "restore-work", value.restoreOperationId, "viewing-date-verify-existing.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  journal.health.route = "/unexpected";
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  const result = evaluateProofGate(value);
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.claims.transaction_lineage.status, "PASS");
  assert.equal(result.claims.verification_chain.status, "NOT_PROVEN");
  assert.equal(result.evidence_gaps.includes("verification_chain_evidence_invalid"), true);
});

test("Proof Gate v0 fails closed when B or the completed C journal is incomplete", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.projectsRoot, { recursive: true, force: true }));
  const journalPath = path.join(value.state.runtimePath, "runs", "restore-work", value.restoreOperationId, "viewing-date-verify-existing.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  delete journal.b.env_identity;
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  let result = evaluateProofGate(value);
  assert.equal(result.claims.verification_chain.gaps.includes("verification_chain_evidence_invalid"), true);

  const completedPath = path.join(value.state.runtimePath, "runs", "restore-work", value.restoreOperationId, "restore-journal.json");
  const completed = JSON.parse(fs.readFileSync(completedPath, "utf8"));
  completed.verification_completed = false;
  fs.writeFileSync(completedPath, JSON.stringify(completed));
  result = evaluateProofGate(value);
  assert.equal(result.claims.verification_chain.gaps.includes("verification_chain_evidence_invalid"), true);
});

test("Proof Gate v0 binds the Restore plan identifier to the completed C journal", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.projectsRoot, { recursive: true, force: true }));
  const restorePath = path.join(value.state.runtimePath, "runs", "operations", value.restoreOperationId + ".json");
  const restore = JSON.parse(fs.readFileSync(restorePath, "utf8"));
  restore.metadata.plan_id = "restore-plan-unrelated";
  fs.writeFileSync(restorePath, JSON.stringify(restore));
  const result = evaluateProofGate(value);
  assert.equal(result.claims.transaction_lineage.gaps.includes("transaction_lineage_evidence_missing"), true);
});

test("Proof Gate v0 fails closed when the persisted Restore plan no longer binds the snapshot manifest", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.projectsRoot, { recursive: true, force: true }));
  const restore = JSON.parse(fs.readFileSync(path.join(value.state.runtimePath, "runs", "operations", value.restoreOperationId + ".json"), "utf8"));
  const restorePlanPath = path.join(value.state.runtimePath, "runs", "restore-plans", restore.metadata.plan_id + ".json");
  const restorePlan = JSON.parse(fs.readFileSync(restorePlanPath, "utf8"));
  restorePlan.immutable_source_fingerprint.canonical.manifest_digest = "0".repeat(64);
  fs.writeFileSync(restorePlanPath, JSON.stringify(restorePlan));
  const result = evaluateProofGate(value);
  assert.equal(result.claims.transaction_lineage.status, "NOT_PROVEN");
  assert.equal(result.evidence_gaps.includes("transaction_lineage_conflict"), true);
});

test("Proof Gate v0 fails closed for a non-canonical snapshot manifest", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.projectsRoot, { recursive: true, force: true }));
  const restore = JSON.parse(fs.readFileSync(path.join(value.state.runtimePath, "runs", "operations", value.restoreOperationId + ".json"), "utf8"));
  const binding = deriveProjectBinding(value.state.project);
  const manifestPath = path.join(value.projectsRoot, ".factory-recovery", "snapshots", binding.binding_key, restore.metadata.viewing_date_snapshot_id, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  delete manifest.verification;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const result = evaluateProofGate(value);
  assert.equal(result.claims.transaction_lineage.status, "NOT_PROVEN");
  assert.equal(result.evidence_gaps.includes("transaction_lineage_conflict"), true);
});

test("Proof Gate v0 fails closed when the persisted restored baseline conflicts with the plan", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.projectsRoot, { recursive: true, force: true }));
  const restorePath = path.join(value.state.runtimePath, "runs", "operations", value.restoreOperationId + ".json");
  const restore = JSON.parse(fs.readFileSync(restorePath, "utf8"));
  restore.result_summary.viewing_date_restore.restored_baseline.records.count = 1;
  fs.writeFileSync(restorePath, JSON.stringify(restore));
  const result = evaluateProofGate(value);
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.claims.authoritative_outcomes.status, "NOT_PROVEN");
  assert.equal(result.claims.restored_baseline.status, "NOT_PROVEN");
  assert.equal(result.evidence_gaps.includes("restored_baseline_invalid"), true);
});

test("Proof Gate v0 fails closed for an incomplete authoritative Restore identity", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.projectsRoot, { recursive: true, force: true }));
  const restorePath = path.join(value.state.runtimePath, "runs", "operations", value.restoreOperationId + ".json");
  const restore = JSON.parse(fs.readFileSync(restorePath, "utf8"));
  delete restore.result_summary.viewing_date_restore.post_apply;
  fs.writeFileSync(restorePath, JSON.stringify(restore));
  const result = evaluateProofGate(value);
  assert.equal(result.claims.authoritative_outcomes.status, "NOT_PROVEN");
  assert.equal(result.claims.restored_baseline.status, "NOT_PROVEN");
  assert.equal(result.evidence_gaps.includes("restore_outcome_invalid"), true);
});

test("Proof Gate v0 is read-only and rejects an invalid Restore operation identifier", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.projectsRoot, { recursive: true, force: true }));
  const before = fs.readdirSync(path.join(value.state.runtimePath, "runs", "operations")).sort();
  const result = evaluateProofGate({ projectsRoot: value.projectsRoot, slug: value.slug, restoreOperationId: "../escape" });
  const after = fs.readdirSync(path.join(value.state.runtimePath, "runs", "operations")).sort();
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.evidence_gaps.includes("restore_operation_id_invalid"), true);
  assert.deepEqual(after, before);
});
