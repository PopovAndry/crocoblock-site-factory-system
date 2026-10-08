"use strict";

const crypto = require("crypto");
const fs = require("fs");
const { runProjectOperation } = require("./project-operation-coordinator");
const { listOperations } = require("./project-operation-store");
const { readProjectBySlug, resolveProjectsRoot, validateExplicitSlug } = require("./project-store");
const { deriveProjectBinding } = require("./structural-snapshot-store");
const { OPTION_NAME, assertObservation, assertPlan, assertCurrentContract, exactActivation, matchingPreparedRecovery, readPlan, recoveryPath, observeAreaRuntime, writeAreaActivation } = require("./property-area-range-preview");

function fail(code, message, statusCode) {
  const error = new Error(message || "Property Area Range Apply cannot proceed safely.");
  error.code = code;
  error.statusCode = statusCode || 409;
  return error;
}

function hash(value) { return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }

function readRecovery(projectState, plan) {
  if (!fs.existsSync(recoveryPath(projectState, plan.plan_id))) throw fail("property_area_range_apply_recovery_missing", "Property Area Range Apply requires the verified Recovery Point.");
  try { return JSON.parse(fs.readFileSync(recoveryPath(projectState, plan.plan_id), "utf8")); } catch (_) { throw fail("property_area_range_apply_recovery_missing", "Property Area Range Apply requires the verified Recovery Point."); }
}

async function authority(options, projectState) {
  const plan = assertPlan(readPlan(projectState, options && options.planId), projectState, options && options.planId);
  assertCurrentContract(plan);
  const recovery = readRecovery(projectState, plan);
  const prepared = options && options.verifyPrepared
    ? await options.verifyPrepared({ projectState, plan, recovery })
    : await matchingPreparedRecovery(projectState, plan, options.projectsRoot);
  if (!prepared || prepared.status !== "prepared" || prepared.snapshot_id !== recovery.snapshot_id) throw fail("property_area_range_apply_recovery_stale", "Property Area Range Apply requires the verified Recovery Point.");
  return { plan, recovery, prepared };
}

function assertBaseline(observation, projectState, authorityValue) {
  const current = assertObservation(observation, projectState, authorityValue.plan.baseline.plugin_identity_sha256);
  if (current.option_present || hash(current.property_areas) !== authorityValue.plan.baseline.property_areas_sha256 || current.property_areas.length !== authorityValue.plan.baseline.property_count) {
    throw fail("property_area_range_apply_baseline_drift", "Property Area Range changed after the prepared Preview.");
  }
  return current;
}

function afterState(observation, projectState, authorityValue, operationId) {
  const current = assertObservation(observation, projectState, authorityValue.plan.baseline.plugin_identity_sha256);
  if (!current.option_present || !exactActivation(current.option_value, projectState.project, authorityValue.plan.plan_id, authorityValue.recovery.snapshot_id, operationId)
    || hash(current.property_areas) !== authorityValue.plan.baseline.property_areas_sha256 || current.property_areas.length !== authorityValue.plan.baseline.property_count) {
    throw fail("property_area_range_apply_after_state_drift", "Property Area Range did not reach the approved state.");
  }
  return { option_name: OPTION_NAME, property_areas_sha256: hash(current.property_areas), property_count: current.property_areas.length };
}

async function applyPropertyAreaRange(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const slug = validateExplicitSlug(options && options.slug);
  const projectState = readProjectBySlug(slug, projectsRoot);
  const preparedAuthority = await authority(Object.assign({}, options, { projectsRoot }), projectState);
  const plan = preparedAuthority.plan;
  const prior = listOperations({ projectsRoot, slug, includeRaw: true }).filter((entry) => entry.operation_type === "property_area_range_apply" && entry.raw && entry.raw.metadata && entry.raw.metadata.plan_id === plan.plan_id);
  if (prior.some((entry) => entry.status === "failed" || entry.status === "interrupted")) throw fail("property_area_range_apply_prior_attempt_terminal", "Property Area Range Apply requires a new reviewed Preview after an earlier attempt.");
  const idempotencyHash = options && options.idempotencyKey ? hash(String(options.idempotencyKey).trim()) : null;
  if (prior.some((entry) => entry.status === "succeeded" && entry.raw.idempotency_key_hash !== idempotencyHash)) throw fail("property_area_range_apply_plan_consumed", "Property Area Range Apply was already completed for this Preview.");
  const outcome = await runProjectOperation({
    projectsRoot, slug, operationType: "property_area_range_apply", idempotencyKey: options && options.idempotencyKey,
    fingerprintInput: { plan_id: plan.plan_id, snapshot_id: preparedAuthority.recovery.snapshot_id, baseline_sha256: plan.baseline.property_areas_sha256 },
    metadata: { plan_id: plan.plan_id, project_id: projectState.project.project_id, project_binding_fingerprint: deriveProjectBinding(projectState.project).fingerprint, recovery_snapshot_id: preparedAuthority.recovery.snapshot_id },
    safety: { apply_used: true },
    verifyIdempotentReplay: async ({ operation }) => {
      const current = await (options && options.readNative ? options.readNative(projectState) : observeAreaRuntime(projectState, options));
      afterState(current, projectState, preparedAuthority, operation.operation_id);
      return { status: "already_applied", mutation_performed: false };
    },
    execute: async ({ operationId, setStage }) => {
      await setStage("validating");
      const fresh = await authority(Object.assign({}, options, { projectsRoot }), projectState);
      const before = await (options && options.readNative ? options.readNative(projectState) : observeAreaRuntime(projectState, options));
      assertBaseline(before, projectState, fresh);
      await setStage("applying");
      const activation = { schema_version: 1, state: "enabled", project_id: projectState.project.project_id, plan_id: fresh.plan.plan_id, snapshot_id: fresh.recovery.snapshot_id, operation_id: operationId };
      const after = await (options && options.writeNative ? options.writeNative(projectState, activation) : writeAreaActivation(projectState, activation, options));
      await setStage("verifying");
      const result = afterState(after, projectState, fresh, operationId);
      return { result: { status: "applied", mutation_performed: true, after_state: result }, resultSummary: Object.assign({ status: "applied", mutation_performed: true, plan_id: fresh.plan.plan_id, snapshot_id: fresh.recovery.snapshot_id, activation_option: OPTION_NAME }, result) };
    }
  });
  const result = Object.assign({}, outcome.result || {}, {
    plan_id: plan.plan_id,
    snapshot_id: preparedAuthority.recovery.snapshot_id,
    operation_id: outcome.operation && outcome.operation.operation_id || null
  });
  if (typeof result.operation_id !== "string" || !/^op-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{6}$/.test(result.operation_id)) {
    throw fail("property_area_range_apply_operation_missing", "Property Area Range Apply did not produce authoritative operation evidence.");
  }
  return result;
}

module.exports = { applyPropertyAreaRange, assertBaseline, afterState, authority };
