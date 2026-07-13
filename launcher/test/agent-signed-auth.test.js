"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");

const {
  AGENT_ROUTE_CAPABILITIES,
  CAPABILITIES,
  MemoryReplayStore,
  SIGNED_AUTH_HEADERS,
  SIGNED_AUTH_VERSION,
  canonicalizeQuery,
  createCanonicalString,
  createSignature,
  createSignedAgentHeaders,
  createSigningCredential,
  lookupRouteCapability,
  normalizeRestPath,
  redactSigningCredential,
  sha256Hex,
  verifySignedAgentRequest
} = require("../src/agent-signed-auth");
const {
  fetchJsonWithSignedAuth
} = require("../src/agent-client");

const FIXED_SECRET = Buffer.alloc(32, 7).toString("base64url");
const FIXED_TIMESTAMP = "2026-07-12T12:00:00.000Z";
const FIXED_NOW = Date.parse(FIXED_TIMESTAMP);
const FIXED_REQUEST_ID = "req-20260712-fixed-0001";

function credential(overrides) {
  return Object.assign(createSigningCredential({
    keyId: "key-alpha",
    projectSlug: "project-alpha",
    createdAt: "2026-07-12T11:00:00.000Z",
    capabilities: CAPABILITIES
  }), {
    signing_secret: FIXED_SECRET
  }, overrides || {});
}

function signRequest(options) {
  const safeOptions = Object.assign({
    credential: credential(),
    method: "POST",
    path: "/wp-json/factory/v1/agent/safe-fields/apply",
    query: "z=last&a=first",
    body: "{\"agency_name\":\"Alpha\"}",
    timestamp: FIXED_TIMESTAMP,
    requestId: FIXED_REQUEST_ID
  }, options || {});
  return createSignedAgentHeaders(safeOptions);
}

function verify(options) {
  const safeOptions = Object.assign({
    method: "POST",
    path: "/wp-json/factory/v1/agent/safe-fields/apply",
    query: "z=last&a=first",
    body: "{\"agency_name\":\"Alpha\"}",
    headers: signRequest().headers,
    projectSlug: "project-alpha",
    nowMs: FIXED_NOW,
    resolveCredential: () => credential()
  }, options || {});
  return verifySignedAgentRequest(safeOptions);
}

function assertRejectsWithCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code);
    const serialized = JSON.stringify(error);
    assert.equal(serialized.includes(FIXED_SECRET), false);
    assert.equal(serialized.includes("Authorization"), false);
    return true;
  });
}

function phpBinary() {
  const osPanelPhp = "C:\\OSPanel\\modules\\php\\PHP_8.1\\php.exe";
  if (fs.existsSync(osPanelPhp)) {
    return osPanelPhp;
  }
  const probe = spawnSync("php", ["-v"], { encoding: "utf8" });
  return probe.status === 0 ? "php" : null;
}

test("route capability registry covers actual operational Agent routes and fails closed", () => {
  assert.equal(lookupRouteCapability("GET", "/wp-json/factory/v1/agent/health"), "health.read");
  assert.equal(lookupRouteCapability("GET", "/wp-json/factory/v1/agent/capabilities"), "capabilities.read");
  assert.equal(lookupRouteCapability("GET", "/wp-json/factory/v1/agent/dependencies"), "dependencies.read");
  assert.equal(lookupRouteCapability("POST", "/wp-json/factory/v1/agent/safe-fields/apply"), "state.apply");
  assert.equal(lookupRouteCapability("POST", "/wp-json/factory/v1/ai/site-plan"), "ai.plan");
  assert.equal(lookupRouteCapability("POST", "/wp-json/factory/v1/ai/blueprint-candidate"), "ai.plan");
  assert.equal(lookupRouteCapability("POST", "/wp-json/factory/v1/ai/preview-diff"), "ai.plan");
  assert.equal(lookupRouteCapability("POST", "/wp-json/factory/v1/ai/generate-gate"), "generate.plan");
  assert.equal(lookupRouteCapability("POST", "/wp-json/factory/v1/ai/generate-preflight"), "generate.plan");
  assert.equal(lookupRouteCapability("POST", "/wp-json/factory/v1/ai/generate-confirmation"), "generate.plan");
  assert.equal(lookupRouteCapability("POST", "/wp-json/factory/v1/ai/controlled-generate"), "generate.apply");
  assert.equal(lookupRouteCapability("POST", "/wp-json/factory/v1/ai/estimate"), "ai.estimate");
  assert.equal(lookupRouteCapability("POST", "/wp-json/factory/v1/ai/settings"), "ai.configure");
  assert.equal(lookupRouteCapability("GET", "/wp-json/factory/v1/ai/settings"), "ai.configure");
  assert.equal(lookupRouteCapability("POST", "/wp-json/factory/v1/ai/interpret-live"), "ai.plan");
  assert.equal(lookupRouteCapability("POST", "/wp-json/factory/v1/unknown"), null);

  for (const capability of Object.values(AGENT_ROUTE_CAPABILITIES)) {
    assert.equal(CAPABILITIES.includes(capability), true, "unknown capability in route registry: " + capability);
  }
});

