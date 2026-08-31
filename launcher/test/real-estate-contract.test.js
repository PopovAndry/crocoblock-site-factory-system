"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CONTRACT_PATH,
  buildRealEstateBusinessSummary,
  evaluateRealEstateContract,
  loadRealEstateContract,
  validateRealEstateContract
} = require("../src/real-estate-contract");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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
  assert.deepEqual(first.user_journeys.map((journey) => journey.id), ["discover_property"]);
  assert.deepEqual(buildRealEstateBusinessSummary(first), {
    description: "Visitors can browse properties, filter by Purpose, Property Type and District, and open property details."
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
