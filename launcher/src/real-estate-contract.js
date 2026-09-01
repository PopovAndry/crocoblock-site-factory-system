"use strict";

const fs = require("fs");
const path = require("path");
const { readProjectBySlug, resolveProjectsRoot, validateExplicitSlug } = require("./project-store");

const CONTRACT_PATH = path.join(__dirname, "..", "contracts", "real-estate-contract.v1.json");
const OWNERSHIP_CLASSES = new Set(["factory_managed", "owner_editable", "protected", "derived_runtime_only"]);
const CHECK_KINDS = new Set(["runtime_status", "validation_message", "generated_url", "minimum_count", "ownership"]);
const HOMEPAGE_COMPONENT_IDS = new Set(["site-header", "hero", "property-listing", "property-card", "site-footer"]);
const BUSINESS_SEMANTIC_SECTIONS = ["queries", "filters", "listings", "property_contexts", "forms", "form_fields", "user_journeys"];
const PROVIDER_OR_EXECUTION_PATTERN = /(?:\b(?:jet(?:engine|smartfilters|formbuilder)?|crocoblock|wordpress|elementor|bricks|kava|shortcode)\b|<\?(?:php|=)|\$\w+|\b(?:select|insert|update|delete|drop|alter|create|from|where|join)\b|\b(?:powershell|cmd|bash|shell|docker|wp-cli|rm|del|remove-item|copy-item|move-item|mkdir|rmdir|touch|chmod|chown|curl|wget|npm|apply|execute|mutate|install|uninstall|restore|format)\b)/i;
const BUSINESS_FORBIDDEN_KEYS = new Set(["implementation_ref", "path", "file", "file_path", "command", "script", "provider", "plugin", "theme", "sql", "php"]);
const FORM_FIELD_TYPES = new Set(["text", "email", "phone", "date", "textarea"]);
const DISCOVERY_FILTER_TAXONOMIES = {
  filter_purpose: "property_purpose",
  filter_property_type: "property_type",
  filter_district: "property_district"
};

function contractError(message, code) {
  const error = new Error(message);
  error.code = code || "real_estate_contract_invalid";
  return error;
}

function readJson(filePath, code) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw contractError("Real Estate contract data is unreadable.", code || "real_estate_contract_unreadable");
  }
}

function containsUnsafePath(value) {
  if (typeof value === "string") {
    return /(?:^[a-z]:[\\/]|^\\\\|^\/|\.\.[\\/])/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(containsUnsafePath);
  }
  return value && typeof value === "object" && Object.values(value).some(containsUnsafePath);
}

function requireArray(contract, key) {
  if (!Array.isArray(contract[key])) {
    throw contractError("Contract section is invalid: " + key + ".");
  }
  return contract[key];
}

function requirePlainObject(value, section) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw contractError("Contract business section entry is invalid: " + section + ".", "real_estate_contract_invalid_business_semantics");
  }
  return value;
}

function requireExactKeys(value, allowedKeys, section) {
  const entry = requirePlainObject(value, section);
  if (Object.keys(entry).some((key) => !allowedKeys.includes(key))) {
    throw contractError("Contract business section contains an unsupported field.", "real_estate_contract_invalid_business_semantics");
  }
  return entry;
}

function requireStableId(value, section) {
  if (!/^[a-z][a-z0-9_.-]*$/i.test(String(value || ""))) {
    throw contractError("Contract contains an invalid stable ID in " + section + ".", "real_estate_contract_invalid_id");
  }
}

function requireBusinessLabel(value, section) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z -]{0,79}$/.test(value)) {
    throw contractError("Contract business label is invalid: " + section + ".", "real_estate_contract_invalid_business_semantics");
  }
}

function containsForbiddenBusinessInstruction(value) {
  if (typeof value === "string") {
    return /[\\/]/.test(value) || PROVIDER_OR_EXECUTION_PATTERN.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(containsForbiddenBusinessInstruction);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, item]) => BUSINESS_FORBIDDEN_KEYS.has(key) || containsForbiddenBusinessInstruction(item));
  }
  return false;
}

function requireReference(value, references, message) {
  if (!references.has(value)) {
    throw contractError(message, "real_estate_contract_invalid_business_reference");
  }
}

