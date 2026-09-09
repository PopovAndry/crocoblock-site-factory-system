"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectScaffold, readProjectBySlug } = require("../src/project-store");
const { deriveProjectBinding } = require("../src/structural-snapshot-store");
const { DATE_BLOCK, nativeFactsFromObservation } = require("../src/viewing-date-preview");
const {
  PLAN_ID,
  SNAPSHOT_ID,
  APPLY_OPERATION_ID,
  AFTER_FORM_SHA256,
  BASELINE_FORM_SHA256,
  AFTER_RECORDS,
  BASELINE_RECORDS,
  AGENT_CREDENTIAL_FIELDS,
  assertAgentCredentialObservation,
  assertAgentRepairDelta,
  assertAgentRepairSurface,
  assertApplicationPasswordIdentity,
  assertUnchangedApplicationPasswordIdentity,
  assertVerifyExistingObservation,
  assertStableEnv,
  assertPostApply,
  assertRestoredBaseline,
  assertSnapshotMetadata,
  parseCanonicalRateCounter,
  readVerifyExistingSurface,
  restoreIdentity,
  replayOptionName,
  verifyCredentialChallenge,
  restoreViewingDate,
  verifyFunctionalSurfaces
} = require("../src/viewing-date-restore");

const BASELINE_CONTENT = '<!-- wp:jet-forms/hidden-field {"field_value":"query_var","query_var_key":"factory_property_id","name":"property_id","required":true} /-->\n\n<!-- wp:jet-forms/text-field {"label":"Name","name":"name","required":true} /-->\n\n<!-- wp:jet-forms/text-field {"field_type":"email","label":"Email","name":"email"} /-->\n\n<!-- wp:jet-forms/text-field {"field_type":"tel","label":"Phone","name":"phone"} /-->\n\n<!-- wp:jet-forms/textarea-field {"label":"Message","name":"message"} /-->\n\n<!-- wp:jet-forms/text-field {"field_type":"hidden","default":"request_viewing_before_v1","name":"_factory_policy_guard","required":true,"validation":{"type":"advanced","rules":[{"type":"ssr","value":"factory_request_viewing_before_v1_validate_contacts","message":"Provide an email address or phone number."},{"type":"ssr","value":"factory_request_viewing_before_v1_validate_property","message":"Select a published property."}]}} /-->\n\n<!-- wp:jet-forms/submit-field {"label":"Request viewing"} /-->';

function digest(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function observation(after) {
  const sha = after ? AFTER_FORM_SHA256 : BASELINE_FORM_SHA256;
  const fields = [
    ["property_id", "jet-forms/hidden-field", "hidden", true, { field_value: "query_var", query_var_key: "factory_property_id", name: "property_id", required: true }],
    ["name", "jet-forms/text-field", "text", true, { label: "Name", name: "name", required: true }],
    ["email", "jet-forms/text-field", "email", false, { field_type: "email", label: "Email", name: "email" }],
    ["phone", "jet-forms/text-field", "tel", false, { field_type: "tel", label: "Phone", name: "phone" }],
    ["message", "jet-forms/textarea-field", "textarea", false, { field_type: "textarea", label: "Message", name: "message" }],
    ["_factory_policy_guard", "jet-forms/text-field", "hidden", true, { field_type: "hidden", default: "request_viewing_before_v1", name: "_factory_policy_guard", required: true, validation: { rules: [{ type: "ssr", value: "factory_request_viewing_before_v1_validate_contacts" }, { type: "ssr", value: "factory_request_viewing_before_v1_validate_property" }] } }]
  ].map(([name, block, type, required, attrs]) => ({ name, block, type, required, label: attrs.label || null, attrs }));
  if (after) fields.splice(5, 0, { name: "preferred_date", block: "jet-forms/date-field", type: "date", required: false, label: "Preferred date", attrs: { label: "Preferred date", name: "preferred_date", blockID: "factory-request-viewing-preferred-date-v1" } });
  return {
    candidate_ids: [13], resolved_form_id: 13, form_id: 13, post_type: "jet-form-builder", post_status: "publish", owner: "request_viewing_before_v1",
    form_content: after ? "after-form" : BASELINE_CONTENT, form_sha256: sha, fields, actions: [{ type: "save_record" }],
    binding: { form_id: 13, form_sha256: sha, email_field: "email", phone_field: "phone", property_field: "property_id", guard_field: "_factory_policy_guard", guard_value: "request_viewing_before_v1" },
    records: clone(after ? AFTER_RECORDS : BASELINE_RECORDS), plugin_version: "3.6.5.1", policy_sha256: "541167d3a80c45095ef9396741fb99dca90752e7f5d7edecadb991d01d188e14"
  };
}

function writeOperation(state, operation) {
  const directory = path.join(state.runtimePath, "runs", "operations");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, operation.operation_id + ".json"), JSON.stringify(operation));
}

