"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildWindowsLauncherPackage,
  scanForDeveloperPaths
} = require("../../scripts/build-windows-launcher-package");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-package-build-"));
}

test("Windows development package contains only packaged runtime files and no developer absolute paths", () => {
  const root = createTempRoot();
  const fakeNode = path.join(root, "node.exe");
  fs.writeFileSync(fakeNode, "development-node-runtime", "utf8");
  const result = buildWindowsLauncherPackage({
    repositoryRoot: REPOSITORY_ROOT,
    outputRoot: path.join(root, "output"),
    nodeExecutable: fakeNode
  });

  assert.equal(fs.existsSync(path.join(result.packageRoot, "FactoryLauncher.exe")), true);
  assert.equal(fs.existsSync(path.join(result.packageRoot, "app", "launcher", "src", "windows-package-main.js")), true);
  assert.equal(fs.existsSync(path.join(result.packageRoot, "app", "launcher", "package.json")), true);
  assert.equal(fs.existsSync(path.join(result.packageRoot, "installer", "install.cmd")), true);
  assert.equal(fs.existsSync(path.join(result.packageRoot, "installer", "uninstall.cmd")), true);
  assert.equal(fs.existsSync(path.join(result.packageRoot, "app", "launcher", "src", "cli.js")), false);
  assert.equal(result.manifest.launch_entry, "app/launcher/src/windows-package-main.js");
  assert.doesNotThrow(() => scanForDeveloperPaths(result.packageRoot));
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