function requireUniqueReferences(values, references, message) {
  if (!Array.isArray(values) || new Set(values).size !== values.length) {
    throw contractError(message, "real_estate_contract_invalid_business_reference");
  }
  for (const value of values) {
    requireReference(value, references, message);
  }
}

function hasExactIds(entries, expectedIds) {
  return entries.length === expectedIds.length
    && new Set(entries.map((entry) => entry.id)).size === expectedIds.length
    && expectedIds.every((id) => entries.some((entry) => entry.id === id));
}

function validateBusinessSemantics(contract) {
  for (const section of BUSINESS_SEMANTIC_SECTIONS) {
    const entries = requireArray(contract, section);
    if (containsForbiddenBusinessInstruction(entries)) {
      throw contractError("Contract business semantics may not contain provider or executable instructions.", "real_estate_contract_invalid_business_semantics");
    }
  }

  const entityIds = new Set(contract.data_model.entities.map((entry) => entry.id));
  const taxonomyIds = new Set(contract.data_model.taxonomies.map((entry) => entry.id));
  const fieldIds = new Set(contract.data_model.fields.map((entry) => entry.id));
  const componentIds = new Set(contract.component_slots.map((entry) => entry.id));
  const surfaceIds = new Set(contract.surfaces.map((entry) => entry.id));
  const queryIds = new Set(contract.queries.map((entry) => entry.id));
  const filterIds = new Set(contract.filters.map((entry) => entry.id));
  const listingIds = new Set(contract.listings.map((entry) => entry.id));
  const contextIds = new Set(contract.property_contexts.map((entry) => entry.id));
  const formIds = new Set(contract.forms.map((entry) => entry.id));
  const formFieldIds = new Set(contract.form_fields.map((entry) => entry.id));

  if (contract.queries.length !== 1 || contract.queries[0].id !== "property_catalog") {
    throw contractError("Real Estate contract requires exactly one property catalog query.", "real_estate_contract_invalid_business_semantics");
  }
  if (!hasExactIds(contract.filters, Object.keys(DISCOVERY_FILTER_TAXONOMIES))) {
    throw contractError("Real Estate contract requires Purpose, Property Type, and District filters.", "real_estate_contract_invalid_business_semantics");
  }
  if (contract.listings.length !== 1 || contract.listings[0].id !== "property_card_listing") {
    throw contractError("Real Estate contract requires exactly one Property Card listing.", "real_estate_contract_invalid_business_semantics");
  }

  for (const query of contract.queries) {
    requireExactKeys(query, ["id", "entity_id", "result_label", "active_filter_combination", "unselected_filter_behavior", "no_selected_filters_behavior", "clear_filters_behavior", "empty_catalog_behavior", "execution_failure_behavior"], "queries");
    requireStableId(query.id, "queries");
    requireReference(query.entity_id, entityIds, "Query references an unknown entity.");
    requireBusinessLabel(query.result_label, "queries");
    if (query.id !== "property_catalog" || query.entity_id !== "property" || query.active_filter_combination !== "and" || query.unselected_filter_behavior !== "no_restriction" || query.no_selected_filters_behavior !== "base_catalog" || query.clear_filters_behavior !== "base_catalog" || query.empty_catalog_behavior !== "empty_state" || query.execution_failure_behavior !== "error_state") {
      throw contractError("Property catalog discovery rules are invalid.", "real_estate_contract_invalid_business_semantics");
    }
  }
  for (const filter of contract.filters) {
    requireExactKeys(filter, ["id", "query_id", "taxonomy_id", "label", "optional", "selection_mode", "term_identity"], "filters");
    requireStableId(filter.id, "filters");
    requireReference(filter.query_id, queryIds, "Filter references an unknown query.");
    requireReference(filter.taxonomy_id, taxonomyIds, "Filter references an unknown taxonomy.");
    requireBusinessLabel(filter.label, "filters");
    if (filter.query_id !== "property_catalog" || filter.taxonomy_id !== DISCOVERY_FILTER_TAXONOMIES[filter.id] || filter.optional !== true || filter.selection_mode !== "single_term" || filter.term_identity !== "taxonomy_term") {
      throw contractError("Property discovery filters must be optional.", "real_estate_contract_invalid_business_semantics");
    }
  }
  for (const listing of contract.listings) {
    requireExactKeys(listing, ["id", "query_id", "component_id", "field_ids", "surface_id", "detail_surface_id", "empty_state", "active_filter_empty_action", "automatic_relaxation"], "listings");
    requireStableId(listing.id, "listings");
    requireReference(listing.query_id, queryIds, "Listing references an unknown query.");
    requireReference(listing.component_id, componentIds, "Listing references an unknown component.");
    requireUniqueReferences(listing.field_ids, fieldIds, "Listing references an unknown field.");
    requireReference(listing.surface_id, surfaceIds, "Listing references an unknown surface.");
    requireReference(listing.detail_surface_id, surfaceIds, "Listing references an unknown surface.");
    if (listing.id !== "property_card_listing" || listing.query_id !== "property_catalog" || listing.empty_state !== "explicit" || listing.active_filter_empty_action !== "clear_filters" || listing.automatic_relaxation !== false) {
      throw contractError("Property listing discovery behavior is invalid.", "real_estate_contract_invalid_business_semantics");
    }
  }

  if (contract.property_contexts.length !== 1 || contract.property_contexts[0].id !== "selected_property_context") {
    throw contractError("Real Estate contract requires exactly one selected property context.", "real_estate_contract_invalid_business_semantics");
  }
  const context = contract.property_contexts[0];
  requireExactKeys(context, ["id", "entity_id", "source_surface_id", "target_surface_id", "required", "identity_source"], "property_contexts");
  requireStableId(context.id, "property_contexts");
  requireReference(context.entity_id, entityIds, "Property context references an unknown entity.");
  requireReference(context.source_surface_id, surfaceIds, "Property context references an unknown surface.");
  requireReference(context.target_surface_id, surfaceIds, "Property context references an unknown surface.");
  if (context.entity_id !== "property" || context.source_surface_id !== "property_single" || context.target_surface_id !== "contact" || context.required !== true || context.identity_source !== "selected_entity") {
    throw contractError("Property context must bind the selected property from details to Contact.", "real_estate_contract_invalid_business_semantics");
  }

  if (contract.forms.length !== 1 || contract.forms[0].id !== "request_viewing_form") {
    throw contractError("Real Estate contract requires exactly one Request Viewing form.", "real_estate_contract_invalid_business_semantics");
  }
  for (const field of contract.form_fields) {
    requireExactKeys(field, ["id", "form_id", "type", "label", "required"], "form_fields");
    requireStableId(field.id, "form_fields");
    requireReference(field.form_id, formIds, "Form field references an unknown form.");
    if (!FORM_FIELD_TYPES.has(field.type) || typeof field.required !== "boolean") {
      throw contractError("Form field type or requirement is invalid.", "real_estate_contract_invalid_business_semantics");
    }
    requireBusinessLabel(field.label, "form_fields");
  }
  const requiredFormFields = {
    request_viewing_name: ["text", true],
    request_viewing_email: ["email", false],
    request_viewing_phone: ["phone", false],
    request_viewing_preferred_date: ["date", false],
    request_viewing_message: ["textarea", false]
  };
  if (!hasExactIds(contract.form_fields, Object.keys(requiredFormFields))) {
    throw contractError("Request Viewing form fields are incomplete.", "real_estate_contract_invalid_business_semantics");
  }
  for (const field of contract.form_fields) {
    const expected = requiredFormFields[field.id];
    if (field.form_id !== "request_viewing_form" || field.type !== expected[0] || field.required !== expected[1]) {
      throw contractError("Request Viewing form field binding is invalid.", "real_estate_contract_invalid_business_semantics");
    }
  }
  const form = contract.forms[0];
  requireExactKeys(form, ["id", "entity_id", "context_id", "field_ids", "contact_rule"], "forms");
  requireStableId(form.id, "forms");
  requireReference(form.entity_id, entityIds, "Form references an unknown entity.");
  requireReference(form.context_id, contextIds, "Form references an unknown property context.");
  requireUniqueReferences(form.field_ids, formFieldIds, "Form references an unknown field.");
  if (form.entity_id !== "property" || form.context_id !== context.id || !hasExactIds(form.field_ids.map((id) => ({ id })), Object.keys(requiredFormFields))) {
    throw contractError("Request Viewing form context or fields are invalid.", "real_estate_contract_invalid_business_reference");
  }
  requireExactKeys(form.contact_rule, ["type", "field_ids"], "forms.contact_rule");
  if (form.contact_rule.type !== "at_least_one") {
    throw contractError("Request Viewing contact rule is invalid.", "real_estate_contract_invalid_business_semantics");
  }
  requireUniqueReferences(form.contact_rule.field_ids, formFieldIds, "Contact rule references an unknown field.");
  if (form.contact_rule.field_ids.length !== 2 || !["request_viewing_email", "request_viewing_phone"].every((id) => form.contact_rule.field_ids.includes(id))) {
    throw contractError("Request Viewing requires email or phone contact.", "real_estate_contract_invalid_business_reference");
  }

  if (!hasExactIds(contract.user_journeys, ["discover_property", "request_viewing"])) {
    throw contractError("Real Estate contract requires discover_property and request_viewing journeys.", "real_estate_contract_invalid_business_journey");
  }
  const discoveryJourney = contract.user_journeys.find((entry) => entry.id === "discover_property");
  const requestViewingJourney = contract.user_journeys.find((entry) => entry.id === "request_viewing");
  requireExactKeys(discoveryJourney, ["id", "entry_surface_id", "query_id", "filter_ids", "listing_id", "detail_surface_id", "detail_label", "clear_filters_action"], "user_journeys");
  requireReference(discoveryJourney.entry_surface_id, surfaceIds, "Journey references an unknown surface.");
  requireReference(discoveryJourney.query_id, queryIds, "Journey references an unknown query.");
  requireUniqueReferences(discoveryJourney.filter_ids, filterIds, "Journey references an unknown filter.");
  requireReference(discoveryJourney.listing_id, listingIds, "Journey references an unknown listing.");
  requireReference(discoveryJourney.detail_surface_id, surfaceIds, "Journey references an unknown surface.");
  requireBusinessLabel(discoveryJourney.detail_label, "user_journeys");

  const listing = contract.listings.find((entry) => entry.id === discoveryJourney.listing_id);
  if (discoveryJourney.entry_surface_id !== listing.surface_id || discoveryJourney.query_id !== listing.query_id || discoveryJourney.detail_surface_id !== listing.detail_surface_id) {
    throw contractError("Journey contains unresolved listing references.", "real_estate_contract_invalid_business_reference");
  }
  if (!hasExactIds(discoveryJourney.filter_ids.map((id) => ({ id })), Object.keys(DISCOVERY_FILTER_TAXONOMIES)) || discoveryJourney.filter_ids.some((filterId) => contract.filters.find((entry) => entry.id === filterId).query_id !== discoveryJourney.query_id) || discoveryJourney.clear_filters_action !== "reset_to_base_catalog") {
    throw contractError("Journey filters do not resolve to its catalog query.", "real_estate_contract_invalid_business_reference");
  }
  requireExactKeys(requestViewingJourney, ["id", "source_surface_id", "target_surface_id", "form_id", "context_id", "outcome", "delivery_status", "email_handoff_confirms_submission"], "user_journeys");
  requireReference(requestViewingJourney.source_surface_id, surfaceIds, "Request Viewing journey references an unknown surface.");
  requireReference(requestViewingJourney.target_surface_id, surfaceIds, "Request Viewing journey references an unknown surface.");
  requireReference(requestViewingJourney.form_id, formIds, "Request Viewing journey references an unknown form.");
  requireReference(requestViewingJourney.context_id, contextIds, "Request Viewing journey references an unknown property context.");
  if (requestViewingJourney.source_surface_id !== discoveryJourney.detail_surface_id || requestViewingJourney.target_surface_id !== "contact" || requestViewingJourney.form_id !== form.id || requestViewingJourney.context_id !== context.id || requestViewingJourney.outcome !== "viewing_request" || requestViewingJourney.delivery_status !== "not_connected" || requestViewingJourney.email_handoff_confirms_submission !== false) {
    throw contractError("Request Viewing journey binding or outcome is invalid.", "real_estate_contract_invalid_business_reference");
  }
}

