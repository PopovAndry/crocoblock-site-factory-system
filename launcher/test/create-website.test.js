"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const {
  assertSystemCheckReady,
  buildCreateWebsitePrompt,
  buildProgress,
  canBindPort,
  DOCKER_INSPECT_BATCH_SIZE,
  executeCreateWebsiteWorkflow,
  findAvailableProjectPort,
  getCreateWebsiteStatus,
  isUnsupportedIpv6Error,
  readDockerPublishedHostPorts,
  startCreateWebsite,
  validateCreateWebsiteRequest
} = require("../src/create-website");
const {
  PROJECT_STORE_LOCK_DIRECTORY,
  createProjectScaffold,
  listProjects,
  readProjectBySlug,
  saveProjectRecord
} = require("../src/project-store");
const { buildPlanningContextFromPersonalization, buildStructuredPersonalization } = require("../src/prompt-personalization");

function validRequest(overrides) {
  return Object.assign({
    profile: "real-estate",
    project_name: "Kyiv Realty CEO Demo",
    agency_name: "Kyiv Realty",
    city: "Kyiv",
    phone: "+380 44 555 01 01",
    email: "hello@kyivrealty.example"
  }, overrides || {});
}

function readySystemCheck() {
  return { state: "PASS", checks: [] };
}

function temporaryProjectsRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-create-website-"));
}

function dockerInspectRecord(id, configured, current) {
  return {
    Id: id.padEnd(64, id[0]),
    HostConfig: { PortBindings: configured === undefined ? {} : configured },
    NetworkSettings: { Ports: current === undefined ? {} : current }
  };
}

function dockerInventoryRunner(ids, records) {
  const calls = [];
  return {
    calls,
    spawnSync(executable, args, options) {
      calls.push({ executable, args, options });
      if (args[0] === "ps") {
        return { status: 0, stdout: ids.join("\n"), stderr: "" };
      }
      const requestedIds = args.slice(3);
      const batchRecords = records.filter((record) => {
        return record && typeof record.Id === "string"
          && requestedIds.some((id) => record.Id.toLowerCase().startsWith(id.toLowerCase()));
      });
      return { status: 0, stdout: JSON.stringify(batchRecords), stderr: "" };
    }
  };
}

const PROJECT_STORE_CHILD_SCRIPT = String.raw`
const payload = JSON.parse(process.argv[1]);
const { createProjectScaffold, readProjectBySlug, saveProjectRecord } = require(payload.modulePath);
process.once("message", (message) => {
  if (message !== "go") process.exit(3);
  let result;
  try {
    const specification = payload.specification;
    if (specification.action === "save") {
      const state = readProjectBySlug(specification.slug, specification.projectsRoot);
      const previousPort = state.project.wp_port;
      state.project.wp_port = specification.port;
      const updated = saveProjectRecord(state, state.project);
      result = { ok: true, action: "save", slug: state.project.slug, port: state.project.wp_port, previousPort, updated };
    } else {
      const options = specification.options || specification;
      const created = createProjectScaffold(options);
      result = { ok: true, action: "create", slug: created.project.slug, port: created.project.wp_port };
    }
  } catch (error) {
    result = {
      ok: false,
      code: error && error.code || null,
      statusCode: error && error.statusCode || null,
      message: String(error && error.message || "")
    };
  }
  process.send({ type: "result", result }, () => process.exit(0));
});
process.send({ type: "ready" });
`;

async function runScaffoldChildren(specifications) {
  const modulePath = path.resolve(__dirname, "../src/project-store.js");
  const launched = specifications.map((specification) => {
    const child = spawn(process.execPath, ["-e", PROJECT_STORE_CHILD_SCRIPT, JSON.stringify({ modulePath, specification })], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    let readyResolve;
    let resultResolve;
    let reject;
    let exitResolve;
    let exitReject;
    const ready = new Promise((resolve, rejectPromise) => { readyResolve = resolve; reject = rejectPromise; });
    const result = new Promise((resolve) => { resultResolve = resolve; });
    const exited = new Promise((resolve, rejectPromise) => { exitResolve = resolve; exitReject = rejectPromise; });
    child.on("message", (message) => {
      if (message && message.type === "ready") readyResolve();
      if (message && message.type === "result") resultResolve(message.result);
    });
    child.once("error", (error) => { reject(error); exitReject(error); });
    child.once("exit", (code) => {
      if (code === 0) {
        exitResolve();
      } else {
        const error = new Error("scaffold child failed: " + String(code) + " " + stderr.slice(0, 200));
        reject(error);
        exitReject(error);
      }
    });
    return { child, ready, result, exited };
  });
  let timeout;
  try {
    await Promise.race([
      Promise.all(launched.map((entry) => entry.ready)),
      new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error("scaffold child barrier timed out")), 10000); })
    ]);
    clearTimeout(timeout);
    for (const entry of launched) entry.child.send("go");
    const results = await Promise.race([
      Promise.all(launched.map((entry) => entry.result)),
      new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error("scaffold child result timed out")), 10000); })
    ]);
    clearTimeout(timeout);
    await Promise.race([
      Promise.all(launched.map((entry) => entry.exited)),
      new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error("scaffold child exit timed out")), 10000); })
    ]);
    clearTimeout(timeout);
    return results;
  } finally {
    clearTimeout(timeout);
    for (const entry of launched) {
      if (entry.child.exitCode === null) entry.child.kill();
    }
  }
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function snapshotTree(rootPath) {
  const rows = [];
  function visit(currentPath, relativePath) {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(currentPath, entry.name);
      const entryRelativePath = path.join(relativePath, entry.name);
      if (entry.isDirectory()) {
        rows.push(["directory", entryRelativePath]);
        visit(entryPath, entryRelativePath);
      } else {
        rows.push(["file", entryRelativePath, sha256File(entryPath)]);
      }
    }
  }
  visit(rootPath, "");
  return rows;
}

function manifestTempFiles(runtimePath) {
  return fs.readdirSync(runtimePath).filter((name) => name.startsWith(".factory-project.json.") && name.endsWith(".tmp"));
}

function assertSanitizedStoreError(error, code) {
  assert.equal(error.code, code);
  assert.equal(error.statusCode, 409);
  assert.doesNotMatch(String(error.message), /factory-project|\.lock|owner\.json|pid|token|EEXIST|ENOENT|EPERM|JSON|[A-Z]:\\/i);
  return true;
}

function connectToListener(port, host) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host });
    socket.once("connect", () => socket.end());
    socket.once("close", resolve);
    socket.once("error", reject);
  });
}

