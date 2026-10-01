"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  PROJECT_NETWORK_POOL,
  PROJECT_SCAFFOLD_STAGING_DIRECTORY,
  PROJECT_SUBDIRECTORIES,
  createProjectScaffold,
  readProjectBySlug,
  readStrictProjectInventory,
  saveProjectRecord
} = require("../src/project-store");
const { createDockerCompose } = require("../src/templates");
const { assertReadyRuntimeBinding } = require("../src/runtime-binding");
const {
  assertProvisionNetworkPreflight,
  cidrsOverlap,
  parseActiveRouteCidrs,
  parseDockerNetworkSubnets
} = require("../src/provision");

function temporaryProjectsRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-project-network-"));
}

function create(root, slug, port) {
  return createProjectScaffold({
    name: "Network " + slug,
    slug,
    port,
    projectsRoot: root
  });
}

function runScaffoldProcess(projectsRoot, slug, port) {
  const modulePath = path.resolve(__dirname, "../src/project-store.js");
  const script = [
    "const store=require(" + JSON.stringify(modulePath) + ");",
    "try { const value=store.createProjectScaffold({name:" + JSON.stringify("Concurrent " + slug) + ",slug:" + JSON.stringify(slug) + ",port:" + String(port) + ",projectsRoot:" + JSON.stringify(projectsRoot) + "}); process.stdout.write(JSON.stringify({ok:true,project:value.project})); }",
    "catch (error) { process.stdout.write(JSON.stringify({ok:false,code:error.code||null,message:error.message})); process.exitCode=1; }"
  ].join("");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error("scaffold process failed: " + stderr + stdout));
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
  });
}

test("project store atomically assigns every server-owned /24 allocation under concurrent scaffolds", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));

  assert.deepEqual(PROJECT_NETWORK_POOL, [
    "10.252.254.0/24",
    "10.252.255.0/24",
    "10.252.253.0/24"
  ]);
  const results = await Promise.all([
    runScaffoldProcess(projectsRoot, "concurrent-network-a", 49201),
    runScaffoldProcess(projectsRoot, "concurrent-network-b", 49202),
    runScaffoldProcess(projectsRoot, "concurrent-network-c", 49203)
  ]);
  assert.equal(results.every((result) => result.ok), true);

  const inventory = readStrictProjectInventory(projectsRoot);
  assert.equal(inventory.length, 3);
  const allocations = inventory.map((record) => record.project.network_allocation.subnet).sort();
  assert.deepEqual(allocations, PROJECT_NETWORK_POOL.slice().sort());
});

test("allocation rejects caller injection, fails closed on exhaustion, and is immutable", (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));

  for (const injected of [
    { network: "caller-network" },
    { network_subnet: PROJECT_NETWORK_POOL[1] },
    { subnet: PROJECT_NETWORK_POOL[1] },
    { network_allocation: { schema: "factory_project_network_allocation", version: 1, subnet: PROJECT_NETWORK_POOL[1] } }
  ]) {
    assert.throws(() => createProjectScaffold(Object.assign({
      name: "Injected Network", slug: "injected-network", port: 49203, projectsRoot
    }, injected)), (error) => error.code === "project_network_allocation_injected");
  }

  create(projectsRoot, "network-first", 49204);
  create(projectsRoot, "network-second", 49205);
  create(projectsRoot, "network-third", 49206);
  assert.throws(() => create(projectsRoot, "network-fourth", 49212), (error) => error.code === "project_network_allocation_exhausted");

  const state = readProjectBySlug("network-first", projectsRoot);
  state.project.network_allocation = {
    schema: "factory_project_network_allocation",
    version: 1,
    subnet: PROJECT_NETWORK_POOL[1]
  };
  assert.throws(() => saveProjectRecord(state, state.project), (error) => error.code === "project_identity_mismatch");
});