function collectStableIds(contract) {
  const seen = new Set();
  const groups = [
    requireArray(contract, "dependencies"),
    requireArray(contract.data_model || {}, "entities"),
    requireArray(contract.data_model || {}, "taxonomies"),
    requireArray(contract.data_model || {}, "fields"),
    requireArray(contract, "surfaces"),
    requireArray(contract, "component_slots"),
    requireArray(contract, "queries"),
    requireArray(contract, "filters"),
    requireArray(contract, "listings"),
    requireArray(contract, "property_contexts"),
    requireArray(contract, "forms"),
    requireArray(contract, "form_fields"),
    requireArray(contract, "user_journeys"),
    requireArray(contract, "ownership"),
    requireArray(contract.proof || {}, "checks")
  ];
  for (const group of groups) {
    for (const entry of group) {
      if (!entry || !/^[a-z][a-z0-9_.-]*$/i.test(String(entry.id || ""))) {
        throw contractError("Contract contains an invalid stable ID.");
      }
      if (seen.has(entry.id)) {
        throw contractError("Contract contains a duplicate stable ID.", "real_estate_contract_duplicate_id");
      }
      seen.add(entry.id);
    }
  }
}

function validateRealEstateContract(contract) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw contractError("Real Estate contract must be an object.");
  }
  if (contract.contract_id !== "real-estate-contract@1" || contract.contract_version !== 1 || contract.vertical_id !== "real_estate") {
    throw contractError("Unsupported Real Estate contract version.", "real_estate_contract_unsupported_version");
  }
  if (containsUnsafePath(contract)) {
    throw contractError("Real Estate contract may not contain absolute or traversal paths.", "real_estate_contract_unsafe_path");
  }
  collectStableIds(contract);
  validateBusinessSemantics(contract);
  const surfaceIds = new Set(contract.surfaces.map((surface) => surface.id));
  for (const entry of contract.data_model.fields.concat(contract.data_model.entities, contract.data_model.taxonomies, contract.ownership)) {
    if (!OWNERSHIP_CLASSES.has(entry.ownership || entry.class)) {
      throw contractError("Contract contains an unknown ownership class.", "real_estate_contract_invalid_ownership");
    }
  }
  for (const component of contract.component_slots) {
    if (!Array.isArray(component.surfaces) || component.surfaces.some((surfaceId) => !surfaceIds.has(surfaceId))) {
      throw contractError("Component references an unknown surface.", "real_estate_contract_invalid_component_surface");
    }
  }
  const componentSlots = new Map(contract.component_slots.map((slot) => [slot.id, slot]));
  const ownership = new Map(contract.ownership.map((entry) => [entry.id, entry.class]));
  const homepageComponentIds = contract.homepage_components.map((component) => component.id);
  const homepageIds = new Set(homepageComponentIds);
  if (homepageIds.size !== homepageComponentIds.length) {
    throw contractError("Homepage contains a duplicate component ID.", "real_estate_contract_duplicate_id");
  }
  if (homepageIds.size !== HOMEPAGE_COMPONENT_IDS.size || [...HOMEPAGE_COMPONENT_IDS].some((id) => !homepageIds.has(id))) {
    throw contractError("Required Homepage component is missing.", "real_estate_contract_missing_homepage_component");
  }
  for (const component of contract.homepage_components) {
    const slot = componentSlots.get(component.contract_slot);
    if (!slot || !slot.surfaces.includes("homepage")) {
      throw contractError("Homepage component references an invalid contract slot.", "real_estate_contract_invalid_homepage_slot");
    }
    if (!Number.isInteger(component.version) || component.version < 1 || component.bindings_source !== "contract_slot.inputs") {
      throw contractError("Homepage component identity or binding source is invalid.", "real_estate_contract_invalid_homepage_component");
    }
    if (!Array.isArray(component.editable_fields) || component.editable_fields.some((field) => ownership.get(field) !== "owner_editable")) {
      throw contractError("Homepage component contains an invalid editable field.", "real_estate_contract_invalid_component_field");
    }
    if (!Array.isArray(component.protected_fields) || component.protected_fields.some((field) => ownership.get(field) !== "protected")) {
      throw contractError("Homepage component contains an invalid protected field.", "real_estate_contract_invalid_component_field");
    }
    if (Object.hasOwn(component, "required_bindings") && (!Array.isArray(component.required_bindings) || component.required_bindings.some((binding) => !slot.inputs.includes(binding)))) {
      throw contractError("Homepage component contains an invalid binding.", "real_estate_contract_invalid_component_binding");
    }
    if (typeof component.implementation_ref !== "string" || !/^[a-z0-9_./-]+\.php#[a-z0-9-]+$/i.test(component.implementation_ref)) {
      throw contractError("Homepage component implementation reference is invalid.", "real_estate_contract_invalid_component_implementation");
    }
  }
  for (const check of contract.proof.checks) {
    if (!CHECK_KINDS.has(check.kind) || !["error", "warning"].includes(check.severity) || typeof check.summary !== "string") {
      throw contractError("Proof check is invalid.", "real_estate_contract_invalid_check");
    }
  }
  return normalizeContract(contract);
}

