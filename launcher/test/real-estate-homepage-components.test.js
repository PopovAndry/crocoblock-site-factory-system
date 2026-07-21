"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { assertControlledGenerateResultSuccessful, normalizePersonalizationOutcomes } = require("../src/generate");
const { loadRealEstateContract, validateRealEstateContract } = require("../src/real-estate-contract");

const repoRoot = path.resolve(__dirname, "..", "..");
const applyService = fs.readFileSync(path.join(repoRoot, "wordpress-plugin", "includes", "apply", "real-estate-apply-service.php"), "utf8");
const renderAdapter = fs.readFileSync(path.join(repoRoot, "wordpress-plugin", "includes", "adapters", "render-adapter.php"), "utf8");
const controlledGenerate = fs.readFileSync(path.join(repoRoot, "wordpress-plugin", "includes", "ai", "controlled-generate-service.php"), "utf8");
const generatePreflight = fs.readFileSync(path.join(repoRoot, "wordpress-plugin", "includes", "ai", "generate-preflight-service.php"), "utf8");
const planSource = fs.readFileSync(path.join(repoRoot, "launcher", "src", "plan.js"), "utf8");
const generateSource = fs.readFileSync(path.join(repoRoot, "launcher", "src", "generate.js"), "utf8");
const signedAuth = fs.readFileSync(path.join(repoRoot, "wordpress-plugin", "includes", "security", "signed-auth.php"), "utf8");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function phpBinary() {
  const osPanelPhp = "C:\\OSPanel\\modules\\php\\PHP_8.1\\php.exe";
  if (fs.existsSync(osPanelPhp)) {
    return osPanelPhp;
  }
  const probe = spawnSync("php", ["-v"], { encoding: "utf8" });
  return probe.status === 0 ? "php" : null;
}

test("Homepage v1 declares exactly the five required stable components on valid contract slots", () => {
  const contract = loadRealEstateContract();
  assert.deepEqual(
    contract.homepage_components.map((component) => component.id).sort(),
    ["hero", "property-card", "property-listing", "site-footer", "site-header"]
  );
  const slots = new Map(contract.component_slots.map((slot) => [slot.id, slot]));
  for (const component of contract.homepage_components) {
    const slot = slots.get(component.contract_slot);
    assert.ok(slot);
    assert.ok(slot.surfaces.includes("homepage"));
    assert.equal(component.version, 1);
    assert.deepEqual(component.required_bindings, slot.inputs);
    assert.doesNotMatch(component.implementation_ref, /(?:^[a-z]:[\\/]|^\\\\|^\/|\.\.[\\/])/i);
  }
});

test("missing or duplicate required Homepage component identities fail closed", () => {
  const missing = clone(loadRealEstateContract());
  missing.homepage_components = missing.homepage_components.filter((component) => component.id !== "hero");
  assert.throws(() => validateRealEstateContract(missing), { code: "real_estate_contract_missing_homepage_component" });

  const duplicate = clone(loadRealEstateContract());
  duplicate.homepage_components[1].id = duplicate.homepage_components[0].id;
  assert.throws(() => validateRealEstateContract(duplicate), { code: "real_estate_contract_duplicate_id" });
});

test("invalid component binding and unsafe implementation reference are rejected", () => {
  const invalidBinding = clone(loadRealEstateContract());
  invalidBinding.homepage_components.find((component) => component.id === "property-card").required_bindings = ["internal_secret"];
  assert.throws(() => validateRealEstateContract(invalidBinding), { code: "real_estate_contract_invalid_component_binding" });

  const unsafePath = clone(loadRealEstateContract());
  unsafePath.homepage_components[0].implementation_ref = "C:\\runtime\\renderer.php#hero";
  assert.throws(() => validateRealEstateContract(unsafePath), { code: "real_estate_contract_unsafe_path" });
});

test("property-card bindings derive from the contract semantic slot and model fields", () => {
  const contract = loadRealEstateContract();
  const card = contract.homepage_components.find((component) => component.id === "property-card");
  const slot = contract.component_slots.find((componentSlot) => componentSlot.id === "property_card");
  const semanticKeys = new Set(contract.data_model.fields.map((field) => field.key));
  assert.equal(card.bindings_source, "contract_slot.inputs");
  assert.deepEqual(card.required_bindings, slot.inputs);
  assert.ok(card.required_bindings.every((binding) => semanticKeys.has(binding)));
});

