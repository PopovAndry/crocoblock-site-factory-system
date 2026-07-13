"use strict";

const crypto = require("node:crypto");

const SIGNED_AUTH_VERSION = "factory-agent-hmac-v1";
const SIGNED_AUTH_FRESHNESS_SECONDS = 300;
const SIGNED_AUTH_CLOCK_SKEW_SECONDS = 30;

const SIGNED_AUTH_HEADERS = Object.freeze({
  version: "x-factory-agent-auth-version",
  keyId: "x-factory-agent-key-id",
  timestamp: "x-factory-agent-timestamp",
  requestId: "x-factory-agent-request-id",
  bodyHash: "x-factory-agent-body-sha256",
  signature: "x-factory-agent-signature"
});

const CAPABILITIES = Object.freeze([
  "health.read",
  "capabilities.read",
  "dependencies.read",
  "generate.plan",
  "generate.apply",
  "state.read",
  "state.apply",
  "state.rollback",
  "proof.read",
  "proof.create",
  "ai.plan",
  "ai.estimate",
  "ai.configure",
  "ai.enable_live"
]);

const AGENT_ROUTE_CAPABILITIES = Object.freeze({
  "GET /factory/v1/agent/health": "health.read",
  "GET /factory/v1/agent/capabilities": "capabilities.read",
  "GET /factory/v1/agent/dependencies": "dependencies.read",
  "POST /factory/v1/agent/safe-fields/apply": "state.apply",
  "GET /factory/v1/ai/settings": "ai.configure",
  "POST /factory/v1/ai/settings": "ai.configure",
  "POST /factory/v1/ai/estimate": "ai.estimate",
  "POST /factory/v1/ai/interpret-prompt": "ai.plan",
  "POST /factory/v1/ai/interpret-live": "ai.plan",
  "POST /factory/v1/ai/site-plan": "ai.plan",
  "POST /factory/v1/ai/blueprint-candidate": "ai.plan",
  "POST /factory/v1/ai/preview-diff": "ai.plan",
  "POST /factory/v1/ai/generate-gate": "generate.plan",
  "POST /factory/v1/ai/generate-preflight": "generate.plan",
  "POST /factory/v1/ai/generate-confirmation": "generate.plan",
  "POST /factory/v1/ai/controlled-generate": "generate.apply"
});

const SIGNED_AUTH_ERROR_CODES = Object.freeze([
  "signed_auth_required",
  "signed_auth_header_invalid",
  "signed_auth_key_unknown",
  "signed_auth_key_revoked",
  "signed_auth_timestamp_invalid",
  "signed_auth_request_expired",
  "signed_auth_body_hash_mismatch",
  "signed_auth_signature_invalid",
  "signed_auth_replay_detected",
  "signed_auth_capability_denied"
]);

function nowIso() {
  return new Date().toISOString();
}

function createSigningCredential(options) {
  const safeOptions = options || {};
  const secret = crypto.randomBytes(32).toString("base64url");
  const keyId = safeOptions.keyId || "factory_agent_" + crypto.randomBytes(12).toString("hex");
  const capabilities = Array.isArray(safeOptions.capabilities) ? safeOptions.capabilities.slice() : CAPABILITIES.slice();

  return {
    schema: "factory_agent_signing_credential",
    version: 1,
    key_id: keyId,
    signing_secret: secret,
    status: safeOptions.status || "active",
    created_at: safeOptions.createdAt || nowIso(),
    revoked_at: safeOptions.revokedAt || null,
    capabilities,
    contract_version: SIGNED_AUTH_VERSION,
    project_slug: safeOptions.projectSlug || null
  };
}

function redactSigningCredential(credential) {
  const safe = Object.assign({}, credential || {});
  if (Object.prototype.hasOwnProperty.call(safe, "signing_secret")) {
    safe.signing_secret = "[redacted]";
  }
  return safe;
}

function normalizeMethod(method) {
  return String(method || "").trim().toUpperCase();
}

function normalizeRestPath(inputPath) {
  let pathname = String(inputPath || "").trim();
  if (!pathname) {
    return "/";
  }
  try {
    if (/^https?:\/\//i.test(pathname)) {
      pathname = new URL(pathname).pathname;
    }
  } catch (error) {
    // Keep the original string and normalize it below.
  }
  pathname = pathname.split("?")[0].split("#")[0].replace(/\\/g, "/");
  if (!pathname.startsWith("/")) {
    pathname = "/" + pathname;
  }
  pathname = pathname.replace(/\/{2,}/g, "/");
  pathname = pathname.replace(/\/$/, "") || "/";
  if (pathname.startsWith("/wp-json/")) {
    pathname = pathname.slice("/wp-json".length);
  }
  return pathname;
}

function encodeQueryComponent(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase());
}

