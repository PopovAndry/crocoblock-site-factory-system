"use strict";

// Profile-specific authority only. The structural executor remains the sole
// database/filesystem mutator and supplies the established B -> health -> C hooks.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { readProjectBySlug, resolveProjectsRoot, validateExplicitSlug } = require("./project-store");
const { listOperations } = require("./project-operation-store");
const { deriveProjectBinding } = require("./structural-snapshot-store");
const { createRestorePlan } = require("./structural-restore-plan");
const { executeManagedWebsiteRestore } = require("./structural-restore-execution");
const { authority: readApplyAuthority, afterState } = require("./property-area-range-apply");
const { OPTION_NAME, assertObservation, observeAreaRuntime } = require("./property-area-range-preview");
const { captureBusinessEvidence, readBusinessEvidence, observeQueryResults } = require("./property-area-range-evidence");
const { requireAgentSigningCredential } = require("./agent-credential-store");
const { assertAgentRepairDelta, assertAgentRepairSurface, assertApplicationPasswordIdentity, assertPropertyAreaRangeVerifyExistingJournal, assertStableEnv, fileIdentity, makePropertyAreaRangeVerifyExistingJournal, readVerifyExistingSurface, verifyCredentialChallenge } = require("./viewing-date-restore");

const OPERATION_TYPE = "property_area_range_restore";
const JOURNAL_SCHEMA = "csf_property_area_range_restore_verify_existing_journal";
const JOURNAL_FILENAME = "property-area-range-verify-existing.json";
const RESTORE_HANDLE = "property-area-range-restore-st2-v1";

function fail(code, message, statusCode) { const error = new Error(message || "Property Area Range Restore cannot proceed safely."); error.code = code; error.statusCode = statusCode || 409; return error; }
function stable(value) { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]"; return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}"; }
function digest(value) { return crypto.createHash("sha256").update(stable(value)).digest("hex"); }
function digestFile(filePath) { return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"); }
function exactKeys(value, keys) { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === keys.slice().sort().join(","); }

function journalContext(input, prepared) {
  const plan = prepared.authority.plan;
  return { operationId: input.operation_id || input.operationId, workRoot: input.work_root || input.workRoot, projectSlug: prepared.projectState.project.slug, projectId: prepared.projectState.project.project_id, projectBindingFingerprint: plan.baseline.project_binding.fingerprint, planId: plan.plan_id, snapshotId: prepared.authority.recovery.snapshot_id, applyOperationId: prepared.apply.operation_id };
}

function journalPath(context) {
  if (!context || typeof context.workRoot !== "string" || !/^op-[a-z0-9-]+$/i.test(String(context.operationId || ""))) throw fail("property_area_range_restore_journal_invalid", "Restore verification evidence could not be stored safely.");
  const root = path.resolve(context.workRoot);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.basename(root) !== context.operationId) throw fail("property_area_range_restore_journal_invalid", "Restore verification evidence could not be stored safely.");
  return path.join(root, JOURNAL_FILENAME);
}

