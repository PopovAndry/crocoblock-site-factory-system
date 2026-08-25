"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { listDependencyDefinitions } = require("../src/dependency-catalog");
const {
  APPLICATION_EXECUTABLE,
  ARTIFACT_LABEL,
  TAR_MAX_BUFFER,
  TAR_TIMEOUT_MS,
  assertUniqueDestinationPaths,
  buildWindowsLauncherPackage,
  createZipArchive,
  scanPackageArtifact,
  validateBuildFilesystem,
  writeArchiveChecksum
} = require("../../scripts/build-windows-launcher-package");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-package-build-"));
}

function createApprovedVendorBundle(root) {
  const vendorDirectory = path.join(root, "vendor-inputs");
  fs.mkdirSync(vendorDirectory, { recursive: true });
  for (const dependency of listDependencyDefinitions()) {
    const staging = path.join(root, "staging-" + dependency.slug);
    const identityPath = path.join(staging, dependency.identity_file);
    fs.mkdirSync(path.dirname(identityPath), { recursive: true });
    fs.writeFileSync(identityPath, dependency.type === "theme"
      ? "/*\nTheme Name: Test\nVersion: 1.2.3\n*/\n"
      : "<?php\n/*\nPlugin Name: Test\nVersion: 1.2.3\n*/\n", "utf8");
    const archivePath = path.join(vendorDirectory, dependency.slug + ".zip");
    const archived = spawnSync("tar", ["-a", "-c", "-f", archivePath, "-C", staging, dependency.zip_root], { encoding: "utf8", windowsHide: true });
    assert.equal(archived.status, 0, archived.stderr || "test ZIP creation failed");
  }
  return vendorDirectory;
}

function createBuildFixture(root) {
  const repositoryRoot = path.join(root, "repository");
  const launcherRoot = path.join(repositoryRoot, "launcher");
  fs.mkdirSync(launcherRoot, { recursive: true });
  for (const relativePath of ["src", "contracts", "windows-installer", "package.json"]) {
    fs.cpSync(path.join(REPOSITORY_ROOT, "launcher", relativePath), path.join(launcherRoot, relativePath), { recursive: true, force: true });
  }
  fs.cpSync(path.join(REPOSITORY_ROOT, "wordpress-plugin"), path.join(repositoryRoot, "wordpress-plugin"), { recursive: true });
  const nodeExecutable = path.join(root, "node.exe");
  fs.writeFileSync(nodeExecutable, "synthetic node", "utf8");
  return {
    repositoryRoot,
    nodeExecutable,
    vendorDirectory: createApprovedVendorBundle(root),
    outputRoot: path.join(root, "output")
  };
}

function buildFixtureOptions(fixture, outputRoot) {
  return {
    repositoryRoot: fixture.repositoryRoot,
    outputRoot: outputRoot || fixture.outputRoot,
    nodeExecutable: fixture.nodeExecutable,
    vendorDirectory: fixture.vendorDirectory
  };
}

