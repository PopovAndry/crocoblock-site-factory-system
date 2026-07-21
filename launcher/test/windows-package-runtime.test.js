"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createProjectScaffold } = require("../src/project-store");
const {
  appendSafeLog,
  collectRuntimeDiagnostics,
  loadPackageConfig,
  readJsonFile,
  resolveRuntimePaths,
  sanitizeLogText,
  savePackageConfig
} = require("../src/windows-package-runtime");
const {
  configurePackagedLauncher,
  shutdownPackagedLauncher,
  startPackagedLauncher
} = require("../src/windows-package-main");

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-windows-package-"));
}

function fakeDockerReady() {
  return { status: 0, stdout: "26.0.0\n" };
}

function noBrowser() {
  throw new Error("Browser must not open in automated tests.");
}

async function requestText(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.text()
  };
}

test("packaged runtime separates application data, configuration, and projects", () => {
  const root = createTempRoot();
  const dataRoot = path.join(root, "data");
  const projectsRoot = path.join(root, "projects");
  const runtimePaths = resolveRuntimePaths({ dataRoot });
  const config = loadPackageConfig(runtimePaths, { projectsRoot, port: 39120 });

  assert.notEqual(path.dirname(runtimePaths.configPath), projectsRoot);
  assert.notEqual(runtimePaths.logDirectory, projectsRoot);
  assert.notEqual(runtimePaths.runtimeDirectory, projectsRoot);
  assert.equal(config.projects_root, path.resolve(projectsRoot));
  assert.equal(config.preferred_port, 39120);
});

test("package configuration discovers an existing configured projects root without mutating it", async () => {
  const root = createTempRoot();
  const projectsRoot = path.join(root, "existing-projects");
  createProjectScaffold({ name: "Existing", slug: "existing", port: 39121, projectsRoot });
  const projectPath = path.join(projectsRoot, "existing", "factory-project.json");
  const before = fs.readFileSync(projectPath, "utf8");

  await configurePackagedLauncher({
    dataRoot: path.join(root, "data"),
    projectsRoot,
    port: 39122
  });
  const runtimePaths = resolveRuntimePaths({ dataRoot: path.join(root, "data") });
  const config = loadPackageConfig(runtimePaths);
  const diagnostics = await collectRuntimeDiagnostics(config, runtimePaths, {
    spawnSync: () => fakeDockerReady(),
    canBindPort: async () => true
  });

  assert.equal(diagnostics.diagnostics.find((item) => item.label === "Projects").status, "ready");
  assert.equal(fs.readFileSync(projectPath, "utf8"), before);
});

test("runtime diagnostics classify missing Docker, stopped Docker, occupied port, and unwritable data safely", async () => {
  const root = createTempRoot();
  const runtimePaths = resolveRuntimePaths({ dataRoot: path.join(root, "data") });
  const config = { projects_root: path.join(root, "projects"), preferred_port: 39123 };
  const missing = await collectRuntimeDiagnostics(config, runtimePaths, {
    spawnSync: () => ({ error: { code: "ENOENT" } }),
    canBindPort: async (port) => port !== 39123 && port === 39124,
    ensureWritableDirectory: () => {
      throw new Error("denied");
    }
  });
  assert.equal(missing.diagnostics.find((item) => item.label === "Docker").status, "missing");
  assert.equal(missing.diagnostics.find((item) => item.label === "Application data").status, "unavailable");
  assert.equal(missing.diagnostics.find((item) => item.label === "Launcher port").status, "fallback");

  const stopped = await collectRuntimeDiagnostics(config, runtimePaths, {
    spawnSync: () => ({ status: 1, stdout: "" }),
    canBindPort: async () => true
  });
  assert.equal(stopped.diagnostics.find((item) => item.label === "Docker").status, "stopped");
});

test("package logs redact credentials and filesystem paths", () => {
  const root = createTempRoot();
  const runtimePaths = resolveRuntimePaths({ dataRoot: path.join(root, "data") });
  const unsafe = "password=secret-value Bearer abc.def C:\\private\\project";
  appendSafeLog(runtimePaths, "start", { message: unsafe });
  const content = fs.readFileSync(runtimePaths.logPath, "utf8");

  assert.equal(content.includes("secret-value"), false);
  assert.equal(content.includes("abc.def"), false);
  assert.equal(content.includes("C:\\private"), false);
  assert.equal(sanitizeLogText(unsafe).includes("secret-value"), false);
});

test("packaged Launcher serves a path-safe first screen and shuts down through its local control channel", async () => {
  const root = createTempRoot();
  const dataRoot = path.join(root, "data");
  const projectsRoot = path.join(root, "projects");
  createProjectScaffold({ name: "Read only", slug: "read-only", port: 39124, projectsRoot });
  const projectPath = path.join(projectsRoot, "read-only", "factory-project.json");
  const before = fs.readFileSync(projectPath, "utf8");

  const runtime = await startPackagedLauncher({
    dataRoot,
    projectsRoot,
    port: 39125,
    openBrowser: false,
    spawn: noBrowser,
    spawnSync: () => fakeDockerReady()
  });
  try {
    const home = await requestText(runtime.url + "/");
    const projects = await requestText(runtime.url + "/api/projects");
    assert.equal(home.status, 200);
    assert.equal(home.body.includes(projectsRoot), false);
    assert.equal(home.body.includes("System Check"), true);
    assert.equal(home.body.includes("Recheck"), true);
    assert.equal(home.body.includes("Factory runtime"), true);
    assert.equal(projects.body.includes(projectsRoot), false);
    assert.equal(fs.readFileSync(projectPath, "utf8"), before);

    await shutdownPackagedLauncher({ dataRoot });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(fs.existsSync(runtime.runtimePaths.runtimeStatePath), false);
  } finally {
    await runtime.close();
  }
});

test("stored package config remains source-mode compatible with the legacy projects root default", () => {
  const root = createTempRoot();
  const runtimePaths = resolveRuntimePaths({ dataRoot: path.join(root, "data") });
  savePackageConfig(runtimePaths, {
    projects_root: path.join(root, "projects"),
    preferred_port: 39126
  });
  const stored = readJsonFile(runtimePaths.configPath);
  assert.deepEqual(stored, {
    schema_version: 1,
    projects_root: path.resolve(path.join(root, "projects")),
    preferred_port: 39126
  });
  assert.equal(require("../src/project-store").DEFAULT_PROJECTS_ROOT, path.join(path.parse(process.cwd()).root, "sf-factory-projects"));
});