function closeListener(listener) {
  if (!listener || !listener.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
}

function scaffold(projectsRoot, slug) {
  const result = createProjectScaffold({
    name: "Workflow Test",
    slug,
    port: 47000 + Math.floor(Math.random() * 1000),
    projectsRoot
  });
  const state = readProjectBySlug(slug, projectsRoot);
  state.project.create_website = {
    schema: "factory_create_website",
    version: 1,
    status: "requested",
    operation_id: "op-test",
    business: validRequest()
  };
  saveProjectRecord(state, state.project);
  return result;
}

test("structured Create Website request normalizes supported customer values", () => {
  const result = validateCreateWebsiteRequest(validRequest({
    project_name: "  Kyiv   Realty CEO Demo  ",
    email: "HELLO@KYIVREALTY.EXAMPLE"
  }));
  assert.equal(result.project_name, "Kyiv Realty CEO Demo");
  assert.equal(result.phone, "+380 44 555 01 01");
  assert.equal(result.email, "hello@kyivrealty.example");
});

test("Create Website rejects required, bounded, email, path, profile, and browser-owned technical fields", () => {
  const cases = [
    [validRequest({ agency_name: "" }), "create_website_invalid_request"],
    [validRequest({ city: "x".repeat(81) }), "create_website_invalid_request"],
    [validRequest({ email: "invalid" }), "create_website_invalid_request"],
    [validRequest({ project_name: "C:\\sites\\demo" }), "create_website_unsafe_project_name"],
    [validRequest({ profile: "future-vertical" }), "create_website_unknown_profile"],
    [Object.assign(validRequest(), { project_root: "C:\\sites" }), "create_website_unknown_fields"],
    [Object.assign(validRequest(), { port: 8120 }), "create_website_unknown_fields"],
    [Object.assign(validRequest(), { host_port: 8120 }), "create_website_unknown_fields"],
    [Object.assign(validRequest(), { docker_port: 8120 }), "create_website_unknown_fields"],
    [Object.assign(validRequest(), { compose_port: 8120 }), "create_website_unknown_fields"],
    [Object.assign(validRequest(), { package_path: "C:\\vendor\\jet-engine.zip" }), "create_website_unknown_fields"],
    [Object.assign(validRequest(), { command: "docker compose up" }), "create_website_unknown_fields"],
    [Object.assign(validRequest(), { agent_secret: "hidden" }), "create_website_unknown_fields"]
  ];
  for (const [payload, code] of cases) {
    assert.throws(() => validateCreateWebsiteRequest(payload), (error) => error.code === code);
  }
});

test("local port probe covers IPv4, IPv6-only, and dual-stack listeners fail closed", async (t) => {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => listener.close(resolve)));
  assert.equal(await canBindPort(listener.address().port), false);

  const hosts = [];
  const available = await canBindPort(48100, {
    async probeAddress(port, host, probeOptions) {
      hosts.push([port, host, probeOptions.ipv6Only]);
      return !host.includes(":")
        ? { available: true, unsupported: false }
        : { available: false, unsupported: true };
    }
  });
  assert.equal(available, true);
  assert.deepEqual(hosts, [
    [48100, "127.0.0.1", false],
    [48100, "0.0.0.0", false],
    [48100, "::1", true],
    [48100, "::", true],
    [48100, "::", false]
  ]);
  assert.equal(isUnsupportedIpv6Error("::1", { code: "EAFNOSUPPORT" }), true);
  assert.equal(isUnsupportedIpv6Error("::", { code: "EADDRNOTAVAIL" }), true);
  assert.equal(isUnsupportedIpv6Error("::1", { code: "EADDRINUSE" }), false);
  assert.equal(isUnsupportedIpv6Error("127.0.0.1", { code: "EAFNOSUPPORT" }), false);

  const blocked = await canBindPort(48101, {
    async probeAddress(port, host) {
      return host === "::1"
        ? { available: false, unsupported: false }
        : { available: true, unsupported: false };
    }
  });
  assert.equal(blocked, false);

  const dualStackChecks = [];
  const dualStackBlocked = await canBindPort(48102, {
    async probeAddress(port, host, probeOptions) {
      dualStackChecks.push([host, probeOptions.ipv6Only]);
      return host === "::" && probeOptions.ipv6Only === false
        ? { available: false, unsupported: false }
        : { available: true, unsupported: false };
    }
  });
  assert.equal(dualStackBlocked, false);
  assert.deepEqual(dualStackChecks.at(-1), ["::", false]);

  const unexpectedFailure = await canBindPort(48103, {
    async probeAddress(port, host, probeOptions) {
      if (host === "::" && probeOptions.ipv6Only === false) {
        throw new Error("unexpected probe failure");
      }
      return { available: true, unsupported: false };
    }
  });
  assert.equal(unexpectedFailure, false);
});

test("real dual-stack listener is occupied for IPv6 and IPv4, skipped, closed, and reusable", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  const listener = net.createServer((socket) => socket.end());
  let port = null;
  let listenerClosed = false;
  console.log("DUAL_STACK_PROOF_ROOT=" + projectsRoot);
  try {
    try {
      await new Promise((resolve, reject) => {
        listener.once("error", reject);
        listener.listen({ port: 0, host: "::", ipv6Only: false, exclusive: true }, resolve);
      });
    } catch (error) {
      t.skip("dual-stack listener unavailable: " + String(error && error.code || error && error.message || "unknown"));
      return;
    }
    port = listener.address().port;
    console.log("DUAL_STACK_PROOF_PORT=" + String(port));
    try {
      await connectToListener(port, "::1");
      await connectToListener(port, "127.0.0.1");
    } catch (error) {
      t.skip("dual-stack connections unavailable: " + String(error && error.code || error && error.message || "unknown"));
      return;
    }
    assert.equal(await canBindPort(port), false);
    if (port < 65535) {
      const selected = await findAvailableProjectPort(projectsRoot, {
        firstPort: port,
        readDockerPublishedHostPorts() { return new Set(); }
      });
      assert.notEqual(selected, port);
      assert.ok(selected > port);
    } else {
      await assert.rejects(findAvailableProjectPort(projectsRoot, {
        firstPort: port,
        readDockerPublishedHostPorts() { return new Set(); }
      }), (error) => error.code === "create_website_port_unavailable");
    }
  } finally {
    await closeListener(listener);
    listenerClosed = !listener.listening;
    fs.rmSync(projectsRoot, { recursive: true, force: true });
    console.log("DUAL_STACK_PROOF_CLEANED=" + String(listenerClosed && !fs.existsSync(projectsRoot)));
  }
  assert.equal(listenerClosed, true);
  assert.equal(fs.existsSync(projectsRoot), false);
  assert.equal(await canBindPort(port), true);
  console.log("DUAL_STACK_PROOF_REUSABLE=true");
});

test("Docker reader unions configured and current TCP bindings for running and stopped containers", () => {
  const ids = ["a".repeat(12), "b".repeat(12), "c".repeat(12)];
  const inventory = dockerInventoryRunner(ids, [
    dockerInspectRecord(ids[0], {
      "80/tcp": [
        { HostIp: "", HostPort: "8120" },
        { HostIp: "0.0.0.0", HostPort: "8120" },
        { HostIp: "::", HostPort: "8121" }
      ],
      "443/tcp": [
        { HostIp: "127.0.0.1", HostPort: "8122" },
        { HostIp: "2001:db8::20", HostPort: "8123" }
      ],
      "8080/tcp": null,
      "8081/tcp": [{ HostIp: "", HostPort: "" }],
      "53/udp": [{ HostIp: "", HostPort: "9999" }]
    }, {
      "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8120" }],
      "8080/tcp": null
    }),
    dockerInspectRecord(ids[1], {
      "80/tcp": [{ HostIp: "", HostPort: "8146" }]
    }, null),
    dockerInspectRecord(ids[2], {
      "80/tcp": [{ HostIp: "", HostPort: "" }]
    }, {
      "80/tcp": [
        { HostIp: "0.0.0.0", HostPort: "8124" },
        { HostIp: "::", HostPort: "8124" }
      ]
    })
  ]);
  const ports = readDockerPublishedHostPorts({ spawnSync: inventory.spawnSync });
  assert.deepEqual(Array.from(ports).sort((left, right) => left - right), [8120, 8121, 8122, 8123, 8124, 8146]);
  assert.equal(ports.has(80), false);
  assert.equal(ports.has(9999), false);
  assert.equal(inventory.calls.length, 2);
  assert.deepEqual(inventory.calls[0].args, ["ps", "--all", "--quiet"]);
  assert.deepEqual(inventory.calls[1].args, ["inspect", "--type", "container", ...ids]);
  for (const call of inventory.calls) {
    assert.equal(call.executable, "docker");
    assert.equal(call.options.shell, false);
    assert.equal(call.options.timeout, 10000);
    assert.equal(call.options.maxBuffer, 1024 * 1024);
  }
});

test("Docker reader returns an empty set without inspect when no containers exist", () => {
  const inventory = dockerInventoryRunner([], []);
  assert.deepEqual(Array.from(readDockerPublishedHostPorts({ spawnSync: inventory.spawnSync })), []);
  assert.equal(inventory.calls.length, 1);
  assert.deepEqual(inventory.calls[0].args, ["ps", "--all", "--quiet"]);
});

test("Docker inspect batching covers below, exact, above, and three-batch inventory sizes", () => {
  for (const count of [5, DOCKER_INSPECT_BATCH_SIZE, DOCKER_INSPECT_BATCH_SIZE + 1, DOCKER_INSPECT_BATCH_SIZE * 2 + 1]) {
    const ids = Array.from({ length: count }, (value, index) => (index + 1).toString(16).padStart(12, "0"));
    const records = ids.map((id, index) => dockerInspectRecord(id, {
      "80/tcp": [{ HostIp: "", HostPort: String(10000 + index) }]
    }, {
      "80/tcp": [{ HostIp: "0.0.0.0", HostPort: String(11000 + index) }]
    }));
    const inventory = dockerInventoryRunner(ids, records);
    const ports = readDockerPublishedHostPorts({ spawnSync: inventory.spawnSync });
    const expected = records.flatMap((record) => [
      Number(record.HostConfig.PortBindings["80/tcp"][0].HostPort),
      Number(record.NetworkSettings.Ports["80/tcp"][0].HostPort)
    ]).sort((left, right) => left - right);
    assert.deepEqual(Array.from(ports).sort((left, right) => left - right), expected);
    const inspectCalls = inventory.calls.filter((call) => call.args[0] === "inspect");
    assert.equal(inspectCalls.length, Math.ceil(count / DOCKER_INSPECT_BATCH_SIZE));
    assert.deepEqual(inspectCalls.flatMap((call) => call.args.slice(3)), ids);
    assert.ok(inspectCalls.every((call) => call.args.slice(3).length <= DOCKER_INSPECT_BATCH_SIZE));
  }
});