function normalizeContract(contract) {
  const clone = JSON.parse(JSON.stringify(contract));
  const sortById = (entries) => entries.sort((left, right) => left.id.localeCompare(right.id));
  sortById(clone.dependencies);
  sortById(clone.data_model.entities);
  sortById(clone.data_model.taxonomies);
  sortById(clone.data_model.fields);
  sortById(clone.surfaces);
  sortById(clone.component_slots);
  sortById(clone.queries);
  sortById(clone.filters);
  sortById(clone.listings);
  sortById(clone.property_contexts);
  sortById(clone.forms);
  sortById(clone.form_fields);
  sortById(clone.user_journeys);
  for (const form of clone.forms) {
    form.field_ids.sort();
    form.contact_rule.field_ids.sort();
  }
  sortById(clone.homepage_components);
  const componentSlots = new Map(clone.component_slots.map((slot) => [slot.id, slot]));
  for (const component of clone.homepage_components) {
    component.required_bindings = componentSlots.get(component.contract_slot).inputs.slice();
  }
  sortById(clone.ownership);
  sortById(clone.proof.checks);
  return clone;
}

function buildRealEstateBusinessSummary(contractInput) {
  const contract = contractInput ? validateRealEstateContract(contractInput) : loadRealEstateContract();
  const discoveryJourney = contract.user_journeys.find((entry) => entry.id === "discover_property");
  const requestViewingJourney = contract.user_journeys.find((entry) => entry.id === "request_viewing");
  const query = contract.queries.find((entry) => entry.id === discoveryJourney.query_id);
  const filters = discoveryJourney.filter_ids.map((filterId) => contract.filters.find((entry) => entry.id === filterId));
  const filterLabels = filters.map((filter) => filter.label);
  const filterText = filterLabels.length === 1
    ? filterLabels[0]
    : filterLabels.slice(0, -1).join(", ") + " and " + filterLabels[filterLabels.length - 1];
  const form = contract.forms.find((entry) => entry.id === requestViewingJourney.form_id);
  const contactLabels = form.contact_rule.field_ids
    .map((fieldId) => contract.form_fields.find((field) => field.id === fieldId).label);
  const preferredDate = contract.form_fields.find((field) => field.id === "request_viewing_preferred_date").label;
  return {
    description: "Visitors can browse " + query.result_label + ", filter by " + filterText + ", and open " + discoveryJourney.detail_label + ".",
    discovery_rules_description: "Property Discovery specification only: each of " + filterText + " accepts one taxonomy term. Active selections use AND, so a property must match every selected condition. An unselected filter adds no restriction; all other active conditions still apply. When no filters are selected, or after Clear filters, the base " + query.result_label + " catalog is used. A valid search with no matches while filters are active shows an explicit empty state and offers Clear filters; conditions are not relaxed automatically. An empty base catalog remains empty, and an execution error is shown as an error, not as no matches. Runtime filtering behavior is not verified in this slice.",
    request_viewing_description: "Request Viewing specification only: it relates to the selected property and requires " + contactLabels.join(" or ") + ". " + preferredDate + " does not confirm an appointment. Opening an email client does not confirm submission or receipt. Runtime submission is not connected in this slice."
  };
}

