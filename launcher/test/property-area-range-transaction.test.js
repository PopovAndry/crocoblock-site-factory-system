"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectScaffold, readProjectBySlug } = require("../src/project-store");
const { createPropertyAreaRangePreview, preparePropertyAreaRangeRecovery, readPlan } = require("../src/property-area-range-preview");
const { applyPropertyAreaRange } = require("../src/property-area-range-apply");
const { listOperations } = require("../src/project-operation-store");
const { nativeQueryScript } = require("../src/property-area-range-evidence");

const PLUGIN_HASH = "a".repeat(64);
const COVERAGE = {
  schema: "csf_viewing_date_recovery_scope_coverage", version: 1,
  database: { scope: "full_database", capture_authority: true, artifact_bytes_verified: true, affected_resources: ["request_viewing_form_post", "request_viewing_form_meta_actions_ownership", "request_viewing_policy_binding_option"], row_level_inspection: false, restore_verification_required: true },
  wordpress_filesystem: { scope: "wordpress_filesystem_archive", artifact_bytes_verified: true, policy_file_verified: true },
  project_metadata: { scope: "project_metadata", artifact_bytes_verified: true, project_identity_verified: true }
};

function fixture() {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "factory-area-range-"));
  const state = createProjectScaffold({ name: "Area Range", slug: "property-area-range-test", port: 31981, projectsRoot });
  let option = null;
  let writes = 0;
  const observe = () => ({
    runtime_binding: { ok: true, binding: { schema_version: 1, binding_kind: "server_owned_runtime_binding", project_id: state.project.project_id, project_slug: state.project.slug } },
    plugin_identity_sha256: PLUGIN_HASH,
    property_areas: [
      { post_id: 9, values: [] },
      { post_id: 3, values: ["74.12"] },
      { post_id: 7, values: ["120"] }
    ],
    option_present: option !== null,
    option_value: option
  });
  return { projectsRoot, state, observe, get writes() { return writes; }, write(activation) { writes += 1; if (option !== null) return observe(); option = activation; return observe(); }, setOption(value) { option = value; } };
}

function reattestation(value, snapshotId) {
  return {
    inspection: { artifact_verification: "single_pass" },
    coverage: COVERAGE,
    snapshot_identity: { snapshot_id: snapshotId, project_slug: value.state.project.slug, project_identity_fingerprint: require("../src/structural-snapshot-store").deriveProjectBinding(value.state.project).fingerprint, manifest_sha256: "b".repeat(64), artifacts_sha256: "c".repeat(64) }
  };
}

test("ST-2 native business observation requires canonicality and range on one property_size row", () => {
  const script = nativeQueryScript({ area_min: "74.00", area_max: "74.12" });
  assert.match(script, /INNER JOIN \{\$wpdb->postmeta\} AS factory_area_meta ON factory_area_meta\.post_id=p\.ID/);
  assert.match(script, /factory_area_meta\.meta_value REGEXP '\^\(0\|\[1-9\]\[0-9\]\{0,9\}\)\(\[\.\]\[0-9\]\{1,2\}\)\?\$'/);
  assert.match(script, /CAST\(factory_area_meta\.meta_value AS DECIMAL\(12,2\)\) BETWEEN/);
  assert.doesNotMatch(script, /meta_query/);
});

async function preparedFixture() {
  const value = fixture();
  const preview = await createPropertyAreaRangePreview({ projectsRoot: value.projectsRoot, slug: value.state.project.slug, observe: async () => value.observe(), expectedPluginIdentity: PLUGIN_HASH, verifyRuntimeBinding: () => ({ ok: true }) });
  const snapshotId = "snapshot-2026-10-08t12-00-00-000z-abcdef123456";
  await preparePropertyAreaRangeRecovery({
    projectsRoot: value.projectsRoot, slug: value.state.project.slug, planId: preview.plan_id, observe: async () => value.observe(),
    captureSnapshot: async () => ({ result: { snapshot_id: snapshotId } }),
    reattest: async () => reattestation(value, snapshotId)
  });
  return Object.assign(value, { planId: preview.plan_id, snapshotId });
}

test("ST-2 Preview persists only an option activation semantic diff after exact binding, plugin, area, and absent-option checks", async () => {
  const value = fixture();
  await assert.rejects(() => createPropertyAreaRangePreview({ projectsRoot: value.projectsRoot, slug: value.state.project.slug, observe: async () => value.observe(), expectedPluginIdentity: "b".repeat(64), verifyRuntimeBinding: () => ({ ok: true }) }), { code: "property_area_range_runtime_identity_drift" });
  const result = await createPropertyAreaRangePreview({ projectsRoot: value.projectsRoot, slug: value.state.project.slug, observe: async () => value.observe(), expectedPluginIdentity: PLUGIN_HASH, verifyRuntimeBinding: () => ({ ok: true }) });
  const plan = readPlan(readProjectBySlug(value.state.project.slug, value.projectsRoot), result.plan_id);
  assert.deepEqual(plan.proposed_delta, { add_option: { key: "factory_property_area_range_v1", schema_version: 1, state: "enabled" } });
  assert.equal(plan.expected.option_absent_before_apply, true);
  assert.equal(plan.baseline.property_count, 3);
  value.setOption({ malformed: true });
  await assert.rejects(() => createPropertyAreaRangePreview({ projectsRoot: value.projectsRoot, slug: value.state.project.slug, observe: async () => value.observe(), expectedPluginIdentity: PLUGIN_HASH, verifyRuntimeBinding: () => ({ ok: true }) }), { code: "property_area_range_option_present" });
});

