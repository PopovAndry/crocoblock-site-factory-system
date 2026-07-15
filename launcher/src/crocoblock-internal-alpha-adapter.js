"use strict";

const PROVIDER_ID = "crocoblock_internal_alpha";
const SUPPORT_LEVEL = "internal_experimental";
const WIZARD_HOST = "https://account.crocoblock.com/";
const JET_DASHBOARD_HOST = "https://api.crocoblock.com";
const WIZARD_ITEM_ID = 9;

const PRODUCT_CROSSWALK = Object.freeze({
  "kava": Object.freeze({
    dependency_key: "kava",
    product_slug: "kava",
    type: "theme",
    installed_identity: "kava"
  }),
  "jet-engine": Object.freeze({
    dependency_key: "jet-engine",
    product_slug: "jet-engine",
    type: "plugin",
    plugin_file: "jet-engine/jet-engine.php"
  }),
  "jet-smart-filters": Object.freeze({
    dependency_key: "jet-smart-filters",
    product_slug: "jet-smart-filters",
    type: "plugin",
    plugin_file: "jet-smart-filters/jet-smart-filters.php"
  })
});

const WIZARD_LICENSE_ACTIONS = Object.freeze({
  activate: "activate_license",
  check: "check_license",
  deactivate: "deactivate_license"
});

const JET_DASHBOARD_LICENSE_ACTIONS = Object.freeze({
  activate: "activate_license",
  deactivate: "deactivate_license"
});

const WIZARD_LICENSE_STATES = Object.freeze({
  valid: "license_valid",
  missing: "license_missing",
  no_activations_left: "activation_limit_reached",
  expired: "license_expired",
  revoked: "license_revoked",
  disabled: "license_disabled",
  invalid: "license_invalid",
  site_inactive: "site_inactive",
  inactive: "license_inactive"
});

const ALLOWED_PACKAGE_HOSTS = Object.freeze([
  "account.crocoblock.com",
  "api.crocoblock.com"
]);

const SECRET_PATTERNS = [
  /test-license-not-real/gi,
  /license=[^&\s"']+/gi,
  /token=[^&\s"']+/gi,
  /key=[^&\s"']+/gi,
  /Authorization:\s*[^\s"']+/gi,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi
];

class CrocoblockInternalAlphaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CrocoblockInternalAlphaError";
    this.code = code;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message
    };
  }
}

function fail(code, message) {
  throw new CrocoblockInternalAlphaError(code, message);
}

function assertPlainObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code || "unrecognized_response_envelope", "The Crocoblock alpha adapter received an unsupported response shape.");
  }
}

function assertAllowedKeys(value, allowed, code) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      fail(code || "schema_drift", "The Crocoblock alpha adapter response schema changed.");
    }
  }
}

function requireSyntheticCredential(value) {
  if (value == null || value === "") {
    fail("missing_credential_input", "A test credential is required for this disabled Crocoblock alpha contract path.");
  }
  if (typeof value !== "string") {
    fail("malformed_credential_type", "The Crocoblock alpha credential must be a string.");
  }
  return value;
}

function normalizePathname(pathname) {
  const pathValue = pathname || "/";
  return pathValue.endsWith("/") ? pathValue : pathValue + "/";
}

