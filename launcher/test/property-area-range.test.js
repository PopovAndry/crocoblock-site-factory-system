"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..", "..");
const adapterPath = path.join(repoRoot, "wordpress-plugin", "includes", "adapters", "render-adapter.php");
const fixturePath = path.join(__dirname, "php-property-area-range.php");

function phpBinary() {
  const osPanelPhp = "C:\\OSPanel\\modules\\php\\PHP_8.1\\php.exe";
  if (fs.existsSync(osPanelPhp)) return osPanelPhp;
  return spawnSync("php", ["-v"], { encoding: "utf8" }).status === 0 ? "php" : null;
}

test("Property Area range stays dormant until the exact transaction-bound option is present", () => {
  const php = phpBinary();
  assert.ok(php, "PHP is required for Property Area range behavior tests");
  const result = spawnSync(php, [fixturePath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    unactivated: false,
    active_range: ["74.00", "74.12"],
    reset_url: "https://example.test/properties/?purpose=Sale&factory_sort=price_desc&factory_per_page=12",
    one_sided_compare: ">="
  });
});

test("Property Area range renders only through the existing Factory archive and never adds a JetSmartFilters path", () => {
  const adapter = fs.readFileSync(adapterPath, "utf8");
  assert.match(adapter, /factory_property_area_range_v1/);
  assert.match(adapter, /DECIMAL\(12,2\)/);
  assert.match(adapter, /name="area_min"/);
  assert.match(adapter, /name="area_max"/);
  assert.match(adapter, /Clear area/);
  const areaRangeSection = adapter.slice(adapter.indexOf("private function get_property_area_range_activation"), adapter.indexOf("private function get_query_param_string"));
  assert.doesNotMatch(areaRangeSection, /JetSmartFilters|jet_smart_filters|properties-native/);
});