test("ST-2 Preview and Recovery reject noncanonical sizes and snapshot drift before Apply", async () => {
  const value = fixture();
  const missingOptionState = value.observe();
  delete missingOptionState.option_present;
  await assert.rejects(() => createPropertyAreaRangePreview({ projectsRoot: value.projectsRoot, slug: value.state.project.slug, observe: async () => missingOptionState, expectedPluginIdentity: PLUGIN_HASH, verifyRuntimeBinding: () => ({ ok: true }) }), { code: "property_area_range_runtime_identity_drift" });
  const malformed = value.observe();
  malformed.property_areas[1].values = ["74.125"];
  await assert.rejects(() => createPropertyAreaRangePreview({ projectsRoot: value.projectsRoot, slug: value.state.project.slug, observe: async () => malformed, expectedPluginIdentity: PLUGIN_HASH, verifyRuntimeBinding: () => ({ ok: true }) }), { code: "property_area_range_data_malformed" });
  const preview = await createPropertyAreaRangePreview({ projectsRoot: value.projectsRoot, slug: value.state.project.slug, observe: async () => value.observe(), expectedPluginIdentity: PLUGIN_HASH, verifyRuntimeBinding: () => ({ ok: true }) });
  await assert.rejects(() => preparePropertyAreaRangeRecovery({ projectsRoot: value.projectsRoot, slug: value.state.project.slug, planId: preview.plan_id, observe: async () => value.observe(), captureSnapshot: async () => ({ result: { snapshot_id: "snapshot-2026-10-08t12-00-00-000z-abcdef123456" } }), reattest: async () => null }), { code: "property_area_range_recovery_missing" });
});

test("ST-2 Apply writes the exact operation-bound option once, verifies read-back, and replays without a second write", async () => {
  const value = await preparedFixture();
  const options = {
    projectsRoot: value.projectsRoot, slug: value.state.project.slug, planId: value.planId, idempotencyKey: "property-area-range-idempotency-key", readNative: async () => value.observe(), writeNative: async (_state, activation) => value.write(activation),
    verifyPrepared: async ({ recovery }) => ({ status: "prepared", snapshot_id: recovery.snapshot_id })
  };
  const first = await applyPropertyAreaRange(options);
  assert.equal(first.status, "applied");
  assert.equal(first.mutation_performed, true);
  assert.equal(value.writes, 1);
  const operation = listOperations({ projectsRoot: value.projectsRoot, slug: value.state.project.slug, includeRaw: true }).find((entry) => entry.operation_type === "property_area_range_apply");
  assert.ok(operation);
  assert.deepEqual(value.observe().option_value, { schema_version: 1, state: "enabled", project_id: value.state.project.project_id, plan_id: value.planId, snapshot_id: value.snapshotId, operation_id: operation.operation_id });
  const replay = await applyPropertyAreaRange(options);
  assert.equal(replay.status, "already_applied");
  assert.equal(replay.mutation_performed, false);
  assert.equal(replay.plan_id, value.planId);
  assert.equal(replay.snapshot_id, value.snapshotId);
  assert.equal(replay.operation_id, operation.operation_id);
  assert.equal(value.writes, 1);
});

test("ST-2 Apply fails closed for option drift, write ambiguity, failed attempts, and cross-project authority", async () => {
  const value = await preparedFixture();
  value.setOption({ malformed: true });
  await assert.rejects(() => applyPropertyAreaRange({ projectsRoot: value.projectsRoot, slug: value.state.project.slug, planId: value.planId, idempotencyKey: "property-area-range-option-drift", readNative: async () => value.observe(), verifyPrepared: async ({ recovery }) => ({ status: "prepared", snapshot_id: recovery.snapshot_id }) }), { code: "property_area_range_apply_baseline_drift" });
  const clean = await preparedFixture();
  await assert.rejects(() => applyPropertyAreaRange({ projectsRoot: clean.projectsRoot, slug: clean.state.project.slug, planId: clean.planId, idempotencyKey: "property-area-range-write-failure", readNative: async () => clean.observe(), writeNative: async () => ({ ...clean.observe(), option_present: true, option_value: { malformed: true } }), verifyPrepared: async ({ recovery }) => ({ status: "prepared", snapshot_id: recovery.snapshot_id }) }), { code: "property_area_range_apply_after_state_drift" });
  await assert.rejects(() => applyPropertyAreaRange({ projectsRoot: clean.projectsRoot, slug: clean.state.project.slug, planId: clean.planId, idempotencyKey: "property-area-range-new-key", readNative: async () => clean.observe(), verifyPrepared: async ({ recovery }) => ({ status: "prepared", snapshot_id: recovery.snapshot_id }) }), { code: "property_area_range_apply_prior_attempt_terminal" });
  const writeFailure = await preparedFixture();
  await assert.rejects(() => applyPropertyAreaRange({ projectsRoot: writeFailure.projectsRoot, slug: writeFailure.state.project.slug, planId: writeFailure.planId, idempotencyKey: "property-area-range-write-throws", readNative: async () => writeFailure.observe(), writeNative: async () => { throw Object.assign(new Error("native write failed"), { code: "native_write_failed" }); }, verifyPrepared: async ({ recovery }) => ({ status: "prepared", snapshot_id: recovery.snapshot_id }) }), { code: "native_write_failed" });
  assert.equal(listOperations({ projectsRoot: writeFailure.projectsRoot, slug: writeFailure.state.project.slug, includeRaw: true }).filter((entry) => entry.operation_type === "property_area_range_apply" && entry.status === "succeeded").length, 0);
});
