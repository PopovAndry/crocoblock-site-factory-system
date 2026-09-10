"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

function phpBinary() {
  const osPanelPhp = "C:\\OSPanel\\modules\\php\\PHP_8.1\\php.exe";
  if (fs.existsSync(osPanelPhp)) return osPanelPhp;
  return spawnSync("php", ["-v"], { encoding: "utf8" }).status === 0 ? "php" : null;
}

test("PHP runtime binding parser accepts only the fixed exact schema", () => {
  const php = phpBinary();
  assert.ok(php, "PHP binary is required for runtime binding reader tests");
  const result = spawnSync(php, [path.join(__dirname, "php-runtime-binding.php")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const behavior = JSON.parse(result.stdout);
  assert.deepEqual(behavior.valid, {
    ok: true,
    binding: {
      schema_version: 1,
      binding_kind: "server_owned_runtime_binding",
      project_id: "123e4567-e89b-12d3-a456-426614174000",
      project_slug: "runtime-binding-test"
    }
  });
  for (const key of ["extra", "invalid_uuid", "malformed", "oversize", "non_string"]) {
    assert.deepEqual(behavior[key], { ok: false, code: "runtime_binding_invalid" }, key);
  }
});

test("PHP runtime binding reader has no caller-controlled test authority", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "wordpress-plugin", "includes", "runtime-binding.php"),
    "utf8"
  );

  assert.match(source, /function factory_runtime_binding_v1_read\(\): array/);
  assert.match(source, /FACTORY_RUNTIME_BINDING_V1_PATH/);
  assert.match(source, /factory_runtime_binding_v1_parse\(\s*\$raw\s*\)/);
  assert.doesNotMatch(source, /FACTORY_RUNTIME_BINDING_V1_TESTING/);
  assert.doesNotMatch(source, /factory_runtime_binding_v1_test_raw/);
  assert.doesNotMatch(source, /\$GLOBALS/);
});