function fixture() {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "factory-viewing-date-restore-"));
  createProjectScaffold({ name: "CSF ST Viewing Before v1", slug: "csf-st-viewing-before-v1", port: 32100, projectsRoot });
  const state = readProjectBySlug("csf-st-viewing-before-v1", projectsRoot);
  fs.mkdirSync(path.join(state.runtimePath, "wordpress"), { recursive: true });
  fs.writeFileSync(path.join(state.runtimePath, "wordpress", "wp-config.php"), "fixture-wp-config");
  const before = observation(false);
  const after = observation(true);
  const plan = {
    schema: "csf_viewing_date_preview", version: 1, plan_id: PLAN_ID, project_slug: state.project.slug,
    profile: "add_optional_viewing_date@1", profile_id: "add_optional_viewing_date", profile_version: 1,
    baseline: { project_binding: deriveProjectBinding(state.project), form_id: 13, form_sha256: BASELINE_FORM_SHA256, actions_sha256: digest(before.actions), binding_sha256: digest(before.binding), policy_sha256: before.policy_sha256, facts_sha256: digest(nativeFactsFromObservation(before)) },
    proposed_delta: { add_optional_date_field: { native_block: DATE_BLOCK } },
    expected: { form_sha256: AFTER_FORM_SHA256 }
  };
  const proofRoot = path.join(state.runtimePath, "proofs", "viewing-date-preview-v1");
  fs.mkdirSync(path.join(proofRoot, "plans"), { recursive: true });
  fs.mkdirSync(path.join(proofRoot, "recovery-results"), { recursive: true });
  fs.writeFileSync(path.join(proofRoot, "plans", PLAN_ID + ".json"), JSON.stringify(plan));
  fs.writeFileSync(path.join(proofRoot, "recovery-results", PLAN_ID + ".json"), JSON.stringify({ schema: "csf_viewing_date_recovery_result", version: 3, status: "prepared", plan_id: PLAN_ID, project_slug: state.project.slug, profile_id: "add_optional_viewing_date", profile_version: 1, snapshot_id: SNAPSHOT_ID }));
  writeOperation(state, { schema: "factory_project_operation", version: 1, operation_id: APPLY_OPERATION_ID, project_slug: state.project.slug, operation_type: "viewing_date_apply", status: "succeeded", metadata: { plan_id: PLAN_ID }, result_summary: { status: "applied", mutation_performed: true } });
  return { projectsRoot, state, plan, before, after };
}

function options(value, current, extra) {
  return Object.assign({
    projectsRoot: value.projectsRoot,
    slug: "csf-st-viewing-before-v1",
    idempotencyKey: "viewing-date-restore-test-key",
    expectedAgentSecret: "fixture-server-owned-secret",
    verifyPrepared: async () => ({ status: "prepared", snapshot_id: SNAPSHOT_ID }),
    readNative: async () => clone(current.value),
    createRestorePlan: async () => ({ plan: { plan_id: "restore-plan-2026-09-07t12-00-00-000z-abcdef", snapshot_id: SNAPSHOT_ID, confirmation: { phrase: "Restore Website for csf-st-viewing-before-v1" } } })
  }, extra || {});
}

