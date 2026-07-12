"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  ROUTE_INVENTORY,
  createHttpSecurity,
  listMutationRoutes
} = require("../src/http-security");
const {
  createProjectScaffold,
  readProjectBySlug
} = require("../src/project-store");
const {
  listOperations
} = require("../src/project-operation-store");

let portCounter = 26100;

function createTempProjectsRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-http-security-"));
}

function createTempProject(projectsRoot, slug) {
  return createProjectScaffold({
    name: slug,
    slug,
    port: portCounter += 1,
    projectsRoot
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function writeStatePlan(runtimePath, slug, planId) {
  const planPath = path.join(runtimePath, "state", "plans", planId + ".json");
  writeJson(planPath, {
    schema: "factory_state_plan",
    version: 1,
    plan_id: planId,
    project_slug: slug,
    provider_called: false,
    source: {
      prompt_personalization_source: "local_interpreter"
    },
    current: {
      slug,
      protected_fields: ["hero_title"],
      effective_values: {
        agency_name: "Owner Realty",
        hero_title: "Owner Protected Hero Title"
      }
    },
    proposed: {
      personalization: {
        agency_name: "Security Test Realty"
      }
    },
    diff: {
      field_changes: [
        {
          field_key: "agency_name",
          change_type: "update",
          effective_value: "Security Test Realty",
          included_in_apply: true,
          protected: false
        }
      ]
    },
    field_scope: {
      included_fields: ["agency_name"],
      excluded_fields: ["hero_title"],
      preserved_protected_fields: ["hero_title"],
      requires_confirmation_fields: []
    },
    conflicts: [],
    warnings: [],
    can_apply_without_confirmation: true,
    confirmation_required: null
  });
  return planPath;
}

function rawRequest(baseUrl, requestPath, options) {
  const safeOptions = options || {};
  const targetUrl = new URL(baseUrl + requestPath);
  const method = String(safeOptions.method || "GET").toUpperCase();
  const body = safeOptions.body == null ? null : (Buffer.isBuffer(safeOptions.body) ? safeOptions.body : Buffer.from(String(safeOptions.body), "utf8"));
  const headers = Object.assign({}, safeOptions.headers || {});
  if (body && headers["Content-Length"] == null && headers["content-length"] == null) {
    headers["Content-Length"] = String(body.length);
  }

  return new Promise((resolve, reject) => {
    const request = http.request({
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: Number(targetUrl.port),
      path: targetUrl.pathname + targetUrl.search,
      method,
      headers
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (error) {
          json = null;
        }
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          text,
          json
        });
      });
    });
    request.on("error", reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

async function getSession(baseUrl, headers) {
  const response = await rawRequest(baseUrl, "/api/session", {
    method: "GET",
    headers: headers || {}
  });
  return {
    response,
    token: response.headers["x-factory-mutation-token"] || null
  };
}

async function withPatchedServer(stubs, callback, options) {
  const modulePatches = [
    { path: require.resolve("../src/state"), stubs: stubs.state || {} }
  ];
  const originals = [];

  for (const patch of modulePatches) {
    const target = require(patch.path);
    for (const [key, value] of Object.entries(patch.stubs)) {
      originals.push({ target, key, value: target[key] });
      target[key] = value;
    }
  }

  const serverModulePath = require.resolve("../src/server");
  delete require.cache[serverModulePath];
  const { createLauncherServer } = require(serverModulePath);
  const port = Number(options && options.port || (portCounter += 1));
  const server = createLauncherServer({
    host: "127.0.0.1",
    port,
    projectsRoot: callback.projectsRoot,
    mutationRateLimitMax: options && options.mutationRateLimitMax,
    mutationRateLimitWindowMs: options && options.mutationRateLimitWindowMs
  });

  try {
    const listenInfo = await server.listen();
    return await callback({
      baseUrl: "http://127.0.0.1:" + listenInfo.port,
      listenInfo,
      createLauncherServer
    });
  } finally {
    await server.close().catch(() => {});
    for (const original of originals) {
      original.target[original.key] = original.value;
    }
    delete require.cache[serverModulePath];
  }
}

test("default Launcher bind host remains loopback-only", async () => {
  const projectsRoot = createTempProjectsRoot();
  const { createLauncherServer } = require("../src/server");
  const port = portCounter += 1;
  const server = createLauncherServer({
    port,
    projectsRoot
  });

  try {
    const listenInfo = await server.listen();
    assert.equal(listenInfo.host, "127.0.0.1");
  } finally {
    await server.close().catch(() => {});
  }
});

test("shared route inventory covers every current POST server route and required mutation routes", () => {
  const serverSource = fs.readFileSync(path.resolve(__dirname, "../src/server.js"), "utf8");
  const postRouteSignatures = Array.from(serverSource.matchAll(/request\.method === "POST" && (requestUrl\.pathname === "[^"]+"|\/\^[^/]+\/.*?\$\/\.test\(requestUrl\.pathname\))/g))
    .map((match) => match[1].startsWith("requestUrl.pathname === ")
      ? match[1].replace('requestUrl.pathname === "', "").replace('"', "")
      : match[1].replace(/\.test\(requestUrl\.pathname\)$/, ""));
  const inventoryPostSignatures = ROUTE_INVENTORY
    .filter((entry) => entry.method === "POST")
    .map((entry) => entry.sourceSignature
      ? (entry.sourceSignature.startsWith('requestUrl.pathname === ')
        ? entry.sourceSignature.replace('requestUrl.pathname === "', "").replace('"', "")
        : entry.sourceSignature)
      : entry.signature);

  assert.deepEqual(postRouteSignatures.sort(), inventoryPostSignatures.sort());

  const mutationIds = new Set(listMutationRoutes().map((entry) => entry.id));
  [
    "project_create",
    "project_provision",
    "agent_install",
    "dependency_install",
    "project_generate",
    "state_apply",
    "state_rollback"
  ].forEach((requiredId) => {
    assert.equal(mutationIds.has(requiredId), true, "missing mutation route classification: " + requiredId);
  });
});

test("host validation accepts loopback aliases and rejects arbitrary hosts without trusting X-Forwarded-Host", async () => {
  const projectsRoot = createTempProjectsRoot();

  await withPatchedServer({}, Object.assign(async ({ baseUrl }) => {
    const accepted = await rawRequest(baseUrl, "/api/health", {
      headers: {
        Host: "localhost:" + String(new URL(baseUrl).port)
      }
    });
    assert.equal(accepted.statusCode, 200);

    const xForwardedIgnored = await rawRequest(baseUrl, "/api/health", {
      headers: {
        Host: "127.0.0.1:" + String(new URL(baseUrl).port),
        "X-Forwarded-Host": "evil.example"
      }
    });
    assert.equal(xForwardedIgnored.statusCode, 200);

    const rejectedHost = await rawRequest(baseUrl, "/api/health", {
      headers: {
        Host: "evil.example:" + String(new URL(baseUrl).port)
      }
    });
    assert.equal(rejectedHost.statusCode, 403);
    assert.equal(rejectedHost.json.code, "host_not_allowed");

    const rejectedLanHost = await rawRequest(baseUrl, "/api/health", {
      headers: {
        Host: "192.168.0.20:" + String(new URL(baseUrl).port),
        "X-Forwarded-Host": "127.0.0.1:" + String(new URL(baseUrl).port)
      }
    });
    assert.equal(rejectedLanHost.statusCode, 403);
    assert.equal(rejectedLanHost.json.code, "host_not_allowed");
  }, { projectsRoot }));
});

test("origin policy and preflight stay exact-same-origin without wildcard CORS", async () => {
  const projectsRoot = createTempProjectsRoot();
  const scaffold = createTempProject(projectsRoot, "origin-guard");
  let refreshExecutions = 0;

  await withPatchedServer({
    state: {
      refreshState: async ({ slug }) => {
        refreshExecutions += 1;
        return {
          project: readProjectBySlug(slug, projectsRoot).project,
          statePath: path.join(scaffold.project.runtime_path, "state", "current.json"),
          snapshotPath: path.join(scaffold.project.runtime_path, "state", "snapshots", "snapshot.json"),
          proofPath: path.join(scaffold.project.runtime_path, "proofs", "state-refresh.json"),
          summary: {},
          state: { effective_safe_fields: null, warnings: [] }
        };
      }
    }
  }, Object.assign(async ({ baseUrl }) => {
    const session = await getSession(baseUrl);
    assert.ok(session.token);

    const sameOrigin = await rawRequest(baseUrl, "/api/projects/origin-guard/state/refresh", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:" + String(new URL(baseUrl).port),
        Origin: baseUrl,
        "Content-Type": "application/json",
        "X-Factory-Mutation-Token": session.token
      },
      body: "{}"
    });
    assert.equal(sameOrigin.statusCode, 200);
    assert.equal(refreshExecutions, 1);

    const foreignOrigin = await rawRequest(baseUrl, "/api/projects/origin-guard/state/refresh", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:" + String(new URL(baseUrl).port),
        Origin: "http://evil.local:3847",
        "Content-Type": "application/json",
        "X-Factory-Mutation-Token": session.token
      },
      body: "{}"
    });
    assert.equal(foreignOrigin.statusCode, 403);
    assert.equal(foreignOrigin.json.code, "origin_not_allowed");
    assert.equal(refreshExecutions, 1);

    const nullOrigin = await rawRequest(baseUrl, "/api/projects/origin-guard/state/refresh", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:" + String(new URL(baseUrl).port),
        Origin: "null",
        "Content-Type": "application/json",
        "X-Factory-Mutation-Token": session.token
      },
      body: "{}"
    });
    assert.equal(nullOrigin.statusCode, 403);
    assert.equal(nullOrigin.json.code, "origin_not_allowed");

    const mismatchedPort = await rawRequest(baseUrl, "/api/projects/origin-guard/state/refresh", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:" + String(new URL(baseUrl).port),
        Origin: "http://127.0.0.1:3999",
        "Content-Type": "application/json",
        "X-Factory-Mutation-Token": session.token
      },
      body: "{}"
    });
    assert.equal(mismatchedPort.statusCode, 403);
    assert.equal(mismatchedPort.json.code, "origin_not_allowed");

    const disallowedPreflight = await rawRequest(baseUrl, "/api/projects/origin-guard/state/refresh", {
      method: "OPTIONS",
      headers: {
        Host: "127.0.0.1:" + String(new URL(baseUrl).port),
        Origin: "http://evil.local:3847",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type, X-Factory-Mutation-Token"
      }
    });
    assert.equal(disallowedPreflight.statusCode, 403);
    assert.equal(disallowedPreflight.headers["access-control-allow-origin"], undefined);
  }, { projectsRoot }));
});

