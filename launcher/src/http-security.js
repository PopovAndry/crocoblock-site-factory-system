"use strict";

const crypto = require("crypto");
const { URL } = require("url");

const DEFAULT_LAUNCHER_HOST = "127.0.0.1";
const DEFAULT_JSON_BODY_LIMIT_BYTES = 64 * 1024;
const DEFAULT_MUTATION_RATE_LIMIT_MAX = 30;
const DEFAULT_MUTATION_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MUTATION_TOKEN_HEADER_NAME = "X-Factory-Mutation-Token";
const MUTATION_TOKEN_HEADER_LOWER = MUTATION_TOKEN_HEADER_NAME.toLowerCase();
const ALLOWED_LOOPBACK_HOSTNAMES = Object.freeze(["127.0.0.1", "localhost", "[::1]"]);

const ROUTE_INVENTORY = Object.freeze([
  { id: "home", method: "GET", group: "health_static_ui", mutation: false, signature: "/", match: { type: "exact", value: "/" } },
  { id: "ui_styles", method: "GET", group: "health_static_ui", mutation: false, signature: "/assets/styles.css", match: { type: "exact", value: "/assets/styles.css" } },
  { id: "ui_app", method: "GET", group: "health_static_ui", mutation: false, signature: "/assets/app.js", match: { type: "exact", value: "/assets/app.js" } },
  { id: "health", method: "GET", group: "health_static_ui", mutation: false, signature: "/api/health", match: { type: "exact", value: "/api/health" } },
  { id: "session", method: "GET", group: "health_static_ui", mutation: false, signature: "/api/session", match: { type: "exact", value: "/api/session" } },
  { id: "projects_list", method: "GET", group: "read_only", mutation: false, signature: "/api/projects", match: { type: "exact", value: "/api/projects" } },
  { id: "dependency_sources", method: "GET", group: "read_only", mutation: false, signature: "/api/dependency-sources", match: { type: "exact", value: "/api/dependency-sources" } },
  { id: "project_create", method: "POST", group: "mutation", mutation: true, sourceSignature: 'requestUrl.pathname === "/api/projects"', signature: "/api/projects", match: { type: "exact", value: "/api/projects" } },
  { id: "setup_status", method: "GET", group: "read_only", mutation: false, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/setup$/', signature: "/api/projects/:slug/setup", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/setup$/ } },
  { id: "project_provision", method: "POST", group: "mutation", mutation: true, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/provision$/', signature: "/api/projects/:slug/provision", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/provision$/ } },
  { id: "agent_install", method: "POST", group: "mutation", mutation: true, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/install-agent$/', signature: "/api/projects/:slug/install-agent", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/install-agent$/ } },
  { id: "agent_auth_rotate", method: "POST", group: "mutation", mutation: true, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/agent-auth\\/rotate$/', signature: "/api/projects/:slug/agent-auth/rotate", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/agent-auth\/rotate$/ } },
  { id: "agent_auth_revoke", method: "POST", group: "mutation", mutation: true, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/agent-auth\\/revoke$/', signature: "/api/projects/:slug/agent-auth/revoke", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/agent-auth\/revoke$/ } },
  { id: "dependencies_status", method: "GET", group: "read_only", mutation: false, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/dependencies$/', signature: "/api/projects/:slug/dependencies", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/dependencies$/ } },
  { id: "dependency_install", method: "POST", group: "mutation", mutation: true, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/install-dependency$/', signature: "/api/projects/:slug/install-dependency", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/install-dependency$/ } },
  { id: "project_plan", method: "POST", group: "planning_preview", mutation: false, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/plan$/', signature: "/api/projects/:slug/plan", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/plan$/ } },
  { id: "generation_plan", method: "POST", group: "planning_preview", mutation: false, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/generation\\/plan$/', signature: "/api/projects/:slug/generation/plan", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/generation\/plan$/ } },
  { id: "generation_status", method: "GET", group: "read_only", mutation: false, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/generation$/', signature: "/api/projects/:slug/generation", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/generation$/ } },
  { id: "operations_status", method: "GET", group: "read_only", mutation: false, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/operations$/', signature: "/api/projects/:slug/operations", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/operations$/ } },
  { id: "project_generate", method: "POST", group: "mutation", mutation: true, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/generate$/', signature: "/api/projects/:slug/generate", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/generate$/ } },
  { id: "site_status", method: "GET", group: "read_only", mutation: false, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/site$/', signature: "/api/projects/:slug/site", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/site$/ } },
  { id: "site_surface_proof", method: "POST", group: "mutation", mutation: true, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/site\\/surface-proof$/', signature: "/api/projects/:slug/site/surface-proof", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/site\/surface-proof$/ } },
  { id: "state_status", method: "GET", group: "read_only", mutation: false, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/state$/', signature: "/api/projects/:slug/state", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/state$/ } },
  { id: "proof_pack_status", method: "GET", group: "read_only", mutation: false, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/proof-pack$/', signature: "/api/projects/:slug/proof-pack", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/proof-pack$/ } },
  { id: "proof_pack_generate", method: "POST", group: "mutation", mutation: true, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/proof-pack\\/generate$/', signature: "/api/projects/:slug/proof-pack/generate", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/proof-pack\/generate$/ } },
  { id: "state_refresh", method: "POST", group: "mutation", mutation: true, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/state\\/refresh$/', signature: "/api/projects/:slug/state/refresh", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/state\/refresh$/ } },
  { id: "state_plan", method: "POST", group: "planning_preview", mutation: false, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/state\\/plan$/', signature: "/api/projects/:slug/state/plan", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/state\/plan$/ } },
  { id: "state_apply", method: "POST", group: "mutation", mutation: true, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/state\\/apply$/', signature: "/api/projects/:slug/state/apply", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/state\/apply$/ } },
  { id: "state_rollback", method: "POST", group: "mutation", mutation: true, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/state\\/rollback$/', signature: "/api/projects/:slug/state/rollback", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/state\/rollback$/ } },
  { id: "ai_status", method: "GET", group: "read_only", mutation: false, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/ai$/', signature: "/api/projects/:slug/ai", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/ai$/ } },
  { id: "ai_configure", method: "POST", group: "mutation", mutation: true, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/ai\\/configure$/', signature: "/api/projects/:slug/ai/configure", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/ai\/configure$/ } },
  { id: "ai_enable_live", method: "POST", group: "mutation", mutation: true, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/ai\\/enable-live$/', signature: "/api/projects/:slug/ai/enable-live", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/ai\/enable-live$/ } },
  { id: "ai_estimate", method: "POST", group: "mutation", mutation: true, sourceSignature: '/^\\/api\\/projects\\/[^/]+\\/ai\\/estimate$/', signature: "/api/projects/:slug/ai/estimate", match: { type: "regex", value: /^\/api\/projects\/[^/]+\/ai\/estimate$/ } }
]);

function createSecurityError(message, code, statusCode, extras) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.securityBoundary = true;
  if (extras && typeof extras === "object") {
    Object.assign(error, extras);
  }
  return error;
}

function isLoopbackBindHost(host) {
  const safeHost = String(host || "").trim().toLowerCase();
  return safeHost === "127.0.0.1" || safeHost === "localhost" || safeHost === "::1";
}

function firstHeaderValue(headers, headerName) {
  const raw = headers[headerName];
  return Array.isArray(raw) ? raw[0] : raw;
}

function normalizeRemoteAddress(remoteAddress) {
  const value = String(remoteAddress || "").trim();
  if (!value) {
    return "unknown";
  }
  if (value === "::1") {
    return "loopback";
  }
  if (value === "127.0.0.1" || value === "::ffff:127.0.0.1") {
    return "loopback";
  }
  return value;
}

function isLoopbackRemoteAddress(remoteAddress) {
  const normalized = normalizeRemoteAddress(remoteAddress);
  return normalized === "loopback";
}

function parseHostHeader(rawHost) {
  const value = String(rawHost || "").trim();
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL("http://" + value);
    const hostname = parsed.hostname;
    const host = parsed.host;
    return {
      raw: value,
      hostname,
      host,
      port: parsed.port ? Number(parsed.port) : null,
      origin: parsed.origin
    };
  } catch (error) {
    return null;
  }
}

function matchRoute(entry, pathname) {
  if (entry.match.type === "exact") {
    return pathname === entry.match.value;
  }
  return entry.match.value.test(pathname);
}

function classifyLauncherRoute(method, pathname, preflightMethod) {
  const effectiveMethod = String(method || "").toUpperCase() === "OPTIONS"
    ? String(preflightMethod || "").toUpperCase()
    : String(method || "").toUpperCase();
  const safePathname = String(pathname || "");
  return ROUTE_INVENTORY.find((entry) => {
    return entry.method === effectiveMethod && matchRoute(entry, safePathname);
  }) || null;
}

function listLauncherRoutes() {
  return ROUTE_INVENTORY.slice();
}

function listMutationRoutes() {
  return ROUTE_INVENTORY.filter((entry) => entry.mutation);
}

function getCanonicalOriginFromHost(hostHeader) {
  return hostHeader.origin;
}

function sanitizeErrorText(value) {
  let sanitized = String(value || "");
  sanitized = sanitized.replace(/Authorization\s*:[^\r\n]*/gi, "Authorization: [redacted]");
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  sanitized = sanitized.replace(/X-Factory-Mutation-Token\s*:[^\r\n]*/gi, MUTATION_TOKEN_HEADER_NAME + ": [redacted]");
  sanitized = sanitized.replace(/Idempotency-Key\s*:[^\r\n]*/gi, "Idempotency-Key: [redacted]");
  sanitized = sanitized.replace(/[A-Za-z]:\\[^\r\n"]+/g, "[redacted-path]");
  return sanitized;
}

function secureCompareToken(expectedToken, actualToken) {
  const expected = Buffer.from(String(expectedToken || ""), "utf8");
  const actual = Buffer.from(String(actualToken || ""), "utf8");
  if (expected.length === 0 || actual.length === 0 || expected.length !== actual.length) {
    return false;
  }
  return crypto.timingSafeEqual(expected, actual);
}

function createHttpSecurity(options) {
  const host = String(options && options.host || DEFAULT_LAUNCHER_HOST).trim();
  const port = Number(options && options.port || 3847);
  const jsonBodyLimitBytes = Number(options && options.jsonBodyLimitBytes || DEFAULT_JSON_BODY_LIMIT_BYTES);
  const mutationRateLimitMax = Number(options && options.mutationRateLimitMax || DEFAULT_MUTATION_RATE_LIMIT_MAX);
  const mutationRateLimitWindowMs = Number(options && options.mutationRateLimitWindowMs || DEFAULT_MUTATION_RATE_LIMIT_WINDOW_MS);
  const mutationToken = crypto.randomBytes(32).toString("hex");
  const tokenIssuedAt = new Date().toISOString();
  const rateWindowState = new Map();

  function validateHost(request) {
    const hostHeaderValue = firstHeaderValue(request.headers, "host");
    if (!hostHeaderValue) {
      throw createSecurityError(
        "Host header is required.",
        "invalid_host_header",
        400
      );
    }
    const hostHeader = parseHostHeader(hostHeaderValue);
    if (!hostHeader || !hostHeader.hostname) {
      throw createSecurityError(
        "Host header is malformed.",
        "invalid_host_header",
        400
      );
    }
    const normalizedHost = hostHeader.hostname === "::1" ? "[::1]" : hostHeader.hostname;
    if (!ALLOWED_LOOPBACK_HOSTNAMES.includes(normalizedHost)) {
      throw createSecurityError(
        "Host is not allowed for Launcher.",
        "host_not_allowed",
        403
      );
    }
    if (hostHeader.port !== port) {
      throw createSecurityError(
        "Host is not allowed for Launcher.",
        "host_not_allowed",
        403
      );
    }
    return {
      raw: hostHeader.raw,
      hostname: normalizedHost,
      port: hostHeader.port,
      origin: getCanonicalOriginFromHost(hostHeader)
    };
  }

  function validateOrigin(request, hostInfo) {
    const originHeader = firstHeaderValue(request.headers, "origin");
    if (originHeader == null || originHeader === "") {
      return null;
    }
    if (String(originHeader).trim().toLowerCase() === "null") {
      throw createSecurityError(
        "Origin is not allowed for Launcher.",
        "origin_not_allowed",
        403
      );
    }
    let parsedOrigin;
    try {
      parsedOrigin = new URL(String(originHeader));
    } catch (error) {
      throw createSecurityError(
        "Origin is not allowed for Launcher.",
        "origin_not_allowed",
        403
      );
    }
    if (parsedOrigin.origin !== hostInfo.origin) {
      throw createSecurityError(
        "Origin is not allowed for Launcher.",
        "origin_not_allowed",
        403
      );
    }
    return parsedOrigin.origin;
  }

  function getMutationRateKey(request) {
    const remoteKey = normalizeRemoteAddress(request.socket && request.socket.remoteAddress);
    return remoteKey + "::mutation";
  }

  function enforceMutationRateLimit(request) {
    const rateKey = getMutationRateKey(request);
    const now = Date.now();
    const current = rateWindowState.get(rateKey);
    if (!current || now >= current.resetAt) {
      rateWindowState.set(rateKey, {
        count: 1,
        resetAt: now + mutationRateLimitWindowMs
      });
      return null;
    }
    current.count += 1;
    rateWindowState.set(rateKey, current);
    if (current.count > mutationRateLimitMax) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      throw createSecurityError(
        "Too many Launcher mutation requests. Retry later.",
        "mutation_rate_limit_exceeded",
        429,
        {
          retryAfterSeconds
        }
      );
    }
    return null;
  }

  function validateMutationToken(request) {
    const token = firstHeaderValue(request.headers, MUTATION_TOKEN_HEADER_LOWER);
    if (!token || typeof token !== "string") {
      throw createSecurityError(
        "Launcher mutation session token is required.",
        "mutation_session_token_required",
        403
      );
    }
    if (!secureCompareToken(mutationToken, token.trim())) {
      throw createSecurityError(
        "Launcher mutation session token is invalid.",
        "mutation_session_token_invalid",
        403
      );
    }
  }

  function getSessionBootstrap(hostInfo) {
    return {
      body: {
        ok: true,
        launcher_origin: hostInfo.origin,
        mutation_token_header: MUTATION_TOKEN_HEADER_NAME,
        token_issued_at: tokenIssuedAt
      },
      headers: {
        [MUTATION_TOKEN_HEADER_NAME]: mutationToken
      }
    };
  }

  function buildCorsHeaders(origin) {
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key, " + MUTATION_TOKEN_HEADER_NAME,
      "Access-Control-Max-Age": "600",
      Vary: "Origin"
    };
    return headers;
  }

  function handlePreflight(request, response, pathname, hostInfo) {
    const origin = validateOrigin(request, hostInfo);
    const requestMethod = firstHeaderValue(request.headers, "access-control-request-method");
    const targetRoute = classifyLauncherRoute("OPTIONS", pathname, requestMethod);
    if (!origin || !targetRoute) {
      throw createSecurityError(
        "Origin is not allowed for Launcher.",
        "origin_not_allowed",
        403
      );
    }
    response.writeHead(204, buildCorsHeaders(origin));
    response.end();
    return true;
  }

  function enforce(request, response, requestUrl) {
    const preflightMethod = firstHeaderValue(request.headers, "access-control-request-method");
    const route = classifyLauncherRoute(request.method, requestUrl.pathname, preflightMethod);
    const hostInfo = validateHost(request);
    const origin = validateOrigin(request, hostInfo);

    if (String(request.method || "").toUpperCase() === "OPTIONS") {
      return {
        handled: handlePreflight(request, response, requestUrl.pathname, hostInfo)
      };
    }

    if (route && route.mutation) {
      enforceMutationRateLimit(request);
      validateMutationToken(request);
    }

    return {
      handled: false,
      route,
      hostInfo,
      origin
    };
  }

  return {
    host,
    port,
    jsonBodyLimitBytes,
    mutationRateLimitMax,
    mutationRateLimitWindowMs,
    mutationTokenHeaderName: MUTATION_TOKEN_HEADER_NAME,
    enforce,
    getSessionBootstrap,
    sanitizeErrorText,
    listRoutes: listLauncherRoutes,
    listMutationRoutes,
    classifyRoute: classifyLauncherRoute
  };
}

module.exports = {
  ALLOWED_LOOPBACK_HOSTNAMES,
  DEFAULT_JSON_BODY_LIMIT_BYTES,
  DEFAULT_LAUNCHER_HOST,
  DEFAULT_MUTATION_RATE_LIMIT_MAX,
  DEFAULT_MUTATION_RATE_LIMIT_WINDOW_MS,
  MUTATION_TOKEN_HEADER_LOWER,
  MUTATION_TOKEN_HEADER_NAME,
  ROUTE_INVENTORY,
  classifyLauncherRoute,
  createHttpSecurity,
  isLoopbackBindHost,
  isLoopbackRemoteAddress,
  listLauncherRoutes,
  listMutationRoutes,
  sanitizeErrorText
};