test("failed staged scaffolds preserve both failures without publishing authority or reserving a /24", (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const stagingRoot = path.join(projectsRoot, PROJECT_SCAFFOLD_STAGING_DIRECTORY);
  const authoritativeRuntimePath = path.join(projectsRoot, "failed-staged-scaffold");
  const originalWriteFileSync = fs.writeFileSync;
  const originalRmSync = fs.rmSync;
  fs.writeFileSync = function patchedWriteFileSync(filePath, ...args) {
    if (path.basename(String(filePath)) === ".env"
      && (String(filePath).startsWith(stagingRoot) || String(filePath) === path.join(authoritativeRuntimePath, ".env"))) {
      const error = new Error("controlled staged write failure");
      error.code = "EIO";
      throw error;
    }
    return originalWriteFileSync.call(fs, filePath, ...args);
  };
  fs.rmSync = function patchedRmSync(targetPath, ...args) {
    if (String(targetPath).startsWith(stagingRoot) || String(targetPath) === authoritativeRuntimePath) {
      const error = new Error("controlled staged cleanup failure");
      error.code = "EACCES";
      throw error;
    }
    return originalRmSync.call(fs, targetPath, ...args);
  };
  try {
    assert.throws(() => create(projectsRoot, "failed-staged-scaffold", 49211), (error) => {
      assert.equal(error.code, "project_scaffold_cleanup_failed");
      assert.equal(error.primary_cause, "filesystem_eio");
      assert.equal(error.cleanup_cause, "filesystem_eacces");
      return true;
    });
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    fs.rmSync = originalRmSync;
  }

  assert.equal(fs.existsSync(path.join(projectsRoot, "failed-staged-scaffold")), false);
  const stagedResidues = fs.readdirSync(stagingRoot, { withFileTypes: true });
  assert.equal(stagedResidues.length, 1);
  assert.equal(stagedResidues[0].isDirectory(), true);
  assert.match(stagedResidues[0].name, /^[a-f0-9]{32}$/);
  assert.equal(stagedResidues[0].name.includes("failed-staged-scaffold"), false);
  assert.deepEqual(readStrictProjectInventory(projectsRoot), []);

  create(projectsRoot, "reused-after-failure", 49211);
  const reused = readProjectBySlug("reused-after-failure", projectsRoot);
  assert.equal(reused.project.network_allocation.subnet, PROJECT_NETWORK_POOL[0]);
  assert.equal(readStrictProjectInventory(projectsRoot).length, 1);
});

test("strict inventory rejects arbitrary staged manifests", (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const stagedRuntimePath = path.join(
    projectsRoot,
    PROJECT_SCAFFOLD_STAGING_DIRECTORY,
    "a".repeat(32)
  );
  fs.mkdirSync(stagedRuntimePath, { recursive: true });
  for (const subdirectory of PROJECT_SUBDIRECTORIES) {
    fs.mkdirSync(path.join(stagedRuntimePath, subdirectory));
  }
  fs.writeFileSync(path.join(stagedRuntimePath, ".env"), "x=1\n", "utf8");
  fs.writeFileSync(path.join(stagedRuntimePath, "runtime-binding-v1.json"), "{}\n", "utf8");
  fs.writeFileSync(path.join(stagedRuntimePath, "docker-compose.yml"), "services: {}\n", "utf8");
  fs.writeFileSync(path.join(stagedRuntimePath, "factory-project.json"), "{\"arbitrary\":true}\n", "utf8");

  assert.throws(() => readStrictProjectInventory(projectsRoot),
    (error) => error.code === "project_store_inventory_invalid");
});

test("strict inventory rejects staging root and leaf realpath escapes", (t) => {
  const rootEscape = temporaryProjectsRoot();
  const leafEscape = temporaryProjectsRoot();
  const outside = temporaryProjectsRoot();
  t.after(() => fs.rmSync(rootEscape, { recursive: true, force: true }));
  t.after(() => fs.rmSync(leafEscape, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const linkType = process.platform === "win32" ? "junction" : "dir";

  fs.symlinkSync(outside, path.join(rootEscape, PROJECT_SCAFFOLD_STAGING_DIRECTORY), linkType);
  assert.throws(() => readStrictProjectInventory(rootEscape),
    (error) => error.code === "project_store_inventory_invalid");

  const stagingRoot = path.join(leafEscape, PROJECT_SCAFFOLD_STAGING_DIRECTORY);
  fs.mkdirSync(stagingRoot);
  fs.symlinkSync(outside, path.join(stagingRoot, "b".repeat(32)), linkType);
  assert.throws(() => readStrictProjectInventory(leafEscape),
    (error) => error.code === "project_store_inventory_invalid");
});

test("legacy projects stay unassigned while new projects require exact IPAM Compose", (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));

  create(projectsRoot, "network-legacy", 49207);
  const legacyState = readProjectBySlug("network-legacy", projectsRoot);
  const legacyManifest = JSON.parse(fs.readFileSync(legacyState.manifestPath, "utf8"));
  delete legacyManifest.network_allocation;
  fs.writeFileSync(legacyState.manifestPath, JSON.stringify(legacyManifest, null, 2) + "\n", "utf8");
  fs.writeFileSync(legacyState.composePath, createDockerCompose(legacyManifest), "utf8");

  const reloadedLegacy = readProjectBySlug("network-legacy", projectsRoot);
  assert.equal(Object.prototype.hasOwnProperty.call(reloadedLegacy.project, "network_allocation"), false);
  assert.equal(assertReadyRuntimeBinding({
    projectState: reloadedLegacy,
    projectsRoot,
    readStrictProjectInventory
  }).project_slug, "network-legacy");

  create(projectsRoot, "network-explicit", 49208);
  const explicit = readProjectBySlug("network-explicit", projectsRoot);
  assert.equal(explicit.project.network_allocation.subnet, PROJECT_NETWORK_POOL[0]);
  const compose = fs.readFileSync(explicit.composePath, "utf8");
  assert.match(compose, /networks:\n  default:\n    ipam:\n      config:\n        - subnet: 10\.252\.254\.0\/24\n$/);
  const bindingArtifact = JSON.parse(
    fs.readFileSync(path.join(explicit.runtimePath, "runtime-binding-v1.json"), "utf8")
  );
  assert.deepEqual(Object.keys(bindingArtifact).sort(), [
    "binding_kind",
    "project_id",
    "project_slug",
    "schema_version"
  ]);

  fs.writeFileSync(explicit.composePath, compose.replace("10.252.254.0/24", "10.252.255.0/24"), "utf8");
  assert.throws(() => assertReadyRuntimeBinding({
    projectState: explicit,
    projectsRoot,
    readStrictProjectInventory
  }), (error) => error.code === "runtime_binding_compose_invalid");
});

