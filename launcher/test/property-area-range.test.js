"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const os = require("node:os");
const { directoryIdentity, nativeScript, browserSummary, assertBrowserSummary } = require("../src/property-area-range-preview");

const repoRoot = path.resolve(__dirname, "..", "..");
const adapterPath = path.join(repoRoot, "wordpress-plugin", "includes", "adapters", "render-adapter.php");
const fixturePath = path.join(__dirname, "php-property-area-range.php");

function phpBinary() {
  const osPanelPhp = "C:\\OSPanel\\modules\\php\\PHP_8.1\\php.exe";
  if (fs.existsSync(osPanelPhp)) return osPanelPhp;
  return spawnSync("php", ["-v"], { encoding: "utf8" }).status === 0 ? "php" : null;
}

function nativePhpIdentity(php, directory) {
  const encodedPluginParent = Buffer.from(path.dirname(directory), "utf8").toString("base64");
  const script = "define('WP_PLUGIN_DIR',base64_decode('" + encodedPluginParent + "'));"
    + "function get_posts($value){return [];}function get_post_meta($id,$key,$single){return [];}function get_option($key,$default=false){return $default;}function wp_json_encode($value){return json_encode($value);}"
    + nativeScript({ mode: "read" });
  const result = spawnSync(php, ["-r", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout).plugin_identity_sha256;
}

test("ST-2 plugin identity uses one cross-language canonical sorted file inventory", () => {
  const php = phpBinary();
  assert.ok(php, "PHP is required for Property Area range identity tests");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "factory-plugin-identity-"));
  try {
    const pluginRoot = path.join(root, "crocoblock-site-factory");
    fs.mkdirSync(path.join(pluginRoot, "nested", "deeper"), { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, "root.php"), "<?php echo 'root';\n", "utf8");
    const nested = path.join(pluginRoot, "nested", "deeper", "adapter.php");
    fs.writeFileSync(nested, "<?php echo 'nested';\n", "utf8");
    fs.writeFileSync(path.join(pluginRoot, "nested", "\u{10000}.php"), "<?php echo 'astral';\n", "utf8");
    fs.writeFileSync(path.join(pluginRoot, "nested", "\uE000a.php"), "<?php echo 'bmp';\n", "utf8");

    const initial = directoryIdentity(pluginRoot);
    assert.equal(nativePhpIdentity(php, pluginRoot), initial, "production PHP and JS must hash the same nested inventory");

    fs.writeFileSync(nested, "<?php echo 'changed';\n", "utf8");
    const changed = directoryIdentity(pluginRoot);
    assert.notEqual(changed, initial);
    assert.equal(nativePhpIdentity(php, pluginRoot), changed, "changed raw bytes must alter both producers equally");

    fs.unlinkSync(nested);
    const missing = directoryIdentity(pluginRoot);
    assert.notEqual(missing, changed);
    assert.equal(nativePhpIdentity(php, pluginRoot), missing, "a missing nested file must alter both inventories equally");

    fs.rmSync(pluginRoot, { recursive: true, force: true });
    const malformed = pluginRoot;
    fs.writeFileSync(malformed, "not a plugin tree", "utf8");
    assert.throws(() => directoryIdentity(malformed), { code: "property_area_range_plugin_identity_invalid" });
    assert.equal(nativePhpIdentity(php, malformed), null, "a malformed plugin inventory must fail closed in production PHP");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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

test("Property Area Range Preview derives a closed browser summary from the server-owned prepared plan", () => {
  const summary = browserSummary({ baseline: { property_count: 30 } });
  assert.deepEqual(assertBrowserSummary(summary), summary);
  assert.equal(summary.observed.published_property_count, 30);
  assert.match(summary.change.title, /optional Property area range/);
  assert.match(summary.preservation.join(" "), /sorting, pagination, cards, count/);
  assert.match(summary.boundary, /has not applied the change/);

  for (const malformed of [
    Object.assign({}, summary, { observed: { published_property_count: -1 } }),
    Object.assign({}, summary, { preservation: summary.preservation.slice(0, 1) }),
    Object.assign({}, summary, { plan_id: "caller-supplied" })
  ]) {
    assert.throws(() => assertBrowserSummary(malformed), { code: "property_area_range_preview_summary_invalid" });
  }
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