test("any incomplete, duplicate, unexpected, or failed later Docker batch discards the inventory", () => {
  const count = DOCKER_INSPECT_BATCH_SIZE * 2 + 1;
  const ids = Array.from({ length: count }, (value, index) => (index + 1).toString(16).padStart(12, "0"));
  const records = ids.map((id, index) => dockerInspectRecord(id, {
    "80/tcp": [{ HostIp: "", HostPort: String(12000 + index) }]
  }, {}));
  const cases = [
    { name: "missing middle", batch: 1, mutate(batch) { return batch.slice(0, -1); } },
    { name: "missing final", batch: 2, mutate(batch) { return []; } },
    { name: "duplicate across batches", batch: 1, mutate(batch) { return [records[0], ...batch.slice(1)]; } },
    { name: "unexpected record", batch: 1, mutate(batch) { return [dockerInspectRecord("f".repeat(12), {}, {}), ...batch.slice(1)]; } },
    { name: "nonzero", batch: 1, result: { status: 1, stdout: "partial sensitive output", stderr: "daemon detail" } },
    { name: "timeout", batch: 1, result: { status: null, stdout: "", stderr: "", error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) } },
    { name: "malformed", batch: 1, result: { status: 0, stdout: "{malformed", stderr: "" } },
    { name: "oversized", batch: 1, result: { status: 0, stdout: "x".repeat(1024 * 1024 + 1), stderr: "" } }
  ];
  for (const scenario of cases) {
    let inspectIndex = 0;
    const calls = [];
    assert.throws(() => readDockerPublishedHostPorts({
      spawnSync(executable, args) {
        calls.push(args);
        if (args[0] === "ps") return { status: 0, stdout: ids.join("\n"), stderr: "" };
        const currentIndex = inspectIndex++;
        const requested = args.slice(3);
        const batch = records.filter((record) => requested.some((id) => record.Id.startsWith(id)));
        if (currentIndex === scenario.batch) {
          if (scenario.result) return scenario.result;
          return { status: 0, stdout: JSON.stringify(scenario.mutate(batch)), stderr: "" };
        }
        return { status: 0, stdout: JSON.stringify(batch), stderr: "" };
      }
    }), (error) => {
      assert.equal(error.code, "create_website_environment_unavailable", scenario.name);
      assert.equal(error.statusCode, 409, scenario.name);
      assert.doesNotMatch(error.message, /partial|daemon|malformed|timeout|container|\.lock/i);
      return true;
    });
    assert.ok(calls.some((args) => args[0] === "inspect"));
  }
});

test("Docker reader rejects invalid host ports and unsafe binding shapes", () => {
  const id = "d".repeat(12);
  const invalidBindings = [
    [{ HostIp: "", HostPort: "invalid" }],
    [{ HostIp: "", HostPort: "8120.5" }],
    [{ HostIp: "", HostPort: "0" }],
    [{ HostIp: "", HostPort: "65536" }],
    [{ HostIp: "", HostPort: 8120 }],
    [{ HostIp: null, HostPort: "8120" }],
    [null],
    { HostIp: "", HostPort: "8120" }
  ];
  for (const bindings of invalidBindings) {
    const inventory = dockerInventoryRunner([id], [dockerInspectRecord(id, { "80/tcp": bindings }, {})]);
    assert.throws(() => readDockerPublishedHostPorts({ spawnSync: inventory.spawnSync }), (error) => {
      assert.equal(error.code, "create_website_environment_unavailable");
      assert.equal(error.statusCode, 409);
      return true;
    });
  }
});

test("port selector skips Docker-published and locally occupied candidates", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const socketChecks = [];
  const selected = await findAvailableProjectPort(projectsRoot, {
    firstPort: 8120,
    async readDockerPublishedHostPorts() {
      return new Set([8120]);
    },
    async canBindPort(port) {
      socketChecks.push(port);
      return port !== 8121;
    }
  });
  assert.equal(selected, 8122);
  assert.deepEqual(socketChecks, [8121, 8122]);
});

test("invalid firstPort values fail before Docker inventory or host probing", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const invalid = [-1, 0, 1, 1023, 65536, 8120.5, NaN, Infinity, "8120"];
  for (const firstPort of invalid) {
    let dockerCalls = 0;
    let probeCalls = 0;
    await assert.rejects(findAvailableProjectPort(projectsRoot, {
      firstPort,
      readDockerPublishedHostPorts() { dockerCalls += 1; return new Set(); },
      canBindPort() { probeCalls += 1; return true; }
    }), (error) => error.code === "create_website_port_unavailable" && error.statusCode === 409);
    assert.equal(dockerCalls, 0);
    assert.equal(probeCalls, 0);
  }
});

test("firstPort accepts exact boundaries and search does not overflow 65535", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  assert.equal(await findAvailableProjectPort(projectsRoot, {
    firstPort: 1024,
    readDockerPublishedHostPorts() { return new Set(); },
    canBindPort() { return true; }
  }), 1024);
  assert.equal(await findAvailableProjectPort(projectsRoot, {
    firstPort: 65535,
    readDockerPublishedHostPorts() { return new Set(); },
    canBindPort() { return true; }
  }), 65535);
  const checked = [];
  await assert.rejects(findAvailableProjectPort(projectsRoot, {
    firstPort: 65535,
    readDockerPublishedHostPorts() { return new Set(); },
    canBindPort(port) { checked.push(port); return false; }
  }), (error) => error.code === "create_website_port_unavailable");
  assert.deepEqual(checked, [65535]);
});

test("bounded search exhausts exactly through the final valid port", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const checked = [];
  await assert.rejects(findAvailableProjectPort(projectsRoot, {
    firstPort: 64535,
    readDockerPublishedHostPorts() { return new Set(); },
    canBindPort(port) { checked.push(port); return false; }
  }), (error) => error.code === "create_website_port_unavailable");
  assert.equal(checked.length, 1001);
  assert.equal(checked[0], 64535);
  assert.equal(checked.at(-1), 65535);
});

