"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CONTRACT_PATH,
  buildRealEstateBusinessSummary,
  classifyAddOptionalViewingDateChange,
  evaluateRealEstateContract,
  loadRealEstateContract,
  validateRealEstateContract
} = require("../src/real-estate-contract");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const DISCOVERY_RULES_DESCRIPTION = "Property Discovery specification only: each of Purpose, Property Type and District accepts one taxonomy term. Active selections use AND, so a property must match every selected condition. An unselected filter adds no restriction; all other active conditions still apply. When no filters are selected, or after Clear filters, the base properties catalog is used. A valid search with no matches while filters are active shows an explicit empty state and offers Clear filters; conditions are not relaxed automatically. An empty base catalog remains empty, and an execution error is shown as an error, not as no matches. Runtime filtering behavior is not verified in this slice.";

function beforeViewingDateFacts() {
  const contract = loadRealEstateContract();
  const form = contract.forms.find((entry) => entry.id === "request_viewing_form");
  const context = contract.property_contexts.find((entry) => entry.id === "selected_property_context");
  const journey = contract.user_journeys.find((entry) => entry.id === "request_viewing");
  const fields = contract.form_fields
    .filter((field) => field.id !== "request_viewing_preferred_date")
    .map(({ id, form_id, type, required }) => ({ id, form_id, type, required }));
  return {
    profile_id: "add_optional_viewing_date",
    profile_version: 1,
    ownership: {
      form: "factory_managed",
      context: "factory_managed",
      existing_fields: "factory_managed",
      protected_content: "preserved",
      user_content: "preserved"
    },
    journey: { id: journey.id, form_id: journey.form_id, context_id: journey.context_id },
    form: {
      id: form.id,
      entity_id: form.entity_id,
      context_id: form.context_id,
      field_ids: fields.map((field) => field.id),
      contact_rule: clone(form.contact_rule)
    },
    context: clone(context),
    fields
  };
}

function runtimeFixture() {
  const contract = loadRealEstateContract();
  const validationMessages = contract.proof.checks
    .filter((check) => check.kind === "validation_message" && check.required !== false)
    .map((check) => ({ status: "ok", message: check.expected }));
  return {
    slug: "fixture-realty",
    project: { runtime: { status: "provisioned" } },
    generateProof: {
      generated_urls: { home: "safe", properties: "safe", single_property: "safe", contact: "safe" },
      after_counts: { properties: 1 }
    },
    manifest: { validation: { checks: validationMessages } }
  };
}

test("valid Real Estate contract loads with deterministic normalized output", () => {
  const first = loadRealEstateContract(CONTRACT_PATH);
  const second = loadRealEstateContract(CONTRACT_PATH);
  assert.equal(first.contract_id, "real-estate-contract@1");
  assert.deepEqual(first, second);
  assert.equal(new Set(first.proof.checks.map((check) => check.id)).size, first.proof.checks.length);
  assert.deepEqual(first.user_journeys.map((journey) => journey.id), ["discover_property", "request_viewing"]);
  assert.deepEqual(buildRealEstateBusinessSummary(first), {
    description: "Visitors can browse properties, filter by Purpose, Property Type and District, and open property details.",
    discovery_rules_description: DISCOVERY_RULES_DESCRIPTION,
    request_viewing_description: "Request Viewing specification only: it relates to the selected property and requires Email or Phone. Preferred date does not confirm an appointment. Opening an email client does not confirm submission or receipt. Runtime readiness and submission are not verified by this specification."
  });
});

test("malformed and unsupported contracts fail closed", () => {
  assert.throws(() => validateRealEstateContract(null));
  const unsupported = clone(loadRealEstateContract());
  unsupported.contract_version = 2;
  assert.throws(() => validateRealEstateContract(unsupported), { code: "real_estate_contract_unsupported_version" });
});

test("duplicate IDs, invalid ownership, invalid surfaces, and unsafe paths are rejected", () => {
  const duplicate = clone(loadRealEstateContract());
  duplicate.proof.checks[0].id = duplicate.dependencies[0].id;
  assert.throws(() => validateRealEstateContract(duplicate), { code: "real_estate_contract_duplicate_id" });
  const ownership = clone(loadRealEstateContract());
  ownership.ownership[0].class = "unknown";
  assert.throws(() => validateRealEstateContract(ownership), { code: "real_estate_contract_invalid_ownership" });
  const surface = clone(loadRealEstateContract());
  surface.component_slots[0].surfaces = ["missing_surface"];
  assert.throws(() => validateRealEstateContract(surface), { code: "real_estate_contract_invalid_component_surface" });
  const unsafe = clone(loadRealEstateContract());
  unsafe.compatibility.blueprint_source = "C:\\developer\\blueprint.json";
  assert.throws(() => validateRealEstateContract(unsafe), { code: "real_estate_contract_unsafe_path" });
});

