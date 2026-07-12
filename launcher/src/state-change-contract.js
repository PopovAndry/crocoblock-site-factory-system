"use strict";

const FORBIDDEN_BROWSER_FIELDS = [
  "apply_path",
  "current_fields",
  "desired_fields",
  "field_map",
  "fields",
  "operation_path",
  "plan_path",
  "project_root",
  "proof_path",
  "rollback_fields",
  "shell",
  "state_path"
];

function createContractError(message, code, statusCode, extras) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode || 400;
  if (extras && typeof extras === "object") {
    Object.assign(error, extras);
  }
  return error;
}

function validateChangeRequestPrompt(promptInput) {
  if (typeof promptInput !== "string") {
    throw createContractError(
      "State change planning requires a string prompt.",
      "state_change_prompt_invalid_type",
      400
    );
  }

  const prompt = promptInput.trim();
  if (!prompt) {
    throw createContractError(
      "State change planning requires a non-empty prompt.",
      "state_change_prompt_required",
      400
    );
  }

  if (prompt.length < 10) {
    throw createContractError(
      "State change prompt must be at least 10 characters.",
      "state_change_prompt_too_short",
      400
    );
  }

  if (prompt.length > 2000) {
    throw createContractError(
      "State change prompt must be 2000 characters or fewer.",
      "state_change_prompt_too_long",
      400
    );
  }

  return prompt;
}

function normalizeStatePlanId(planId) {
  const value = String(planId || "").trim();
  if (!value || !/^state-plan-[A-Za-z0-9._:-]+$/.test(value)) {
    throw createContractError(
      "A valid state plan_id is required.",
      "state_plan_id_invalid",
      400
    );
  }
  return value;
}

function normalizeOperationId(operationId, code) {
  const value = String(operationId || "").trim();
  if (!value || !/^op-[A-Za-z0-9._:-]+$/.test(value)) {
    throw createContractError(
      "A valid operation id is required.",
      code || "operation_id_invalid",
      400
    );
  }
  return value;
}

function rejectBrowserSuppliedStatePaths(payload) {
  const safePayload = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {};
  const rejected = FORBIDDEN_BROWSER_FIELDS.filter((key) => Object.prototype.hasOwnProperty.call(safePayload, key));
  if (rejected.length) {
    throw createContractError(
      "State change requests may not submit paths, field maps, or executable payloads.",
      "state_change_browser_payload_rejected",
      400,
      { rejected_fields: rejected }
    );
  }
}

function assertPlanBelongsToProject(plan, slug) {
  const planSlug = String(plan && plan.current && plan.current.slug || plan && plan.project_slug || "");
  if (planSlug && planSlug !== String(slug || "")) {
    throw createContractError(
      "State plan does not belong to the selected project.",
      "state_plan_project_mismatch",
      409
    );
  }
}

function assertOperationBelongsToProject(operation, slug, code) {
  if (!operation || String(operation.project_slug || "") !== String(slug || "")) {
    throw createContractError(
      "Operation does not belong to the selected project.",
      code || "operation_project_mismatch",
      409
    );
  }
}

function buildWritableDesiredState(plan) {
  const safePlan = plan && typeof plan === "object" ? plan : {};
  const proposed = safePlan.proposed && typeof safePlan.proposed === "object"
    ? safePlan.proposed
    : {};
  const personalization = proposed.personalization && typeof proposed.personalization === "object"
    ? proposed.personalization
    : {};
  const fieldScope = safePlan.field_scope && typeof safePlan.field_scope === "object"
    ? safePlan.field_scope
    : {};
  const includedFields = Array.isArray(fieldScope.included_fields)
    ? fieldScope.included_fields
    : [];
  const writable = {};

  for (const fieldKey of includedFields) {
    if (typeof fieldKey !== "string") {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(personalization, fieldKey)) {
      writable[fieldKey] = personalization[fieldKey];
    }
  }

  return writable;
}

function collectUnsupportedFields(plan) {
  const safePlan = plan && typeof plan === "object" ? plan : {};
  const diff = safePlan.diff && typeof safePlan.diff === "object"
    ? safePlan.diff
    : {};
  const fieldChanges = Array.isArray(diff.field_changes)
    ? diff.field_changes
    : [];

  return fieldChanges
    .filter((entry) => entry && typeof entry === "object")
    .filter((entry) => {
      const reason = String(entry.excluded_reason || "").trim();
      return reason === "unsupported_field" || reason === "empty_or_unsupported_value";
    })
    .map((entry) => String(entry.field_key || "").trim())
    .filter(Boolean);
}

function summarizeStatePlanForClient(result) {
  const plan = result && result.plan ? result.plan : {};
  const fieldScope = plan.field_scope && typeof plan.field_scope === "object" ? plan.field_scope : {};
  const diff = plan.diff && typeof plan.diff === "object" ? plan.diff : {};
  const planId = String(plan.plan_id || "");

  return {
    ok: true,
    plan_id: planId,
    schema: plan.schema || null,
    version: plan.version || null,
    provider_called: plan.provider_called === true,
    ai_source: plan.source && (plan.source.ai_source || plan.source.prompt_personalization_source) || "local_interpreter",
    prompt_fingerprint: plan.source && plan.source.prompt_hash || null,
    interpretation: plan.proposed ? {
      personalization: plan.proposed.personalization || {},
      design_profile: plan.proposed.design_profile || {}
    } : null,
    current_effective_state: plan.current ? plan.current.effective_values || null : null,
    desired_state: plan.proposed ? plan.proposed.personalization || {} : {},
    writable_desired_state: buildWritableDesiredState(plan),
    diff,
    field_scope: fieldScope,
    protected_fields: plan.current && Array.isArray(plan.current.protected_fields) ? plan.current.protected_fields : [],
    preserved_protected_fields: Array.isArray(fieldScope.preserved_protected_fields) ? fieldScope.preserved_protected_fields : [],
    excluded_fields: Array.isArray(fieldScope.excluded_fields) ? fieldScope.excluded_fields : [],
    included_fields: Array.isArray(fieldScope.included_fields) ? fieldScope.included_fields : [],
    requires_confirmation_fields: Array.isArray(fieldScope.requires_confirmation_fields) ? fieldScope.requires_confirmation_fields : [],
    unsupported_fields: collectUnsupportedFields(plan),
    confirmation_required: plan.confirmation_required || null,
    conflicts: Array.isArray(plan.conflicts) ? plan.conflicts : [],
    can_apply: plan.can_apply_without_confirmation === true && Array.isArray(fieldScope.included_fields) && fieldScope.included_fields.length > 0,
    can_apply_without_confirmation: plan.can_apply_without_confirmation === true,
    applies_changes: false,
    proof_ref: result.proofPath || null,
    warnings: Array.isArray(plan.warnings) ? plan.warnings : []
  };
}

module.exports = {
  FORBIDDEN_BROWSER_FIELDS,
  assertOperationBelongsToProject,
  assertPlanBelongsToProject,
  buildWritableDesiredState,
  collectUnsupportedFields,
  createContractError,
  normalizeOperationId,
  normalizeStatePlanId,
  rejectBrowserSuppliedStatePaths,
  summarizeStatePlanForClient,
  validateChangeRequestPrompt
};