test("cross-language fixed vector matches PHP canonicalization and signature", () => {
  const php = phpBinary();
  assert.ok(php, "PHP binary is required for cross-language signed auth vector test");
  const fixture = path.resolve(__dirname, "php-signed-auth-vector.php");
  const body = "{\"b\":2,\"a\":1}";
  const vector = {
    version: SIGNED_AUTH_VERSION,
    key_id: "key-alpha",
    project_slug: "project-alpha",
    timestamp: FIXED_TIMESTAMP,
    request_id: FIXED_REQUEST_ID,
    method: "post",
    path: "/wp-json/factory/v1/agent/safe-fields/apply",
    query: "z=last&a=first&a=alpha",
    body,
    secret: FIXED_SECRET
  };
  const nodeBodyHash = sha256Hex(body);
  const nodeCanonical = createCanonicalString({
    version: vector.version,
    keyId: vector.key_id,
    projectSlug: vector.project_slug,
    timestamp: vector.timestamp,
    requestId: vector.request_id,
    method: vector.method,
    path: vector.path,
    query: vector.query,
    bodyHash: nodeBodyHash
  });
  const nodeSignature = createSignature(FIXED_SECRET, nodeCanonical);

  const phpResult = spawnSync(php, [fixture], {
    input: JSON.stringify(vector),
    encoding: "utf8"
  });
  assert.equal(phpResult.status, 0, phpResult.stderr);
  const parsed = JSON.parse(phpResult.stdout);
  assert.equal(parsed.body_hash, nodeBodyHash);
  assert.equal(parsed.canonical, nodeCanonical);
  assert.equal(parsed.signature, nodeSignature);
  assert.equal(parsed.capability, "state.apply");
});

test("canonicalization is deterministic and method path query body differences change signatures", () => {
  const base = signRequest();
  const differentMethod = signRequest({ method: "GET" });
  const differentPath = signRequest({ path: "/wp-json/factory/v1/agent/health" });
  const differentProject = signRequest({ projectSlug: "project-beta" });
  const differentQuery = signRequest({ query: "a=first&z=last&z=again" });
  const differentBody = signRequest({ body: "{\"agency_name\":\"Beta\"}" });

  assert.equal(normalizeRestPath("/wp-json/factory/v1/agent/health"), "/factory/v1/agent/health");
  assert.equal(canonicalizeQuery("?b=2&a=first&a=alpha"), "a=alpha&a=first&b=2");
  assert.notEqual(differentMethod.headers[SIGNED_AUTH_HEADERS.signature], base.headers[SIGNED_AUTH_HEADERS.signature]);
  assert.notEqual(differentPath.headers[SIGNED_AUTH_HEADERS.signature], base.headers[SIGNED_AUTH_HEADERS.signature]);
  assert.notEqual(differentProject.headers[SIGNED_AUTH_HEADERS.signature], base.headers[SIGNED_AUTH_HEADERS.signature]);
  assert.notEqual(differentQuery.headers[SIGNED_AUTH_HEADERS.signature], base.headers[SIGNED_AUTH_HEADERS.signature]);
  assert.notEqual(differentBody.headers[SIGNED_AUTH_HEADERS.signature], base.headers[SIGNED_AUTH_HEADERS.signature]);
});