test("persisted project ports accept canonical decimals and ignore noncanonical strings", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  createProjectScaffold({ name: "Reserved one", slug: "reserved-one", port: 8120, projectsRoot });
  createProjectScaffold({ name: "Reserved two", slug: "reserved-two", port: 8121, projectsRoot });
  createProjectScaffold({ name: "Stopped", slug: "reserved-stopped", port: 8122, projectsRoot });
  const stopped = readProjectBySlug("reserved-stopped", projectsRoot);
  stopped.project.runtime.status = "stopped";
  saveProjectRecord(stopped, stopped.project);
  const invalidStrings = ["08123", "00001024", "+8123", " 8123", "8123 ", "8123.0", "8123x", "-8123", "0", "65536", "1e4"];
  invalidStrings.forEach((value, index) => {
    const slug = "invalid-port-" + String(index);
    createProjectScaffold({ name: slug, slug, port: 8200 + index, projectsRoot });
  });
  invalidStrings.forEach((value, index) => {
    const manifestPath = path.join(projectsRoot, "invalid-port-" + String(index), "factory-project.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.wp_port = value;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  });

  const checked = [];
  const selectedWithNoncanonical = await findAvailableProjectPort(projectsRoot, {
    firstPort: 8120,
    readDockerPublishedHostPorts() { return new Set(); },
    canBindPort(port) { checked.push(port); return true; }
  });
  assert.equal(selectedWithNoncanonical, 8123);
  assert.deepEqual(checked, [8123]);

  const canonicalManifestPath = path.join(projectsRoot, "invalid-port-0", "factory-project.json");
  const canonical = JSON.parse(fs.readFileSync(canonicalManifestPath, "utf8"));
  canonical.wp_port = "8123";
  fs.writeFileSync(canonicalManifestPath, JSON.stringify(canonical, null, 2) + "\n", "utf8");
  assert.equal(await findAvailableProjectPort(projectsRoot, {
    firstPort: 8120,
    readDockerPublishedHostPorts() { return new Set(); },
    canBindPort() { return true; }
  }), 8124);
});

test("concurrent selectors may race, but persisted scaffold rejects the second duplicate port", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const options = {
    firstPort: 8300,
    readDockerPublishedHostPorts() { return new Set(); },
    async canBindPort() { return true; }
  };
  const selected = await Promise.all([
    findAvailableProjectPort(projectsRoot, options),
    findAvailableProjectPort(projectsRoot, options)
  ]);
  assert.deepEqual(selected, [8300, 8300]);
  createProjectScaffold({ name: "Concurrent one", slug: "concurrent-one", port: selected[0], projectsRoot });
  assert.throws(() => createProjectScaffold({
    name: "Concurrent two",
    slug: "concurrent-two",
    port: selected[1],
    projectsRoot
  }), (error) => error.code === "project_port_conflict" && error.statusCode === 409);
  assert.deepEqual(listProjects(projectsRoot).map((project) => [project.slug, project.wp_port]), [["concurrent-one", 8300]]);
});

test("saveProjectRecord cannot move another authoritative project onto an occupied port", (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  createProjectScaffold({ name: "Port owner", slug: "port-owner", port: 8310, projectsRoot });
  createProjectScaffold({ name: "Port mover", slug: "port-mover", port: 8311, projectsRoot });
  const moving = readProjectBySlug("port-mover", projectsRoot);
  moving.project.wp_port = 8310;
  assert.throws(() => saveProjectRecord(moving, moving.project), (error) => {
    assert.equal(error.code, "project_port_conflict");
    assert.equal(error.statusCode, 409);
    assert.doesNotMatch(error.message, /factory-project|projects root|\.lock|pid|token|EEXIST/i);
    return true;
  });
  assert.equal(readProjectBySlug("port-mover", projectsRoot).project.wp_port, 8311);
  assert.equal(fs.existsSync(path.join(projectsRoot, PROJECT_STORE_LOCK_DIRECTORY)), false);
});

test("strict transaction inventory rejects every malformed authoritative record without mutation", (t) => {
  const proofRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(proofRoot, { recursive: true, force: true }));
  const cases = [
    ["truncated-json", ({ manifestPath }) => fs.writeFileSync(manifestPath, '{"project_id":', "utf8")],
    ["empty-manifest", ({ manifestPath }) => fs.writeFileSync(manifestPath, "", "utf8")],
    ["missing-port", ({ manifestPath, manifest }) => { delete manifest.wp_port; fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8"); }],
    ["fractional-port", ({ manifestPath, manifest }) => { manifest.wp_port = 8610.5; fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8"); }],
    ["string-port", ({ manifestPath, manifest }) => { manifest.wp_port = "8610"; fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8"); }],
    ["out-of-range-port", ({ manifestPath, manifest }) => { manifest.wp_port = 65536; fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8"); }],
    ["slug-mismatch", ({ manifestPath, manifest }) => { manifest.slug = "different-project"; fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8"); }],
    ["runtime-mismatch", ({ manifestPath, manifest, projectsRoot }) => { manifest.runtime_path = path.join(projectsRoot, "different-project"); fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8"); }],
    ["duplicate-port", ({ manifestPath, manifest, target }) => { manifest.wp_port = target.project.wp_port; fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8"); }],
    ["duplicate-identity", ({ manifestPath, manifest, target }) => { manifest.project_id = target.project.project_id; fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8"); }],
    ["array-schema", ({ manifestPath }) => fs.writeFileSync(manifestPath, "[]\n", "utf8")],
    ["missing-manifest", ({ manifestPath }) => fs.unlinkSync(manifestPath)]
  ];

  for (const [index, [name, corrupt]] of cases.entries()) {
    const projectsRoot = path.join(proofRoot, name);
    fs.mkdirSync(projectsRoot);
    const target = createProjectScaffold({ name: "Target", slug: "target", port: 8600 + index * 3, projectsRoot });
    createProjectScaffold({ name: "Broken", slug: "broken", port: 8601 + index * 3, projectsRoot });
    const targetState = readProjectBySlug("target", projectsRoot);
    const manifestPath = path.join(projectsRoot, "broken", "factory-project.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    corrupt({ manifestPath, manifest, projectsRoot, target });
    const before = snapshotTree(projectsRoot);

    assert.throws(() => createProjectScaffold({
      name: "Rejected create", slug: "rejected-create", port: 8602 + index * 3, projectsRoot
    }), (error) => assertSanitizedStoreError(error, "project_store_inventory_invalid"), name + " create");
    targetState.project.site_name = "Rejected update";
    assert.throws(() => saveProjectRecord(targetState, targetState.project),
      (error) => assertSanitizedStoreError(error, "project_store_inventory_invalid"), name + " save");

    assert.deepEqual(snapshotTree(projectsRoot), before, name);
    assert.equal(fs.existsSync(path.join(projectsRoot, "rejected-create")), false, name);
    assert.equal(fs.existsSync(path.join(projectsRoot, PROJECT_STORE_LOCK_DIRECTORY)), false, name);
    assert.deepEqual(manifestTempFiles(path.join(projectsRoot, "target")), [], name);
    assert.deepEqual(manifestTempFiles(path.join(projectsRoot, "broken")), [], name);
    assert.doesNotThrow(() => listProjects(projectsRoot), name);
    if (name === "truncated-json" || name === "empty-manifest") {
      assert.ok(listProjects(projectsRoot).some((project) => project.error === "Invalid factory-project.json"), name);
    }
  }
});

test("strict transaction inventory maps unreadable manifests to a sanitized fail-closed error", (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  createProjectScaffold({ name: "Target", slug: "target", port: 8660, projectsRoot });
  createProjectScaffold({ name: "Unreadable", slug: "unreadable", port: 8661, projectsRoot });
  const state = readProjectBySlug("target", projectsRoot);
  const blockedManifest = path.join(projectsRoot, "unreadable", "factory-project.json");
  const before = snapshotTree(projectsRoot);
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = function patchedReadFileSync(filePath, ...args) {
    if (path.resolve(String(filePath)) === path.resolve(blockedManifest)) {
      const error = new Error("controlled unreadable manifest");
      error.code = "EACCES";
      throw error;
    }
    return originalReadFileSync.call(fs, filePath, ...args);
  };
  try {
    assert.throws(() => createProjectScaffold({ name: "No create", slug: "no-create", port: 8662, projectsRoot }),
      (error) => assertSanitizedStoreError(error, "project_store_inventory_invalid"));
    assert.throws(() => saveProjectRecord(state, state.project),
      (error) => assertSanitizedStoreError(error, "project_store_inventory_invalid"));
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
  assert.deepEqual(snapshotTree(projectsRoot), before);
  assert.equal(fs.existsSync(path.join(projectsRoot, PROJECT_STORE_LOCK_DIRECTORY)), false);
});

test("strict inventory excludes only exact known internal roots and rejects project markers inside them", (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const cacheRoot = path.join(projectsRoot, ".factory-cache");
  const recoveryRoot = path.join(projectsRoot, ".factory-recovery");
  fs.mkdirSync(path.join(cacheRoot, "managed-packages"), { recursive: true });
  fs.mkdirSync(path.join(recoveryRoot, "snapshots"), { recursive: true });
  createProjectScaffold({ name: "First", slug: "first", port: 8662, projectsRoot });
  createProjectScaffold({ name: "Second", slug: "second", port: 8663, projectsRoot });
  fs.writeFileSync(path.join(cacheRoot, ".env"), "WP_PORT=8664\n", "utf8");
  const before = snapshotTree(projectsRoot);
  assert.throws(() => createProjectScaffold({ name: "Rejected", slug: "rejected", port: 8664, projectsRoot }),
    (error) => assertSanitizedStoreError(error, "project_store_inventory_invalid"));
  assert.deepEqual(snapshotTree(projectsRoot), before);
  assert.equal(fs.existsSync(path.join(projectsRoot, "rejected")), false);
  assert.equal(fs.existsSync(path.join(projectsRoot, PROJECT_STORE_LOCK_DIRECTORY)), false);
});

test("saveProjectRecord fails closed when its bound target manifest is malformed or missing", (t) => {
  const proofRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(proofRoot, { recursive: true, force: true }));
  for (const mode of ["malformed", "missing"]) {
    const projectsRoot = path.join(proofRoot, mode);
    fs.mkdirSync(projectsRoot);
    createProjectScaffold({ name: "Target", slug: "target", port: mode === "malformed" ? 8664 : 8665, projectsRoot });
    const state = readProjectBySlug("target", projectsRoot);
    if (mode === "malformed") {
      fs.writeFileSync(state.manifestPath, "{truncated", "utf8");
    } else {
      fs.unlinkSync(state.manifestPath);
    }
    const before = snapshotTree(projectsRoot);
    assert.throws(() => saveProjectRecord(state, state.project),
      (error) => assertSanitizedStoreError(error, "project_store_inventory_invalid"));
    assert.deepEqual(snapshotTree(projectsRoot), before);
    assert.equal(fs.existsSync(path.join(projectsRoot, PROJECT_STORE_LOCK_DIRECTORY)), false);
    assert.deepEqual(manifestTempFiles(state.runtimePath), []);
  }
});

test("saveProjectRecord binds immutable identity to the physical target and preserves both projects on spoof attempts", (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  createProjectScaffold({ name: "Project A", slug: "project-a", port: 8670, projectsRoot });
  createProjectScaffold({ name: "Project B", slug: "project-b", port: 8671, projectsRoot });
  const stateA = readProjectBySlug("project-a", projectsRoot);
  const stateB = readProjectBySlug("project-b", projectsRoot);
  const manifestA = stateA.manifestPath;
  const manifestB = stateB.manifestPath;
  const beforeA = sha256File(manifestA);
  const beforeB = sha256File(manifestB);
  const incomingCases = [
    Object.assign({}, stateA.project, { slug: stateB.project.slug, wp_port: stateB.project.wp_port }),
    Object.assign({}, stateA.project, { project_id: stateB.project.project_id }),
    Object.assign({}, stateA.project, { runtime_path: stateB.project.runtime_path }),
    Object.assign({}, stateA.project, { manifest_path: path.join(projectsRoot, "outside", "factory-project.json") }),
    Object.assign({}, stateA.project, { runtime_path: projectsRoot + path.sep + "other" + path.sep + ".." + path.sep + "project-a" }),
    Object.assign({}, stateA.project, { runtime_path: path.join(stateA.project.runtime_path, "descendant") })
  ];
  for (const incoming of incomingCases) {
    assert.throws(() => saveProjectRecord(stateA, incoming),
      (error) => assertSanitizedStoreError(error, "project_identity_mismatch"));
  }

  const originalRuntimePath = stateA.runtimePath;
  stateA.runtimePath = stateB.runtimePath;
  assert.throws(() => saveProjectRecord(stateA, stateA.project),
    (error) => assertSanitizedStoreError(error, "project_identity_mismatch"));
  stateA.runtimePath = originalRuntimePath;
  const originalManifestPath = stateA.manifestPath;
  stateA.manifestPath = path.join(projectsRoot, "outside", "factory-project.json");
  assert.throws(() => saveProjectRecord(stateA, stateA.project),
    (error) => assertSanitizedStoreError(error, "project_identity_mismatch"));
  stateA.manifestPath = originalManifestPath;

  assert.throws(() => saveProjectRecord(stateA, Object.assign({}, stateA.project, { wp_port: 8671 })),
    (error) => assertSanitizedStoreError(error, "project_port_conflict"));
  assert.equal(sha256File(manifestA), beforeA);
  assert.equal(sha256File(manifestB), beforeB);
  assert.deepEqual(manifestTempFiles(stateA.runtimePath), []);
  assert.deepEqual(manifestTempFiles(stateB.runtimePath), []);
  assert.equal(fs.existsSync(path.join(projectsRoot, PROJECT_STORE_LOCK_DIRECTORY)), false);

  const samePort = readProjectBySlug("project-a", projectsRoot);
  samePort.project.site_name = "Project A updated";
  saveProjectRecord(samePort, samePort.project);
  const freePort = readProjectBySlug("project-a", projectsRoot);
  freePort.project.wp_port = 8672;
  saveProjectRecord(freePort, freePort.project);
  assert.equal(readProjectBySlug("project-a", projectsRoot).project.wp_port, 8672);
  assert.equal(readProjectBySlug("project-b", projectsRoot).project.wp_port, 8671);

  if (process.platform === "win32") {
    const caseAlias = readProjectBySlug("project-a", projectsRoot);
    const persistedRuntimePath = caseAlias.project.runtime_path;
    caseAlias.project.runtime_path = persistedRuntimePath.toUpperCase();
    saveProjectRecord(caseAlias, caseAlias.project);
    assert.equal(readProjectBySlug("project-a", projectsRoot).project.runtime_path, persistedRuntimePath);
  }
});

test("atomic manifest replacement preserves old bytes across write, replace, and transient cleanup failures", (t) => {
  const proofRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(proofRoot, { recursive: true, force: true }));
  const scenarios = ["temp-write", "replacement", "cleanup"];
  for (const [index, scenario] of scenarios.entries()) {
    const projectsRoot = path.join(proofRoot, scenario);
    fs.mkdirSync(projectsRoot);
    createProjectScaffold({ name: scenario, slug: "target", port: 8680 + index * 2, projectsRoot });
    const state = readProjectBySlug("target", projectsRoot);
    const manifestPath = state.manifestPath;
    const beforeBytes = fs.readFileSync(manifestPath);
    const beforeHash = sha256File(manifestPath);
    const beforePort = state.project.wp_port;
    state.project.wp_port = beforePort + 1;
    const originalOpenSync = fs.openSync;
    const originalRenameSync = fs.renameSync;
    const originalUnlinkSync = fs.unlinkSync;
    let cleanupFailures = 0;
    if (scenario === "temp-write") {
      fs.openSync = function patchedOpenSync(filePath, flags, ...args) {
        if (String(flags) === "wx" && path.basename(String(filePath)).startsWith(".factory-project.json.")) {
          throw new Error("controlled temp write failure");
        }
        return originalOpenSync.call(fs, filePath, flags, ...args);
      };
    } else {
      fs.renameSync = function patchedRenameSync(sourcePath, targetPath) {
        if (path.basename(String(sourcePath)).startsWith(".factory-project.json.")
          && path.resolve(String(targetPath)) === path.resolve(manifestPath)) {
          throw new Error("controlled replacement failure");
        }
        return originalRenameSync.call(fs, sourcePath, targetPath);
      };
      if (scenario === "cleanup") {
        fs.unlinkSync = function patchedUnlinkSync(filePath) {
          if (cleanupFailures === 0 && path.basename(String(filePath)).startsWith(".factory-project.json.")) {
            cleanupFailures += 1;
            throw new Error("controlled cleanup failure");
          }
          return originalUnlinkSync.call(fs, filePath);
        };
      }
    }
    try {
      assert.throws(() => saveProjectRecord(state, state.project),
        (error) => assertSanitizedStoreError(error, "project_store_write_failed"), scenario);
    } finally {
      fs.openSync = originalOpenSync;
      fs.renameSync = originalRenameSync;
      fs.unlinkSync = originalUnlinkSync;
    }
    assert.equal(sha256File(manifestPath), beforeHash, scenario);
    assert.deepEqual(fs.readFileSync(manifestPath), beforeBytes, scenario);
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, "utf8")).wp_port, beforePort, scenario);
    assert.deepEqual(manifestTempFiles(state.runtimePath), [], scenario);
    assert.equal(fs.existsSync(path.join(projectsRoot, PROJECT_STORE_LOCK_DIRECTORY)), false, scenario);
    if (scenario === "cleanup") assert.equal(cleanupFailures, 1);

    const retry = readProjectBySlug("target", projectsRoot);
    retry.project.wp_port = beforePort + 1;
    saveProjectRecord(retry, retry.project);
    assert.equal(readProjectBySlug("target", projectsRoot).project.wp_port, beforePort + 1, scenario);
    assert.deepEqual(manifestTempFiles(state.runtimePath), [], scenario);
  }
});

test("cross-process project store permits exactly one same-port scaffold in 12 synchronized trials", { timeout: 120000 }, async (t) => {
  const proofRoot = temporaryProjectsRoot();
  console.log("PROJECT_STORE_CROSS_PROCESS_ROOT=" + proofRoot);
  t.after(() => fs.rmSync(proofRoot, { recursive: true, force: true }));
  for (let trial = 0; trial < 12; trial += 1) {
    const projectsRoot = path.join(proofRoot, "collision-" + String(trial));
    fs.mkdirSync(projectsRoot);
    const port = 8400 + trial;
    const slugs = ["collision-a-" + String(trial), "collision-b-" + String(trial)];
    const results = await runScaffoldChildren(slugs.map((slug) => ({ name: slug, slug, port, projectsRoot })));
    const successes = results.filter((result) => result.ok);
    const rejected = results.filter((result) => !result.ok);
    assert.equal(successes.length, 1, "trial " + String(trial));
    assert.equal(rejected.length, 1, "trial " + String(trial));
    assert.equal(rejected[0].code, "project_port_conflict");
    assert.equal(rejected[0].statusCode, 409);
    assert.doesNotMatch(rejected[0].message, /factory-project|\.lock|pid|token|EEXIST|projects root|[A-Z]:\\/i);
    const records = listProjects(projectsRoot);
    assert.equal(records.filter((project) => project.wp_port === port).length, 1);
    assert.equal(records.length, 1);
    const loserSlug = slugs.find((slug) => slug !== successes[0].slug);
    assert.equal(fs.existsSync(path.join(projectsRoot, loserSlug)), false);
    assert.equal(fs.existsSync(path.join(projectsRoot, PROJECT_STORE_LOCK_DIRECTORY)), false);
  }
  console.log("PROJECT_STORE_CROSS_PROCESS_TRIALS=12");
});

test("cross-process fan-in rejects seven losers and distinct ports both persist", { timeout: 60000 }, async (t) => {
  const proofRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(proofRoot, { recursive: true, force: true }));
  const fanInRoot = path.join(proofRoot, "fan-in");
  fs.mkdirSync(fanInRoot);
  const fanInSlugs = Array.from({ length: 8 }, (value, index) => "fan-in-" + String(index));
  const fanInResults = await runScaffoldChildren(fanInSlugs.map((slug) => ({
    name: slug, slug, port: 8500, projectsRoot: fanInRoot
  })));
  assert.equal(fanInResults.filter((result) => result.ok).length, 1);
  assert.equal(fanInResults.filter((result) => !result.ok && result.code === "project_port_conflict" && result.statusCode === 409).length, 7);
  const fanInRecords = listProjects(fanInRoot);
  assert.equal(fanInRecords.length, 1);
  assert.equal(fanInRecords[0].wp_port, 8500);
  for (const slug of fanInSlugs.filter((candidate) => candidate !== fanInRecords[0].slug)) {
    assert.equal(fs.existsSync(path.join(fanInRoot, slug)), false);
  }
  assert.equal(fs.existsSync(path.join(fanInRoot, PROJECT_STORE_LOCK_DIRECTORY)), false);

  const distinctRoot = path.join(proofRoot, "distinct");
  fs.mkdirSync(distinctRoot);
  const distinctResults = await runScaffoldChildren([
    { name: "distinct-a", slug: "distinct-a", port: 8510, projectsRoot: distinctRoot },
    { name: "distinct-b", slug: "distinct-b", port: 8511, projectsRoot: distinctRoot }
  ]);
  assert.equal(distinctResults.filter((result) => result.ok).length, 2);
  assert.deepEqual(listProjects(distinctRoot).map((project) => project.wp_port).sort((left, right) => left - right), [8510, 8511]);
  assert.equal(fs.existsSync(path.join(distinctRoot, PROJECT_STORE_LOCK_DIRECTORY)), false);
});

test("cross-process save/save permits exactly one move to a shared free port in 12 synchronized trials", { timeout: 120000 }, async (t) => {
  const proofRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(proofRoot, { recursive: true, force: true }));
  for (let trial = 0; trial < 12; trial += 1) {
    const projectsRoot = path.join(proofRoot, "save-save-" + String(trial));
    fs.mkdirSync(projectsRoot);
    const oldPorts = [8800 + trial * 3, 8801 + trial * 3];
    const sharedPort = 8802 + trial * 3;
    createProjectScaffold({ name: "Save A", slug: "save-a", port: oldPorts[0], projectsRoot });
    createProjectScaffold({ name: "Save B", slug: "save-b", port: oldPorts[1], projectsRoot });
    const results = await runScaffoldChildren([
      { action: "save", slug: "save-a", port: sharedPort, projectsRoot },
      { action: "save", slug: "save-b", port: sharedPort, projectsRoot }
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1, "trial " + String(trial));
    assert.equal(results.filter((result) => !result.ok && result.code === "project_port_conflict" && result.statusCode === 409).length, 1);
    const records = listProjects(projectsRoot);
    assert.equal(records.filter((project) => project.wp_port === sharedPort).length, 1);
    const loser = records.find((project) => project.wp_port !== sharedPort);
    assert.ok(oldPorts.includes(loser.wp_port));
    assert.equal(records.length, 2);
    assert.equal(fs.existsSync(path.join(projectsRoot, PROJECT_STORE_LOCK_DIRECTORY)), false);
    for (const record of records) assert.deepEqual(manifestTempFiles(record.runtime_path), []);
  }
});

test("cross-process create/save permits exactly one owner of the shared port in 12 synchronized trials", { timeout: 120000 }, async (t) => {
  const proofRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(proofRoot, { recursive: true, force: true }));
  for (let trial = 0; trial < 12; trial += 1) {
    const projectsRoot = path.join(proofRoot, "create-save-" + String(trial));
    fs.mkdirSync(projectsRoot);
    const oldPort = 9000 + trial * 2;
    const sharedPort = oldPort + 1;
    createProjectScaffold({ name: "Existing", slug: "existing", port: oldPort, projectsRoot });
    const results = await runScaffoldChildren([
      { action: "create", options: { name: "Created", slug: "created", port: sharedPort, projectsRoot } },
      { action: "save", slug: "existing", port: sharedPort, projectsRoot }
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1, "trial " + String(trial));
    assert.equal(results.filter((result) => !result.ok && result.code === "project_port_conflict" && result.statusCode === 409).length, 1);
    const records = listProjects(projectsRoot);
    assert.equal(records.filter((project) => project.wp_port === sharedPort).length, 1);
    assert.ok(records.every((record) => Number.isInteger(record.wp_port)));
    const winner = results.find((result) => result.ok);
    if (winner.action === "save") {
      assert.equal(fs.existsSync(path.join(projectsRoot, "created")), false);
      assert.equal(readProjectBySlug("existing", projectsRoot).project.wp_port, sharedPort);
    } else {
      assert.equal(readProjectBySlug("existing", projectsRoot).project.wp_port, oldPort);
    }
    assert.equal(fs.existsSync(path.join(projectsRoot, PROJECT_STORE_LOCK_DIRECTORY)), false);
    for (const record of records) assert.deepEqual(manifestTempFiles(record.runtime_path), []);
  }
});

test("scaffold write failure preserves the primary error, rolls back, and releases the lock", (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function patchedWriteFileSync(filePath, ...args) {
    if (path.basename(String(filePath)) === ".env") {
      throw new Error("controlled scaffold write failure");
    }
    return originalWriteFileSync.call(fs, filePath, ...args);
  };
  try {
    assert.throws(() => createProjectScaffold({
      name: "Failure cleanup", slug: "failure-cleanup", port: 8520, projectsRoot
    }), /controlled scaffold write failure/);
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
  assert.equal(fs.existsSync(path.join(projectsRoot, "failure-cleanup")), false);
  assert.equal(fs.existsSync(path.join(projectsRoot, PROJECT_STORE_LOCK_DIRECTORY)), false);
  createProjectScaffold({ name: "After failure", slug: "after-failure", port: 8520, projectsRoot });
  assert.equal(readProjectBySlug("after-failure", projectsRoot).project.wp_port, 8520);
  assert.equal(fs.existsSync(path.join(projectsRoot, PROJECT_STORE_LOCK_DIRECTORY)), false);
});

test("live and malformed owner locks fail closed with bounded wait and are never stolen", { timeout: 10000 }, (t) => {
  const proofRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(proofRoot, { recursive: true, force: true }));
  for (const [name, ownerText] of [
    ["live", JSON.stringify({ schema: "factory_project_store_lock", version: 1, owner_token: "a".repeat(64), pid: process.pid }) + "\n"],
    ["malformed", "{incomplete"]
  ]) {
    const projectsRoot = path.join(proofRoot, name);
    const lockPath = path.join(projectsRoot, PROJECT_STORE_LOCK_DIRECTORY);
    fs.mkdirSync(lockPath, { recursive: true });
    const ownerPath = path.join(lockPath, "owner.json");
    fs.writeFileSync(ownerPath, ownerText, "utf8");
    const started = Date.now();
    assert.throws(() => createProjectScaffold({
      name, slug: "blocked-" + name, port: 8530, projectsRoot
    }), (error) => error.code === "project_store_unavailable" && error.statusCode === 409);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 1000 && elapsed < 5000, name + " elapsed=" + String(elapsed));
    assert.equal(fs.readFileSync(ownerPath, "utf8"), ownerText);
    assert.equal(fs.existsSync(path.join(projectsRoot, "blocked-" + name)), false);
  }
});

test("release with a changed owner token leaves the foreign lock intact", (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const lockOwnerPath = path.join(projectsRoot, PROJECT_STORE_LOCK_DIRECTORY, "owner.json");
  const foreignOwner = JSON.stringify({
    schema: "factory_project_store_lock",
    version: 1,
    owner_token: "f".repeat(64),
    pid: process.pid
  }) + "\n";
  const originalRenameSync = fs.renameSync;
  let changed = false;
  fs.renameSync = function patchedRenameSync(sourcePath, targetPath) {
    const result = originalRenameSync.call(fs, sourcePath, targetPath);
    if (!changed && path.basename(String(targetPath)) === "factory-project.json") {
      changed = true;
      fs.writeFileSync(lockOwnerPath, foreignOwner, "utf8");
    }
    return result;
  };
  try {
    assert.throws(() => createProjectScaffold({
      name: "Ownership proof", slug: "ownership-proof", port: 8540, projectsRoot
    }), (error) => error.code === "project_store_unavailable" && error.statusCode === 409);
  } finally {
    fs.renameSync = originalRenameSync;
  }
  assert.equal(fs.readFileSync(lockOwnerPath, "utf8"), foreignOwner);
  assert.equal(readProjectBySlug("ownership-proof", projectsRoot).project.wp_port, 8540);
});

test("Docker read failures, malformed IDs, malformed inspect data, and partial inventory fail sanitized", () => {
  const idA = "e".repeat(12);
  const idB = "f".repeat(12);
  const failures = [
    () => ({ status: 1, stdout: "sensitive stdout", stderr: "sensitive daemon detail" }),
    () => ({ status: null, stdout: "", stderr: "", error: Object.assign(new Error("missing docker path"), { code: "ENOENT" }) }),
    () => ({ status: null, stdout: "", stderr: "", error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }) }),
    () => { throw new Error("spawn exception with host path"); }
  ];
  for (const failingRunner of failures) {
    assert.throws(() => readDockerPublishedHostPorts({ spawnSync: failingRunner }), (error) => {
      assert.equal(error.code, "create_website_environment_unavailable");
      assert.equal(error.statusCode, 409);
      assert.equal(error.message, "Docker port availability could not be checked. Recheck the local environment and try again.");
      assert.equal(error.customer_action, "Open System Check and recheck.");
      assert.doesNotMatch(error.message, /sensitive|daemon|stdout|host path|spawn|inspect/i);
      return true;
    });
  }

  const malformedCases = [
    dockerInventoryRunner(["not-an-id"], []),
    dockerInventoryRunner([idA, idB], [dockerInspectRecord(idA, {}, {})]),
    dockerInventoryRunner([idA], [{ Id: idA.padEnd(64, "e"), HostConfig: {}, NetworkSettings: { Ports: {} } }]),
    {
      spawnSync(executable, args) {
        return args[0] === "ps"
          ? { status: 0, stdout: idA, stderr: "" }
          : { status: 0, stdout: "{malformed", stderr: "" };
      }
    },
    {
      spawnSync(executable, args) {
        return args[0] === "ps"
          ? { status: 0, stdout: idA, stderr: "" }
          : { status: 0, stdout: "x".repeat(1024 * 1024 + 1), stderr: "" };
      }
    }
  ];
  for (const inventory of malformedCases) {
    assert.throws(() => readDockerPublishedHostPorts({ spawnSync: inventory.spawnSync }), (error) => {
      assert.equal(error.code, "create_website_environment_unavailable");
      assert.doesNotMatch(error.message, /malformed|container|inspect|output limit/i);
      return true;
    });
  }

  for (const failure of failures) {
    let calls = 0;
    assert.throws(() => readDockerPublishedHostPorts({
      spawnSync(executable, args) {
        calls += 1;
        if (args[0] === "ps") {
          return { status: 0, stdout: idA, stderr: "" };
        }
        return failure();
      }
    }), (error) => error.code === "create_website_environment_unavailable");
    assert.equal(calls, 2);
  }
});

test("Docker port inventory failure stops before project scaffolding with a sanitized error", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  let scaffoldCalls = 0;
  await assert.rejects(startCreateWebsite({
    request: validRequest(),
    projectsRoot,
    idempotencyKey: "create-docker-port-inventory-failure-0001",
    systemCheck: readySystemCheck(),
    portOptions: {
      spawnSync() {
        return { status: 1, stdout: "", stderr: "sensitive daemon diagnostic" };
      }
    },
    services: {
      createProjectScaffold() {
        scaffoldCalls += 1;
      }
    }
  }), (error) => {
    assert.equal(error.code, "create_website_environment_unavailable");
    assert.doesNotMatch(error.message, /sensitive|daemon|docker ps/i);
    return true;
  });
  assert.equal(scaffoldCalls, 0);
  assert.deepEqual(fs.readdirSync(projectsRoot), []);
});

test("structured personalization remains authoritative for agency, city, phone, and email", () => {
  const request = validateCreateWebsiteRequest(validRequest());
  const personalization = buildStructuredPersonalization(request);
  const context = buildPlanningContextFromPersonalization(personalization);
  assert.equal(personalization.source, "structured_create_request");
  assert.equal(context.preset_variables.agency_name, "Kyiv Realty");
  assert.equal(context.preset_variables.phone, "+380 44 555 01 01");
  assert.equal(context.preset_variables.email, "hello@kyivrealty.example");
  assert.match(buildCreateWebsitePrompt(request), /30 demonstration properties/);
});

test("workflow invokes existing services once in frozen stage order and succeeds only after validation", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const slug = "workflow-success";
  scaffold(projectsRoot, slug);
  const stages = [];
  const calls = [];
  const result = await executeCreateWebsiteWorkflow({
    request: validRequest(),
    slug,
    projectsRoot,
    operationId: "op-test",
    setStage(stage) { stages.push(stage); },
    services: {
      async provisionProject() { calls.push("provision"); return { proofPath: "provision-proof" }; },
      createManagedDependencyInstallPlan({ dependency }) { calls.push("plan:" + dependency); return { plan: { plan_id: "plan-" + dependency } }; },
      async installDependency({ planId }) { calls.push("install:" + planId); return { proof: { installed: true, active: true } }; },
      async installAgent() { calls.push("agent"); return { health: { status: "ok" }, capabilities: { capabilities: { controlled_generate: true } } }; },
      async readDependencies() { calls.push("verify-dependencies"); return { blockers: [] }; },
      async planProject(options) {
        calls.push("plan-site");
        assert.equal(options.structuredPersonalization.source, "structured_create_request");
        return { run: { run_id: "run-1", status: "ok" } };
      },
      async generateProject(options) {
        calls.push("generate");
        await options.onProgress("generating");
        return {
          afterCounts: { pages: 3, properties: 30 },
          proofPath: "generate-proof",
          urlStatus: { home: 200, properties: 200, single_property: 200, contact: 200 }
        };
      },
      async getSiteStatus() {
        calls.push("site-status");
        return {
          project: { wp_url: "http://127.0.0.1:47001" },
          site: {
            generated_site_present: true,
            generation_status: "ok",
            generated_urls: { home: "http://127.0.0.1:47001" },
            url_status: { home: 200, properties: 200, contact: 200 }
          }
        };
      },
      evaluateRealEstateContract() { calls.push("contract"); return { status: "compliant", totals: { passed: 25, total: 25 } }; }
    }
  });
  assert.deepEqual(stages.filter((stage, index) => index === 0 || stage !== stages[index - 1]), [
    "validate_request", "create_project", "provision_runtime", "install_dependencies", "install_agent",
    "verify_agent", "create_plan", "apply_plan", "validate_website", "finalize_project"
  ]);
  assert.equal(calls.filter((call) => call === "provision").length, 1);
  assert.equal(calls.filter((call) => call.startsWith("install:")).length, 3);
  assert.equal(calls.filter((call) => call === "agent").length, 1);
  assert.equal(calls.filter((call) => call === "generate").length, 1);
  assert.equal(result.resultSummary.validation_passed, true);
  assert.equal(result.resultSummary.url_status.single_property, 200);
  assert.equal(readProjectBySlug(slug, projectsRoot).project.create_website.status, "ready");
});

test("failed dependency stage prevents Agent and generate", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const slug = "dependency-failure";
  scaffold(projectsRoot, slug);
  let laterCalls = 0;
  await assert.rejects(executeCreateWebsiteWorkflow({
    request: validRequest(), slug, projectsRoot, operationId: "op-test", setStage() {},
    services: {
      async provisionProject() { return {}; },
      createManagedDependencyInstallPlan({ dependency }) { return { plan: { plan_id: dependency } }; },
      async installDependency() { throw new Error("dependency failure"); },
      async installAgent() { laterCalls += 1; },
      async planProject() { laterCalls += 1; },
      async generateProject() { laterCalls += 1; }
    }
  }), (error) => error.createWebsiteStage === "install_dependencies");
  assert.equal(laterCalls, 0);
});

test("failed Agent stage prevents planning and failed validation prevents Website Ready", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  scaffold(projectsRoot, "agent-failure");
  let planCalls = 0;
  await assert.rejects(executeCreateWebsiteWorkflow({
    request: validRequest(), slug: "agent-failure", projectsRoot, operationId: "op-test", setStage() {},
    services: {
      async provisionProject() { return {}; },
      createManagedDependencyInstallPlan({ dependency }) { return { plan: { plan_id: dependency } }; },
      async installDependency() { return { proof: { installed: true, active: true } }; },
      async installAgent() { return { health: { status: "error" }, capabilities: { capabilities: {} } }; },
      async planProject() { planCalls += 1; }
    }
  }), (error) => error.createWebsiteStage === "verify_agent");
  assert.equal(planCalls, 0);

  scaffold(projectsRoot, "validation-failure");
  await assert.rejects(executeCreateWebsiteWorkflow({
    request: validRequest(), slug: "validation-failure", projectsRoot, operationId: "op-test", setStage() {},
    services: {
      async provisionProject() { return {}; },
      createManagedDependencyInstallPlan({ dependency }) { return { plan: { plan_id: dependency } }; },
      async installDependency() { return { proof: { installed: true, active: true } }; },
      async installAgent() { return { health: { status: "ok" }, capabilities: { capabilities: { controlled_generate: true } } }; },
      async readDependencies() { return { blockers: [] }; },
      async planProject() { return { run: { run_id: "run", status: "ok" } }; },
      async generateProject() { return { afterCounts: {}, proofPath: null }; },
      async getSiteStatus() { return { project: { wp_url: "http://127.0.0.1" }, site: { generated_site_present: true, generation_status: "ok", generated_urls: {}, url_status: { home: 200, properties: 500, single_property: 200, contact: 200 } } }; },
      evaluateRealEstateContract() { return { status: "compliant", totals: { passed: 25, total: 25 } }; }
    }
  }), (error) => error.createWebsiteStage === "validate_website");
  assert.notEqual(readProjectBySlug("validation-failure", projectsRoot).project.create_website.status, "ready");
});

test("System Check not-ready blocks before every mutation seam", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const calls = { port: 0, scaffold: 0, operation: 0, dependency: 0, agent: 0 };
  await assert.rejects(startCreateWebsite({
    request: validRequest(),
    projectsRoot,
    idempotencyKey: "create-system-check-blocked-0001",
    systemCheck: {
      state: "ACTION_REQUIRED",
      checks: [{ id: "docker_daemon", state: "ACTION_REQUIRED", message: "Start Docker Desktop, then recheck." }]
    },
    services: {
      async findAvailableProjectPort() { calls.port += 1; return 47001; },
      createProjectScaffold() { calls.scaffold += 1; },
      runProjectOperation() { calls.operation += 1; },
      installDependency() { calls.dependency += 1; },
      installAgent() { calls.agent += 1; }
    }
  }), (error) => error.code === "create_website_system_check_blocked");
  assert.deepEqual(calls, { port: 0, scaffold: 0, operation: 0, dependency: 0, agent: 0 });
  assert.deepEqual(fs.readdirSync(projectsRoot), []);
});

test("Create Website duplicate-port race loser keeps a sanitized HTTP conflict contract", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const never = new Promise(() => {});
  let operationCounter = 0;
  const services = {
    async findAvailableProjectPort() { return 48331; },
    createOperationId() { operationCounter += 1; return "op-race-" + String(operationCounter); },
    runProjectOperation() { return never; }
  };
  const outcomes = await Promise.allSettled([
    startCreateWebsite({
      request: validRequest({ project_name: "Race one" }), projectsRoot, projectSlug: "race-one",
      idempotencyKey: "create-race-one-0001", systemCheck: readySystemCheck(), services
    }),
    startCreateWebsite({
      request: validRequest({ project_name: "Race two" }), projectsRoot, projectSlug: "race-two",
      idempotencyKey: "create-race-two-0001", systemCheck: readySystemCheck(), services
    })
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected").reason;
  assert.equal(rejected.code, "project_port_conflict");
  assert.equal(rejected.statusCode, 409);
  assert.equal(rejected.message, "The selected local website port is already assigned to another project.");
  assert.doesNotMatch(rejected.message, /factory-project|\.lock|pid|token|EEXIST|[A-Z]:\\/i);
  assert.equal(listProjects(projectsRoot).length, 1);
  assert.equal(fs.existsSync(path.join(projectsRoot, PROJECT_STORE_LOCK_DIRECTORY)), false);
});

test("double submission reuses one project and status polling is read-only", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  let scaffoldCalls = 0;
  let portCalls = 0;
  let nextPort = 47991;
  const never = new Promise(() => {});
  const services = {
    async findAvailableProjectPort() { portCalls += 1; return nextPort++; },
    createOperationId() { return "op-idempotent"; },
    createProjectScaffold(options) { scaffoldCalls += 1; return createProjectScaffold(options); },
    runProjectOperation() { return never; }
  };
  const options = {
    request: validRequest(), projectsRoot, idempotencyKey: "create-idempotent-request-0001",
    systemCheck: readySystemCheck(), services
  };
  const [first, second] = await Promise.all([startCreateWebsite(options), startCreateWebsite(options)]);
  assert.equal(first.project.slug, second.project.slug);
  assert.equal(readProjectBySlug(first.project.slug, projectsRoot).project.wp_port, 47991);
  assert.equal(scaffoldCalls, 1);
  assert.equal(portCalls, 1);
  assert.equal(listProjects(projectsRoot).length, 1);
  const retry = await startCreateWebsite(Object.assign({}, options, {
    idempotencyKey: "create-idempotent-request-0002"
  }));
  assert.notEqual(retry.project.slug, first.project.slug);
  assert.equal(readProjectBySlug(retry.project.slug, projectsRoot).project.wp_port, 47992);
  assert.equal(scaffoldCalls, 2);
  assert.equal(portCalls, 2);
  assert.equal(listProjects(projectsRoot).length, 2);
  const manifest = path.join(projectsRoot, first.project.slug, "factory-project.json");
  const before = fs.statSync(manifest).mtimeMs;
  const polled = getCreateWebsiteStatus({ slug: first.project.slug, projectsRoot });
  const after = fs.statSync(manifest).mtimeMs;
  assert.equal(polled.status, "running");
  assert.equal(after, before);
});

test("customer progress maps backend stages without exposing internal identifiers", () => {
  const progress = buildProgress({ status: "running", stage: "install_agent" }, { status: "running" });
  assert.deepEqual(progress.map((stage) => stage.status), ["complete", "complete", "complete", "active", "pending", "pending"]);
  assert.throws(() => assertSystemCheckReady({ state: "UNSUPPORTED", checks: [] }), /System Check/);
});
