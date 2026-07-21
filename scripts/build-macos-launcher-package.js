"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  loadMacPackageConfiguration,
  validateMacPackageConfiguration
} = require("./validate-macos-package-config");
const {
  signApplication,
  signNotarizeAndVerifyDmg,
  validateReleasePrerequisites
} = require("./macos-signing");

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2);
    result[key] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
  }
  return result;
}

function escapePlist(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function assertMacBuildHost(arch, options) {
  const platform = options && options.platform || process.platform;
  const hostArch = options && options.hostArch || process.arch;
  if (platform !== "darwin") throw new Error("macOS packages must be built on a macOS host or verified macOS CI runner.");
  if (hostArch !== arch) throw new Error("This builder creates a native package only for the current Mac architecture.");
}

function runTool(command, args, options) {
  const runner = options && options.spawnSync || spawnSync;
  const result = runner(command, args, { encoding: "utf8", stdio: "pipe", shell: false });
  if (!result || result.error || result.status !== 0) throw new Error("macOS package tool failed: " + command + ".");
}

function writeInfoPlist(filePath, identity, executableName) {
  const content = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"https://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\"><dict>",
    "<key>CFBundleDisplayName</key><string>" + escapePlist(identity.applicationName) + "</string>",
    "<key>CFBundleExecutable</key><string>" + escapePlist(executableName) + "</string>",
    "<key>CFBundleIdentifier</key><string>" + escapePlist(identity.bundleIdentifier) + "</string>",
    "<key>CFBundleName</key><string>" + escapePlist(identity.applicationName) + "</string>",
    "<key>CFBundleShortVersionString</key><string>" + escapePlist(identity.version) + "</string>",
    "<key>CFBundleVersion</key><string>" + escapePlist(identity.version) + "</string>",
    "<key>CFBundleIconFile</key><string>CrocoblockSiteFactory</string>",
    "<key>LSMinimumSystemVersion</key><string>12.0</string>",
    "<key>NSHighResolutionCapable</key><true/>",
    "</dict></plist>",
    ""
  ].join("\n");
  fs.writeFileSync(filePath, content, "utf8");
}

function buildMacPackage(options) {
  const safeOptions = options || {};
  const repositoryRoot = path.resolve(safeOptions.repositoryRoot || path.join(__dirname, ".."));
  const configuration = loadMacPackageConfiguration(repositoryRoot);
  const identity = validateMacPackageConfiguration(configuration);
  const arch = safeOptions.arch;
  const mode = safeOptions.mode;
  if (!identity.targets.includes(arch)) throw new Error("Unsupported macOS package architecture.");
  if (!["evaluation", configuration.config.unsigned_engineering_mode].includes(mode)) throw new Error("A named macOS package mode is required.");
  assertMacBuildHost(arch, safeOptions);

  const iconPath = path.resolve(repositoryRoot, configuration.config.icon_path);
  if (!fs.existsSync(iconPath)) throw new Error("The approved macOS ICNS application icon is required before packaging.");
  const prerequisites = mode === "evaluation" ? validateReleasePrerequisites(safeOptions) : null;
  const outputRoot = path.resolve(safeOptions.outputRoot || path.join(repositoryRoot, "build", "macos", arch));
  const appPath = path.join(outputRoot, identity.applicationName + ".app");
  const contents = path.join(appPath, "Contents");
  const macosDirectory = path.join(contents, "MacOS");
  const resourcesDirectory = path.join(contents, "Resources");
  if (fs.existsSync(appPath)) throw new Error("macOS package output already exists.");
  fs.mkdirSync(path.join(resourcesDirectory, "app", "launcher"), { recursive: true });
  fs.mkdirSync(path.join(resourcesDirectory, "managed-packages"), { recursive: true });
  fs.mkdirSync(macosDirectory, { recursive: true });
  fs.cpSync(path.join(repositoryRoot, "launcher", "src"), path.join(resourcesDirectory, "app", "launcher", "src"), {
    recursive: true,
    filter(sourcePath) { return path.basename(sourcePath) !== "cli.js"; }
  });
  fs.copyFileSync(path.join(repositoryRoot, "launcher", "package.json"), path.join(resourcesDirectory, "app", "launcher", "package.json"));
  fs.copyFileSync(iconPath, path.join(resourcesDirectory, "CrocoblockSiteFactory.icns"));
  fs.copyFileSync(safeOptions.nodeExecutable || process.execPath, path.join(macosDirectory, "FactoryLauncherNode"));
  fs.chmodSync(path.join(macosDirectory, "FactoryLauncherNode"), 0o755);
  const executableName = "Crocoblock Site Factory";
  const launcherScript = "#!/bin/sh\nHERE=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)\nexport FACTORY_PACKAGED_RESOURCES=\"$HERE/../Resources\"\nexec \"$HERE/FactoryLauncherNode\" \"$HERE/../Resources/app/launcher/src/macos-package-main.js\"\n";
  fs.writeFileSync(path.join(macosDirectory, executableName), launcherScript, { encoding: "utf8", mode: 0o755 });
  writeInfoPlist(path.join(contents, "Info.plist"), identity, executableName);
  fs.writeFileSync(path.join(resourcesDirectory, "package-manifest.json"), JSON.stringify({
    schema_version: 1,
    artifact_class: mode === "evaluation" ? "CEO_EVALUATION" : "UNSIGNED_ENGINEERING_ONLY",
    architecture: arch,
    application_version: identity.version,
    managed_packages: "external_approved_bundle_or_release_injection"
  }, null, 2) + "\n", "utf8");

  const entitlementsPath = path.resolve(repositoryRoot, configuration.config.entitlements_path);
  if (mode === "evaluation") signApplication(appPath, { entitlementsPath }, prerequisites, safeOptions);
  const dmgPath = path.join(outputRoot, "Crocoblock-Site-Factory-" + identity.version + "-" + arch + (mode === "evaluation" ? "" : "-UNSIGNED-ENGINEERING") + ".dmg");
  runTool("hdiutil", ["create", "-volname", identity.applicationName, "-srcfolder", appPath, "-ov", "-format", "UDZO", dmgPath], safeOptions);
  if (mode === "evaluation") signNotarizeAndVerifyDmg(dmgPath, prerequisites, safeOptions);
  return { appPath, arch, dmgPath, mode };
}

if (require.main === module) {
  try {
    const flags = parseArguments(process.argv.slice(2));
    const result = buildMacPackage({ arch: flags.arch, mode: flags.mode, outputRoot: flags["output-root"] });
    process.stdout.write("macOS package created: " + path.basename(result.dmgPath) + "\n");
  } catch (error) {
    process.stderr.write("macOS package build blocked: " + error.message + "\n");
    process.exitCode = 1;
  }
}

module.exports = { assertMacBuildHost, buildMacPackage, parseArguments, writeInfoPlist };
