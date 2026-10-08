"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectScaffold, readProjectBySlug } = require("../src/project-store");
const { deriveProjectBinding } = require("../src/structural-snapshot-store");
const { createPropertyAreaRangePreview, preparePropertyAreaRangeRecovery } = require("../src/property-area-range-preview");
const { applyPropertyAreaRange } = require("../src/property-area-range-apply");
const { isRestoreWorkRootClean } = require("../src/structural-restore-execution");
const { restorePropertyAreaRange } = require("../src/property-area-range-restore");

const PLUGIN = "a".repeat(64);
const SECRET = "property-area-range-server-secret";
const COVERAGE = { schema: "csf_viewing_date_recovery_scope_coverage", version: 1, database: { scope: "full_database", capture_authority: true, artifact_bytes_verified: true, affected_resources: ["request_viewing_form_post", "request_viewing_form_meta_actions_ownership", "request_viewing_policy_binding_option"], row_level_inspection: false, restore_verification_required: true }, wordpress_filesystem: { scope: "wordpress_filesystem_archive", artifact_bytes_verified: true, policy_file_verified: true }, project_metadata: { scope: "project_metadata", artifact_bytes_verified: true, project_identity_verified: true } };

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function hash(value) { return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }

async function fixture() {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "factory-property-area-range-restore-"));
  const scaffold = createProjectScaffold({ name: "Area Restore", slug: "property-area-range-restore", port: 39711, projectsRoot });
  const state = readProjectBySlug(scaffold.project.slug, projectsRoot);
  fs.mkdirSync(path.join(state.project.runtime_path, "wordpress"), { recursive: true });
  fs.writeFileSync(path.join(state.project.runtime_path, "wordpress", "wp-config.php"), "fixture-config", "utf8");
  let option = null;
  const observe = () => ({ runtime_binding: { ok: true, binding: { schema_version: 1, binding_kind: "server_owned_runtime_binding", project_id: state.project.project_id, project_slug: state.project.slug } }, plugin_identity_sha256: PLUGIN, property_areas: [{ post_id: 3, values: ["74.12"] }, { post_id: 7, values: ["120"] }], option_present: option !== null, option_value: option });
  const preview = await createPropertyAreaRangePreview({ projectsRoot, slug: state.project.slug, observe: async () => observe(), expectedPluginIdentity: PLUGIN, verifyRuntimeBinding: () => ({ ok: true }) });
  const snapshotId = "snapshot-2026-10-08t12-00-00-000z-abcdef123456";
  const binding = deriveProjectBinding(state.project);
  await preparePropertyAreaRangeRecovery({ projectsRoot, slug: state.project.slug, planId: preview.plan_id, observe: async () => observe(), captureSnapshot: async () => ({ result: { snapshot_id: snapshotId } }), reattest: async () => ({ inspection: { artifact_verification: "single_pass" }, coverage: COVERAGE, snapshot_identity: { snapshot_id: snapshotId, project_slug: state.project.slug, project_identity_fingerprint: binding.fingerprint, manifest_sha256: "b".repeat(64), artifacts_sha256: "c".repeat(64) } }) });
  const prepared = { status: "prepared", snapshot_id: snapshotId };
  const applied = await applyPropertyAreaRange({ projectsRoot, slug: state.project.slug, planId: preview.plan_id, idempotencyKey: "property-area-range-apply-key", readNative: async () => observe(), writeNative: async (_state, activation) => { option = activation; return observe(); }, verifyPrepared: async () => prepared });
  assert.equal(applied.status, "applied");
  return { projectsRoot, state, observe, setOption: (value) => { option = value; }, planId: preview.plan_id, snapshotId, binding, prepared };
}

function observer(slug, nonce, after) {
  const credential = { schema: "factory_agent_signing_credential", version: 1, contract_version: "factory-agent-hmac-v1", key_id: "factory_agent_test", status: "active", created_at: "2026-10-08T00:00:00.000Z", revoked_at: null, capabilities: ["health.read"], project_slug: slug };
  const signed = { method: "GET", route: "/factory/v1/agent/health", project_slug: slug, key_id: credential.key_id, request_id: "property-area-range-health", expires_at: 1791453600 };
  const replay = { name: "factory_agent_replay_" + crypto.createHash("sha256").update(credential.key_id + "\n" + signed.request_id, "utf8").digest("hex"), value: String(signed.expires_at), autoload: "off" };
  const surface = { credential: { option_name: "factory_agent_signed_auth_credentials", credentials: [credential] }, replays: after ? [replay] : [], rates: after ? [{ name: "factory_agent_rate_" + "d".repeat(64), value: "1", autoload: "off" }] : [], other_factory_options: [] };
  return { signed, value: { surface, credential_hmac: [crypto.createHmac("sha256", SECRET).update(nonce.toString("hex"), "utf8").digest("hex")], application_passwords: { user_id: 1, count: 1, entries: [{ uuid: "app-1", app_id: "", name: "Factory", created: 1, last_used: null, last_ip: null }], structure_hmac: "e".repeat(64) } } };
}

