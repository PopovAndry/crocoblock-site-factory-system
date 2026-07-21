"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PACKAGE_DIRECTORY_NAME = "FactoryLauncher-development";

function copyPackageSources(repositoryRoot, packageRoot, nodeExecutable) {
  const launcherSource = path.join(repositoryRoot, "launcher", "src");
  const installerSource = path.join(repositoryRoot, "launcher", "windows-installer");
  const appSource = path.join(packageRoot, "app", "launcher", "src");
  const installerDestination = path.join(packageRoot, "installer");
  fs.cpSync(launcherSource, appSource, {
    recursive: true,
    filter(sourcePath) {
      return path.basename(sourcePath) !== "cli.js";
    }
  });
  fs.copyFileSync(
    path.join(repositoryRoot, "launcher", "package.json"),
    path.join(packageRoot, "app", "launcher", "package.json")
  );
  fs.cpSync(installerSource, installerDestination, { recursive: true });
  fs.copyFileSync(nodeExecutable, path.join(packageRoot, "FactoryLauncher.exe"));
}

function scanForDeveloperPaths(packageRoot) {
  const blockedPaths = [
    /[a-z]:\\\\?crocoblock-site-factory-system/i,
    /[a-z]:\\\\?sf-factory-projects/i,
    /[a-z]:\\\\?sf-vendor/i
  ];
  const stack = [packageRoot];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!/\.(?:js|cmd|vbs|txt|json|css)$/i.test(entry.name)) {
        continue;
      }
      const content = fs.readFileSync(entryPath, "utf8").toLowerCase();
      if (blockedPaths.some((pattern) => pattern.test(content))) {
        throw new Error("Package contains a developer-specific path.");
      }
    }
  }
}

function buildWindowsLauncherPackage(options) {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const outputRoot = path.resolve(options.outputRoot);
  const nodeExecutable = path.resolve(options.nodeExecutable || process.execPath);
  const packageRoot = path.join(outputRoot, PACKAGE_DIRECTORY_NAME);
  if (fs.existsSync(packageRoot)) {
    throw new Error("Package output already exists. Choose a new output directory.");
  }
  if (!fs.existsSync(nodeExecutable) || !fs.statSync(nodeExecutable).isFile()) {
    throw new Error("A maintained Node.js executable is required to build the development package.");
  }
  fs.mkdirSync(outputRoot, { recursive: true });
  copyPackageSources(repositoryRoot, packageRoot, nodeExecutable);
  const manifest = {
    schema_version: 1,
    package_type: "windows_node_sidecar_development",
    launch_executable: "FactoryLauncher.exe",
    launch_entry: "app/launcher/src/windows-package-main.js",
    installer: "installer/install.cmd",
    uninstall: "installer/uninstall.cmd"
  };
  fs.writeFileSync(path.join(packageRoot, "package-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  scanForDeveloperPaths(packageRoot);
  return { packageRoot, manifest };
}

function createZipArchive(packageRoot) {
  const archivePath = packageRoot + ".zip";
  const result = spawnSync("tar", ["-a", "-c", "-f", archivePath, "-C", path.dirname(packageRoot), path.basename(packageRoot)], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    throw new Error("Windows package archive could not be created.");
  }
  return archivePath;
}

function parseBuildArguments(argv) {
  const argumentsByName = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) {
      continue;
    }
    const key = argv[index].slice(2);
    argumentsByName[key] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
  }
  return argumentsByName;
}

if (require.main === module) {
  try {
    const flags = parseBuildArguments(process.argv.slice(2));
    const repositoryRoot = path.resolve(__dirname, "..");
    const result = buildWindowsLauncherPackage({
      repositoryRoot,
      outputRoot: flags["output-root"] || path.join(repositoryRoot, "build"),
      nodeExecutable: flags["node-executable"] || process.execPath
    });
    const archivePath = createZipArchive(result.packageRoot);
    process.stdout.write("Windows Launcher package created: " + archivePath + "\n");
  } catch (error) {
    process.stderr.write("Windows Launcher package build failed. Check the package configuration.\n");
    process.exitCode = 1;
  }
}

module.exports = {
  PACKAGE_DIRECTORY_NAME,
  buildWindowsLauncherPackage,
  createZipArchive,
  parseBuildArguments,
  scanForDeveloperPaths
};