test("provider-neutral discovery semantics fail closed for missing, unresolved, and provider instructions", () => {
  const missing = clone(loadRealEstateContract());
  delete missing.queries;
  assert.throws(() => validateRealEstateContract(missing));

  const unknownEntity = clone(loadRealEstateContract());
  unknownEntity.queries[0].entity_id = "unknown_entity";
  assert.throws(() => validateRealEstateContract(unknownEntity), { code: "real_estate_contract_invalid_business_reference" });

  const unknownFilterQuery = clone(loadRealEstateContract());
  unknownFilterQuery.filters[0].query_id = "unknown_query";
  assert.throws(() => validateRealEstateContract(unknownFilterQuery), { code: "real_estate_contract_invalid_business_reference" });

  const unresolvedListing = clone(loadRealEstateContract());
  unresolvedListing.listings[0].component_id = "unknown_component";
  assert.throws(() => validateRealEstateContract(unresolvedListing), { code: "real_estate_contract_invalid_business_reference" });

  const unresolvedJourney = clone(loadRealEstateContract());
  unresolvedJourney.user_journeys[0].listing_id = "unknown_listing";
  assert.throws(() => validateRealEstateContract(unresolvedJourney), { code: "real_estate_contract_invalid_business_reference" });

  for (const value of ["JetEngine listing", "<?php echo 'property';", "SELECT * FROM properties", "powershell Remove-Item C:\\site"]) {
    const unsafeBusinessSemantic = clone(loadRealEstateContract());
    unsafeBusinessSemantic.queries[0].result_label = value;
    assert.throws(() => validateRealEstateContract(unsafeBusinessSemantic), { code: "real_estate_contract_invalid_business_semantics" });
  }

  const implementationRef = clone(loadRealEstateContract());
  implementationRef.queries[0].implementation_ref = "adapter";
  assert.throws(() => validateRealEstateContract(implementationRef), { code: "real_estate_contract_invalid_business_semantics" });
});

test("Property Discovery rules are explicit, deterministic, and derive the review description from business labels", () => {
  const contract = loadRealEstateContract();
  assert.deepEqual(contract.queries[0], {
    id: "property_catalog",
    entity_id: "property",
    result_label: "properties",
    active_filter_combination: "and",
    unselected_filter_behavior: "no_restriction",
    no_selected_filters_behavior: "base_catalog",
    clear_filters_behavior: "base_catalog",
    empty_catalog_behavior: "empty_state",
    execution_failure_behavior: "error_state"
  });
  assert.equal(contract.listings[0].empty_state, "explicit");
  assert.equal(contract.listings[0].active_filter_empty_action, "clear_filters");
  assert.equal(contract.listings[0].automatic_relaxation, false);
  assert.equal(contract.user_journeys.find((journey) => journey.id === "discover_property").clear_filters_action, "reset_to_base_catalog");
  for (const filter of contract.filters) {
    assert.equal(filter.optional, true);
    assert.equal(filter.selection_mode, "single_term");
    assert.equal(filter.term_identity, "taxonomy_term");
  }

  const reordered = clone(contract);
  reordered.filters.reverse();
  reordered.user_journeys.reverse();
  assert.deepEqual(validateRealEstateContract(reordered), contract);

  const relabeled = clone(contract);
  relabeled.filters.find((filter) => filter.id === "filter_purpose").label = "Intent";
  assert.match(buildRealEstateBusinessSummary(relabeled).discovery_rules_description, /each of Intent, Property Type and District accepts one taxonomy term/);
});