function queryResults(_state, bounds) {
  assert.deepEqual(bounds, { area_min: "74.12", area_max: "74.12" });
  return { unfiltered_result_ids: [3, 7], range_result_ids: [3] };
}

function writeCompletedRestoreJournal(workRoot, operation, restorePlan, project) {
  fs.writeFileSync(path.join(workRoot, "restore-journal.json"), JSON.stringify({ journal_schema_version: 1, operation_id: operation.operation_id, project_slug: project.slug, restore_plan_id: restorePlan.plan_id, source_snapshot_id: restorePlan.snapshot_id, verification_completed: true, project_binding: { binding_key: project.slug + "-" + restorePlan.project_identity_fingerprint.slice(0, 16), fingerprint: restorePlan.project_identity_fingerprint, slug: project.slug } }) + "\n", "utf8");
}

test("Property Area Range Restore produces the exact profile journal through B, one health, C, and cleanup", async () => {
  const value = await fixture();
  const operationId = "op-2026-10-08T12-00-00-000Z-aabbcc";
  const workRoot = path.join(value.state.project.runtime_path, "runs", "restore-work", operationId);
  fs.mkdirSync(workRoot, { recursive: true });
  let nonce;
  let healthCalls = 0;
  const result = await restorePropertyAreaRange({ projectsRoot: value.projectsRoot, slug: value.state.project.slug, idempotencyKey: "property-area-range-restore-key", expectedAgentSecret: SECRET, verifyPrepared: async () => value.prepared, readNative: async () => value.observe(), observeQueryResults: queryResults, readVerifyExistingSurface: async (_state, suppliedNonce) => { nonce = suppliedNonce; return observer(value.state.project.slug, suppliedNonce, healthCalls > 0).value; }, createRestorePlan: async () => ({ plan: { plan_id: "restore-plan-2026-10-08t12-00-00-000z-abcdef", snapshot_id: value.snapshotId, project_slug: value.state.project.slug, project_identity_fingerprint: value.binding.fingerprint, confirmation: { phrase: "Restore Website for " + value.state.project.slug } } }), executeRestore: async (request) => {
    assert.deepEqual(await request.postLockTerminalResolver(), { status: "continue" });
    await request.preRestoreVerifier();
    value.setOption(null);
    const { expires_at: _unusedExpiresAt, ...initial } = observer(value.state.project.slug, crypto.randomBytes(32), false).signed;
    await request.beforeSignedHealthObserver(Object.assign({}, initial, { operation_id: operationId, work_root: workRoot }));
    const reserved = JSON.parse(fs.readFileSync(path.join(workRoot, "property-area-range-verify-existing.json"), "utf8"));
    assert.equal(reserved.schema, "csf_property_area_range_restore_verify_existing_journal");
    assert.equal(reserved.phase, "health_reserved");
    healthCalls += 1;
    const signed = observer(value.state.project.slug, nonce, true).signed;
    await request.signedHealthObserver(Object.assign({}, signed, { operation_id: operationId, work_root: workRoot }));
    const operation = { operation_id: operationId, operation_type: "property_area_range_restore", metadata: Object.assign({ restore_scope: "managed_website_same_project", plan_id: request.planId }, request.operationMetadata) };
    const restorePlan = { plan_id: request.planId, snapshot_id: value.snapshotId, project_identity_fingerprint: value.binding.fingerprint };
    writeCompletedRestoreJournal(workRoot, operation, restorePlan, value.state.project);
    await request.postRestoreVerifier({ operationId, projectState: value.state, source: { manifest: { snapshot_id: value.snapshotId, project_slug: value.state.project.slug, project_identity_fingerprint: value.binding.fingerprint } }, liveWordPressRoot: path.join(value.state.project.runtime_path, "wordpress"), workRoot, wpConfigSha256: hash("fixture-config"), agent: { successful: true }, health: { signed_agent: "ok" } });
    const cleanupContext = { agentAuthorityMode: "verify_existing", operation, projectState: value.state, restorePlan, workRoot };
    assert.equal(isRestoreWorkRootClean(workRoot, cleanupContext), true);
    fs.writeFileSync(path.join(workRoot, "unexpected.json"), "{}\n", "utf8");
    assert.equal(isRestoreWorkRootClean(workRoot, cleanupContext), false, "extra work-root files remain fail-closed");
    fs.unlinkSync(path.join(workRoot, "unexpected.json"));
    return { operation: { status: "succeeded" } };
  } });
  assert.deepEqual(result, { status: "restored", mutation_performed: true });
  assert.equal(healthCalls, 1);
});

