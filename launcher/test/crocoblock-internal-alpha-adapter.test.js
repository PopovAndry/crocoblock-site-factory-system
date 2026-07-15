"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { installDependency } = require("../src/install-dependency");
const { DEFAULT_PROVIDER } = require("../src/managed-package-cache");
const { createProjectScaffold } = require("../src/project-store");
const adapter = require("../src/crocoblock-internal-alpha-adapter");

const TEST_LICENSE = "test-license-not-real";
const SITE_URL = "https://Example.test:443/site";

function assertCode(callback, code) {
  assert.throws(callback, (error) => error && error.code === code);
}

function validJetLicenseData() {
  return {
    status: "success",
    code: "license_active",
    message: "Synthetic success",
    data: {
      license: TEST_LICENSE,
      type: "crocoblock",
      product_name: "Synthetic Crocoblock",
      product_category: "all-inclusive",
      expire: "2099-01-01",
      plugins: {
        "jet-engine": true,
        "jet-smart-filters": true
      },
      sites: ["example.test"],
      site_url: "example.test/",
      is_sublicense: false,
      activation_limit: 10
    }
  };
}

function validPackageResponse() {
  return {
    status: "success",
    code: "package_ready",
    data: {
      product: "jet-engine",
      plugin: "jet-engine/jet-engine.php",
      version: "3.8.9.1",
      package_url: "https://api.crocoblock.com/packages/jet-engine.zip?license=" + TEST_LICENSE,
      content_type: "application/zip"
    }
  };
}

test("adapter is disabled by default", () => {
  const instance = adapter.createCrocoblockInternalAlphaAdapter();
  assert.equal(instance.getSafeMetadata().provider_id, "crocoblock_internal_alpha");
  assert.equal(instance.getSafeMetadata().enabled, false);
  assert.equal(instance.getSafeMetadata().network_enabled, false);
  assert.equal(instance.getSafeMetadata().customer_supported, false);
});

test("default adapter performs no transport call", () => {
  let calls = 0;
  const instance = adapter.createCrocoblockInternalAlphaAdapter({
    transport: () => {
      calls += 1;
      return {};
    }
  });
  assertCode(() => instance.executePrivateRequest({ contract: "test" }), "crocoblock_internal_alpha_disabled");
  assert.equal(calls, 0);
});

test("injected mock transport is required for test execution", () => {
  const enabled = adapter.createCrocoblockInternalAlphaAdapter({ enabled: true });
  assertCode(() => enabled.executePrivateRequest({ contract: "test" }), "live_transport_unavailable");

  const withTransport = adapter.createCrocoblockInternalAlphaAdapter({
    enabled: true,
    transport: (request) => ({ ok: true, contract: request.contract })
  });
  assert.deepEqual(withTransport.executePrivateRequest({ contract: "mock" }), {
    ok: true,
    contract: "mock"
  });
});

test("only three allowlisted products resolve", () => {
  assert.deepEqual(adapter.getSafeAdapterMetadata().products, ["kava", "jet-engine", "jet-smart-filters"]);
});

test("unknown product fails closed", () => {
  assertCode(() => adapter.getSafeProductMapping("jet-evil"), "unknown_dependency_key");
});

test("Kava mapping is correct", () => {
  assert.deepEqual(adapter.getSafeProductMapping("kava"), {
    dependency_key: "kava",
    product_slug: "kava",
    type: "theme",
    installed_identity: "kava"
  });
});

test("JetEngine mapping is correct", () => {
  assert.deepEqual(adapter.getSafeProductMapping("jet-engine"), {
    dependency_key: "jet-engine",
    product_slug: "jet-engine",
    type: "plugin",
    plugin_file: "jet-engine/jet-engine.php"
  });
});

test("JetSmartFilters mapping is correct", () => {
  assert.deepEqual(adapter.getSafeProductMapping("jet-smart-filters"), {
    dependency_key: "jet-smart-filters",
    product_slug: "jet-smart-filters",
    type: "plugin",
    plugin_file: "jet-smart-filters/jet-smart-filters.php"
  });
});

test("Wizard activation request shape", () => {
  const request = adapter.buildWizardLicenseRequest({
    operation: "activate",
    license: TEST_LICENSE,
    siteUrl: SITE_URL
  });
  assert.equal(request.method, "GET");
  assert.equal(request.host, "https://account.crocoblock.com/");
  assert.equal(request.action_selector, "activate_license");
  assert.equal(request.item_id, 9);
  assert.equal(request.site.wizard_url, "https://example.test/site/");
  assert.equal(request.private_fields.license, TEST_LICENSE);
});