test("Property Discovery rules fail closed for missing, unknown, duplicate, and conflicting behavior", () => {
  const missingRule = clone(loadRealEstateContract());
  delete missingRule.queries[0].active_filter_combination;
  assert.throws(() => validateRealEstateContract(missingRule), { code: "real_estate_contract_invalid_business_semantics" });

  for (const [field, value] of [["unselected_filter_behavior", "base_catalog"], ["no_selected_filters_behavior", "retain_selections"], ["clear_filters_behavior", "retain_selections"], ["empty_catalog_behavior", "matched_results"], ["execution_failure_behavior", "empty_state"]]) {
    const conflictingQueryRule = clone(loadRealEstateContract());
    conflictingQueryRule.queries[0][field] = value;
    assert.throws(() => validateRealEstateContract(conflictingQueryRule), { code: "real_estate_contract_invalid_business_semantics" });
  }

  const unknownTaxonomy = clone(loadRealEstateContract());
  unknownTaxonomy.filters[0].taxonomy_id = "unknown_taxonomy";
  assert.throws(() => validateRealEstateContract(unknownTaxonomy), { code: "real_estate_contract_invalid_business_reference" });

  const duplicateFilter = clone(loadRealEstateContract());
  duplicateFilter.filters[1].id = "filter_purpose";
  assert.throws(() => validateRealEstateContract(duplicateFilter), { code: "real_estate_contract_duplicate_id" });

  const conflictingTaxonomy = clone(loadRealEstateContract());
  conflictingTaxonomy.filters[0].taxonomy_id = "property_type";
  assert.throws(() => validateRealEstateContract(conflictingTaxonomy), { code: "real_estate_contract_invalid_business_semantics" });

  const multiSelection = clone(loadRealEstateContract());
  multiSelection.filters[0].selection_mode = "multiple_terms";
  assert.throws(() => validateRealEstateContract(multiSelection), { code: "real_estate_contract_invalid_business_semantics" });

  const displayLabelIdentity = clone(loadRealEstateContract());
  displayLabelIdentity.filters[0].term_identity = "display_label";
  assert.throws(() => validateRealEstateContract(displayLabelIdentity), { code: "real_estate_contract_invalid_business_semantics" });

  const orCombination = clone(loadRealEstateContract());
  orCombination.queries[0].active_filter_combination = "or";
  assert.throws(() => validateRealEstateContract(orCombination), { code: "real_estate_contract_invalid_business_semantics" });

  const expandedResults = clone(loadRealEstateContract());
  expandedResults.listings[0].automatic_relaxation = true;
  assert.throws(() => validateRealEstateContract(expandedResults), { code: "real_estate_contract_invalid_business_semantics" });

  const hiddenEmptyState = clone(loadRealEstateContract());
  hiddenEmptyState.listings[0].empty_state = "none";
  assert.throws(() => validateRealEstateContract(hiddenEmptyState), { code: "real_estate_contract_invalid_business_semantics" });

  const unresolvedClearAction = clone(loadRealEstateContract());
  unresolvedClearAction.user_journeys.find((journey) => journey.id === "discover_property").clear_filters_action = "retain_selections";
  assert.throws(() => validateRealEstateContract(unresolvedClearAction), { code: "real_estate_contract_invalid_business_reference" });

  const providerIdentity = clone(loadRealEstateContract());
  providerIdentity.filters[0].term_identity = "JetEngine";
  assert.throws(() => validateRealEstateContract(providerIdentity), { code: "real_estate_contract_invalid_business_semantics" });

  assert.throws(() => buildRealEstateBusinessSummary(orCombination), { code: "real_estate_contract_invalid_business_semantics" });
});

test("Request Viewing form, selected property context, and exact journey bindings validate deterministically", () => {
  const contract = loadRealEstateContract();
  assert.equal(contract.forms[0].id, "request_viewing_form");
  assert.equal(contract.property_contexts[0].identity_source, "selected_entity");
  assert.deepEqual(contract.forms[0].contact_rule, {
    type: "at_least_one",
    field_ids: ["request_viewing_email", "request_viewing_phone"]
  });

  const reordered = clone(contract);
  reordered.form_fields.reverse();
  reordered.user_journeys.reverse();
  assert.deepEqual(validateRealEstateContract(reordered), contract);
});