test("Property Area Range Restore rejects profile injection, journal-write failure, and post-C drift", async () => {
  const value = await fixture();
  await assert.rejects(() => restorePropertyAreaRange({ projectsRoot: value.projectsRoot, slug: value.state.project.slug, profile: "viewing_date" }), { code: "property_area_range_restore_authority_injected" });
  const makeOptions = (extra) => Object.assign({ projectsRoot: value.projectsRoot, slug: value.state.project.slug, idempotencyKey: "property-area-range-restore-failure", expectedAgentSecret: SECRET, verifyPrepared: async () => value.prepared, readNative: async () => value.observe(), observeQueryResults: queryResults, createRestorePlan: async () => ({ plan: { plan_id: "restore-plan-2026-10-08t12-00-00-000z-failure", snapshot_id: value.snapshotId, project_slug: value.state.project.slug, project_identity_fingerprint: value.binding.fingerprint, confirmation: { phrase: "Restore Website for " + value.state.project.slug } } }) }, extra);
  await assert.rejects(() => restorePropertyAreaRange(makeOptions({ writeVerifyExistingJournal: () => { throw new Error("disk full"); }, readVerifyExistingSurface: async (_state, nonce) => observer(value.state.project.slug, nonce, false).value, executeRestore: async (request) => { await request.preRestoreVerifier(); value.setOption(null); const { expires_at: _unusedExpiresAt, ...attempt } = observer(value.state.project.slug, crypto.randomBytes(32), false).signed; const operationId = "op-2026-10-08T12-00-00-000Z-failure"; const workRoot = path.join(value.state.project.runtime_path, "runs", "restore-work", operationId); fs.mkdirSync(workRoot, { recursive: true }); await request.beforeSignedHealthObserver(Object.assign({}, attempt, { operation_id: operationId, work_root: workRoot })); } })), { code: "property_area_range_restore_journal_write_failed" });
});

test("Property Area Range Restore makes post-C Agent drift terminal after one health", async () => {
  const value = await fixture();
  const operationId = "op-2026-10-08T12-00-00-000Z-cdrift";
  const workRoot = path.join(value.state.project.runtime_path, "runs", "restore-work", operationId);
  fs.mkdirSync(workRoot, { recursive: true });
  let reads = 0;
  let healthCalls = 0;
  await assert.rejects(() => restorePropertyAreaRange({ projectsRoot: value.projectsRoot, slug: value.state.project.slug, idempotencyKey: "property-area-range-restore-cdrift", expectedAgentSecret: SECRET, verifyPrepared: async () => value.prepared, readNative: async () => value.observe(), observeQueryResults: queryResults, readVerifyExistingSurface: async (_state, nonce) => { reads += 1; return observer(value.state.project.slug, nonce, false).value; }, createRestorePlan: async () => ({ plan: { plan_id: "restore-plan-2026-10-08t12-00-00-000z-cdrift", snapshot_id: value.snapshotId, project_slug: value.state.project.slug, project_identity_fingerprint: value.binding.fingerprint, confirmation: { phrase: "Restore Website for " + value.state.project.slug } } }), executeRestore: async (request) => {
    await request.preRestoreVerifier();
    value.setOption(null);
    const { expires_at: _unusedExpiresAt, ...attempt } = observer(value.state.project.slug, crypto.randomBytes(32), false).signed;
    await request.beforeSignedHealthObserver(Object.assign({}, attempt, { operation_id: operationId, work_root: workRoot }));
    healthCalls += 1;
    const signed = observer(value.state.project.slug, crypto.randomBytes(32), true).signed;
    await request.signedHealthObserver(Object.assign({}, signed, { operation_id: operationId, work_root: workRoot }));
    await request.postRestoreVerifier({ operationId, projectState: value.state, source: { manifest: { snapshot_id: value.snapshotId, project_slug: value.state.project.slug, project_identity_fingerprint: value.binding.fingerprint } }, liveWordPressRoot: path.join(value.state.project.runtime_path, "wordpress"), workRoot, wpConfigSha256: hash("fixture-config"), agent: { successful: true }, health: { signed_agent: "ok" } });
  } }), { code: "viewing_date_restore_agent_allowlist_drift" });
  assert.equal(healthCalls, 1);
  assert.equal(reads, 2);
});

test("Property Area Range Restore does not resume a failed terminal operation", async () => {
  const value = await fixture();
  const operationId = "op-2026-10-08T12-00-00-000Z-terminal";
  const operations = path.join(value.state.runtimePath, "runs", "operations");
  fs.mkdirSync(operations, { recursive: true });
  fs.writeFileSync(path.join(operations, operationId + ".json"), JSON.stringify({ schema: "factory_project_operation", version: 1, operation_id: operationId, project_slug: value.state.project.slug, operation_type: "property_area_range_restore", status: "failed", metadata: {}, result_summary: { manual_recovery_required: true } }) + "\n", "utf8");
  let entered = false;
  await assert.rejects(() => restorePropertyAreaRange({ projectsRoot: value.projectsRoot, slug: value.state.project.slug, idempotencyKey: "property-area-range-terminal", expectedAgentSecret: SECRET, verifyPrepared: async () => value.prepared, readNative: async () => value.observe(), observeQueryResults: queryResults, createRestorePlan: async () => ({ plan: { plan_id: "restore-plan-2026-10-08t12-00-00-000z-terminal", snapshot_id: value.snapshotId, project_slug: value.state.project.slug, project_identity_fingerprint: value.binding.fingerprint, confirmation: { phrase: "Restore Website for " + value.state.project.slug } } }), executeRestore: async (request) => { await request.postLockTerminalResolver(); entered = true; } }), { code: "property_area_range_restore_prior_attempt_terminal" });
  assert.equal(entered, false);
});