test("Wizard check request shape", () => {
  const request = adapter.buildWizardLicenseRequest({
    operation: "check",
    license: TEST_LICENSE,
    siteUrl: "http://WWW.Example.test:80"
  });
  assert.equal(request.action_selector, "check_license");
  assert.equal(request.site.wizard_url, "http://www.example.test/");
  assert.equal(request.site.jet_dashboard_site_url, "example.test/");
});

test("Wizard deactivation request shape", () => {
  const request = adapter.buildWizardLicenseRequest({
    operation: "deactivate",
    license: TEST_LICENSE,
    siteUrl: SITE_URL
  });
  assert.equal(request.action_selector, "deactivate_license");
});

test("Wizard package request shape", () => {
  const request = adapter.buildWizardPackageRequest({
    dependencyKey: "jet-smart-filters",
    license: TEST_LICENSE,
    siteUrl: SITE_URL
  });
  assert.equal(request.action_selector, "ct_api_action=get_plugin");
  assert.equal(request.product.product_slug, "jet-smart-filters");
  assert.equal(request.private_fields.license, TEST_LICENSE);
});

test("Jet Dashboard activation request shape", () => {
  const request = adapter.buildJetDashboardLicenseRequest({
    operation: "activate",
    license: TEST_LICENSE,
    siteUrl: SITE_URL
  });
  assert.equal(request.host, "https://api.crocoblock.com");
  assert.equal(request.action, "activate_license");
  assert.equal(request.site.jet_dashboard_site_url, "example.test/site/");
});

test("Jet Dashboard get_plugins_data request shape", () => {
  const request = adapter.buildJetDashboardPluginDataRequest();
  assert.equal(request.host, "https://api.crocoblock.com");
  assert.equal(request.action, "get_plugins_data");
  assert.equal(Object.prototype.hasOwnProperty.call(request, "private_fields"), false);
});

test("Jet Dashboard get_plugin_update request shape", () => {
  const request = adapter.buildJetDashboardUpdateRequest({
    dependencyKey: "jet-engine",
    version: "3.8.9.1",
    license: TEST_LICENSE,
    siteUrl: SITE_URL
  });
  assert.equal(request.action, "get_plugin_update");
  assert.equal(request.product.plugin, "jet-engine/jet-engine.php");
  assert.equal(request.version, "3.8.9.1");
});

test("site URL normalization", () => {
  assert.deepEqual(adapter.normalizeSiteUrl("HTTPS://WWW.Example.COM:443/path"), {
    wizard_url: "https://www.example.com/path/",
    jet_dashboard_site_url: "example.com/path/"
  });
});

test("malformed URL rejection", () => {
  assertCode(() => adapter.normalizeSiteUrl("not a url"), "malformed_site_url");
  assertCode(() => adapter.normalizeSiteUrl("file:///tmp/test"), "malformed_site_url");
});

test("credential-bearing URL rejection", () => {
  assertCode(() => adapter.normalizeSiteUrl("https://user:pass@example.test/"), "credential_embedded_in_url");
});