test("body integrity verifies exact bytes and treats empty body deterministically", () => {
  const context = verify();
  assert.equal(context.auth_type, "factory_agent_signed_request");
  assert.equal(context.capability, "state.apply");
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

  assertRejectsWithCode(() => verify({ body: "{\"agency_name\":\"Changed\"}" }), "signed_auth_body_hash_mismatch");

  const jsonA = "{\"a\":1,\"b\":2}";
  const jsonB = "{\"b\":2,\"a\":1}";
  assert.notEqual(signRequest({ body: jsonA }).headers[SIGNED_AUTH_HEADERS.signature], signRequest({ body: jsonB }).headers[SIGNED_AUTH_HEADERS.signature]);
});

test("timestamp checks reject expired future and malformed requests", () => {
  assert.equal(verify().request_id, FIXED_REQUEST_ID);

  const expired = signRequest({ timestamp: "2026-07-12T11:50:00.000Z" });
  assertRejectsWithCode(() => verify({ headers: expired.headers }), "signed_auth_request_expired");

  const future = signRequest({ timestamp: "2026-07-12T12:01:00.000Z" });
  assertRejectsWithCode(() => verify({ headers: future.headers }), "signed_auth_request_expired");

  const malformed = signRequest();
  malformed.headers[SIGNED_AUTH_HEADERS.timestamp] = "Sunday";
  assertRejectsWithCode(() => verify({ headers: malformed.headers }), "signed_auth_timestamp_invalid");
});

test("replay store accepts first request rejects duplicates and cleans expired entries", () => {
  const replayStore = new MemoryReplayStore();
  assert.equal(verify({ replayStore }).request_id, FIXED_REQUEST_ID);
  assertRejectsWithCode(() => verify({ replayStore }), "signed_auth_replay_detected");

  replayStore.cleanup(FIXED_NOW + 301000);
  const newRequest = signRequest({ requestId: "req-after-cleanup" });
  assert.equal(verify({ headers: newRequest.headers, replayStore }).request_id, "req-after-cleanup");

  const duplicateStore = new MemoryReplayStore();
  const duplicate = signRequest({ requestId: "req-concurrent" });
  const results = [1, 2].map(() => {
    try {
      verify({ headers: duplicate.headers, replayStore: duplicateStore });
      return "accepted";
    } catch (error) {
      return error.code;
    }
  });
  assert.deepEqual(results.sort(), ["accepted", "signed_auth_replay_detected"].sort());
});

test("key status and project binding are enforced", () => {
  assert.equal(verify().project_slug, "project-alpha");
  assertRejectsWithCode(() => verify({ resolveCredential: () => null }), "signed_auth_key_unknown");
  assertRejectsWithCode(() => verify({ resolveCredential: () => credential({ status: "revoked" }) }), "signed_auth_key_revoked");
  assertRejectsWithCode(() => verify({ resolveCredential: () => credential({ status: "disabled" }) }), "signed_auth_key_revoked");
  assertRejectsWithCode(() => verify({ projectSlug: "project-beta" }), "signed_auth_project_mismatch");

  const missingProjectHeader = signRequest();
  delete missingProjectHeader.headers[SIGNED_AUTH_HEADERS.projectSlug];
  assertRejectsWithCode(() => verify({ headers: missingProjectHeader.headers }), "signed_auth_project_required");

  const unboundCredential = credential({ project_slug: "" });
  const unboundSigned = signRequest({ credential: unboundCredential, projectSlug: "" });
  assertRejectsWithCode(() => verify({
    headers: unboundSigned.headers,
    resolveCredential: () => unboundCredential,
    projectSlug: ""
  }), "signed_auth_project_required");

  const copiedKeyWrongProject = credential({ project_slug: "project-beta" });
  const copiedSigned = signRequest({ credential: copiedKeyWrongProject });
  assertRejectsWithCode(() => verify({
    headers: copiedSigned.headers,
    resolveCredential: () => credential(),
    projectSlug: "project-alpha"
  }), "signed_auth_project_mismatch");

  const beta = credential({ key_id: "key-beta", project_slug: "project-beta" });
  const betaSigned = signRequest({ credential: beta });
  assertRejectsWithCode(() => verify({
    headers: betaSigned.headers,
    resolveCredential: () => beta,
    projectSlug: "project-alpha"
  }), "signed_auth_project_mismatch");
});