function canonicalizeQuery(query) {
  const raw = String(query || "").replace(/^\?/, "");
  if (!raw) {
    return "";
  }
  const params = new URLSearchParams(raw);
  const entries = Array.from(params.entries()).map(([key, value]) => [String(key), String(value)]);
  entries.sort((left, right) => {
    if (left[0] === right[0]) {
      return left[1] < right[1] ? -1 : (left[1] > right[1] ? 1 : 0);
    }
    return left[0] < right[0] ? -1 : 1;
  });
  return entries.map(([key, value]) => encodeQueryComponent(key) + "=" + encodeQueryComponent(value)).join("&");
}

function bodyToBuffer(body) {
  if (body == null) {
    return Buffer.alloc(0);
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  return Buffer.from(String(body), "utf8");
}

function sha256Hex(body) {
  return crypto.createHash("sha256").update(bodyToBuffer(body)).digest("hex");
}

function createCanonicalString(fields) {
  return [
    fields.version,
    fields.keyId,
    fields.timestamp,
    fields.requestId,
    normalizeMethod(fields.method),
    normalizeRestPath(fields.path),
    canonicalizeQuery(fields.query || ""),
    fields.bodyHash
  ].join("\n");
}

function decodeSigningSecret(secret) {
  const text = String(secret || "");
  if (/^[A-Za-z0-9_-]+$/.test(text)) {
    try {
      const decoded = Buffer.from(text, "base64url");
      if (decoded.length >= 32) {
        return decoded;
      }
    } catch (error) {
      // Fall through to utf8 for fixed test secrets.
    }
  }
  return Buffer.from(text, "utf8");
}

function createSignature(secret, canonicalString) {
  return crypto.createHmac("sha256", decodeSigningSecret(secret)).update(canonicalString, "utf8").digest("base64url");
}

function createSignedAgentHeaders(options) {
  const safeOptions = options || {};
  const credential = safeOptions.credential || {};
  const bodyBuffer = bodyToBuffer(safeOptions.body);
  const bodyHash = safeOptions.bodyHash || sha256Hex(bodyBuffer);
  const timestamp = safeOptions.timestamp || (safeOptions.clock ? safeOptions.clock() : nowIso());
  const requestId = safeOptions.requestId || (safeOptions.requestIdGenerator ? safeOptions.requestIdGenerator() : crypto.randomUUID());
  const fields = {
    version: SIGNED_AUTH_VERSION,
    keyId: credential.key_id,
    timestamp,
    requestId,
    method: safeOptions.method,
    path: safeOptions.path,
    query: safeOptions.query || "",
    bodyHash
  };
  const canonicalString = createCanonicalString(fields);
  const signature = createSignature(credential.signing_secret, canonicalString);

  return {
    headers: {
      [SIGNED_AUTH_HEADERS.version]: fields.version,
      [SIGNED_AUTH_HEADERS.keyId]: fields.keyId,
      [SIGNED_AUTH_HEADERS.timestamp]: fields.timestamp,
      [SIGNED_AUTH_HEADERS.requestId]: fields.requestId,
      [SIGNED_AUTH_HEADERS.bodyHash]: fields.bodyHash,
      [SIGNED_AUTH_HEADERS.signature]: signature
    },
    requestId,
    bodyHash,
    canonicalString
  };
}

function lookupRouteCapability(method, path) {
  const key = normalizeMethod(method) + " " + normalizeRestPath(path);
  return AGENT_ROUTE_CAPABILITIES[key] || null;
}

function signedAuthError(code, statusCode, details) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode || 401;
  error.details = Object.assign({}, details || {});
  return error;
}

function getHeaderValue(headers, headerName) {
  const lowerName = headerName.toLowerCase();
  const matches = [];
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === lowerName) {
      matches.push(value);
    }
  }
  if (matches.length !== 1) {
    return { error: matches.length === 0 ? "missing" : "duplicate" };
  }
  const value = matches[0];
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      return { error: "duplicate" };
    }
    return getHeaderValue({ [headerName]: value[0] }, headerName);
  }
  const text = String(value || "").trim();
  if (!text || text.includes(",")) {
    return { error: "invalid" };
  }
  return { value: text };
}

function readSignedHeaders(headers) {
  const out = {};
  for (const [field, headerName] of Object.entries(SIGNED_AUTH_HEADERS)) {
    const result = getHeaderValue(headers, headerName);
    if (result.error) {
      throw signedAuthError(result.error === "missing" ? "signed_auth_required" : "signed_auth_header_invalid", 401, { header: headerName });
    }
    out[field] = result.value;
  }
  return out;
}

function parseTimestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(String(value || ""))) {
    return null;
  }
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

class MemoryReplayStore {
  constructor() {
    this.entries = new Map();
  }

  cleanup(nowMs) {
    const nowValue = Number(nowMs || Date.now());
    for (const [key, expiresAt] of this.entries.entries()) {
      if (expiresAt <= nowValue) {
        this.entries.delete(key);
      }
    }
  }

