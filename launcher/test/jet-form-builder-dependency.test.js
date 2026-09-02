"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  listDependencyDefinitions,
  resolveDependencyDefinition
} = require("../src/dependency-catalog");

function phpBinary() {
  const osPanelPhp = "C:\\OSPanel\\modules\\php\\PHP_8.1\\php.exe";
  if (fs.existsSync(osPanelPhp)) {
    return osPanelPhp;
  }
  const probe = spawnSync("php", ["-v"], { encoding: "utf8" });
  return probe.status === 0 ? "php" : null;
}

test("JetFormBuilder catalog mapping is native, explicit, and unknown keys remain rejected", () => {
  assert.deepEqual(resolveDependencyDefinition("jet-form-builder"), {
    slug: "jet-form-builder",
    label: "JetFormBuilder",
    type: "plugin",
    wp_slug: "jetformbuilder",
    zip_root: "jetformbuilder",
    identity_file: "jetformbuilder/jet-form-builder.php",
    version_header: "Version"
  });
  assert.deepEqual(listDependencyDefinitions().map((entry) => entry.slug), [
    "kava",
    "jet-engine",
    "jet-smart-filters",
    "jet-form-builder"
  ]);
  assert.throws(() => resolveDependencyDefinition("jetformbuilder"), { code: "unsupported_dependency" });
  assert.throws(() => resolveDependencyDefinition("https://example.test/package.zip"), { code: "unsupported_dependency" });
});

test("Agent dependency inventory recognizes only the verified JetFormBuilder native identity", () => {
  const php = phpBinary();
  assert.ok(php, "PHP binary is required for JetFormBuilder dependency inventory test");
  const fixture = path.resolve(__dirname, "php-jet-form-builder-dependency.php");
  const result = spawnSync(php, [fixture], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    definition: {
      slug: "jet-form-builder",
      required_for_real_estate: false,
      plugin_basenames: ["jetformbuilder/jet-form-builder.php"],
      plugin_dirs: ["jetformbuilder"]
    },
    active: { installed: true, active: true, version: "3.6.5.1", status: "ok" },
    inactive: { installed: true, active: false, version: "3.6.5.1", status: "inactive" },
    missing: { installed: false, active: false, version: null, status: "optional_missing" },
    legacy_alias: { installed: false, active: false, version: null, status: "optional_missing" }
  });
});