test("server selects the fixed implementation before apply and keeps implementation paths out of customer results", () => {
  const selection = applyService.indexOf("$blueprint['homepage_components'] = $homepage_components;");
  const apply = applyService.indexOf("factory_apply_blueprint( $blueprint )");
  assert.ok(selection > -1 && selection < apply);
  assert.doesNotMatch(applyService, /\$args\['homepage_components'\]/);
  assert.doesNotMatch(controlledGenerate, /implementation_ref/);

  const summaryStart = applyService.indexOf("function factory_real_estate_apply_service_homepage_component_summary");
  const summary = applyService.slice(summaryStart);
  assert.doesNotMatch(summary, /implementation_ref/);
});

test("Homepage ownership keeps agency name editable and hero title protected", () => {
  const contract = loadRealEstateContract();
  const hero = contract.homepage_components.find((component) => component.id === "hero");
  assert.deepEqual(hero.editable_fields, ["agency_name"]);
  assert.deepEqual(hero.protected_fields, ["hero_title"]);
  assert.equal(contract.ownership.find((entry) => entry.id === "agency_name").class, "owner_editable");
  assert.equal(contract.ownership.find((entry) => entry.id === "hero_title").class, "protected");
});

test("actual Homepage renderer emits each stable boundary and reuses the existing upsert path", () => {
  for (const id of ["site-header", "hero", "property-listing", "property-card", "site-footer"]) {
    assert.equal(renderAdapter.split(`data-factory-component=\"${id}\" data-factory-component-version`).length - 1, 1);
  }
  assert.match(renderAdapter, /upsert_configured_page\( \$blueprint, \$page_key \)/);
  assert.match(renderAdapter, /get_page_by_path\( \$page_slug \)/);
  assert.match(renderAdapter, /\$listing_rendered = true/);
  assert.doesNotMatch(renderAdapter, /append_homepage_component|insert_homepage_component/);
});

test("fresh versioned Homepage remains idempotent and implementation paths are server-selected", () => {
  assert.match(renderAdapter, /if \( empty\( \$diff \) \) \{[\s\S]*?mark_page_factory_managed/);
  assert.match(applyService, /factory_real_estate_apply_service_homepage_components\(\)/);
  assert.doesNotMatch(applyService, /\$args\['homepage_components'\]/);
});

test("page ownership hashes the persisted post after WordPress content normalization", () => {
  const php = phpBinary();
  assert.ok(php, "PHP binary is required for persisted ownership fixture");
  const fixture = path.join(__dirname, "php-real-estate-persisted-ownership.php");
  const result = spawnSync(php, [fixture], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    persisted_hash_recorded: true,
    pre_normalized_hash_rejected: true,
    persisted_page_is_unmodified: true,
    later_owner_edit_is_detected: true,
    synchronized_pages_validate: true,
    real_page_mismatch_is_error: true
  });
});

test("controlled generate validation errors cannot reach a successful coordinator result", () => {
  assert.doesNotThrow(() => assertControlledGenerateResultSuccessful({ status: "ok" }));
  assert.doesNotThrow(() => assertControlledGenerateResultSuccessful({ status: "warning" }));
  assert.throws(
    () => assertControlledGenerateResultSuccessful({ status: "error" }),
    (error) => error.code === "controlled_generate_validation_failed"
  );
  assert.throws(
    () => assertControlledGenerateResultSuccessful({}),
    (error) => error.code === "controlled_generate_validation_failed"
  );

  const assertion = generateSource.indexOf("assertControlledGenerateResultSuccessful(executeData);");
  const succeeded = generateSource.indexOf('reportGenerateProgress(options, "succeeded"');
  assert.ok(assertion > -1 && assertion < succeeded);
});

