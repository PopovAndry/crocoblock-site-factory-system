"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  classifyLauncherRoute
} = require("../src/http-security");
const {
  createProjectScaffold
} = require("../src/project-store");

let portCounter = 28100;

function createTempProjectsRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-recovery-route-"));
}

function createTempProject(projectsRoot, slug) {
  return createProjectScaffold({
    name: slug,
    slug,
    port: portCounter += 1,
    projectsRoot
  });
}

function rawRequest(baseUrl, requestPath, options) {
  const safeOptions = options || {};
  const targetUrl = new URL(baseUrl + requestPath);
  const method = String(safeOptions.method || "GET").toUpperCase();
  const headers = Object.assign({}, safeOptions.headers || {});
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
    request.end();
  });
}

async function withRecoveryStatusServer(projectsRoot, callback, options) {
  const safeOptions = options || {};
  const readModelPath = require.resolve("../src/recovery-status-read-model");
  const readModel = require(readModelPath);
  const originalGetRecoveryStatus = readModel.getRecoveryStatus;
  if (safeOptions.getRecoveryStatus) {
    readModel.getRecoveryStatus = safeOptions.getRecoveryStatus;
  }
  const serverPath = require.resolve("../src/server");
  delete require.cache[serverPath];
  const { createLauncherServer } = require(serverPath);
  const port = portCounter += 1;
  const server = createLauncherServer({
    host: "127.0.0.1",
    port,
    projectsRoot
  });
  try {
    const listenInfo = await server.listen();
    return await callback({
      baseUrl: "http://127.0.0.1:" + listenInfo.port,
      port: listenInfo.port
    });
  } finally {
    await server.close().catch(() => {});
    readModel.getRecoveryStatus = originalGetRecoveryStatus;
    delete require.cache[serverPath];
  }
}

function countOperationFiles(runtimePath) {
  const operationsDirectory = path.join(runtimePath, "runs", "operations");
  if (!fs.existsSync(operationsDirectory)) {
    return 0;
  }
  return fs.readdirSync(operationsDirectory).filter((entry) => entry.endsWith(".json")).length;
}

function assertNoUnsafeResponse(value) {
  const text = JSON.stringify(value);
  assert.equal(/[A-Za-z]:[\\/]/.test(text), false);
  assert.equal(/(?:password|Bearer|access_token|MYSQL_PASSWORD)/i.test(text), false);
  assert.equal(/(?:proof|manifest\.json|database\.sql|wordpress\.tar|restore-journal\.json)/i.test(text), false);
  assert.equal(/op-\d{4}/i.test(text), false);
}

test("Recovery status route returns a safe read-only status for a valid project", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "route-valid");

  await withRecoveryStatusServer(projectsRoot, async ({ baseUrl, port }) => {
    const response = await rawRequest(baseUrl, "/api/projects/route-valid/recovery/status", {
      headers: {
        Host: "127.0.0.1:" + String(port)
      }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json.schema_version, 1);
    assert.deepEqual(response.json.project, { slug: "route-valid" });
    assert.equal(response.json.availability, "unavailable");
    assertNoUnsafeResponse(response.json);
  });
});

test("Recovery status route returns sanitized not-found and invalid slug errors", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "route-known");

  await withRecoveryStatusServer(projectsRoot, async ({ baseUrl, port }) => {
    const missing = await rawRequest(baseUrl, "/api/projects/missing-project/recovery/status", {
      headers: {
        Host: "127.0.0.1:" + String(port)
      }
    });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json.code, "project_not_found");
    assertNoUnsafeResponse(missing.json);

    const pathSlug = await rawRequest(baseUrl, "/api/projects/C:%5Ctemp/recovery/status", {
      headers: {
        Host: "127.0.0.1:" + String(port)
      }
    });
    assert.equal(pathSlug.statusCode, 400);
    assert.equal(pathSlug.json.code, "invalid_project_slug");
    assertNoUnsafeResponse(pathSlug.json);
  });
});

test("Recovery status route sanitizes read-model failures", async () => {
  const projectsRoot = createTempProjectsRoot();
  createTempProject(projectsRoot, "route-failure");

  await withRecoveryStatusServer(projectsRoot, async ({ baseUrl, port }) => {
    const response = await rawRequest(baseUrl, "/api/projects/route-failure/recovery/status", {
      headers: {
        Host: "127.0.0.1:" + String(port)
      }
    });
    assert.equal(response.statusCode, 500);
    assert.equal(response.json.code, "recovery_status_failed");
    assert.equal(response.text.includes("C:\\secret"), false);
    assertNoUnsafeResponse(response.json);
  }, {
    getRecoveryStatus: () => {
      throw new Error("C:\\secret\\manifest.json password Bearer token");
    }
  });
});

test("Recovery status route does not create operations and is inventoried read-only", async () => {
  const projectsRoot = createTempProjectsRoot();
  const scaffold = createTempProject(projectsRoot, "route-readonly");
  const beforeCount = countOperationFiles(scaffold.project.runtime_path);
  let readModelCalls = 0;

  await withRecoveryStatusServer(projectsRoot, async ({ baseUrl, port }) => {
    const response = await rawRequest(baseUrl, "/api/projects/route-readonly/recovery/status", {
      headers: {
        Host: "127.0.0.1:" + String(port)
      }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(readModelCalls, 1);
  }, {
    getRecoveryStatus: ({ projectSlug }) => {
      readModelCalls += 1;
      return {
        schema_version: 1,
        project: { slug: projectSlug },
        availability: "unavailable",
        protection_status: "not_protected",
        latest_recovery_point: null,
        restore_status: "idle",
        storage_status: "healthy",
        recommended_action: "create_recovery_point",
        warnings: [],
        blockers: [],
        observed_at: "2026-07-17T00:00:00.000Z"
      };
    }
  });

  assert.equal(countOperationFiles(scaffold.project.runtime_path), beforeCount);

  const route = classifyLauncherRoute("GET", "/api/projects/route-readonly/recovery/status");
  assert.ok(route);
  assert.equal(route.id, "recovery_status");
  assert.equal(route.group, "read_only");
  assert.equal(route.mutation, false);
  assert.equal(classifyLauncherRoute("POST", "/api/projects/route-readonly/recovery/status"), null);
});