function loadRealEstateContract(contractPath) {
  return validateRealEstateContract(readJson(contractPath || CONTRACT_PATH));
}

function findLatestGenerateProof(runtimePath) {
  const proofsPath = path.join(runtimePath, "proofs");
  if (!fs.existsSync(proofsPath)) {
    return null;
  }
  return fs.readdirSync(proofsPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^generate-[A-Za-z0-9._-]+\.json$/.test(entry.name))
    .map((entry) => ({ filePath: path.join(proofsPath, entry.name), name: entry.name }))
    .map((entry) => Object.assign(entry, { value: readJson(entry.filePath, "real_estate_runtime_proof_unreadable") }))
    .sort((left, right) => String(right.value.created_at || "").localeCompare(String(left.value.created_at || "")) || right.name.localeCompare(left.name))[0] || null;
}

function readRuntimeManifest(runtimePath, generateProof) {
  const fileName = generateProof && generateProof.agent_manifest_summary && generateProof.agent_manifest_summary.generation_result
    ? generateProof.agent_manifest_summary.generation_result.file
    : null;
  if (typeof fileName !== "string" || !/^run-[A-Za-z0-9._-]+\.json$/.test(fileName)) {
    return null;
  }
  const manifestPath = path.join(runtimePath, "wordpress", "wp-content", "uploads", "crocoblock-site-factory", "runs", fileName);
  return fs.existsSync(manifestPath) ? readJson(manifestPath, "real_estate_runtime_manifest_unreadable") : null;
}