test("Wizard valid response parsing", () => {
  const result = adapter.parseWizardLicenseResponse({
    success: true,
    license: "valid",
    has_templates_access: true,
    has_design_templates_access: false,
    excluded_plugins: ["jet-foo"]
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, "license_valid");
  assert.equal(result.entitlements.templates, true);
});

test("Wizard entitlement error parsing", () => {
  const result = adapter.parseWizardLicenseResponse({
    success: false,
    license: "invalid",
    error: "no_activations_left"
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "activation_limit_reached");
});

test("activation-limit normalization", () => {
  const result = adapter.parseJetDashboardLicenseEnvelope({
    status: "error",
    code: "limit_exceeded",
    message: "Synthetic activation limit",
    data: {
      activation_limit: 1,
      sites: ["example.test"]
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "activation_limit_reached");
  assert.equal(result.activation_limit, 1);
  assert.equal(result.sites_count, 1);
});

test("Jet Dashboard valid envelope parsing", () => {
  const result = adapter.parseJetDashboardLicenseEnvelope(validJetLicenseData());
  assert.equal(result.ok, true);
  assert.equal(result.license_present, true);
  assert.equal(result.is_sublicense, false);
  assert.deepEqual(result.included_products, ["jet-engine", "jet-smart-filters"]);
  assert.equal(JSON.stringify(result).includes(TEST_LICENSE), false);
});

test("Jet Dashboard malformed envelope rejection", () => {
  assertCode(() => adapter.parseJetDashboardLicenseEnvelope({ status: "success" }), "missing_response_fields");
});

test("plugin-data allowlist filtering", () => {
  const result = adapter.parsePluginDataResponse({
    status: "success",
    data: [
      { slug: "jet-engine/jet-engine.php", version: "3.8.9.1" },
      { slug: "jet-smart-filters/jet-smart-filters.php", version: "3.7.4.1" },
      { slug: "kava", version: "2.1.4" }
    ]
  });
  assert.deepEqual(result.products.map((product) => product.dependency_key), [
    "jet-engine",
    "jet-smart-filters",
    "kava"
  ]);
});

test("package/update response parsing", () => {
  const result = adapter.parsePackageUpdateResponse(validPackageResponse());
  assert.equal(result.ok, true);
  assert.equal(result.dependency_key, "jet-engine");
  assert.equal(result.package_authorization.host, "api.crocoblock.com");
  assert.equal(result.package_authorization.opaque, true);
  assert.equal(JSON.stringify(result).includes("packages/jet-engine.zip"), false);
});

test("unexpected package host rejection", () => {
  const response = validPackageResponse();
  response.data.package_url = "https://evil.example/jet-engine.zip";
  assertCode(() => adapter.parsePackageUpdateResponse(response), "unexpected_package_host");
});

test("non-HTTPS package URL rejection", () => {
  const response = validPackageResponse();
  response.data.package_url = "http://api.crocoblock.com/jet-engine.zip";
  assertCode(() => adapter.parsePackageUpdateResponse(response), "non_https_package_url");
});

test("HTML/error-page response rejection", () => {
  assertCode(() => adapter.parsePackageUpdateResponse("<html>login</html>"), "html_response_instead_of_metadata");
  const response = validPackageResponse();
  response.data.content_type = "text/html";
  assertCode(() => adapter.parsePackageUpdateResponse(response), "html_response_instead_of_metadata");
});

test("unknown schema rejection", () => {
  assertCode(() => adapter.parseWizardLicenseResponse({
    success: true,
    license: "valid",
    unexpected: true
  }), "schema_drift");
});

test("secret redaction in errors", () => {
  const safe = adapter.sanitizeError({
    code: "backend_shaped_error_containing_secret",
    message: "bad " + TEST_LICENSE
  });
  assert.equal(JSON.stringify(safe).includes(TEST_LICENSE), false);
  assert.equal(safe.code, "backend_shaped_error_containing_secret");
});

test("secret redaction in normalized results", () => {
  const result = adapter.parseJetDashboardLicenseEnvelope(validJetLicenseData());
  assert.equal(JSON.stringify(result).includes(TEST_LICENSE), false);
});

test("secret redaction after JSON serialization", () => {
  const safe = adapter.redactForSafeOutput({
    license: TEST_LICENSE,
    nested: {
      value: "https://api.crocoblock.com/package.zip?license=" + TEST_LICENSE
    }
  });
  assert.equal(JSON.stringify(safe).includes(TEST_LICENSE), false);
  assert.equal(JSON.stringify(safe).includes("package.zip"), false);
});

test("no raw package URL in safe metadata", () => {
  const result = adapter.parsePackageUpdateResponse(validPackageResponse());
  assert.equal(JSON.stringify(result).includes("https://"), false);
  assert.equal(JSON.stringify(result).includes("license="), false);
});

test("no dependency on network libraries", () => {
  const source = fs.readFileSync(require.resolve("../src/crocoblock-internal-alpha-adapter"), "utf8");
  [
    "http.request",
    "https.request",
    "axios",
    "curl",
    "Invoke-WebRequest",
    "child_process",
    "exec(",
    "spawn(",
    "wp_remote_get",
    "wp_remote_post"
  ].forEach((needle) => {
    assert.equal(source.includes(needle), false, needle);
  });
  assert.equal(/(^|[^A-Za-z])fetch\s*\(/.test(source), false);
});

test("current development_local behavior remains unchanged", () => {
  assert.equal(DEFAULT_PROVIDER, "development_local");
});

test("existing client zipPath rejection remains", async () => {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "factory-crocoblock-alpha-"));
  createProjectScaffold({
    name: "Zip Guard",
    slug: "zip-guard",
    port: 29777,
    projectsRoot
  });

  await assert.rejects(
    () => installDependency({
      slug: "zip-guard",
      dependency: "kava",
      zipPath: "C:\\temp\\kava.zip",
      projectsRoot
    }),
    /Direct dependency ZIP paths are not accepted/
  );
});

test("existing CLI --zip rejection remains", () => {
  const source = fs.readFileSync(require.resolve("../src/cli"), "utf8");
  assert.equal(source.includes("install-dependency no longer accepts --zip"), true);
});

test("missing credential and Kava Jet Dashboard package mismatch fail closed", () => {
  assertCode(() => adapter.buildWizardPackageRequest({
    dependencyKey: "kava",
    siteUrl: SITE_URL,
    license: ""
  }), "missing_credential_input");
  assertCode(() => adapter.buildJetDashboardUpdateRequest({
    dependencyKey: "kava",
    siteUrl: SITE_URL,
    version: "2.1.4",
    license: TEST_LICENSE
  }), "product_mapping_mismatch");
});
