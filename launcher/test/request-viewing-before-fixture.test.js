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
});

test("before-state controls are Factory-owned, idempotent, and fail closed on conflicts", () => {
  assert.match(bootstrap, /FACTORY_REQUEST_VIEWING_BEFORE_V1_CONTROL_META/);
  assert.match(bootstrap, /function factory_request_viewing_before_v1_control_post/);
  assert.match(bootstrap, /get_post_stati\( \[\], 'names' \)/);
  assert.match(bootstrap, /in_array\( 'trash', \$all_statuses, true \)/);
  assert.match(bootstrap, /fixture_control_duplicate/);
  assert.match(bootstrap, /fixture_control_conflict/);
  assert.match(bootstrap, /fixture_control_slug_conflict/);
  assert.match(bootstrap, /wp_trash_post\( \$id \)/);
  assert.match(bootstrap, /'private_property_v1'/);
  assert.match(bootstrap, /'trash_property_v1'/);
  assert.match(bootstrap, /fixture_entities_invalid/);
  assert.match(bootstrap, /array_merge\( \$entities, \$controls \)/);
  assert.match(bootstrap, /'controls' === \$mode/);
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
});
