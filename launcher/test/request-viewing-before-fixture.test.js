"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const fixtureRoot = path.resolve(__dirname, "..", "..", "scripts", "fixtures", "request-viewing-before-v1");
const policy = fs.readFileSync(path.join(fixtureRoot, "factory-request-viewing-before-v1-policy.php"), "utf8");
const bootstrap = fs.readFileSync(path.join(fixtureRoot, "bootstrap.php"), "utf8");

function phpBinary() {
  const osPanelPhp = "C:\\OSPanel\\modules\\php\\PHP_8.1\\php.exe";
  if (fs.existsSync(osPanelPhp)) {
    return osPanelPhp;
  }
  const probe = spawnSync("php", ["-v"], { encoding: "utf8" });
  return probe.status === 0 ? "php" : null;
}

function policyBehavior() {
  const php = phpBinary();
  assert.ok(php, "PHP binary is required for Request Viewing fixture policy tests");
  const result = spawnSync(php, [path.join(__dirname, "php-request-viewing-before-fixture.php")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function formRecordsBehavior(mode) {
  const php = phpBinary();
  assert.ok(php, "PHP binary is required for Form Records readiness tests");
  const result = spawnSync(php, [path.join(__dirname, "php-request-viewing-before-fixture.php")], {
    encoding: "utf8",
    env: Object.assign({}, process.env, { FIXTURE_FORM_RECORDS_TEST_MODE: mode })
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function wpUnslash(value) {
  return value.replace(/\\(.)/gs, "$1");
}

test("before-state fixture policy is versioned, exact-form bound, and limited to the two approved invariants", () => {
  assert.match(policy, /Version:\s*1\.0\.0/);
  assert.match(policy, /factory_request_viewing_before_v1_validate_contacts/);
  assert.match(policy, /factory_request_viewing_before_v1_validate_property/);
  assert.match(policy, /'email' !== \$binding\['email_field'\]/);
  assert.match(policy, /'phone' !== \$binding\['phone_field'\]/);
  assert.match(policy, /'property_id' !== \$binding\['property_field'\]/);
  assert.match(policy, /'jet-form-builder' !== \$form->post_type/);
  assert.match(policy, /'property' === \$property->post_type && 'publish' === \$property->post_status/);
  assert.match(policy, /resolve_to_up\( \$field \)/);
  assert.doesNotMatch(policy, /send_email|wp_remote|curl_exec|add_action\(\s*'wp_ajax/);
});

test("before-state form stores the native JFB action payload as slashed JSON rather than a PHP meta array", () => {
  assert.match(bootstrap, /function factory_request_viewing_before_v1_store_form_actions/);
  assert.match(bootstrap, /wp_json_encode\( \$actions, JSON_UNESCAPED_SLASHES \)/);
  assert.match(bootstrap, /update_post_meta\( \$form_id, '_jf_actions', wp_slash\( \$json \) \)/);
  assert.match(bootstrap, /json_decode\( \$stored, true \)/);
  assert.match(bootstrap, /fixture_actions_round_trip_failed/);
  assert.match(bootstrap, /function factory_request_viewing_before_v1_repair_actions/);
  assert.match(bootstrap, /fixture_owned_form_binding_invalid/);
  assert.doesNotMatch(bootstrap, /update_post_meta\( \$form_id, '_jf_actions', \[ \[/);

  const action = { type: "save_record", editor_name: 'Record "quote" \\ path' };
  const json = JSON.stringify([action]);
  const storedByMetaApi = wpUnslash(json.replace(/\\/g, "\\\\").replace(/'/g, "\\'"));
  assert.deepEqual(JSON.parse(storedByMetaApi), [action]);
});

test("before-state form has only the accepted business fields, native Form Records, and no preferred date", () => {
  for (const name of ["property_id", "name", "email", "phone", "message", "_factory_policy_guard"]) {
    assert.match(bootstrap, new RegExp('"name":"' + name + '"'));
  }
  assert.match(bootstrap, /'type'\s+=>\s+'save_record'/);
  assert.match(bootstrap, /'id'\s+=>\s+0/);
  assert.match(bootstrap, /wp:jet-forms\/text-field .*"field_type":"hidden"/);
  assert.doesNotMatch(bootstrap, /preferred_(?:date|time)|send_email|webhook|redirect/i);
  assert.match(bootstrap, /factory_property_id/);
  assert.match(bootstrap, /factory_request_viewing_before_v1_require_form_records_ready/);
  assert.match(bootstrap, /JFB_Modules\\\\Form_Record\\\\Models\\\\Record_Model/);
  assert.match(bootstrap, /JFB_Modules\\\\Form_Record\\\\Models\\\\Record_Field_Model/);
  assert.match(bootstrap, /Jet_Form_Builder\\\\Db_Queries\\\\Execution_Builder/);
  assert.match(bootstrap, /\$verifier = new \$builder_class\(\)/);
  assert.doesNotMatch(bootstrap, /Execution_Builder::instance\(\)/);
  assert.doesNotMatch(bootstrap, /CREATE\s+TABLE|INSERT\s+INTO\s+.*jet_fb|wp_insert_post\(.*record/i);
});

test("Form Records readiness uses native idempotent models, verifies both tables, and leaves zero records", () => {
  const { baseline } = policyBehavior();
  assert.deepEqual(baseline.form_records_first, {
    tables: { records: "wp_jet_fb_records", fields: "wp_jet_fb_records_fields" },
    record_count: 0
  });
  assert.deepEqual(baseline.form_records_second, baseline.form_records_first);
  assert.equal(baseline.form_records_schema_mutations, 2);
  assert.equal(baseline.form_records_no_repeat_mutation, true);

  assert.deepEqual(formRecordsBehavior("missing_class"), {
    error: "fixture_form_records_class_missing",
    schema_mutations: 0
  });
  assert.deepEqual(formRecordsBehavior("table_verification_failed"), {
    error: "fixture_form_records_table_unavailable",
    schema_mutations: 1
  });
  assert.deepEqual(formRecordsBehavior("records_not_empty"), {
    error: "fixture_form_records_not_empty",
    schema_mutations: 2
  });
});

test("before-state controls are Factory-owned, idempotent, and fail closed on conflicts", () => {
  assert.match(bootstrap, /FACTORY_REQUEST_VIEWING_BEFORE_V1_CONTROL_META/);
  assert.match(bootstrap, /function factory_request_viewing_before_v1_control_post/);
  assert.match(bootstrap, /get_post_stati\( \[\], 'names' \)/);
  assert.match(bootstrap, /function factory_request_viewing_before_v1_all_statuses/);
  assert.match(bootstrap, /in_array\( 'trash', \$statuses, true \)/);
  assert.match(bootstrap, /fixture_control_duplicate/);
  assert.match(bootstrap, /fixture_control_conflict/);
  assert.match(bootstrap, /fixture_control_slug_conflict/);
  assert.match(bootstrap, /wp_trash_post\( \$id \)/);
  assert.match(bootstrap, /'private_property_v1'/);
  assert.match(bootstrap, /'trash_property_v1'/);
  assert.match(bootstrap, /fixture_entities_invalid/);
  assert.match(bootstrap, /array_merge\( \$entities, \$controls \)/);
  assert.match(bootstrap, /'controls' === \$mode/);
  assert.match(bootstrap, /factory_runtime_binding_v1_read/);
  assert.match(bootstrap, /fixture_runtime_identity_injection/);
  assert.doesNotMatch(bootstrap, /csf-st-viewing-before-v1/);
});

test("Request Viewing policy executes through real PHP functions and fails closed on invalid bindings", () => {
  const { validations, global_hooks_added } = policyBehavior();

  for (const key of ["valid_email", "valid_phone", "valid_both"]) {
    assert.deepEqual(validations[key].contacts, true, key);
    assert.deepEqual(validations[key].property, true, key);
    assert.ok(validations[key].updates > 0, key + " native context parser refresh");
  }
  for (const key of ["empty_contacts", "whitespace_contacts", "non_scalar_contacts"]) {
    assert.equal(validations[key].contacts, false, key);
    assert.equal(validations[key].property, true, key);
  }
  for (const key of ["bad_property", "malformed_property"]) {
    assert.equal(validations[key].contacts, true, key);
    assert.equal(validations[key].property, false, key);
  }
  for (const key of ["missing_binding", "malformed_binding", "ambiguous_binding", "retargeted_binding", "absent_execution_context", "unrelated_invocation"]) {
    assert.deepEqual(validations[key], { contacts: false, property: false, updates: 0 }, key);
  }
  assert.equal(global_hooks_added, 0, "policy registers no global hook for unrelated forms");
});

test("controls search trash explicitly and block duplicate or ownership conflicts before mutation", () => {
  const { controls } = policyBehavior();
  assert.equal(controls.any_lookup_misses_trash, true);
  assert.deepEqual(controls.once, { private_property: 16, trash_property: 17 });
  assert.deepEqual(controls.twice, { private_property: 16, trash_property: 17 });
  assert.equal(controls.no_mutation, true);
  assert.equal(controls.duplicate_error, "fixture_control_duplicate");
  assert.equal(controls.duplicate_no_mutation, true);
  assert.equal(controls.conflict_error, "fixture_control_conflict");
  assert.equal(controls.conflict_no_mutation, true);
  assert.equal(controls.malformed_entities_error, "fixture_entities_invalid");
  assert.equal(controls.malformed_entities_no_mutation, true);
});

test("fixture baseline and form are runtime-bound, idempotent, and preflight conflicts before writes", () => {
  const { baseline } = policyBehavior();
  assert.deepEqual(baseline.base_twice, baseline.base_once);
  assert.equal(baseline.base_no_repeat_mutation, true);
  assert.deepEqual(baseline.form_twice, baseline.form_once);
  assert.equal(baseline.form_no_repeat_mutation, true);
  assert.deepEqual(baseline.form_once.form_records, baseline.form_records_first);
  assert.equal(baseline.redirected_entities_error, "fixture_entities_invalid");
  assert.equal(baseline.redirected_entities_no_mutation, true);
	assert.equal(baseline.redirected_entities_no_schema_mutation, true);
	assert.equal(baseline.binding_conflict_error, "fixture_form_binding_conflict");
	assert.equal(baseline.binding_conflict_no_schema_mutation, true);
	assert.equal(baseline.form_conflict_error, "fixture_form_conflict");
	assert.equal(baseline.form_conflict_no_schema_mutation, true);
  assert.equal(baseline.entity_conflict_error, "fixture_entity_conflict");
  assert.equal(baseline.entity_conflict_no_mutation, true);
  assert.equal(baseline.identity_injection_error, "fixture_runtime_identity_injection");
  assert.equal(baseline.identity_injection_no_mutation, true);
});