test("Windows internal evaluation package closes the current Create Website runtime and resource manifest", () => {
  const root = createTempRoot();
  const fakeNode = path.join(root, "node.exe");
  fs.writeFileSync(fakeNode, "packaged-node-runtime", "utf8");
  const result = buildWindowsLauncherPackage({
    repositoryRoot: REPOSITORY_ROOT,
    outputRoot: path.join(root, "output"),
    nodeExecutable: fakeNode,
    vendorDirectory: createApprovedVendorBundle(root)
  });

  const requiredFiles = [
    APPLICATION_EXECUTABLE,
    "Launch Crocoblock Site Factory.vbs",
    "app/launcher/package.json",
    "app/launcher/src/windows-package-main.js",
    "app/launcher/src/windows-package-runtime.js",
    "app/launcher/src/platform-runtime.js",
    "app/launcher/src/system-check.js",
    "app/launcher/src/server.js",
    "app/launcher/src/create-website.js",
    "app/launcher/src/ui/create-website-ui.js",
    "app/launcher/src/ui/app.js",
    "app/launcher/src/ui/styles.css",
    "app/launcher/src/project-store.js",
    "app/launcher/src/project-operation-coordinator.js",
    "app/launcher/src/dependency-sources.js",
    "app/launcher/src/managed-package-cache.js",
    "app/launcher/src/package-validator.js",
    "app/launcher/src/install-agent.js",
    "app/launcher/src/real-estate-contract.js",
    "app/launcher/contracts/real-estate-contract.v1.json",
    "app/wordpress-plugin/crocoblock-site-factory.php",
    "app/wordpress-plugin/presets/real-estate.json",
    "installer/install.cmd",
    "installer/uninstall.cmd",
    "resources/package-manifest.json",
    "resources/managed-packages/kava.zip",
    "resources/managed-packages/jet-engine.zip",
    "resources/managed-packages/jet-smart-filters.zip"
  ];
  for (const relativePath of requiredFiles) {
    assert.equal(fs.existsSync(path.join(result.packageRoot, ...relativePath.split("/"))), true, relativePath);
  }
  assert.equal(fs.existsSync(path.join(result.packageRoot, "app", "launcher", "src", "cli.js")), false);
  assert.equal(result.manifest.artifact_label, ARTIFACT_LABEL);
  assert.equal(result.manifest.application_name, "Crocoblock Site Factory");
  assert.equal(result.manifest.application_version, require("../package.json").version);
  assert.equal(result.manifest.architecture, "x64");
  assert.equal(result.manifest.signed, false);
  assert.equal(result.manifest.public_release_ready, false);
  assert.equal(result.manifest.rehearsal.frozen_project_slug, "win-ceo-rehearsal-smoke-3");
  assert.equal(result.manifest.managed_packages.length, 3);
  assert.equal(result.manifest.managed_packages.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)), true);
  assert.equal(result.inventory.some((entry) => /(?:^|\/)test(?:s)?\//i.test(entry)), false);
  assert.doesNotThrow(() => scanPackageArtifact(result.packageRoot));

  const archivePath = createZipArchive(result.packageRoot, path.join(root, result.identity.archiveName));
  const checksum = writeArchiveChecksum(archivePath);
  assert.equal(fs.existsSync(archivePath), true);
  assert.equal(fs.existsSync(checksum.checksumPath), true);
  assert.match(checksum.digest, /^[a-f0-9]{64}$/);
});

test("package scan rejects developer paths, credentials, and prior runtime state", () => {
  const root = createTempRoot();
  fs.writeFileSync(path.join(root, "bad.json"), JSON.stringify({ root: "C:\\sf-vendor\\kava.zip" }), "utf8");
  assert.throws(() => scanPackageArtifact(root), /developer-specific absolute path/);
  fs.rmSync(path.join(root, "bad.json"));
  fs.writeFileSync(path.join(root, ".env"), "WP_ADMIN_PASSWORD=not-a-real-password\n", "utf8");
  assert.throws(() => scanPackageArtifact(root), /blocked runtime or credential file/);
  fs.rmSync(path.join(root, ".env"));
  fs.mkdirSync(path.join(root, "proofs"));
  assert.throws(() => scanPackageArtifact(root), /runtime-state directory/);
});

test("proprietary dependency archives are not tracked by Git", () => {
  const result = spawnSync("git", ["ls-files", "*.zip"], { cwd: REPOSITORY_ROOT, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0);
  assert.equal(String(result.stdout || "").trim(), "");
});

test("builder rejects source/output aliasing and source reparse entries before output mutation", (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = createBuildFixture(root);
  const aliases = [
    path.join(fixture.repositoryRoot, "launcher", "src"),
    path.join(fixture.repositoryRoot, "launcher", "src", "inside-output"),
    fixture.repositoryRoot
  ];
  for (const outputRoot of aliases) {
    assert.throws(() => buildWindowsLauncherPackage(buildFixtureOptions(fixture, outputRoot)), /filesystem layout is invalid/);
  }
  const outside = path.join(root, "outside-target");
  const linkedEntry = path.join(fixture.repositoryRoot, "launcher", "src", "linked-source");
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "preserved.txt"), "outside\n", "utf8");
  try {
    fs.symlinkSync(outside, linkedEntry, "junction");
  } catch (error) {
    try {
      fs.symlinkSync(outside, linkedEntry, "dir");
    } catch (linkError) {
      t.skip("Local symlink and junction creation are unavailable on this host.");
      return;
    }
  }
  assert.throws(() => buildWindowsLauncherPackage(buildFixtureOptions(fixture)), /filesystem layout is invalid/);
  assert.equal(fs.existsSync(fixture.outputRoot), false);
  assert.equal(fs.existsSync(path.join(outside, "preserved.txt")), true);
});