test("Provision network preflight fails closed before Docker mutation on missing, drifted, duplicate, or colliding allocation", async (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  create(projectsRoot, "network-preflight", 49209);
  const state = readProjectBySlug("network-preflight", projectsRoot);
  const options = {
    projectState: state,
    projectsRoot,
    proofStem: "network-preflight-test",
    readStrictProjectInventory,
    networkObservation: { dockerSubnets: [], activeRouteCidrs: [] }
  };
  assert.deepEqual(await assertProvisionNetworkPreflight(options), state.project.network_allocation);

  await assert.rejects(
    () => assertProvisionNetworkPreflight({ ...options, networkObservation: { dockerSubnets: [PROJECT_NETWORK_POOL[0]], activeRouteCidrs: [] } }),
    (error) => error.code === "project_network_allocation_collision"
  );
  await assert.rejects(
    () => assertProvisionNetworkPreflight({ ...options, networkObservation: { dockerSubnets: [], activeRouteCidrs: ["10.252.254.0/23"] } }),
    (error) => error.code === "project_network_allocation_collision"
  );

  const drifted = readProjectBySlug("network-preflight", projectsRoot);
  drifted.project.network_allocation = {
    schema: "factory_project_network_allocation",
    version: 1,
    subnet: PROJECT_NETWORK_POOL[1]
  };
  await assert.rejects(
    () => assertProvisionNetworkPreflight({ ...options, projectState: drifted }),
    (error) => error.code === "project_network_allocation_authority_mismatch"
  );
  delete drifted.project.network_allocation;
  await assert.rejects(
    () => assertProvisionNetworkPreflight({ ...options, projectState: drifted }),
    (error) => error.code === "project_network_allocation_missing"
  );

  const malformed = readProjectBySlug("network-preflight", projectsRoot);
  malformed.project.network_allocation = {};
  await assert.rejects(
    () => assertProvisionNetworkPreflight({ ...options, projectState: malformed }),
    (error) => error.code === "project_network_allocation_missing"
  );

  create(projectsRoot, "network-duplicate", 49210);
  const duplicate = readProjectBySlug("network-duplicate", projectsRoot);
  duplicate.project.network_allocation = state.project.network_allocation;
  fs.writeFileSync(duplicate.manifestPath, JSON.stringify(duplicate.project, null, 2) + "\n", "utf8");
  await assert.rejects(
    () => assertProvisionNetworkPreflight(options),
    (error) => error.code === "project_store_inventory_invalid"
  );
});

test("network observation parsers accept only exact subnetless Docker built-ins and reject spoofed or malformed networks", () => {
  assert.equal(cidrsOverlap("10.252.254.0/24", "10.252.254.0/23"), true);
  assert.equal(cidrsOverlap("10.252.254.0/24", "10.252.255.0/24"), false);
  assert.deepEqual(parseDockerNetworkSubnets(JSON.stringify([
    { Name: "host", Driver: "host", IPAM: { Driver: "default", Options: null, Config: null } },
    { Name: "none", Driver: "null", IPAM: { Driver: "default", Options: null } },
    { Name: "bridge", Driver: "bridge", IPAM: { Config: [{ Subnet: "10.252.254.0/24" }] } }
  ])), ["10.252.254.0/24"]);
  assert.deepEqual(parseActiveRouteCidrs(JSON.stringify(["192.168.0.0/24"])), ["192.168.0.0/24"]);
  assert.throws(() => parseDockerNetworkSubnets("not-json"), (error) => error.code === "project_network_observation_invalid");
  for (const network of [
    { Name: "host", Driver: "bridge", IPAM: { Config: null } },
    { Name: "none", Driver: "bridge", IPAM: { Config: null } },
    { Name: "renamed-host", Driver: "host", IPAM: { Config: null } },
    { Name: "custom", Driver: "bridge", IPAM: { Config: null } },
    { Name: "bridge", Driver: "bridge", IPAM: { Config: [] } },
    { Name: "bridge", Driver: "bridge", IPAM: { Config: [{}] } },
    { Name: "host", Driver: "host" }
  ]) {
    assert.throws(() => parseDockerNetworkSubnets(JSON.stringify([network])),
      (error) => error.code === "project_network_observation_invalid");
  }
  assert.throws(() => parseActiveRouteCidrs(JSON.stringify([{ prefix: "10.0.0.0/8" }])), (error) => error.code === "project_network_observation_invalid");
});