test("same-project Restore reaches the executor once only after the exact accepted post-Apply authority", async () => {
  const value = fixture();
  const current = { value: value.after };
  const calls = [];
  const result = await restoreViewingDate(options(value, current, {
    executeRestore: async (input) => { calls.push(input); assert.deepEqual(await input.postLockTerminalResolver(), { status: "continue" }); return { operation: { status: "succeeded" } }; }
  }));
  assert.deepEqual(result, { status: "restored", mutation_performed: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operationType, "viewing_date_restore");
  assert.deepEqual(calls[0].operationMetadata, { viewing_date_plan_id: PLAN_ID, viewing_date_snapshot_id: SNAPSHOT_ID, viewing_date_apply_operation_id: APPLY_OPERATION_ID });
  assert.equal(typeof calls[0].preRestoreVerifier, "function");
  assert.equal(typeof calls[0].postRestoreVerifier, "function");
  assert.equal(calls[0].deferIdempotencyUntilPostLock, true);
});

test("same-project Restore blocks wrong recovery, current drift, missing date, and record drift before the executor", async () => {
  const value = fixture();
  for (const mutate of [
    (input) => { input.recoverySnapshot = "wrong"; },
    (input) => { input.current.value.form_sha256 = "f".repeat(64); input.current.value.binding.form_sha256 = input.current.value.form_sha256; },
    (input) => { input.current.value.fields = input.current.value.fields.filter((field) => field.name !== "preferred_date"); },
    (input) => { input.current.value.records = { count: 98, fingerprint: "c".repeat(64) }; }
  ]) {
    const current = { value: clone(value.after) };
    const input = { current, recoverySnapshot: SNAPSHOT_ID };
    mutate(input);
    let calls = 0;
    await assert.rejects(() => restoreViewingDate(options(value, current, {
      verifyPrepared: async () => ({ status: "prepared", snapshot_id: input.recoverySnapshot }),
      executeRestore: async (request) => { await request.postLockTerminalResolver(); calls += 1; return { operation: { status: "succeeded" } }; }
    })));
    assert.equal(calls, 0);
  }
});

test("same-project Restore rejects another project, another plan, or a missing accepted Apply operation", async () => {
  const value = fixture();
  await assert.rejects(() => restoreViewingDate(options(value, { value: value.after }, { slug: "another-project" })), { code: "viewing_date_restore_project_not_allowed" });
  await assert.rejects(() => restoreViewingDate(options(value, { value: value.after }, { planId: "viewing-date-plan-00000000-0000-4000-8000-000000000000" })), { code: "viewing_date_restore_plan_mismatch" });
  fs.rmSync(path.join(value.state.runtimePath, "runs", "operations", APPLY_OPERATION_ID + ".json"));
  await assert.rejects(() => restoreViewingDate(options(value, { value: value.after })), { code: "viewing_date_restore_apply_missing" });
});

test("same-project Restore rejects failed or incomplete historical success and returns only exact restored history", async () => {
  const value = fixture();
  writeOperation(value.state, { schema: "factory_project_operation", version: 1, operation_id: "op-failed-restore", project_slug: value.state.project.slug, operation_type: "viewing_date_restore", status: "failed", metadata: { viewing_date_plan_id: PLAN_ID }, result_summary: {} });
  await assert.rejects(() => restoreViewingDate(options(value, { value: value.after })), { code: "viewing_date_restore_prior_attempt_terminal" });

  const interrupted = fixture();
  writeOperation(interrupted.state, { schema: "factory_project_operation", version: 1, operation_id: "op-interrupted-after-health", project_slug: interrupted.state.project.slug, operation_type: "viewing_date_restore", status: "interrupted", metadata: { viewing_date_plan_id: PLAN_ID, verify_existing_phase: "health_recorded" }, result_summary: {} });
  let interruptedNativeRestoreCalls = 0;
  await assert.rejects(() => restoreViewingDate(options(interrupted, { value: interrupted.after }, { executeRestore: async (request) => {
    await request.postLockTerminalResolver();
    interruptedNativeRestoreCalls += 1;
    return { operation: { status: "succeeded" } };
  } })), { code: "viewing_date_restore_prior_attempt_terminal" });
  assert.equal(interruptedNativeRestoreCalls, 0);

  const replay = fixture();
  writeOperation(replay.state, { schema: "factory_project_operation", version: 1, operation_id: "op-restored", project_slug: replay.state.project.slug, operation_type: "viewing_date_restore", status: "succeeded", metadata: { viewing_date_plan_id: PLAN_ID }, result_summary: { viewing_date_restore: restoreIdentity(replay.state.project.slug) } });
  let writes = 0;
  const result = await restoreViewingDate(options(replay, { value: replay.before }, { executeRestore: async (request) => { const terminal = await request.postLockTerminalResolver(); if (terminal.status === "handled") return { terminalHandled: true, result: terminal.result }; writes += 1; return { operation: { status: "succeeded" } }; } }));
  assert.deepEqual(result, { status: "already_restored", mutation_performed: false });
  assert.equal(writes, 0);

  const tampered = fixture();
  writeOperation(tampered.state, { schema: "factory_project_operation", version: 1, operation_id: "op-legacy-restored", project_slug: tampered.state.project.slug, operation_type: "viewing_date_restore", status: "succeeded", metadata: { viewing_date_plan_id: PLAN_ID }, result_summary: { status: "restored", mutation_performed: true } });
  await assert.rejects(() => restoreViewingDate(options(tampered, { value: tampered.before }, {
    executeRestore: async (request) => ({ result: await request.postLockTerminalResolver() })
  })), { code: "viewing_date_restore_prior_attempt_terminal" });

  const duplicate = fixture();
  const identity = restoreIdentity(duplicate.state.project.slug);
  for (const operationId of ["op-restored-one", "op-restored-two"]) {
    writeOperation(duplicate.state, { schema: "factory_project_operation", version: 1, operation_id: operationId, project_slug: duplicate.state.project.slug, operation_type: "viewing_date_restore", status: "succeeded", metadata: { viewing_date_plan_id: PLAN_ID }, result_summary: { viewing_date_restore: identity } });
  }
  await assert.rejects(() => restoreViewingDate(options(duplicate, { value: duplicate.before }, {
    executeRestore: async (request) => ({ result: await request.postLockTerminalResolver() })
  })), { code: "viewing_date_restore_prior_attempt_terminal" });
});

test("the exact failed ST-1 Restore is non-resumable and cannot reach native Restore", async () => {
  const value = fixture();
  writeOperation(value.state, {
    schema: "factory_project_operation", version: 1, operation_id: "op-2026-09-09T16-50-19-581Z-0992bf",
    project_slug: value.state.project.slug, operation_type: "viewing_date_restore", status: "failed",
    metadata: { viewing_date_plan_id: PLAN_ID, viewing_date_snapshot_id: SNAPSHOT_ID, viewing_date_apply_operation_id: APPLY_OPERATION_ID },
    result_summary: { manual_recovery_required: true }, error: { code: "viewing_date_restore_metadata_drift" }
  });
  let nativeRestoreCalls = 0;
  await assert.rejects(() => restoreViewingDate(options(value, { value: value.before }, { executeRestore: async (request) => {
    await request.postLockTerminalResolver();
    nativeRestoreCalls += 1;
    return { operation: { status: "succeeded" } };
  } })), { code: "viewing_date_restore_prior_attempt_terminal" });
  assert.equal(nativeRestoreCalls, 0);
});

test("Agent credential observation accepts only the exact native metadata fields", () => {
  const credential = { schema: "factory_agent_signing_credential", version: 1, contract_version: "factory_agent_signed_auth@1", key_id: "key-1", status: "active", created_at: "2026-09-01T00:00:00.000Z", revoked_at: null, capabilities: ["agent.health"], project_slug: "csf-st-viewing-before-v1" };
  assert.deepEqual(Object.keys(credential).sort(), AGENT_CREDENTIAL_FIELDS.slice().sort());
  assert.doesNotThrow(() => assertAgentCredentialObservation({ option_name: "factory_agent_signed_auth_credentials", credentials: [credential] }, credential.project_slug));
  assert.throws(() => assertAgentCredentialObservation({ option_name: "factory_agent_signed_auth_credentials", credentials: [Object.assign({}, credential, { unrelated: true })] }, credential.project_slug), { code: "viewing_date_restore_agent_allowlist_drift" });
  assert.throws(() => assertAgentCredentialObservation({ option_name: "factory_agent_signed_auth_credentials", credentials: [Object.assign({}, credential, { project_slug: "other" })] }, credential.project_slug), { code: "viewing_date_restore_agent_allowlist_drift" });
});

test("Agent repair permits exactly one correlated native replay guard and rejects every other surface delta", () => {
  const credential = { schema: "factory_agent_signing_credential", version: 1, contract_version: "factory-agent-hmac-v1", key_id: "factory_agent_test", status: "active", created_at: "2026-09-01T00:00:00.000Z", revoked_at: null, capabilities: ["health.read"], project_slug: "csf-st-viewing-before-v1" };
  const surface = (replays, other, rates) => ({ credential: { option_name: "factory_agent_signed_auth_credentials", credentials: [credential] }, replays: replays || [], rates: rates || [], other_factory_options: other || [] });
  const expected = { method: "GET", route: "/factory/v1/agent/health", project_slug: credential.project_slug, key_id: credential.key_id, request_id: "restore-health-request-1", expires_at: 1780000000 };
  const replay = { name: replayOptionName(expected.key_id, expected.request_id), value: String(expected.expires_at), autoload: "no" };
  const rate = { name: "factory_agent_rate_" + "3".repeat(64), value: "1", autoload: "no" };
  assert.doesNotThrow(() => assertAgentRepairDelta(surface(), surface([replay], [], [rate]), expected, credential.project_slug));
  assert.match(replay.name, /^factory_agent_replay_[a-f0-9]{64}$/);
  for (const after of [
    surface([{ name: "factory_agent_replay_" + "0".repeat(64), value: String(expected.expires_at), autoload: "no" }], [], [rate]),
    surface([{ name: replay.name, value: "invalid", autoload: "no" }], [], [rate]),
    surface([replay, { name: "factory_agent_replay_" + "1".repeat(64), value: String(expected.expires_at), autoload: "no" }], [], [rate]),
    surface([replay], [{ name: "factory_agent_unrelated", value_sha256: "a".repeat(64), autoload: "no" }], [rate])
  ]) {
    assert.throws(() => assertAgentRepairDelta(surface(), after, expected, credential.project_slug), { code: "viewing_date_restore_agent_allowlist_drift" });
  }
  const existing = { name: "factory_agent_replay_" + "2".repeat(64), value: "1779999900", autoload: "no" };
  assert.throws(() => assertAgentRepairDelta(surface([existing]), surface([replay]), expected, credential.project_slug), { code: "viewing_date_restore_agent_allowlist_drift" });
  assert.throws(() => assertAgentRepairSurface({ credential: surface().credential, replays: [{ name: "bad", value: "1", autoload: "no" }], other_factory_options: [] }, credential.project_slug), { code: "viewing_date_restore_agent_allowlist_drift" });
  assert.throws(() => assertAgentRepairDelta(surface(), surface([replay]), Object.assign({}, expected, { project_slug: "other" }), credential.project_slug), { code: "viewing_date_restore_agent_allowlist_drift" });
});

test("rate counters accept only bounded canonical decimal transitions", () => {
  assert.equal(parseCanonicalRateCounter("1"), 1n);
  assert.equal(parseCanonicalRateCounter("600"), 600n);
  for (const value of ["0", "-1", "601", "01", "1.0", "1e2", " Infinity", "9".repeat(400), Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseCanonicalRateCounter(value), { code: "viewing_date_restore_agent_allowlist_drift" });
  }
  const credential = { schema: "factory_agent_signing_credential", version: 1, contract_version: "factory-agent-hmac-v1", key_id: "factory_agent_test", status: "active", created_at: "2026-09-01T00:00:00.000Z", revoked_at: null, capabilities: ["health.read"], project_slug: "csf-st-viewing-before-v1" };
  const surface = (rates) => ({ credential: { option_name: "factory_agent_signed_auth_credentials", credentials: [credential] }, replays: [], rates, other_factory_options: [] });
  const expected = { method: "GET", route: "/factory/v1/agent/health", project_slug: credential.project_slug, key_id: credential.key_id, request_id: "rate-transition", expires_at: 1780000000 };
  const replay = { name: replayOptionName(expected.key_id, expected.request_id), value: String(expected.expires_at), autoload: "off" };
  const rate = (value) => ({ name: "factory_agent_rate_" + "e".repeat(64), value, autoload: "off" });
  for (const [before, after] of [[[], [rate("1")]], [[rate("1")], [rate("2")]], [[rate("599")], [rate("600")]]]) {
    assert.doesNotThrow(() => assertAgentRepairDelta(Object.assign(surface(before), { replays: [] }), Object.assign(surface(after), { replays: [replay] }), expected, credential.project_slug));
  }
  for (const [before, after] of [[rate("1"), rate("1")], [rate("2"), rate("1")], [rate("1"), rate("3")], [rate("600"), rate("601")], [rate("9".repeat(400)), rate("9".repeat(400))]]) {
    assert.throws(() => assertAgentRepairDelta(surface([before]), Object.assign(surface([after]), { replays: [replay] }), expected, credential.project_slug), { code: "viewing_date_restore_agent_allowlist_drift" });
  }
});

test("verify-existing boundary rejects changed Application Passwords, env identities, and replayed secret challenges", () => {
  const passwordState = { user_id: 1, count: 1, entries: [{ uuid: "a", app_id: "", name: "CSF", created: 1, last_used: null, last_ip: null }], structure_hmac: "a".repeat(64) };
  assert.doesNotThrow(() => assertApplicationPasswordIdentity(passwordState));
  assert.throws(() => assertApplicationPasswordIdentity(Object.assign({}, passwordState, { entries: [Object.assign({}, passwordState.entries[0], { last_used: 2 })], structure_hmac: "broken" })), { code: "viewing_date_restore_application_password_drift" });
  for (const changed of [
    Object.assign({}, passwordState, { entries: [Object.assign({}, passwordState.entries[0], { last_used: 2 })], structure_hmac: "b".repeat(64) }),
    Object.assign({}, passwordState, { entries: [Object.assign({}, passwordState.entries[0], { last_ip: "127.0.0.1" })], structure_hmac: "c".repeat(64) })
  ]) assert.throws(() => assertUnchangedApplicationPasswordIdentity(passwordState, changed), { code: "viewing_date_restore_application_password_drift" });
  const env = { dev: 1, ino: 2, size: 3, sha256: "b".repeat(64) };
  assert.doesNotThrow(() => assertStableEnv(env, Object.assign({}, env)));
  assert.throws(() => assertStableEnv(env, Object.assign({}, env, { sha256: "c".repeat(64) })), { code: "viewing_date_restore_env_drift" });
  const nonce = crypto.randomBytes(32);
  const response = crypto.createHmac("sha256", "server-owned-secret").update(nonce.toString("hex"), "utf8").digest("hex");
  assert.doesNotThrow(() => verifyCredentialChallenge("server-owned-secret", nonce, response));
  assert.throws(() => verifyCredentialChallenge("other-secret", nonce, response), { code: "viewing_date_restore_agent_secret_mismatch" });
  assert.throws(() => verifyCredentialChallenge("server-owned-secret", crypto.randomBytes(32), response), { code: "viewing_date_restore_agent_secret_mismatch" });
});

test("verify-existing reader accepts only canonical sanitized Agent observations", async () => {
  const credential = { schema: "factory_agent_signing_credential", version: 1, contract_version: "factory-agent-hmac-v1", key_id: "factory_agent_test", status: "active", created_at: "2026-09-01T00:00:00.000Z", revoked_at: null, capabilities: ["health.read"], project_slug: "csf-st-viewing-before-v1" };
  const observation = {
    surface: { credential: { option_name: "factory_agent_signed_auth_credentials", credentials: [credential] }, replays: [], rates: [{ name: "factory_agent_rate_" + "a".repeat(64), value: "1", autoload: "off" }], other_factory_options: [] },
    credential_hmac: ["b".repeat(64)],
    application_passwords: { user_id: 1, count: 1, entries: [{ uuid: "app-1", app_id: "", name: "Factory Launcher", created: 1, last_used: null, last_ip: null }], structure_hmac: "c".repeat(64) }
  };
  assert.doesNotThrow(() => assertVerifyExistingObservation(observation, credential.project_slug));
  await assert.doesNotReject(() => readVerifyExistingSurface({ project: { slug: credential.project_slug } }, { readVerifyExistingSurface: async () => clone(observation) }, crypto.randomBytes(32)));
  const runtimePath = fs.mkdtempSync(path.join(os.tmpdir(), "factory-verify-existing-reader-"));
  const projectState = { project: { slug: credential.project_slug }, env: { WP_ADMIN_USER: "fixture-admin" }, runtimePath };
  await assert.doesNotReject(() => readVerifyExistingSurface(projectState, { runVerifyExistingCommand: async () => ({ stdout: JSON.stringify(observation) }) }, crypto.randomBytes(32)));
  await assert.rejects(() => readVerifyExistingSurface(projectState, { runVerifyExistingCommand: async () => ({ stdout: "{" }) }, crypto.randomBytes(32)), { code: "viewing_date_restore_agent_allowlist_drift" });
  await assert.rejects(() => readVerifyExistingSurface(projectState, { runVerifyExistingCommand: async () => ({ stdout: "x".repeat(131073) }) }, crypto.randomBytes(32)), { code: "viewing_date_restore_agent_allowlist_drift" });
  const malformedSentinel = "observer-malformed-json-sentinel";
  await assert.rejects(() => readVerifyExistingSurface(projectState, { runVerifyExistingCommand: async (_command, _args, commandOptions) => require("../src/runtime-tools").runCommand(process.execPath, ["-e", "process.stdout.write(" + JSON.stringify(malformedSentinel + "{") + ")"], commandOptions) }, crypto.randomBytes(32)), { code: "viewing_date_restore_agent_allowlist_drift" });
  assert.equal(fs.readFileSync(path.join(runtimePath, "logs", "viewing-date-restore-verify-existing-read.log"), "utf8").includes(malformedSentinel), false);
  assert.throws(() => assertVerifyExistingObservation(Object.assign({}, observation, { application_passwords: Object.assign({}, observation.application_passwords, { entries: [Object.assign({}, observation.application_passwords.entries[0], { password: "must-not-leak" })] }) }), credential.project_slug), { code: "viewing_date_restore_application_password_drift" });
  assert.throws(() => assertVerifyExistingObservation(Object.assign({}, observation, { surface: Object.assign({}, observation.surface, { rates: [{ name: "factory_agent_rate_" + "b".repeat(64), value: "not-a-counter", autoload: "off" }] }) }), credential.project_slug), { code: "viewing_date_restore_agent_allowlist_drift" });
  await assert.rejects(() => readVerifyExistingSurface({ project: { slug: credential.project_slug } }, { readVerifyExistingSurface: async () => ({ malformed: true }) }, crypto.randomBytes(32)), { code: "viewing_date_restore_agent_allowlist_drift" });
});

test("same-project Restore invokes the verify-existing reader at B and C around one health observation", async () => {
  const value = fixture();
  const current = { value: value.after };
  const credential = { schema: "factory_agent_signing_credential", version: 1, contract_version: "factory-agent-hmac-v1", key_id: "factory_agent_test", status: "active", created_at: "2026-09-01T00:00:00.000Z", revoked_at: null, capabilities: ["health.read"], project_slug: value.state.project.slug };
  const signed = { method: "GET", route: "/factory/v1/agent/health", project_slug: value.state.project.slug, key_id: credential.key_id, request_id: "restore-health-request-1", expires_at: 1780000000 };
  const beforeSurface = { credential: { option_name: "factory_agent_signed_auth_credentials", credentials: [credential] }, replays: [], rates: [], other_factory_options: [] };
  const afterSurface = { credential: beforeSurface.credential, replays: [{ name: replayOptionName(signed.key_id, signed.request_id), value: String(signed.expires_at), autoload: "off" }], rates: [{ name: "factory_agent_rate_" + "d".repeat(64), value: "1", autoload: "off" }], other_factory_options: [] };
  const passwords = { user_id: 1, count: 1, entries: [{ uuid: "app-1", app_id: "", name: "Factory Launcher", created: 1, last_used: null, last_ip: null }], structure_hmac: "e".repeat(64) };
  const readerNonces = [];
  const wpRoot = path.join(value.state.runtimePath, "wordpress");
  const operationId = "op-verify-existing-journal";
  const workRoot = path.join(value.state.runtimePath, "runs", "restore-work", operationId);
  fs.mkdirSync(workRoot, { recursive: true });
  fs.mkdirSync(wpRoot, { recursive: true });
  fs.writeFileSync(path.join(wpRoot, "wp-config.php"), "fixture-wp-config");
  const wpConfigSha256 = digest("fixture-wp-config");
  const result = await restoreViewingDate(options(value, current, {
    expectedAgentSecret: "fixture-server-owned-secret",
    readVerifyExistingSurface: async (_state, nonce) => {
      readerNonces.push(nonce.toString("hex"));
      const hmac = crypto.createHmac("sha256", "fixture-server-owned-secret").update(nonce.toString("hex"), "utf8").digest("hex");
      return { surface: readerNonces.length === 1 ? clone(beforeSurface) : clone(afterSurface), credential_hmac: [hmac], application_passwords: clone(passwords) };
    },
    verifySnapshotMetadata: async () => {},
    verifyRestoredFilesystem: async () => {},
    verifySurfaces: async () => {},
    executeRestore: async (request) => {
      await request.preRestoreVerifier();
      current.value = value.before;
      await request.beforeSignedHealthObserver(Object.assign({}, signed, { operation_id: operationId, work_root: workRoot }));
      const beforeHealthJournal = JSON.parse(fs.readFileSync(path.join(workRoot, "viewing-date-verify-existing.json"), "utf8"));
      assert.equal(beforeHealthJournal.phase, "b_recorded");
      assert.equal(Object.hasOwn(beforeHealthJournal, "health"), false);
      await request.signedHealthObserver(Object.assign({}, signed, { operation_id: operationId, work_root: workRoot }));
      const afterHealthJournal = JSON.parse(fs.readFileSync(path.join(workRoot, "viewing-date-verify-existing.json"), "utf8"));
      assert.equal(afterHealthJournal.phase, "health_recorded");
      assert.deepEqual(afterHealthJournal.health, signed);
      const rawHmac = crypto.createHmac("sha256", "fixture-server-owned-secret").update(readerNonces[0], "utf8").digest("hex");
      assert.equal(JSON.stringify(afterHealthJournal).includes(rawHmac), false);
      assert.equal(JSON.stringify(afterHealthJournal).includes(JSON.stringify(passwords.entries)), false);
      await request.postRestoreVerifier({ operationId, projectState: value.state, source: {}, liveWordPressRoot: wpRoot, workRoot, wpConfigSha256, agent: { successful: true }, health: { signed_agent: "ok" } });
      return { operation: { status: "succeeded" } };
    }
  }));
  assert.deepEqual(result, { status: "restored", mutation_performed: true });
  assert.equal(readerNonces.length, 2);
  assert.equal(readerNonces[0], readerNonces[1]);
});

test("checkpoint B failure prevents health and restored success", async () => {
  const value = fixture();
  const current = { value: value.after };
  const wpRoot = path.join(value.state.runtimePath, "wordpress");
  fs.mkdirSync(wpRoot, { recursive: true });
  fs.writeFileSync(path.join(wpRoot, "wp-config.php"), "fixture-wp-config");
  let healthCalls = 0;
  await assert.rejects(() => restoreViewingDate(options(value, current, {
    executeRestore: async (request) => {
      await request.preRestoreVerifier();
      current.value = value.after;
      try { await request.beforeSignedHealthObserver(); } catch (error) { throw error; }
      healthCalls += 1;
      return { operation: { status: "succeeded" } };
    }
  })), { code: "viewing_date_apply_baseline_drift" });
  assert.equal(healthCalls, 0);
});

test("post-Apply and restored-baseline assertions reject duplicate date fields and unexpected record graphs", () => {
  const value = fixture();
  assert.equal(assertPostApply(value.after, value.plan).form_sha256, AFTER_FORM_SHA256);
  assert.equal(assertRestoredBaseline(value.before, value.plan).form_sha256, BASELINE_FORM_SHA256);
  const duplicateDate = clone(value.after);
  duplicateDate.fields.push(clone(duplicateDate.fields.find((field) => field.name === "preferred_date")));
  assert.throws(() => assertPostApply(duplicateDate, value.plan));
  const unexpectedBaselineRecord = clone(value.before);
  unexpectedBaselineRecord.records = { count: 96, fingerprint: "d".repeat(64) };
  assert.throws(() => assertRestoredBaseline(unexpectedBaselineRecord, value.plan), { code: "viewing_date_restore_records_baseline_drift" });
});

test("snapshot project metadata permits no non-allowlisted project drift", () => {
  const value = fixture();
  const metadataPath = path.join(value.state.runtimePath, "snapshot-metadata.json");
  const metadata = {
    schema: "factory_structural_snapshot_metadata", version: 1,
    project_slug: value.state.project.slug, project_id: value.state.project.project_id || null,
    site_name: value.state.project.site_name || null, wp_port: value.state.project.wp_port || null,
    runtime_status: value.state.project.runtime && value.state.project.runtime.status || null,
    agent_status: value.state.project.agent && value.state.project.agent.status || null,
    agent_version: value.state.project.agent && value.state.project.agent.version || null,
    binding: deriveProjectBinding(value.state.project).basis, created_at: "2026-09-04T00:00:00.000Z"
  };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  assert.doesNotThrow(() => assertSnapshotMetadata({ artifacts: { metadata: { path: metadataPath } } }, value.state));
  metadata.site_name = "unrelated drift";
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  assert.throws(() => assertSnapshotMetadata({ artifacts: { metadata: { path: metadataPath } } }, value.state), { code: "viewing_date_restore_metadata_drift" });
  metadata.site_name = value.state.project.site_name;
  metadata.binding = deriveProjectBinding(value.state.project);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  assert.throws(() => assertSnapshotMetadata({ artifacts: { metadata: { path: metadataPath } } }, value.state), { code: "viewing_date_restore_metadata_drift" });
  metadata.binding = "arbitrary-binding";
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  assert.throws(() => assertSnapshotMetadata({ artifacts: { metadata: { path: metadataPath } } }, value.state), { code: "viewing_date_restore_metadata_drift" });
});

test("restored Property and Contact surfaces require live route, CTA, baseline form, and no date field", async () => {
  const responses = [
    '<a class="factory-request-viewing-cta"></a>',
    '<a class="factory-request-viewing-cta"></a>',
    '<input name="name"><input name="property_id">'
  ];
  let calls = 0;
  await verifyFunctionalSurfaces({}, {
    discoverSurfaces: async () => ({ property_a: "http://127.0.0.1:8200/a", property_b: "http://127.0.0.1:8200/b", contact: "http://127.0.0.1:8200/contact" }),
    fetcher: async () => ({ status: 200, text: async () => responses[calls++] })
  });
  await assert.rejects(() => verifyFunctionalSurfaces({}, {
    discoverSurfaces: async () => ({ property_a: "http://127.0.0.1:8200/a", property_b: "http://127.0.0.1:8200/b", contact: "http://127.0.0.1:8200/contact" }),
    fetcher: async () => ({ status: 200, text: async () => '<input name="preferred_date">' })
  }), { code: "viewing_date_restore_surface_drift" });
});