test("mutation session token gate reaches canonical state apply flow and rejected requests create zero operations", async () => {
  const projectsRoot = createTempProjectsRoot();
  const scaffold = createTempProject(projectsRoot, "token-guard");
  const runtimePath = scaffold.project.runtime_path;
  const planId = "state-plan-2026-07-12T18-00-00-000Z-token-guard";
  let applyExecutions = 0;
  writeStatePlan(runtimePath, "token-guard", planId);

  await withPatchedServer({
    state: {
      applyStatePlan: async ({ slug }) => {
        applyExecutions += 1;
        return {
          project: readProjectBySlug(slug, projectsRoot).project,
          status: "ok",
          code: "state_plan_applied",
          proofPath: path.join(runtimePath, "proofs", "state-apply-token-guard.json"),
          statePath: path.join(runtimePath, "state", "current.json"),
          apply: {
            apply_id: "state-apply-token-guard-1",
            plan_id: planId,
            apply_method: "field_only_safe_apply",
            applied_fields: ["agency_name"],
            ignored_fields: [],
            warnings: []
          }
        };
      }
    }
  }, Object.assign(async ({ baseUrl }) => {
    const session = await getSession(baseUrl);
    assert.ok(session.token);
    assert.equal(typeof session.response.json["X-Factory-Mutation-Token"], "undefined");

    const validApply = await rawRequest(baseUrl, "/api/projects/token-guard/state/apply", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:" + String(new URL(baseUrl).port),
        Origin: baseUrl,
        "Content-Type": "application/json",
        "Idempotency-Key": "state-apply-token-guard-0001",
        "X-Factory-Mutation-Token": session.token
      },
      body: JSON.stringify({
        plan_id: planId,
        confirm_apply: true
      })
    });
    assert.equal(validApply.statusCode, 200);
    assert.equal(validApply.json.code, "state_plan_applied");
    assert.equal(applyExecutions, 1);
    assert.equal(listOperations({ slug: "token-guard", projectsRoot }).filter((entry) => entry.operation_type === "state_apply").length, 1);

    const runtimeText = fs.readFileSync(path.join(runtimePath, "runs", "operations", validApply.json.operation.operation_id + ".json"), "utf8");
    assert.equal(runtimeText.includes(session.token), false);
    assert.equal(runtimeText.includes("state-apply-token-guard-0001"), false);

    const wrongTokenProject = createTempProject(projectsRoot, "token-guard-wrong");
    const wrongRuntimePath = wrongTokenProject.project.runtime_path;
    const wrongPlanId = "state-plan-2026-07-12T18-00-00-000Z-token-guard-wrong";
    writeStatePlan(wrongRuntimePath, "token-guard-wrong", wrongPlanId);

    const wrongToken = await rawRequest(baseUrl, "/api/projects/token-guard-wrong/state/apply", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:" + String(new URL(baseUrl).port),
        Origin: baseUrl,
        "Content-Type": "application/json",
        "X-Factory-Mutation-Token": "wrong-token"
      },
      body: JSON.stringify({
        plan_id: wrongPlanId,
        confirm_apply: true
      })
    });
    assert.equal(wrongToken.statusCode, 403);
    assert.equal(wrongToken.json.code, "mutation_session_token_invalid");
    assert.equal(listOperations({ slug: "token-guard-wrong", projectsRoot }).length, 0);

    const missingTokenProject = createTempProject(projectsRoot, "token-guard-missing");
    const missingRuntimePath = missingTokenProject.project.runtime_path;
    const missingPlanId = "state-plan-2026-07-12T18-00-00-000Z-token-guard-missing";
    writeStatePlan(missingRuntimePath, "token-guard-missing", missingPlanId);

    const missingToken = await rawRequest(baseUrl, "/api/projects/token-guard-missing/state/apply", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:" + String(new URL(baseUrl).port),
        Origin: baseUrl,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        plan_id: missingPlanId,
        confirm_apply: true
      })
    });
    assert.equal(missingToken.statusCode, 403);
    assert.equal(missingToken.json.code, "mutation_session_token_required");
    assert.equal(listOperations({ slug: "token-guard-missing", projectsRoot }).length, 0);

    const badOriginProject = createTempProject(projectsRoot, "token-guard-origin");
    const badOriginRuntimePath = badOriginProject.project.runtime_path;
    const badOriginPlanId = "state-plan-2026-07-12T18-00-00-000Z-token-guard-origin";
    writeStatePlan(badOriginRuntimePath, "token-guard-origin", badOriginPlanId);

    const badOrigin = await rawRequest(baseUrl, "/api/projects/token-guard-origin/state/apply", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:" + String(new URL(baseUrl).port),
        Origin: "http://evil.local:3847",
        "Content-Type": "application/json",
        "X-Factory-Mutation-Token": session.token
      },
      body: JSON.stringify({
        plan_id: badOriginPlanId,
        confirm_apply: true
      })
    });
    assert.equal(badOrigin.statusCode, 403);
    assert.equal(badOrigin.json.code, "origin_not_allowed");
    assert.equal(listOperations({ slug: "token-guard-origin", projectsRoot }).length, 0);
  }, { projectsRoot }));
});

