"use strict";

const fs = require("node:fs");
const path = require("node:path");

function loadMacPackageConfiguration(repositoryRoot) {
  const root = path.resolve(repositoryRoot || path.join(__dirname, ".."));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "launcher", "package.json"), "utf8"));
  const config = JSON.parse(fs.readFileSync(path.join(root, "launcher", "macos", "package-config.json"), "utf8"));
  return { config, packageJson, repositoryRoot: root };
}

function validateMacPackageConfiguration(input) {
  const { config, packageJson, repositoryRoot } = input;
  const failures = [];
  if (config.schema_version !== 1) failures.push("Unsupported macOS package schema.");
  if (!Array.isArray(config.targets) || !config.targets.includes("arm64") || !config.targets.includes("x64")) failures.push("Both arm64 and x64 targets are required.");
  if (!Array.isArray(config.artifacts) || !config.artifacts.includes("app") || !config.artifacts.includes("dmg")) failures.push("Both app and dmg artifacts are required.");
  if (!packageJson.version || !/^\d+\.\d+\.\d+/.test(packageJson.version)) failures.push("Launcher package version is invalid.");
  if (!packageJson.factoryDesktop || packageJson.factoryDesktop.bundleIdentifier !== "com.crocoblock.sitefactory") failures.push("Desktop bundle identity is not centralized.");
  if (config.hardened_runtime !== true || !config.release || Object.values(config.release).some((value) => value !== true)) failures.push("Release security gates must remain required.");
  if (config.unsigned_engineering_mode !== "unsigned-engineering") failures.push("Unsigned engineering mode is not explicit.");
  for (const relativePath of [config.entry, config.entitlements_path]) {
    if (!relativePath || !fs.existsSync(path.resolve(repositoryRoot, relativePath))) failures.push("A required package input is missing.");
  }
  if (!config.icon_path || path.extname(config.icon_path).toLowerCase() !== ".icns") failures.push("A macOS ICNS icon input must be configured.");
  if (failures.length) {
    const error = new Error(failures.join(" "));
    error.code = "macos_package_configuration_invalid";
    throw error;
  }
  return {
    applicationName: packageJson.factoryDesktop.applicationName,
    bundleIdentifier: packageJson.factoryDesktop.bundleIdentifier,
    version: packageJson.version,
    targets: config.targets.slice(),
    artifacts: config.artifacts.slice(),
    iconConfigured: true,
    iconAvailable: fs.existsSync(path.resolve(repositoryRoot, config.icon_path))
  };
}

if (require.main === module) {
  try {
    const result = validateMacPackageConfiguration(loadMacPackageConfiguration());
    process.stdout.write("macOS package configuration valid: " + result.targets.join(", ") + "; icon configured; binary build not run.\n");
  } catch (error) {
    process.stderr.write("macOS package configuration is invalid.\n");
    process.exitCode = 1;
  }
}

module.exports = { loadMacPackageConfiguration, validateMacPackageConfiguration };
