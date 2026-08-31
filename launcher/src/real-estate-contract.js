"use strict";

const fs = require("fs");
const path = require("path");
const { readProjectBySlug, resolveProjectsRoot, validateExplicitSlug } = require("./project-store");

const CONTRACT_PATH = path.join(__dirname, "..", "contracts", "real-estate-contract.v1.json");
const OWNERSHIP_CLASSES = new Set(["factory_managed", "owner_editable", "protected", "derived_runtime_only"]);
const CHECK_KINDS = new Set(["runtime_status", "validation_message", "generated_url", "minimum_count", "ownership"]);
const HOMEPAGE_COMPONENT_IDS = new Set(["site-header", "hero", "property-listing", "property-card", "site-footer"]);
const BUSINESS_SEMANTIC_SECTIONS = ["queries", "filters", "listings", "user_journeys"];
const PROVIDER_OR_EXECUTION_PATTERN = /(?:\b(?:jet(?:engine|smartfilters|formbuilder)?|crocoblock|wordpress|elementor|bricks|kava)\b|<\?(?:php|=)|\$\w+|\b(?:select|insert|update|delete|drop|alter|create|from|where|join)\b|\b(?:powershell|cmd|bash|shell|docker|wp-cli|rm|del|remove-item|copy-item|move-item|mkdir|rmdir|touch|chmod|chown|curl|wget|npm|apply|execute|mutate|install|uninstall|restore|format)\b)/i;
const BUSINESS_FORBIDDEN_KEYS = new Set(["implementation_ref", "path", "file", "file_path", "command", "script", "provider", "plugin", "theme", "sql", "php"]);

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

  if (contract.queries.length !== 1 || contract.queries[0].id !== "property_catalog") {
    throw contractError("Real Estate contract requires exactly one property catalog query.", "real_estate_contract_invalid_business_semantics");
  }
  if (contract.filters.length !== 3 || new Set(contract.filters.map((entry) => entry.taxonomy_id)).size !== 3 || contract.filters.some((entry) => !["property_purpose", "property_type", "property_district"].includes(entry.taxonomy_id))) {
    throw contractError("Real Estate contract requires Purpose, Property Type, and District filters.", "real_estate_contract_invalid_business_semantics");
  }
  if (contract.listings.length !== 1 || contract.listings[0].id !== "property_card_listing") {
    throw contractError("Real Estate contract requires exactly one Property Card listing.", "real_estate_contract_invalid_business_semantics");
  }

  for (const query of contract.queries) {
    requireExactKeys(query, ["id", "entity_id", "result_label"], "queries");
    requireStableId(query.id, "queries");
    requireReference(query.entity_id, entityIds, "Query references an unknown entity.");
    requireBusinessLabel(query.result_label, "queries");
  }
  for (const filter of contract.filters) {
    requireExactKeys(filter, ["id", "query_id", "taxonomy_id", "label", "optional"], "filters");
    requireStableId(filter.id, "filters");
    requireReference(filter.query_id, queryIds, "Filter references an unknown query.");
    requireReference(filter.taxonomy_id, taxonomyIds, "Filter references an unknown taxonomy.");
    requireBusinessLabel(filter.label, "filters");
    if (filter.optional !== true) {
      throw contractError("Property discovery filters must be optional.", "real_estate_contract_invalid_business_semantics");
    }
  }
  for (const listing of contract.listings) {
    requireExactKeys(listing, ["id", "query_id", "component_id", "field_ids", "surface_id", "detail_surface_id"], "listings");
    requireStableId(listing.id, "listings");
    requireReference(listing.query_id, queryIds, "Listing references an unknown query.");
    requireReference(listing.component_id, componentIds, "Listing references an unknown component.");
    requireUniqueReferences(listing.field_ids, fieldIds, "Listing references an unknown field.");
    requireReference(listing.surface_id, surfaceIds, "Listing references an unknown surface.");
    requireReference(listing.detail_surface_id, surfaceIds, "Listing references an unknown surface.");
  }
  if (contract.user_journeys.length !== 1 || contract.user_journeys[0].id !== "discover_property") {
    throw contractError("Real Estate contract requires exactly one discover_property journey.", "real_estate_contract_invalid_business_journey");
  }
  const journey = contract.user_journeys[0];
  requireExactKeys(journey, ["id", "entry_surface_id", "query_id", "filter_ids", "listing_id", "detail_surface_id", "detail_label"], "user_journeys");
  requireStableId(journey.id, "user_journeys");
  requireReference(journey.entry_surface_id, surfaceIds, "Journey references an unknown surface.");
  requireReference(journey.query_id, queryIds, "Journey references an unknown query.");
  requireUniqueReferences(journey.filter_ids, filterIds, "Journey references an unknown filter.");
  requireReference(journey.listing_id, listingIds, "Journey references an unknown listing.");
  requireReference(journey.detail_surface_id, surfaceIds, "Journey references an unknown surface.");
  requireBusinessLabel(journey.detail_label, "user_journeys");

  const listing = contract.listings.find((entry) => entry.id === journey.listing_id);
  if (journey.entry_surface_id !== listing.surface_id || journey.query_id !== listing.query_id || journey.detail_surface_id !== listing.detail_surface_id) {
    throw contractError("Journey contains unresolved listing references.", "real_estate_contract_invalid_business_reference");
  }
  if (journey.filter_ids.length !== 3 || journey.filter_ids.some((filterId) => contract.filters.find((entry) => entry.id === filterId).query_id !== journey.query_id)) {
    throw contractError("Journey filters do not resolve to its catalog query.", "real_estate_contract_invalid_business_reference");
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
  sortById(clone.user_journeys);
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
  const journey = contract.user_journeys[0];
  const query = contract.queries.find((entry) => entry.id === journey.query_id);
  const filters = journey.filter_ids.map((filterId) => contract.filters.find((entry) => entry.id === filterId));
  const filterLabels = filters.map((filter) => filter.label);
  const filterText = filterLabels.length === 1
    ? filterLabels[0]
    : filterLabels.slice(0, -1).join(", ") + " and " + filterLabels[filterLabels.length - 1];
  return {
    description: "Visitors can browse " + query.result_label + ", filter by " + filterText + ", and open " + journey.detail_label + "."
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