test("token rotates on restart and old token is rejected", async () => {
  const projectsRoot = createTempProjectsRoot();
  const scaffold = createTempProject(projectsRoot, "restart-rotation");
  let port = portCounter += 1;
  let refreshExecutions = 0;

  async function startServer() {
    const { createLauncherServer } = require("../src/server");
    const server = createLauncherServer({
      host: "127.0.0.1",
      port,
      projectsRoot
    });
    await server.listen();
    return server;
  }

  const stateModulePath = require.resolve("../src/state");
  const stateModule = require(stateModulePath);
  const originalRefreshState = stateModule.refreshState;
  stateModule.refreshState = async ({ slug }) => {
    refreshExecutions += 1;
    return {
      project: readProjectBySlug(slug, projectsRoot).project,
      statePath: path.join(scaffold.project.runtime_path, "state", "current.json"),
      snapshotPath: path.join(scaffold.project.runtime_path, "state", "snapshots", "snapshot.json"),
      proofPath: path.join(scaffold.project.runtime_path, "proofs", "restart-refresh.json"),
      summary: {},
      state: { effective_safe_fields: null, warnings: [] }
    };
  };

  let server = null;
  try {
    server = await startServer();
    const baseUrl = "http://127.0.0.1:" + port;
    const firstSession = await getSession(baseUrl);
    assert.ok(firstSession.token);
    await server.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    delete require.cache[require.resolve("../src/server")];
    server = await startServer();
    const secondSession = await getSession(baseUrl);
    assert.ok(secondSession.token);
    assert.notEqual(firstSession.token, secondSession.token);

    const oldTokenAttempt = await rawRequest(baseUrl, "/api/projects/restart-rotation/state/refresh", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:" + String(port),
        Connection: "close",
        Origin: baseUrl,
        "Content-Type": "application/json",
        "X-Factory-Mutation-Token": firstSession.token
      },
      body: "{}"
    });
    assert.equal(oldTokenAttempt.statusCode, 403);
    assert.equal(oldTokenAttempt.json.code, "mutation_session_token_invalid");
    assert.equal(refreshExecutions, 0);

    const newTokenAttempt = await rawRequest(baseUrl, "/api/projects/restart-rotation/state/refresh", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:" + String(port),
        Connection: "close",
        Origin: baseUrl,
        "Content-Type": "application/json",
        "X-Factory-Mutation-Token": secondSession.token
      },
      body: "{}"
    });
    assert.equal(newTokenAttempt.statusCode, 200);
    assert.equal(refreshExecutions, 1);
  } finally {
    if (server) {
      await server.close().catch(() => {});
    }
    stateModule.refreshState = originalRefreshState;
    delete require.cache[require.resolve("../src/server")];
  }
});