test("capabilities are route derived and caller cannot claim stronger access", () => {
  const limitedCredential = credential({ capabilities: ["health.read"] });
  const body = JSON.stringify({ capability: "state.apply", operation_type: "state.apply" });
  const signed = signRequest({ credential: limitedCredential, path: "/wp-json/factory/v1/agent/health", method: "GET", query: "", body });
  const context = verifySignedAgentRequest({
    method: "GET",
    path: "/wp-json/factory/v1/agent/health",
    query: "",
    body,
    headers: signed.headers,
    nowMs: FIXED_NOW,
    projectSlug: "project-alpha",
    resolveCredential: () => limitedCredential
  });
  assert.equal(context.capability, "health.read");

  const unsafe = signRequest({ credential: limitedCredential });
  assertRejectsWithCode(() => verify({
    headers: unsafe.headers,
    resolveCredential: () => limitedCredential
  }), "signed_auth_capability_denied");

  const unknown = signRequest({ path: "/wp-json/factory/v1/agent/not-real" });
  assertRejectsWithCode(() => verify({
    path: "/wp-json/factory/v1/agent/not-real",
    headers: unknown.headers
  }), "signed_auth_capability_denied");
});

test("headers and errors are safely redacted", () => {
  const signed = signRequest();
  const duplicated = Object.assign({}, signed.headers, {
    [SIGNED_AUTH_HEADERS.keyId]: ["key-alpha", "key-alpha"]
  });
  assertRejectsWithCode(() => verify({ headers: duplicated }), "signed_auth_header_invalid");

  const missing = Object.assign({}, signed.headers);
  delete missing[SIGNED_AUTH_HEADERS.signature];
  assertRejectsWithCode(() => verify({ headers: missing }), "signed_auth_required");

  const badSignature = Object.assign({}, signed.headers, {
    [SIGNED_AUTH_HEADERS.signature]: "bad-signature"
  });
  assertRejectsWithCode(() => verify({ headers: badSignature }), "signed_auth_signature_invalid");

  const redacted = redactSigningCredential(credential());
  assert.equal(redacted.signing_secret, "[redacted]");
  assert.equal(JSON.stringify(redacted).includes(FIXED_SECRET), false);

  for (const errorCode of ["signed_auth_signature_invalid", "signed_auth_required"]) {
    assert.equal(JSON.stringify({ code: errorCode }).includes(FIXED_SECRET), false);
  }
});

test("legacy boundary remains explicit and signed auth is independent of WordPress auth headers", () => {
  assertRejectsWithCode(() => verify({
    headers: {
      Authorization: "Basic dXNlcjpwYXNz",
      Cookie: "wordpress_logged_in=test",
      "X-WP-Nonce": "nonce"
    }
  }), "signed_auth_required");

  const signed = signRequest();
  const withLegacyNoise = Object.assign({}, signed.headers, {
    Authorization: "Basic dXNlcjpwYXNz",
    Cookie: "wordpress_logged_in=test",
    "X-WP-Nonce": "nonce"
  });
  assert.equal(verify({ headers: withLegacyNoise }).auth_type, "factory_agent_signed_request");
});

test("shared Agent client can attach signed headers without exposing the secret", async () => {
  const received = {};
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      received.method = request.method;
      received.url = request.url;
      received.headers = request.headers;
      received.body = Buffer.concat(chunks).toString("utf8");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const body = "{\"agency_name\":\"Alpha\"}";
    const response = await fetchJsonWithSignedAuth(
      "http://127.0.0.1:" + String(address.port) + "/wp-json/factory/v1/agent/safe-fields/apply?b=2&a=1",
      credential(),
      {
        method: "POST",
        body,
        timestamp: FIXED_TIMESTAMP,
        requestId: "req-client-signed"
      }
    );

    assert.equal(response.json.status, "ok");
    assert.equal(received.method, "POST");
    assert.equal(received.body, body);
    assert.equal(received.headers[SIGNED_AUTH_HEADERS.version], SIGNED_AUTH_VERSION);
    assert.equal(received.headers[SIGNED_AUTH_HEADERS.keyId], "key-alpha");
    assert.equal(received.headers[SIGNED_AUTH_HEADERS.projectSlug], "project-alpha");
    assert.equal(JSON.stringify(received.headers).includes(FIXED_SECRET), false);
    assert.equal(response.signedAuth.requestId, "req-client-signed");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