function normalizeSiteUrl(siteUrl) {
  if (typeof siteUrl !== "string" || /[\u0000-\u001f\u007f]/.test(siteUrl)) {
    fail("malformed_site_url", "The site URL is invalid.");
  }

  let parsed;
  try {
    parsed = new URL(siteUrl);
  } catch (error) {
    fail("malformed_site_url", "The site URL is invalid.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail("malformed_site_url", "The site URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password) {
    fail("credential_embedded_in_url", "The site URL must not contain credentials.");
  }

  const protocol = parsed.protocol.toLowerCase();
  const hostname = parsed.hostname.toLowerCase();
  const defaultPort = (protocol === "http:" && parsed.port === "80") || (protocol === "https:" && parsed.port === "443");
  const port = parsed.port && !defaultPort ? ":" + parsed.port : "";
  const pathname = normalizePathname(parsed.pathname);
  const wizardUrl = protocol + "//" + hostname + port + pathname;
  const dashboardHost = hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  const dashboardSiteUrl = dashboardHost + port + pathname;

  return {
    wizard_url: wizardUrl,
    jet_dashboard_site_url: dashboardSiteUrl
  };
}

function resolveProduct(dependencyKey) {
  const key = String(dependencyKey || "").trim().toLowerCase();
  const product = PRODUCT_CROSSWALK[key];
  if (!product) {
    fail("unknown_dependency_key", "The requested Crocoblock alpha product is not allowlisted.");
  }
  return Object.assign({}, product);
}

function getSafeProductMapping(dependencyKey) {
  return resolveProduct(dependencyKey);
}

function validateVersion(value) {
  const version = String(value || "").trim();
  if (!/^[0-9]+(?:\.[0-9]+){0,4}(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) {
    fail("malformed_version", "The product version is invalid.");
  }
  return version;
}

function buildWizardLicenseRequest(options) {
  const action = WIZARD_LICENSE_ACTIONS[String(options && options.operation || "").trim()];
  if (!action) {
    fail("unsupported_operation", "Unsupported Wizard license operation.");
  }
  const site = normalizeSiteUrl(options.siteUrl);
  const license = requireSyntheticCredential(options.license);
  return {
    private_contract: true,
    contract: "wizard_license",
    method: "GET",
    host: WIZARD_HOST,
    action_selector: action,
    item_id: WIZARD_ITEM_ID,
    site,
    private_fields: {
      license
    }
  };
}

function buildWizardPackageRequest(options) {
  const product = resolveProduct(options && options.dependencyKey);
  const site = normalizeSiteUrl(options.siteUrl);
  const license = requireSyntheticCredential(options.license);
  return {
    private_contract: true,
    contract: "wizard_paid_package",
    method: "GET",
    host: WIZARD_HOST,
    action_selector: "ct_api_action=get_plugin",
    product: {
      dependency_key: product.dependency_key,
      product_slug: product.product_slug
    },
    site,
    private_fields: {
      license
    }
  };
}

function buildJetDashboardLicenseRequest(options) {
  const action = JET_DASHBOARD_LICENSE_ACTIONS[String(options && options.operation || "").trim()];
  if (!action) {
    fail("unsupported_operation", "Unsupported Jet Dashboard license operation.");
  }
  const site = normalizeSiteUrl(options.siteUrl);
  const license = requireSyntheticCredential(options.license);
  return {
    private_contract: true,
    contract: "jet_dashboard_license",
    method: "GET",
    host: JET_DASHBOARD_HOST,
    action,
    site,
    private_fields: {
      license
    }
  };
}

function buildJetDashboardPluginDataRequest() {
  return {
    private_contract: true,
    contract: "jet_dashboard_plugin_data",
    method: "GET",
    host: JET_DASHBOARD_HOST,
    action: "get_plugins_data"
  };
}

function buildJetDashboardUpdateRequest(options) {
  const product = resolveProduct(options && options.dependencyKey);
  if (product.type !== "plugin" || !product.plugin_file) {
    fail("product_mapping_mismatch", "The selected product does not have a Jet Dashboard plugin package identifier.");
  }
  const version = validateVersion(options.version);
  const site = normalizeSiteUrl(options.siteUrl);
  const license = requireSyntheticCredential(options.license);
  return {
    private_contract: true,
    contract: "jet_dashboard_update_package",
    method: "GET",
    host: JET_DASHBOARD_HOST,
    action: "get_plugin_update",
    product: {
      dependency_key: product.dependency_key,
      product_slug: product.product_slug,
      plugin: product.plugin_file
    },
    version,
    site,
    private_fields: {
      license
    }
  };
}

function mapWizardError(errorCode) {
  const normalized = WIZARD_LICENSE_STATES[errorCode];
  if (!normalized) {
    fail("unknown_license_state", "The Wizard license state is not recognized.");
  }
  return normalized;
}

function parseWizardLicenseResponse(response) {
  assertPlainObject(response);
  assertAllowedKeys(response, [
    "success",
    "license",
    "error",
    "excluded_plugins",
    "has_templates_access",
    "has_design_templates_access"
  ]);

  if (response.success === true && response.license === "valid") {
    return {
      source: "wizard_license",
      ok: true,
      code: "license_valid",
      license_state: "valid",
      entitlements: {
        templates: response.has_templates_access === true,
        design_templates: response.has_design_templates_access === true
      },
      excluded_products: Array.isArray(response.excluded_plugins) ? response.excluded_plugins.map(String) : []
    };
  }

  if (typeof response.error === "string") {
    const code = mapWizardError(response.error);
    return {
      source: "wizard_license",
      ok: false,
      code,
      license_state: response.error
    };
  }

  fail("missing_response_fields", "The Wizard license response is incomplete.");
}

function safeProductListFromPlugins(plugins) {
  if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) {
    return [];
  }
  const result = [];
  for (const key of Object.keys(plugins)) {
    const product = PRODUCT_CROSSWALK[key] || Object.values(PRODUCT_CROSSWALK).find((entry) => entry.plugin_file === key);
    if (product) {
      result.push(product.dependency_key);
    }
  }
  return result.sort();
}

function parseJetDashboardLicenseEnvelope(response) {
  assertPlainObject(response);
  assertAllowedKeys(response, ["status", "code", "message", "data"]);
  if (response.status !== "success" && response.status !== "error") {
    fail("unknown_license_state", "The Jet Dashboard license status is not recognized.");
  }

  if (response.status === "error") {
    if (response.code === "limit_exceeded") {
      const data = response.data && typeof response.data === "object" ? response.data : {};
      return {
        source: "jet_dashboard_license",
        ok: false,
        code: "activation_limit_reached",
        activation_limit: Number.isFinite(data.activation_limit) ? data.activation_limit : null,
        sites_count: Array.isArray(data.sites) ? data.sites.length : null
      };
    }
    if (response.code === "product_not_included") {
      return {
        source: "jet_dashboard_license",
        ok: false,
        code: "product_not_included"
      };
    }
    fail("unknown_license_state", "The Jet Dashboard license error is not recognized.");
  }

  assertPlainObject(response.data, "missing_response_fields");
  assertAllowedKeys(response.data, [
    "license",
    "type",
    "product_name",
    "product_category",
    "expire",
    "plugins",
    "sites",
    "site_url",
    "is_sublicense",
    "activation_limit"
  ]);
  if (typeof response.data.license !== "string" || !response.data.license) {
    fail("missing_response_fields", "The Jet Dashboard license response is incomplete.");
  }

  return {
    source: "jet_dashboard_license",
    ok: true,
    code: response.code || "license_active",
    license_present: true,
    type: typeof response.data.type === "string" ? response.data.type : null,
    product_category: typeof response.data.product_category === "string" ? response.data.product_category : null,
    product_name: typeof response.data.product_name === "string" ? response.data.product_name : null,
    is_sublicense: response.data.is_sublicense === true,
    activation_limit: Number.isFinite(response.data.activation_limit) ? response.data.activation_limit : null,
    included_products: safeProductListFromPlugins(response.data.plugins)
  };
}

function productFromRemoteSlug(slug) {
  const value = String(slug || "").trim();
  return Object.values(PRODUCT_CROSSWALK).find((product) =>
    product.product_slug === value ||
    product.dependency_key === value ||
    product.plugin_file === value ||
    product.installed_identity === value
  ) || null;
}

function parsePluginDataResponse(response) {
  assertPlainObject(response);
  assertAllowedKeys(response, ["status", "data"]);
  if (response.status !== "success") {
    fail("unrecognized_response_envelope", "The Jet Dashboard plugin metadata response failed.");
  }
  if (!Array.isArray(response.data)) {
    fail("missing_response_fields", "The Jet Dashboard plugin metadata response is incomplete.");
  }

  const products = [];
  for (const item of response.data) {
    assertPlainObject(item, "unrecognized_response_envelope");
    assertAllowedKeys(item, ["slug", "version", "name", "title"]);
    const product = productFromRemoteSlug(item.slug);
    if (!product) {
      fail("unknown_dependency_key", "The Jet Dashboard plugin metadata includes an unsupported product.");
    }
    const version = validateVersion(item.version);
    products.push({
      dependency_key: product.dependency_key,
      product_slug: product.product_slug,
      plugin_file: product.plugin_file || null,
      type: product.type,
      version
    });
  }

  return {
    source: "jet_dashboard_plugin_data",
    ok: true,
    products
  };
}

function validatePrivatePackageUrl(packageUrl) {
  if (typeof packageUrl !== "string" || /^\s*</.test(packageUrl)) {
    fail("html_response_instead_of_metadata", "The package response is not metadata.");
  }
  let parsed;
  try {
    parsed = new URL(packageUrl);
  } catch (error) {
    fail("unexpected_response_shape", "The package URL is invalid.");
  }
  if (parsed.protocol !== "https:") {
    fail("non_https_package_url", "The package URL must use HTTPS.");
  }
  if (parsed.username || parsed.password) {
    fail("credential_embedded_in_url", "The package URL must not contain credentials.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_PACKAGE_HOSTS.includes(hostname)) {
    fail("unexpected_package_host", "The package URL host is not allowlisted.");
  }
  return {
    host: hostname
  };
}

function parsePackageUpdateResponse(response) {
  if (typeof response === "string") {
    validatePrivatePackageUrl(response);
    fail("unexpected_response_shape", "The package response metadata is incomplete.");
  }
  assertPlainObject(response);
  assertAllowedKeys(response, ["status", "code", "data"]);
  if (response.status !== "success") {
    fail("unrecognized_response_envelope", "The package response failed.");
  }
  assertPlainObject(response.data, "missing_response_fields");
  assertAllowedKeys(response.data, ["product", "plugin", "version", "package_url", "content_type"]);
  const product = productFromRemoteSlug(response.data.product || response.data.plugin);
  if (!product) {
    fail("unknown_dependency_key", "The package response includes an unsupported product.");
  }
  const version = validateVersion(response.data.version);
  if (typeof response.data.content_type === "string" && /html/i.test(response.data.content_type)) {
    fail("html_response_instead_of_metadata", "The package response is HTML.");
  }
  const packageSummary = validatePrivatePackageUrl(response.data.package_url);

  return {
    source: "jet_dashboard_update_package",
    ok: true,
    dependency_key: product.dependency_key,
    product_slug: product.product_slug,
    plugin_file: product.plugin_file || null,
    version,
    package_authorization: {
      present: true,
      host: packageSummary.host,
      opaque: true
    }
  };
}

function redactString(value) {
  let output = value;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, "[redacted]");
  }
  return output;
}