  claim(keyId, requestId, expiresAtMs, nowMs) {
    this.cleanup(nowMs);
    const key = String(keyId) + "\n" + String(requestId);
    const existing = this.entries.get(key);
    if (existing && existing > Number(nowMs || Date.now())) {
      return false;
    }
    this.entries.set(key, Number(expiresAtMs));
    return true;
  }
}

function verifySignedAgentRequest(options) {
  const safeOptions = options || {};
  const signedHeaders = readSignedHeaders(safeOptions.headers || {});
  if (signedHeaders.version !== SIGNED_AUTH_VERSION) {
    throw signedAuthError("signed_auth_header_invalid", 401, { field: "version" });
  }

  const credential = safeOptions.resolveCredential ? safeOptions.resolveCredential(signedHeaders.keyId) : null;
  if (!credential) {
    throw signedAuthError("signed_auth_key_unknown", 401);
  }
  if (credential.status === "revoked" || credential.revoked_at) {
    throw signedAuthError("signed_auth_key_revoked", 401);
  }
  if (credential.status && credential.status !== "active") {
    throw signedAuthError("signed_auth_key_revoked", 401);
  }
  if (safeOptions.projectSlug && credential.project_slug && credential.project_slug !== safeOptions.projectSlug) {
    throw signedAuthError("signed_auth_key_unknown", 401);
  }

  const timestampMs = parseTimestamp(signedHeaders.timestamp);
  if (timestampMs == null) {
    throw signedAuthError("signed_auth_timestamp_invalid", 401);
  }
  const nowMs = safeOptions.nowMs != null ? Number(safeOptions.nowMs) : Date.now();
  const freshnessMs = Number(safeOptions.freshnessSeconds || SIGNED_AUTH_FRESHNESS_SECONDS) * 1000;
  const skewMs = Number(safeOptions.clockSkewSeconds || SIGNED_AUTH_CLOCK_SKEW_SECONDS) * 1000;
  if (timestampMs < nowMs - freshnessMs || timestampMs > nowMs + skewMs) {
    throw signedAuthError("signed_auth_request_expired", 401);
  }

  const actualBodyHash = sha256Hex(bodyToBuffer(safeOptions.body));
  if (signedHeaders.bodyHash !== actualBodyHash) {
    throw signedAuthError("signed_auth_body_hash_mismatch", 401);
  }

  const canonicalString = createCanonicalString({
    version: signedHeaders.version,
    keyId: signedHeaders.keyId,
    timestamp: signedHeaders.timestamp,
    requestId: signedHeaders.requestId,
    method: safeOptions.method,
    path: safeOptions.path,
    query: safeOptions.query || "",
    bodyHash: signedHeaders.bodyHash
  });
  const expectedSignature = createSignature(credential.signing_secret, canonicalString);
  const left = Buffer.from(expectedSignature, "utf8");
  const right = Buffer.from(signedHeaders.signature, "utf8");
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw signedAuthError("signed_auth_signature_invalid", 401);
  }

  const routeCapability = safeOptions.requiredCapability || lookupRouteCapability(safeOptions.method, safeOptions.path);
  if (!routeCapability) {
    throw signedAuthError("signed_auth_capability_denied", 403);
  }
  const allowedCapabilities = Array.isArray(credential.capabilities) ? credential.capabilities : [];
  if (!allowedCapabilities.includes(routeCapability)) {
    throw signedAuthError("signed_auth_capability_denied", 403);
  }

  const replayStore = safeOptions.replayStore;
  if (replayStore && typeof replayStore.claim === "function") {
    const accepted = replayStore.claim(signedHeaders.keyId, signedHeaders.requestId, timestampMs + freshnessMs, nowMs);
    if (!accepted) {
      throw signedAuthError("signed_auth_replay_detected", 409);
    }
  }

  return {
    auth_type: "factory_agent_signed_request",
    contract_version: SIGNED_AUTH_VERSION,
    key_id: signedHeaders.keyId,
    request_id: signedHeaders.requestId,
    timestamp: signedHeaders.timestamp,
    capability: routeCapability,
    project_slug: credential.project_slug || safeOptions.projectSlug || null
  };
}

module.exports = {
  AGENT_ROUTE_CAPABILITIES,
  CAPABILITIES,
  MemoryReplayStore,
  SIGNED_AUTH_CLOCK_SKEW_SECONDS,
  SIGNED_AUTH_ERROR_CODES,
  SIGNED_AUTH_FRESHNESS_SECONDS,
  SIGNED_AUTH_HEADERS,
  SIGNED_AUTH_VERSION,
  canonicalizeQuery,
  createCanonicalString,
  createSignature,
  createSignedAgentHeaders,
  createSigningCredential,
  lookupRouteCapability,
  normalizeMethod,
  normalizeRestPath,
  redactSigningCredential,
  sha256Hex,
  signedAuthError,
  verifySignedAgentRequest
};