test("builder rejects output junction aliases and Windows case aliases before output mutation", (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = createBuildFixture(root);
  const alias = path.join(root, "output-alias");
  try {
    fs.symlinkSync(path.join(fixture.repositoryRoot, "launcher", "src"), alias, "junction");
  } catch (error) {
    try {
      fs.symlinkSync(path.join(fixture.repositoryRoot, "launcher", "src"), alias, "dir");
    } catch (linkError) {
      t.skip("Local symlink and junction creation are unavailable on this host.");
      return;
    }
  }
  assert.throws(() => buildWindowsLauncherPackage(buildFixtureOptions(fixture, alias)), /filesystem layout is invalid/);
  assert.equal(fs.existsSync(path.join(alias, "Crocoblock-Site-Factory-Windows-x64-0.1.0-beta")), false);
  if (process.platform === "win32") {
    const caseAlias = path.join(fixture.repositoryRoot, "LAUNCHER", "SRC");
    assert.throws(() => buildWindowsLauncherPackage(buildFixtureOptions(fixture, caseAlias)), /filesystem layout is invalid/);
  }
});

test("builder rejects duplicate and case-colliding package destinations", () => {
  assert.throws(() => assertUniqueDestinationPaths(["app/launcher/src/index.js", "app/launcher/src/index.js"]), /filesystem layout is invalid/);
  if (process.platform === "win32") {
    assert.throws(() => assertUniqueDestinationPaths(["app/Launcher/src/index.js", "app/launcher/src/index.js"]), /filesystem layout is invalid/);
  }
  const root = createTempRoot();
  const fixture = createBuildFixture(root);
  assert.doesNotThrow(() => validateBuildFilesystem(buildFixtureOptions(fixture)));
  fs.rmSync(root, { recursive: true, force: true });
});

test("archive creation has a fixed bounded process boundary and removes only its partial archive", () => {
  const root = createTempRoot();
  const packageRoot = path.join(root, "package");
  const archivePath = path.join(root, "archive.zip");
  const unrelatedPath = path.join(root, "unrelated.txt");
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(unrelatedPath, "preserve\n", "utf8");
  const cases = [
    { name: "nonzero", result: { status: 1 } },
    { name: "timeout", result: { status: null, error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) } },
    { name: "oversized output", result: { status: null, error: Object.assign(new Error("buffer"), { code: "ENOBUFS" }), stdout: "x".repeat(TAR_MAX_BUFFER + 1) } },
    { name: "signal", result: { status: null, signal: "SIGTERM" } }
  ];
  for (const entry of cases) {
    let invocation;
    assert.throws(() => createZipArchive(packageRoot, archivePath, {
      spawnSync(command, args, options) {
        invocation = { command, args, options };
        fs.writeFileSync(archivePath, "partial\n", "utf8");
        return entry.result;
      }
    }), /archive could not be created/);
    assert.equal(invocation.command, "tar", entry.name);
    assert.equal(invocation.options.shell, false, entry.name);
    assert.equal(invocation.options.timeout, TAR_TIMEOUT_MS, entry.name);
    assert.equal(invocation.options.maxBuffer, TAR_MAX_BUFFER, entry.name);
    assert.equal(fs.existsSync(archivePath), false, entry.name);
    assert.equal(fs.existsSync(unrelatedPath), true, entry.name);
  }
  assert.throws(() => createZipArchive(packageRoot, archivePath, {
    spawnSync() { throw new Error("unavailable"); }
  }), /archive could not be created/);
  assert.equal(fs.existsSync(archivePath), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("uninstaller removes only application files and explicitly preserves data and projects", () => {
  const uninstallPath = path.join(REPOSITORY_ROOT, "launcher", "windows-installer", "uninstall.cmd");
  const uninstall = fs.readFileSync(uninstallPath, "utf8");
  assert.match(uninstall, /set "INSTALL_ROOT=%%~fI"/i);
  assert.match(uninstall, /cd \/d "%SystemRoot%"/i);
  assert.match(uninstall, /start "" \/b cmd\.exe \/d \/c/i);
  assert.match(uninstall, /rmdir \/s \/q ""%INSTALL_ROOT%""/i);
  assert.doesNotMatch(uninstall, /LOCALAPPDATA.*Crocoblock Site Factory/i);
  assert.doesNotMatch(uninstall, /Documents\\Factory Projects/i);
  assert.match(uninstall, /project and application data were preserved/i);
});