test("body limit, malformed json, rate limiting, and security errors stay controlled", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "guarded-refresh");
  let refreshExecutions = 0;

  await withPatchedServer({
    state: {
      refreshState: async ({ slug }) => {
        refreshExecutions += 1;
        return {
          project: readProjectBySlug(slug, projectsRoot).project,
          statePath: path.join(projectsRoot, slug, "state", "current.json"),
          snapshotPath: path.join(projectsRoot, slug, "state", "snapshots", "snapshot.json"),
          proofPath: path.join(projectsRoot, slug, "proofs", "state-refresh.json"),
          summary: {},
          state: { effective_safe_fields: null, warnings: [] }
        };
      }
    }
  }, Object.assign(async ({ baseUrl }) => {
    const session = await getSession(baseUrl);
    assert.ok(session.token);

    const valid = await rawRequest(baseUrl, "/api/projects/guarded-refresh/state/refresh", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:" + String(new URL(baseUrl).port),
        Origin: baseUrl,
        "Content-Type": "application/json",
        "X-Factory-Mutation-Token": session.token
      },
      body: "{}"
    });
    assert.equal(valid.statusCode, 200);
    assert.equal(refreshExecutions, 1);

    const oversized = await rawRequest(baseUrl, "/api/projects/guarded-refresh/state/refresh", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:" + String(new URL(baseUrl).port),
        Origin: baseUrl,
        "Content-Type": "application/json",
        "X-Factory-Mutation-Token": session.token
      },
      body: '{"padding":"' + "x".repeat(70 * 1024) + '"}'
    });
    assert.equal(oversized.statusCode, 413);
    assert.equal(oversized.json.code, "request_body_too_large");
    assert.equal(refreshExecutions, 1);

    const malformed = await rawRequest(baseUrl, "/api/projects/guarded-refresh/state/refresh", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:" + String(new URL(baseUrl).port),
        Origin: baseUrl,
        "Content-Type": "application/json",
        "X-Factory-Mutation-Token": session.token
      },
      body: '{"broken":'
    });
    assert.equal(malformed.statusCode, 400);
    assert.equal(malformed.json.code, "request_json_invalid");
    assert.equal(refreshExecutions, 1);

    const leakedValues = JSON.stringify(malformed.json);
    assert.equal(/Authorization|Bearer|X-Factory-Mutation-Token|Idempotency-Key|[A-Za-z]:\\/.test(leakedValues), false);
  }, {
    projectsRoot,
    mutationRateLimitMax: 2,
    mutationRateLimitWindowMs: 120
  }));

  refreshExecutions = 0;

  await withPatchedServer({
    state: {
      refreshState: async ({ slug }) => {
        refreshExecutions += 1;
        return {
          project: readProjectBySlug(slug, projectsRoot).project,
          statePath: path.join(projectsRoot, slug, "state", "current.json"),
          snapshotPath: path.join(projectsRoot, slug, "state", "snapshots", "snapshot.json"),
          proofPath: path.join(projectsRoot, slug, "proofs", "state-refresh.json"),
          summary: {},
          state: { effective_safe_fields: null, warnings: [] }
        };
      }
    }
  }, Object.assign(async ({ baseUrl }) => {
    const session = await getSession(baseUrl);
    const attempts = [];
    for (let index = 0; index < 31; index += 1) {
      attempts.push(await rawRequest(baseUrl, "/api/projects/guarded-refresh/state/refresh", {
        method: "POST",
        headers: {
          Host: "127.0.0.1:" + String(new URL(baseUrl).port),
          Connection: "close",
          Origin: baseUrl,
          "Content-Type": "application/json",
          "X-Factory-Mutation-Token": session.token
        },
        body: "{}"
      }));
    }

    assert.equal(attempts[0].statusCode, 200);
    assert.equal(attempts[29].statusCode, 200);
    assert.equal(attempts[30].statusCode, 429);
    assert.equal(attempts[30].json.code, "mutation_rate_limit_exceeded");
    assert.ok(attempts[30].headers["retry-after"]);
    assert.equal(refreshExecutions, 30);
  }, {
    projectsRoot
  }));
});

test("mutation rate limiter resets deterministically after the configured window", async () => {
  const security = createHttpSecurity({
    host: "127.0.0.1",
    port: 3847,
    mutationRateLimitMax: 1,
    mutationRateLimitWindowMs: 50
  });
  const response = { writeHead() {}, end() {} };
  const requestUrl = new URL("http://127.0.0.1:3847/api/projects/test/state/refresh");
  function makeRequest() {
    return {
      method: "POST",
      headers: {
        host: "127.0.0.1:3847",
        origin: "http://127.0.0.1:3847",
        "x-factory-mutation-token": security.getSessionBootstrap({ origin: "http://127.0.0.1:3847" }).headers["X-Factory-Mutation-Token"]
      },
      socket: {
        remoteAddress: "127.0.0.1"
      }
    };
  }

  assert.doesNotThrow(() => security.enforce(makeRequest(), response, requestUrl));
  assert.throws(() => security.enforce(makeRequest(), response, requestUrl), (error) => error.code === "mutation_rate_limit_exceeded");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.doesNotThrow(() => security.enforce(makeRequest(), response, requestUrl));
});