function inspectRealEstateRuntime(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const slug = validateExplicitSlug(options && options.slug);
  const projectState = readProjectBySlug(slug, projectsRoot);
  const latestProof = findLatestGenerateProof(projectState.runtimePath);
  const manifest = latestProof ? readRuntimeManifest(projectState.runtimePath, latestProof.value) : null;
  return {
    slug,
    project: projectState.project,
    generateProof: latestProof && latestProof.value || null,
    manifest
  };
}

function evaluateCheck(check, runtime, validationMessages) {
  let passed = false;
  let blocked = false;
  if (check.kind === "runtime_status") {
    passed = runtime.project.runtime && runtime.project.runtime.status === check.expected;
  } else if (check.kind === "validation_message") {
    blocked = !runtime.manifest;
    passed = validationMessages.has(check.expected);
  } else if (check.kind === "generated_url") {
    blocked = !runtime.generateProof;
    passed = Boolean(runtime.generateProof && runtime.generateProof.generated_urls && runtime.generateProof.generated_urls[check.expected]);
  } else if (check.kind === "minimum_count") {
    blocked = !runtime.generateProof;
    passed = Number(runtime.generateProof && runtime.generateProof.after_counts && runtime.generateProof.after_counts[check.expected]) >= Number(check.minimum || 0);
  } else if (check.kind === "ownership") {
    passed = true;
  }
  const optional = check.required === false;
  return {
    id: check.id,
    severity: check.severity,
    required: !optional,
    status: passed || optional ? "pass" : (blocked ? "blocked" : "fail"),
    summary: passed ? check.summary : (optional ? "Optional capability is not present." : check.summary)
  };
}