function writeNew(context, value) {
  const target = journalPath(context);
  if (fs.existsSync(target)) throw fail("property_area_range_restore_journal_exists", "Restore verification evidence could not be stored safely.");
  const temporary = target + ".tmp-" + process.pid + "-" + crypto.randomBytes(3).toString("hex");
  try { fs.writeFileSync(temporary, JSON.stringify(value) + "\n", { encoding: "utf8", flag: "wx" }); fs.linkSync(temporary, target); } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function replace(context, value) {
  const target = journalPath(context);
  if (!fs.existsSync(target)) throw fail("property_area_range_restore_journal_missing", "Restore verification evidence is unavailable.");
  const temporary = target + ".tmp-" + process.pid + "-" + crypto.randomBytes(3).toString("hex");
  try { fs.writeFileSync(temporary, JSON.stringify(value) + "\n", { encoding: "utf8", flag: "wx" }); fs.renameSync(temporary, target); } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function readJournal(context) { try { return JSON.parse(fs.readFileSync(journalPath(context), "utf8")); } catch (_) { throw fail("property_area_range_restore_journal_missing", "Restore verification evidence is unavailable."); } }

function postApplyFromSummary(summary) {
  if (!exactKeys(summary, ["activation_option", "mutation_performed", "option_name", "plan_id", "property_areas_sha256", "property_count", "snapshot_id", "status"])
    || summary.status !== "applied" || summary.mutation_performed !== true || summary.activation_option !== OPTION_NAME || summary.option_name !== OPTION_NAME
    || typeof summary.plan_id !== "string" || !/^property-area-range-plan-[0-9a-f-]{36}$/.test(summary.plan_id)
    || typeof summary.snapshot_id !== "string" || !/^snapshot-[a-z0-9-]+$/.test(summary.snapshot_id)
    || typeof summary.property_areas_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(summary.property_areas_sha256)
    || !Number.isInteger(summary.property_count) || summary.property_count < 0) return null;
  return { option_name: summary.option_name, property_areas_sha256: summary.property_areas_sha256, property_count: summary.property_count };
}

function isAcceptedApply(entry, projectState) {
  const raw = entry && entry.raw; const metadata = raw && raw.metadata; const summary = raw && raw.result_summary; const project = projectState && projectState.project;
  const postApply = postApplyFromSummary(summary);
  return Boolean(entry && entry.operation_type === "property_area_range_apply" && entry.status === "succeeded" && raw && metadata && summary
    && raw.project_slug === project.slug && metadata.project_id === project.project_id && metadata.project_binding_fingerprint === deriveProjectBinding(project).fingerprint
    && typeof metadata.plan_id === "string" && /^property-area-range-plan-[0-9a-f-]{36}$/.test(metadata.plan_id)
    && typeof metadata.recovery_snapshot_id === "string" && /^snapshot-[a-z0-9-]+$/.test(metadata.recovery_snapshot_id)
    && postApply && summary.plan_id === metadata.plan_id && summary.snapshot_id === metadata.recovery_snapshot_id);
}

function assertConfirmation(prepared, confirmation) {
  if (confirmation === undefined) return;
  const expected = {
    plan_id: prepared.authority.plan.plan_id,
    snapshot_id: prepared.authority.recovery.snapshot_id,
    apply_operation_id: prepared.apply.operation_id
  };
  if (!confirmation || typeof confirmation !== "object" || Array.isArray(confirmation)
    || Object.keys(confirmation).sort().join(",") !== Object.keys(expected).sort().join(",")
    || confirmation.plan_id !== expected.plan_id || confirmation.snapshot_id !== expected.snapshot_id
    || confirmation.apply_operation_id !== expected.apply_operation_id) {
    throw fail("property_area_range_restore_confirmation_invalid", "Property Area Range Restore requires the exact accepted lineage.", 400);
  }
}

async function prepareAuthority(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot); const slug = validateExplicitSlug(options && options.slug); const projectState = readProjectBySlug(slug, projectsRoot);
  const candidates = listOperations({ projectsRoot, slug, includeRaw: true }).filter((entry) => isAcceptedApply(entry, projectState));
  if (candidates.length !== 1) throw fail("property_area_range_restore_apply_missing", "Property Area Range Restore requires one accepted Apply operation.");
  const apply = candidates[0]; const authority = await readApplyAuthority({ projectsRoot, slug, planId: apply.raw.metadata.plan_id, verifyPrepared: options && options.verifyPrepared }, projectState);
  const postApply = postApplyFromSummary(apply.raw.result_summary);
  if (authority.recovery.snapshot_id !== apply.raw.metadata.recovery_snapshot_id || !postApply
    || postApply.property_areas_sha256 !== authority.plan.baseline.property_areas_sha256 || postApply.property_count !== authority.plan.baseline.property_count) {
    throw fail("property_area_range_restore_apply_missing", "Property Area Range Restore requires one accepted Apply operation.");
  }
  return { projectsRoot, projectState, authority, apply };
}

function restoreIdentity(prepared, evidence) {
  const project = prepared.projectState.project; const plan = prepared.authority.plan; const recovery = prepared.authority.recovery;
  const postApply = postApplyFromSummary(prepared.apply.raw.result_summary);
  if (!postApply) throw fail("property_area_range_restore_apply_missing", "Property Area Range Restore requires one accepted Apply operation.");
  return { schema: "csf_property_area_range_restore_identity", version: 2, project_slug: project.slug, project_id: project.project_id, project_binding_fingerprint: plan.baseline.project_binding.fingerprint, plan_id: plan.plan_id, profile_id: "property_area_range", profile_version: 1, apply_operation_id: prepared.apply.operation_id, recovery_result_schema: "csf_property_area_range_recovery_result", recovery_result_version: 3, recovery_status: "prepared", snapshot_id: recovery.snapshot_id, post_apply: postApply, restored_baseline: { option_absent: true, plugin_identity_sha256: plan.baseline.plugin_identity_sha256, property_areas_sha256: plan.baseline.property_areas_sha256, property_count: plan.baseline.property_count, business_evidence_sha256: evidence.sha256, unfiltered_archive_sha256: digest(evidence.evidence.unfiltered) }, preservation_mode: "same_project_structural_restore", preservation_version: 1, runtime_authority_mode: "same_project_runtime_authority_v1", correlated_replay_guard: true, correlated_rate_guard: true, mutation_performed: true, post_verification_completed: true, status: "restored" };
}

async function assertPostApply(prepared, options) {
  const observation = await (options && options.readNative ? options.readNative(prepared.projectState) : observeAreaRuntime(prepared.projectState, options));
  const observed = afterState(observation, prepared.projectState, prepared.authority, prepared.apply.operation_id);
  const persisted = postApplyFromSummary(prepared.apply.raw.result_summary);
  if (!persisted || persisted.option_name !== observed.option_name || persisted.property_areas_sha256 !== observed.property_areas_sha256 || persisted.property_count !== observed.property_count) {
    throw fail("property_area_range_restore_apply_missing", "Property Area Range Restore requires one accepted Apply operation.");
  }
  return assertObservation(observation, prepared.projectState, prepared.authority.plan.baseline.plugin_identity_sha256);
}

async function assertBaseline(prepared, options) {
  const observation = await (options && options.readNative ? options.readNative(prepared.projectState) : observeAreaRuntime(prepared.projectState, options));
  const { assertObservation } = require("./property-area-range-preview");
  const current = assertObservation(observation, prepared.projectState, prepared.authority.plan.baseline.plugin_identity_sha256);
  if (current.option_present || digest(current.property_areas) !== prepared.authority.plan.baseline.property_areas_sha256 || current.property_areas.length !== prepared.authority.plan.baseline.property_count) throw fail("property_area_range_restore_baseline_drift", "The restored Property archive does not match the accepted baseline.");
  return current;
}

async function resolveRestoreTerminal(options, prepared) {
  const entries = listOperations({ projectsRoot: prepared.projectsRoot, slug: prepared.projectState.project.slug, includeRaw: true })
    .filter((entry) => entry.operation_type === OPERATION_TYPE);
  if (entries.length === 0) return { status: "continue" };
  if (entries.length !== 1 || entries[0].status !== "succeeded") {
    throw fail("property_area_range_restore_prior_attempt_terminal", "A prior Property Area Range Restore is terminal and cannot be resumed.");
  }
  const summary = entries[0].raw && entries[0].raw.result_summary;
  if (!summary || summary.status !== "restored" || summary.plan_id !== prepared.authority.plan.plan_id
    || summary.snapshot_id !== prepared.authority.recovery.snapshot_id || summary.apply_operation_id !== prepared.apply.operation_id) {
    throw fail("property_area_range_restore_prior_attempt_terminal", "A prior Property Area Range Restore is terminal and cannot be resumed.");
  }
  await assertBaseline(prepared, options);
  return { status: "already_restored", mutation_performed: false };
}

async function restorePropertyAreaRange(options) {
  for (const key of ["planId", "projectId", "snapshotId", "applyOperationId", "journalSchema", "profile", "profileId"]) if (options && Object.hasOwn(options, key)) throw fail("property_area_range_restore_authority_injected", "Property Area Range Restore derives authority from server-owned records only.", 400);
  const prepared = await prepareAuthority(options || {});
  assertConfirmation(prepared, options && options.confirmation);
  const postApply = await assertPostApply(prepared, options);
  const evidence = await captureBusinessEvidence(prepared, Object.assign({}, options, { propertyAreas: postApply.property_areas }));
  const planner = options && options.createRestorePlan || createRestorePlan;
  const planned = await planner({ projectsRoot: prepared.projectsRoot, slug: prepared.projectState.project.slug, snapshotId: prepared.authority.recovery.snapshot_id, idempotencyKey: options && options.idempotencyKey });
  if (!planned || !planned.plan || planned.plan.snapshot_id !== prepared.authority.recovery.snapshot_id || planned.plan.project_slug !== prepared.projectState.project.slug || planned.plan.project_identity_fingerprint !== prepared.authority.plan.baseline.project_binding.fingerprint) throw fail("property_area_range_restore_snapshot_mismatch", "Property Area Range Restore requires the verified Recovery Point.");
  const nonce = crypto.randomBytes(32); const expectedSecret = options && options.expectedAgentSecret || requireAgentSigningCredential(prepared.projectState).signing_secret; const envBefore = fileIdentity(prepared.projectState.envPath);
  const wpConfigPath = path.join(prepared.projectState.runtimePath, "wordpress", "wp-config.php");
  const wpConfigBefore = digestFile(wpConfigPath);
  const executor = options && options.executeRestore || executeManagedWebsiteRestore;
  const execution = await executor({ projectsRoot: prepared.projectsRoot, projectSlug: prepared.projectState.project.slug, planId: planned.plan.plan_id, exactConfirmation: planned.plan.confirmation && planned.plan.confirmation.phrase, idempotencyKey: options && options.idempotencyKey, operationType: OPERATION_TYPE, agentAuthorityMode: "verify_existing", operationMetadata: { property_area_range_plan_id: prepared.authority.plan.plan_id, property_area_range_snapshot_id: prepared.authority.recovery.snapshot_id, property_area_range_apply_operation_id: prepared.apply.operation_id, property_area_range_project_id: prepared.projectState.project.project_id, property_area_range_project_binding_fingerprint: prepared.authority.plan.baseline.project_binding.fingerprint },
    deferIdempotencyUntilPostLock: true,
    postLockTerminalResolver: async () => resolveRestoreTerminal(options || {}, prepared),
    preRestoreVerifier: async () => { const current = await prepareAuthority(options || {}); assertConfirmation(current, options && options.confirmation); await assertPostApply(prepared, options); readBusinessEvidence(prepared); },
    beforeSignedHealthObserver: async (input) => { const context = journalContext(input, prepared); await assertBaseline(prepared, options); assertStableEnv(envBefore, fileIdentity(prepared.projectState.envPath)); if (digestFile(wpConfigPath) !== wpConfigBefore) throw fail("property_area_range_restore_wp_config_changed", "Current wp-config.php was not preserved."); const checkpoint = await readVerifyExistingSurface(prepared.projectState, options, nonce); assertAgentRepairSurface(checkpoint.surface, context.projectSlug); assertApplicationPasswordIdentity(checkpoint.application_passwords); if (!Array.isArray(checkpoint.credential_hmac) || checkpoint.credential_hmac.length !== 1) throw fail("property_area_range_restore_agent_secret_mismatch", "Factory Agent credential could not be verified safely."); verifyCredentialChallenge(expectedSecret, nonce, checkpoint.credential_hmac[0]); const journal = makePropertyAreaRangeVerifyExistingJournal(context, checkpoint, nonce, { envIdentity: envBefore, wpConfigSha256: wpConfigBefore }, input); try { (options && options.writeVerifyExistingJournal || writeNew)(context, journal); } catch (_) { const error = fail("property_area_range_restore_journal_write_failed", "Restore verification evidence could not be stored safely."); error.manualRecoveryRequired = true; throw error; } },
    signedHealthObserver: async (input) => { const context = journalContext(input, prepared); const journal = assertPropertyAreaRangeVerifyExistingJournal((options && options.readVerifyExistingJournal || readJournal)(context), context, "health_reserved"); journal.phase = "health_recorded"; journal.health = { method: input.method, route: input.route, project_slug: input.project_slug, key_id: input.key_id, request_id: input.request_id, expires_at: input.expires_at }; journal.health_attempt = Object.assign({}, journal.health_attempt, { state: "response_recorded", response: { signed_agent: "ok" } }); assertPropertyAreaRangeVerifyExistingJournal(journal, context, "health_recorded"); try { (options && options.replaceVerifyExistingJournal || replace)(context, journal); } catch (_) { const error = fail("property_area_range_restore_journal_write_failed", "Restore verification evidence could not be stored safely."); error.manualRecoveryRequired = true; throw error; } },
    postRestoreVerifier: async (context) => { await assertBaseline(prepared, options); const storedEvidence = readBusinessEvidence(prepared); const restoredQuery = await (options && options.observeQueryResults ? options.observeQueryResults(prepared.projectState, storedEvidence.bounds) : observeQueryResults(prepared.projectState, storedEvidence.bounds, options)); if (JSON.stringify(restoredQuery.unfiltered_result_ids.slice().sort((a, b) => a - b)) !== JSON.stringify(storedEvidence.unfiltered.result_ids)) throw fail("property_area_range_restore_archive_drift", "The restored Property archive does not match the accepted baseline."); const journalContextValue = journalContext({ operation_id: context.operationId, work_root: context.workRoot }, prepared); const journal = assertPropertyAreaRangeVerifyExistingJournal((options && options.readVerifyExistingJournal || readJournal)(journalContextValue), journalContextValue, "health_recorded"); assertStableEnv(journal.b.env_identity, fileIdentity(context.projectState.envPath)); const wpConfigAfter = digestFile(path.join(context.liveWordPressRoot, "wp-config.php")); if (context.wpConfigSha256 !== journal.b.wp_config_sha256 || wpConfigAfter !== journal.b.wp_config_sha256) throw fail("property_area_range_restore_wp_config_changed", "Current wp-config.php was not preserved."); if (!context.source || !context.source.manifest || context.source.manifest.snapshot_id !== prepared.authority.recovery.snapshot_id || context.source.manifest.project_slug !== prepared.projectState.project.slug || context.source.manifest.project_identity_fingerprint !== prepared.authority.plan.baseline.project_binding.fingerprint) throw fail("property_area_range_restore_snapshot_mismatch", "Property Area Range Restore requires the verified Recovery Point."); if (!context.agent || context.agent.successful !== true || !context.health || context.health.signed_agent !== "ok") throw fail("property_area_range_restore_agent_binding_invalid", "Factory Agent binding could not be verified."); const checkpoint = await readVerifyExistingSurface(context.projectState, options, Buffer.from(journal.observation_nonce, "hex")); if (digest(checkpoint.application_passwords) !== journal.b.application_password_identity_sha256 || digest(checkpoint.surface.credential) !== journal.b.credential_metadata_sha256 || !Array.isArray(checkpoint.credential_hmac) || checkpoint.credential_hmac.length !== 1 || digest(checkpoint.credential_hmac[0]) !== journal.b.credential_hmac_sha256) throw fail("property_area_range_restore_agent_secret_mismatch", "Factory Agent state changed during verification."); verifyCredentialChallenge(expectedSecret, Buffer.from(journal.observation_nonce, "hex"), checkpoint.credential_hmac[0]); const preservation = assertAgentRepairDelta(Object.assign({ credential: checkpoint.surface.credential }, journal.b.surface), checkpoint.surface, journal.health, context.projectState.project.slug); return { property_area_range_restore: Object.assign(restoreIdentity(prepared, evidence), preservation) }; },
    verifyIdempotentReplay: async () => { await assertBaseline(prepared, options); return { status: "already_restored", mutation_performed: false }; }
  });
  if (execution && (execution.idempotentReplay || execution.terminalHandled)) return { status: "already_restored", mutation_performed: false };
  if (!execution || !execution.operation || execution.operation.status !== "succeeded") throw fail("property_area_range_restore_execution_failed", "Property Area Range Restore did not complete safely.");
  return { status: "restored", mutation_performed: true };
}

module.exports = { OPERATION_TYPE, JOURNAL_SCHEMA, JOURNAL_FILENAME, RESTORE_HANDLE, prepareAuthority, restoreIdentity, isAcceptedApply, postApplyFromSummary, assertConfirmation, resolveRestoreTerminal, restorePropertyAreaRange };