function redactForSafeOutput(value) {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) && /[?&](?:license|token|key)=/i.test(value)) {
      return "[redacted-url]";
    }
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactForSafeOutput);
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (/license|secret|token|authorization|cookie|package_url|url/i.test(key)) {
        result[key] = "[redacted]";
      } else {
        result[key] = redactForSafeOutput(item);
      }
    }
    return result;
  }
  return value;
}

function sanitizeError(error) {
  return {
    code: error && error.code ? String(error.code) : "crocoblock_internal_alpha_error",
    message: "The disabled Crocoblock alpha adapter rejected the operation."
  };
}

function getSafeAdapterMetadata() {
  return {
    provider_id: PROVIDER_ID,
    support_level: SUPPORT_LEVEL,
    enabled: false,
    network_enabled: false,
    customer_supported: false,
    products: Object.keys(PRODUCT_CROSSWALK)
  };
}

function createCrocoblockInternalAlphaAdapter(options) {
  const config = options || {};
  const enabled = config.enabled === true;
  const transport = config.transport;

  return {
    getSafeMetadata() {
      return Object.assign({}, getSafeAdapterMetadata(), {
        enabled,
        network_enabled: false
      });
    },

    executePrivateRequest(privateRequest) {
      if (!enabled) {
        fail("crocoblock_internal_alpha_disabled", "The Crocoblock internal alpha adapter is disabled.");
      }
      if (typeof transport !== "function") {
        fail("live_transport_unavailable", "The Crocoblock internal alpha adapter has no production transport.");
      }
      return transport(privateRequest);
    }
  };
}

module.exports = {
  JET_DASHBOARD_HOST,
  PRODUCT_CROSSWALK,
  PROVIDER_ID,
  SUPPORT_LEVEL,
  WIZARD_HOST,
  buildJetDashboardLicenseRequest,
  buildJetDashboardPluginDataRequest,
  buildJetDashboardUpdateRequest,
  buildWizardLicenseRequest,
  buildWizardPackageRequest,
  createCrocoblockInternalAlphaAdapter,
  getSafeAdapterMetadata,
  getSafeProductMapping,
  normalizeSiteUrl,
  parseJetDashboardLicenseEnvelope,
  parsePackageUpdateResponse,
  parsePluginDataResponse,
  parseWizardLicenseResponse,
  redactForSafeOutput,
  sanitizeError
};