test("Request Viewing semantics fail closed for unresolved context, form, field, and outcome bindings", () => {
  const missingForm = clone(loadRealEstateContract());
  delete missingForm.forms;
  assert.throws(() => validateRealEstateContract(missingForm));

  const missingContext = clone(loadRealEstateContract());
  delete missingContext.property_contexts;
  assert.throws(() => validateRealEstateContract(missingContext));

  const unknownContextEntity = clone(loadRealEstateContract());
  unknownContextEntity.property_contexts[0].entity_id = "unknown_entity";
  assert.throws(() => validateRealEstateContract(unknownContextEntity), { code: "real_estate_contract_invalid_business_reference" });

  const unknownContextSurface = clone(loadRealEstateContract());
  unknownContextSurface.property_contexts[0].target_surface_id = "unknown_surface";
  assert.throws(() => validateRealEstateContract(unknownContextSurface), { code: "real_estate_contract_invalid_business_reference" });

  const unknownFormField = clone(loadRealEstateContract());
  unknownFormField.forms[0].field_ids[0] = "unknown_field";
  assert.throws(() => validateRealEstateContract(unknownFormField), { code: "real_estate_contract_invalid_business_reference" });

  const unknownJourneyForm = clone(loadRealEstateContract());
  unknownJourneyForm.user_journeys.find((journey) => journey.id === "request_viewing").form_id = "unknown_form";
  assert.throws(() => validateRealEstateContract(unknownJourneyForm), { code: "real_estate_contract_invalid_business_reference" });

  const unknownFieldType = clone(loadRealEstateContract());
  unknownFieldType.form_fields[0].type = "select";
  assert.throws(() => validateRealEstateContract(unknownFieldType), { code: "real_estate_contract_invalid_business_semantics" });

  const extraFieldKey = clone(loadRealEstateContract());
  extraFieldKey.form_fields[0].placeholder = "Name";
  assert.throws(() => validateRealEstateContract(extraFieldKey), { code: "real_estate_contract_invalid_business_semantics" });

  const duplicateFormField = clone(loadRealEstateContract());
  duplicateFormField.form_fields[0].id = duplicateFormField.form_fields[1].id;
  assert.throws(() => validateRealEstateContract(duplicateFormField), { code: "real_estate_contract_duplicate_id" });

  const unresolvedContactRule = clone(loadRealEstateContract());
  unresolvedContactRule.forms[0].contact_rule.field_ids[0] = "unknown_field";
  assert.throws(() => validateRealEstateContract(unresolvedContactRule), { code: "real_estate_contract_invalid_business_reference" });

  const conflictingJourney = clone(loadRealEstateContract());
  conflictingJourney.user_journeys.find((journey) => journey.id === "request_viewing").source_surface_id = "contact";
  assert.throws(() => validateRealEstateContract(conflictingJourney), { code: "real_estate_contract_invalid_business_reference" });

  const bookingOutcome = clone(loadRealEstateContract());
  bookingOutcome.user_journeys.find((journey) => journey.id === "request_viewing").outcome = "booking_confirmed";
  assert.throws(() => validateRealEstateContract(bookingOutcome), { code: "real_estate_contract_invalid_business_reference" });

  const confirmedEmailHandoff = clone(loadRealEstateContract());
  confirmedEmailHandoff.user_journeys.find((journey) => journey.id === "request_viewing").email_handoff_confirms_submission = true;
  assert.throws(() => validateRealEstateContract(confirmedEmailHandoff), { code: "real_estate_contract_invalid_business_reference" });

  const providerConfiguration = clone(loadRealEstateContract());
  providerConfiguration.forms[0].provider = "JetEngine";
  assert.throws(() => validateRealEstateContract(providerConfiguration), { code: "real_estate_contract_invalid_business_semantics" });
});

test("the sole viewing-date change profile preserves exactly the allowed structural change", () => {
  const contract = loadRealEstateContract();
  assert.deepEqual(contract.change_profiles.map((profile) => [profile.id, profile.version, profile.operation, profile.journey_id, profile.form_id, profile.context_id, profile.field_id]), [[
    "add_optional_viewing_date",
    1,
    "add_optional_form_field_and_binding",
    "request_viewing",
    "request_viewing_form",
    "selected_property_context",
    "request_viewing_preferred_date"
  ]]);
  assert.equal(contract.change_profiles[0].preservation.form_replacement, "forbidden");
  assert.equal(contract.change_profiles[0].preservation.field_removal, "forbidden");
  assert.equal(contract.change_profiles[0].recovery_policy.before_mutation, "verified_recovery_point_required");
  assert.equal(contract.change_profiles[0].verification.email_client_is_submission_proof, false);
  assert.equal(contract.change_profiles[0].verification.receiver_receipt_confirms_appointment, false);

  const reordered = clone(contract);
  reordered.change_profiles.reverse();
  reordered.form_fields.reverse();
  reordered.user_journeys.reverse();
  assert.deepEqual(validateRealEstateContract(reordered), contract);
});