test("controlled generate proof uses persisted apply outcomes instead of desired keys", () => {
  const personalization = {
    fields: {
      agency_name: "Kyiv Realty",
      hero_title: "Protected hero",
      hero_subtitle: "Safe subtitle",
      hero_cta_text: "Browse listings"
    }
  };
  const outcomes = normalizePersonalizationOutcomes({
    personalization_outcomes: {
      applied_fields: ["agency_name", "hero_title", "unknown_field"],
      preserved_fields: ["hero_title"],
      skipped_fields: ["hero_subtitle"],
      failed_fields: ["hero_cta_text"]
    }
  }, personalization);

  assert.deepEqual(outcomes, {
    applied_fields: ["agency_name"],
    preserved_fields: ["hero_title"],
    skipped_fields: ["hero_subtitle"],
    failed_fields: ["hero_cta_text"]
  });
  assert.deepEqual(
    normalizePersonalizationOutcomes({}, personalization),
    {
      applied_fields: [],
      preserved_fields: [],
      skipped_fields: [],
      failed_fields: ["agency_name", "hero_title", "hero_subtitle", "hero_cta_text"]
    }
  );
  assert.doesNotMatch(generateSource, /applied_fields:\s*promptPersonalization\s*\?\s*summarizeAppliedFieldKeys/);
});

test("apply service reports persisted, preserved, skipped, and failed Homepage fields", () => {
  const php = phpBinary();
  assert.ok(php, "PHP binary is required for personalization outcome fixture");
  const fixture = path.join(__dirname, "php-real-estate-personalization-outcomes.php");
  const result = spawnSync(php, [fixture], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    persisted_agency_is_applied: true,
    preserved_field_not_applied: true,
    skipped_field_not_applied: true,
    failed_field_not_applied: true
  });
});

test("existing owner-modified pages remain blocked without migration exceptions", () => {
  assert.match(renderAdapter, /if \( factory_is_post_user_modified\( \$existing->ID, \$current_state, \$target_state \) \) \{/);
  assert.match(generatePreflight, /if \( \$user_modified_total > 0 \) \{[\s\S]*?\$status = 'blocked';/);
  assert.doesNotMatch(renderAdapter, /homepage_component_upgrade|last_generated_hash'[\s\S]*?content_sha256/);
  assert.doesNotMatch(generatePreflight, /legacy_page_fingerprints|homepage_migration|exempt_user_modified|exempt_locked|ownership_bypass/);
});

test("versioned Homepage markup uses component markers and renderer-owned CSS", () => {
  for (const id of ["site-header", "hero", "property-listing", "property-card", "site-footer"]) {
    assert.match(renderAdapter, new RegExp(`data-factory-component=\\"${id}\\"`));
  }
  assert.match(renderAdapter, /<style id="factory-generated-page-style">/);
  const homeRenderer = renderAdapter.slice(renderAdapter.indexOf("private function render_home_page_content"));
  assert.doesNotMatch(homeRenderer, /<style[\s>]/i);
  assert.match(renderAdapter, /factory-home-site-header__nav/);
});

test("planning and generate carry only the preceding authoritative stage under the signed body limit", () => {
  for (const source of [planSource, generateSource]) {
    const preview = source.slice(source.indexOf('name: "preview_diff"'), source.indexOf('name: "generate_gate"'));
    const gate = source.slice(source.indexOf('name: "generate_gate"'), source.indexOf('name: "generate_preflight"'));
    const preflight = source.slice(source.indexOf('name: "generate_preflight"'), source.indexOf('name: "generate_confirmation"'));
    const confirmation = source.slice(source.indexOf('name: "generate_confirmation"'), source.indexOf("function timestampCompact"));
    assert.doesNotMatch(preview, /site_plan:\s*results\.site_plan/);
    assert.doesNotMatch(gate, /(?:site_plan|blueprint_candidate):\s*results\./);
    assert.doesNotMatch(preflight, /(?:site_plan|blueprint_candidate|preview_diff):\s*results\./);
    assert.doesNotMatch(confirmation, /(?:site_plan|blueprint_candidate|preview_diff|generate_gate):\s*results\./);
  }
  const controlledPreview = generateSource.slice(generateSource.indexOf("const previewPayload"), generateSource.indexOf("const previewResponse"));
  assert.match(controlledPreview, /generate_preflight: preflight/);
  assert.doesNotMatch(controlledPreview, /(?:site_plan|blueprint_candidate|preview_diff|generate_gate|generate_confirmation):/);
  assert.match(signedAuth, /FACTORY_AGENT_SIGNED_AUTH_MAX_BODY_BYTES = 65536/);
});