function evaluateRealEstateContract(options) {
  const contract = loadRealEstateContract(options && options.contractPath);
  const runtime = options && options.runtime || inspectRealEstateRuntime(options);
  const validationMessages = new Set((runtime.manifest && runtime.manifest.validation && runtime.manifest.validation.checks || [])
    .filter((check) => check && check.status === "ok" && typeof check.message === "string")
    .map((check) => check.message));
  const checks = contract.proof.checks.map((check) => evaluateCheck(check, runtime, validationMessages));
  const failed = checks.filter((check) => check.status === "fail");
  const blocked = checks.filter((check) => check.status === "blocked");
  return {
    contract_id: contract.contract_id,
    contract_version: contract.contract_version,
    project_slug: runtime.slug,
    status: blocked.length ? "blocked" : (failed.length ? "non_compliant" : "compliant"),
    totals: { passed: checks.filter((check) => check.status === "pass").length, failed: failed.length, blocked: blocked.length, total: checks.length },
    failed_check_ids: failed.map((check) => check.id),
    blocked_check_ids: blocked.map((check) => check.id),
    checks
  };
}

module.exports = {
  CONTRACT_PATH,
  buildRealEstateBusinessSummary,
  evaluateRealEstateContract,
  inspectRealEstateRuntime,
  loadRealEstateContract,
  validateRealEstateContract
};