test("viewing-date change profile validation fails closed for invalid references and weakened requirements", () => {
  const missingProfile = clone(loadRealEstateContract());
  delete missingProfile.change_profiles;
  assert.throws(() => validateRealEstateContract(missingProfile));

  const unsupportedVersion = clone(loadRealEstateContract());
  unsupportedVersion.change_profiles[0].version = 2;
  assert.throws(() => validateRealEstateContract(unsupportedVersion), { code: "real_estate_contract_invalid_business_reference" });

  const unsupportedOperation = clone(loadRealEstateContract());
  unsupportedOperation.change_profiles[0].operation = "replace_form";
  assert.throws(() => validateRealEstateContract(unsupportedOperation), { code: "real_estate_contract_invalid_business_reference" });

  const unknownReference = clone(loadRealEstateContract());
  unknownReference.change_profiles[0].field_id = "unknown_field";
  assert.throws(() => validateRealEstateContract(unknownReference), { code: "real_estate_contract_invalid_business_reference" });

  const unknownJourneyReference = clone(loadRealEstateContract());
  unknownJourneyReference.change_profiles[0].journey_id = "unknown_journey";
  assert.throws(() => validateRealEstateContract(unknownJourneyReference), { code: "real_estate_contract_invalid_business_reference" });

  const duplicateProfile = clone(loadRealEstateContract());
  duplicateProfile.change_profiles.push(clone(duplicateProfile.change_profiles[0]));
  assert.throws(() => validateRealEstateContract(duplicateProfile), { code: "real_estate_contract_duplicate_id" });

  const weakenedPreservation = clone(loadRealEstateContract());
  weakenedPreservation.change_profiles[0].preservation.form_replacement = "allowed";
  assert.throws(() => validateRealEstateContract(weakenedPreservation), { code: "real_estate_contract_invalid_business_semantics" });

  const missingRecoveryRule = clone(loadRealEstateContract());
  delete missingRecoveryRule.change_profiles[0].recovery_policy.before_mutation;
  assert.throws(() => validateRealEstateContract(missingRecoveryRule), { code: "real_estate_contract_invalid_business_semantics" });

  const weakenedVerification = clone(loadRealEstateContract());
  weakenedVerification.change_profiles[0].verification.visual.mobile = "optional";
  assert.throws(() => validateRealEstateContract(weakenedVerification), { code: "real_estate_contract_invalid_business_semantics" });

  const providerInstruction = clone(loadRealEstateContract());
  providerInstruction.change_profiles[0].provider = "JetEngine";
  assert.throws(() => validateRealEstateContract(providerInstruction), { code: "real_estate_contract_invalid_business_semantics" });

  const executableInstruction = clone(loadRealEstateContract());
  executableInstruction.change_profiles[0].recovery_policy.command = "powershell";
  assert.throws(() => validateRealEstateContract(executableInstruction), { code: "real_estate_contract_invalid_business_semantics" });
});

test("preferred viewing date classifier is pure, deterministic, and never execution authority", () => {
  const before = beforeViewingDateFacts();
  const beforeSnapshot = clone(before);
  const applicable = classifyAddOptionalViewingDateChange(before);
  assert.deepEqual(applicable, { classification: "applicable" });
  assert.deepEqual(before, beforeSnapshot);
  assert.equal(Object.hasOwn(applicable, "can_apply"), false);
  assert.equal(Object.hasOwn(applicable, "runtime_ready"), false);
  assert.equal(Object.hasOwn(applicable, "execution_payload"), false);

  const noOp = clone(before);
  noOp.fields.push({ id: "request_viewing_preferred_date", form_id: "request_viewing_form", type: "date", required: false });
  noOp.form.field_ids.push("request_viewing_preferred_date");
  assert.deepEqual(classifyAddOptionalViewingDateChange(noOp), { classification: "no_op" });

  const reorderedNoOp = clone(noOp);
  reorderedNoOp.fields.reverse();
  reorderedNoOp.form.field_ids.reverse();
  assert.deepEqual(classifyAddOptionalViewingDateChange(reorderedNoOp), { classification: "no_op" });
});

