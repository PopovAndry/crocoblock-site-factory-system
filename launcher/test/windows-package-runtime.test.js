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
  configurePackagedLauncher
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

function writePackageManifest(resources) {
  fs.mkdirSync(resources, { recursive: true });
  fs.writeFileSync(path.join(resources, "package-manifest.json"), JSON.stringify({
    schema_version: 1,
    artifact_class: "INTERNAL_EVALUATION",
    artifact_label: "INTERNAL EVALUATION BUILD",
    application_name: "Crocoblock Site Factory",
    application_version: "0.1.0",
    architecture: "x64",
    rehearsal: { frozen_project_slug: "win-ceo-rehearsal-smoke-3" }
  }), "utf8");
}

function createCanonicalPackageLayout(root, options) {
  const safeOptions = options || {};
  const packageRoot = path.join(root, "Crocoblock-Site-Factory-Windows-x64-0.1.0-beta");
  const launcherRoot = path.join(packageRoot, "app", "launcher");
  fs.cpSync(path.join(__dirname, "..", "src"), path.join(launcherRoot, "src"), { recursive: true });
  fs.cpSync(path.join(__dirname, "..", "contracts"), path.join(launcherRoot, "contracts"), { recursive: true });
  fs.copyFileSync(path.join(__dirname, "..", "package.json"), path.join(launcherRoot, "package.json"));
  const resources = path.join(packageRoot, "resources");
  if (safeOptions.manifest !== false) {
    writePackageManifest(resources);
  }
  return {
    packageRoot,
    resources,
    main: require(path.join(launcherRoot, "src", "windows-package-main.js")),
    runtime: require(path.join(launcherRoot, "src", "windows-package-runtime.js"))
  };
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

test("package manifest is authoritative for canonical internal evaluation identity and version", (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packaged = createCanonicalPackageLayout(root);
  assert.equal(packaged.runtime.loadPackageManifest().application_version, "0.1.0");
  fs.writeFileSync(path.join(packaged.resources, "package-manifest.json"), "{}", "utf8");
  assert.throws(() => packaged.runtime.loadPackageManifest(), /metadata is missing or invalid/);
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

test("direct packaged start fails closed without a canonical manifest before server startup", async (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packaged = createCanonicalPackageLayout(root, { manifest: false });
  const dataRoot = path.join(root, "data");
  let browserOpened = false;
  await assert.rejects(() => packaged.main.startPackagedLauncher({
    dataRoot,
    projectsRoot: path.join(root, "projects"),
    requirePackageManifest: false,
    packageManifest: { application_name: "ignored" },
    openBrowser: false,
    spawn() { browserOpened = true; return { unref() {} }; },
    spawnSync: () => fakeDockerReady()
  }), (error) => /metadata is missing or invalid/.test(error.message) && !error.message.includes(root));
  assert.equal(browserOpened, false);
  assert.equal(fs.existsSync(dataRoot), false);
});

test("packaged startup rejects manifest or resources reparse substitution before startup", async (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packaged = createCanonicalPackageLayout(root);
  const manifestPath = path.join(packaged.resources, "package-manifest.json");
  const targetManifest = path.join(root, "manifest-target.json");
  fs.renameSync(manifestPath, targetManifest);
  let linked = false;
  try {
    fs.symlinkSync(targetManifest, manifestPath, "file");
    linked = true;
  } catch (error) {
    const targetResources = path.join(root, "resources-target");
    writePackageManifest(targetResources);
    try {
      fs.rmSync(packaged.resources, { recursive: true, force: true });
      fs.symlinkSync(targetResources, packaged.resources, "junction");
      linked = true;
    } catch (junctionError) {
      t.skip("Local symlink and junction creation are unavailable on this host.");
      return;
    }
  }
  assert.equal(linked, true);
  const dataRoot = path.join(root, "data");
  await assert.rejects(() => packaged.main.startPackagedLauncher({
    dataRoot,
    projectsRoot: path.join(root, "projects"),
    openBrowser: false,
    spawnSync: () => fakeDockerReady()
  }), (error) => /metadata is missing or invalid/.test(error.message) && !error.message.includes(root));
  assert.equal(fs.existsSync(dataRoot), false);
});

test("packaged Launcher ignores caller resource roots and serves a path-safe first screen", async (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packaged = createCanonicalPackageLayout(root);
  const dataRoot = path.join(root, "data");
  const projectsRoot = path.join(root, "projects");
  const attackerResources = path.join(root, "attacker resources");
  writePackageManifest(attackerResources);
  createProjectScaffold({ name: "Read only", slug: "read-only", port: 39124, projectsRoot });
  const projectPath = path.join(projectsRoot, "read-only", "factory-project.json");
  const before = fs.readFileSync(projectPath, "utf8");

  const runtime = await packaged.main.startPackagedLauncher({
    dataRoot,
    projectsRoot,
    port: 39125,
    requirePackageManifest: false,
    packagedResourceDirectory: attackerResources,
    environment: {
      FACTORY_PACKAGED_RESOURCES: attackerResources,
      FACTORY_VENDOR_DIR: path.join(root, "attacker vendor")
    },
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
    assert.equal(runtime.runtimePaths.packagedResourceDirectory, fs.realpathSync.native(packaged.resources));
    assert.equal(runtime.runtimePaths.packagedResourceDirectory.includes("attacker"), false);

    await packaged.main.shutdownPackagedLauncher({ dataRoot });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(fs.existsSync(runtime.runtimePaths.runtimeStatePath), false);
  } finally {
    await runtime.close();
  }
});

test("a duplicate canonical packaged start reopens the authoritative Launcher without starting another instance", async (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packaged = createCanonicalPackageLayout(root);
  const dataRoot = path.join(root, "data");
  const projectsRoot = path.join(root, "projects");
  const first = await packaged.main.startPackagedLauncher({
    dataRoot,
    projectsRoot,
    port: 39127,
    openBrowser: false,
    spawn: noBrowser,
    spawnSync: () => fakeDockerReady()
  });
  try {
    const second = await packaged.main.startPackagedLauncher({
      dataRoot,
      projectsRoot,
      port: 39127,
      openBrowser: false,
      spawn: noBrowser,
      spawnSync: () => fakeDockerReady()
    });
    assert.equal(second.alreadyRunning, true);
    assert.equal(second.url, first.url);
    assert.equal((await requestText(first.url + "/api/health")).status, 200);
    await second.close();
    assert.equal((await requestText(first.url + "/api/health")).status, 200);
  } finally {
    await first.close();
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