test("preferred viewing date classifier blocks conflicts and never lets no-op mask base violations", () => {
  for (const conflictingDate of [
    { id: "request_viewing_preferred_date", form_id: "request_viewing_form", type: "text", required: false },
    { id: "request_viewing_preferred_date", form_id: "request_viewing_form", type: "date", required: true },
    { id: "request_viewing_preferred_date", form_id: "other_form", type: "date", required: false }
  ]) {
    const conflictingField = beforeViewingDateFacts();
    conflictingField.fields.push(conflictingDate);
    conflictingField.form.field_ids.push("request_viewing_preferred_date");
    assert.deepEqual(classifyAddOptionalViewingDateChange(conflictingField), { classification: "blocked" });
  }

  const missingContext = beforeViewingDateFacts();
  delete missingContext.context;
  assert.deepEqual(classifyAddOptionalViewingDateChange(missingContext), { classification: "blocked" });

  const unknownOwnership = beforeViewingDateFacts();
  unknownOwnership.ownership.form = "unknown";
  assert.deepEqual(classifyAddOptionalViewingDateChange(unknownOwnership), { classification: "blocked" });

  const ambiguousIdentity = beforeViewingDateFacts();
  ambiguousIdentity.context.identity_source = "ambiguous";
  assert.deepEqual(classifyAddOptionalViewingDateChange(ambiguousIdentity), { classification: "blocked" });

  const duplicateField = beforeViewingDateFacts();
  duplicateField.fields.push(clone(duplicateField.fields[0]));
  duplicateField.form.field_ids.push(duplicateField.fields[0].id);
  assert.deepEqual(classifyAddOptionalViewingDateChange(duplicateField), { classification: "blocked" });

  const unknownField = beforeViewingDateFacts();
  unknownField.fields.push({ id: "unknown_field", form_id: "request_viewing_form", type: "text", required: false });
  unknownField.form.field_ids.push("unknown_field");
  assert.deepEqual(classifyAddOptionalViewingDateChange(unknownField), { classification: "blocked" });

  const invalidBaseWithDate = beforeViewingDateFacts();
  invalidBaseWithDate.fields.find((field) => field.id === "request_viewing_name").required = false;
  invalidBaseWithDate.fields.push({ id: "request_viewing_preferred_date", form_id: "request_viewing_form", type: "date", required: false });
  invalidBaseWithDate.form.field_ids.push("request_viewing_preferred_date");
  assert.deepEqual(classifyAddOptionalViewingDateChange(invalidBaseWithDate), { classification: "blocked" });

  const v1WithoutDate = clone(loadRealEstateContract());
  v1WithoutDate.form_fields = v1WithoutDate.form_fields.filter((field) => field.id !== "request_viewing_preferred_date");
  v1WithoutDate.forms[0].field_ids = v1WithoutDate.forms[0].field_ids.filter((id) => id !== "request_viewing_preferred_date");
  assert.throws(() => validateRealEstateContract(v1WithoutDate), { code: "real_estate_contract_invalid_business_semantics" });
});

test("valid runtime fixture produces a sanitized compliant report", () => {
  const report = evaluateRealEstateContract({ runtime: runtimeFixture() });
  assert.equal(report.status, "compliant");
  assert.equal(report.totals.failed, 0);
  assert.equal(report.totals.blocked, 0);
  assert.equal(JSON.stringify(report).match(/[A-Za-z]:[\\/]/), null);
  assert.equal(/password|secret|authorization/i.test(JSON.stringify(report)), false);
});

test("required dependency, post type, field, and route failures are deterministic", () => {
  const cases = [
    ["dependency.jet_engine", "Plugin active: jet-engine"],
    ["model.property", "CPT exists: property"],
    ["model.price", "JetEngine field exists: property.price"]
  ];
  for (const [checkId, message] of cases) {
    const runtime = runtimeFixture();
    runtime.manifest.validation.checks = runtime.manifest.validation.checks.filter((check) => check.message !== message);
    const report = evaluateRealEstateContract({ runtime });
    assert.equal(report.status, "non_compliant");
    assert.deepEqual(report.failed_check_ids, [checkId]);
  }
  const runtime = runtimeFixture();
  delete runtime.generateProof.generated_urls.contact;
  const report = evaluateRealEstateContract({ runtime });
  assert.deepEqual(report.failed_check_ids, ["surface.contact"]);
});

test("missing runtime evidence blocks required checks while optional checks do not fail compliance", () => {
  const runtime = runtimeFixture();
  runtime.manifest = null;
  const blocked = evaluateRealEstateContract({ runtime });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.blocked_check_ids.includes("dependency.kava"), true);
  const optionalOnly = runtimeFixture();
  optionalOnly.manifest.validation.checks = optionalOnly.manifest.validation.checks.filter((check) => check.message !== "Plugin active: jet-form-builder");
  const report = evaluateRealEstateContract({ runtime: optionalOnly });
  assert.equal(report.status, "compliant");
});
