"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  loadMacPackageConfiguration,
  validateMacPackageConfiguration
} = require("../../scripts/validate-macos-package-config");
const { validateReleasePrerequisites } = require("../../scripts/macos-signing");
const { assertMacBuildHost } = require("../../scripts/build-macos-launcher-package");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");

test("macOS package configuration centralizes identity and version", () => {
  const loaded = loadMacPackageConfiguration(REPOSITORY_ROOT);
  const result = validateMacPackageConfiguration(loaded);
  assert.equal(result.applicationName, "Crocoblock Site Factory");
  assert.equal(result.bundleIdentifier, "com.crocoblock.sitefactory");
  assert.equal(result.version, loaded.packageJson.version);
  assert.equal(loaded.config.version_source, "launcher/package.json");
});

test("macOS package configuration includes arm64, x64, app, DMG and hardened release gates", () => {
  const loaded = loadMacPackageConfiguration(REPOSITORY_ROOT);
  const result = validateMacPackageConfiguration(loaded);
  assert.deepEqual(result.targets, ["arm64", "x64"]);
  assert.deepEqual(result.artifacts, ["app", "dmg"]);
  assert.equal(loaded.config.hardened_runtime, true);
  assert.equal(Object.values(loaded.config.release).every(Boolean), true);
  assert.equal(fs.existsSync(path.resolve(REPOSITORY_ROOT, loaded.config.entitlements_path)), true);
});

test("evaluation signing prerequisites fail clearly without credentials", () => {
  assert.throws(
    () => validateReleasePrerequisites({ environment: {} }),
    (error) => error.code === "macos_release_prerequisite_missing" && !/password|private key/i.test(error.message)
  );
});

test("evaluation signing accepts external keychain references without logging secret material", () => {
  const result = validateReleasePrerequisites({
    environment: {
      APPLE_DEVELOPER_IDENTITY: "Developer ID Application: Example Company",
      APPLE_NOTARY_KEYCHAIN_PROFILE: "site-factory-notary"
    }
  });
  assert.equal(result.notaryProfile, "site-factory-notary");
  assert.equal(Object.hasOwn(result, "password"), false);
});

test("unsigned engineering commands and artifact labels cannot be confused with evaluation builds", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, "launcher", "package.json"), "utf8"));
  assert.match(packageJson.scripts["package:mac:arm64:unsigned-engineering"], /--mode unsigned-engineering/);
  assert.match(packageJson.scripts["package:mac:x64:unsigned-engineering"], /--mode unsigned-engineering/);
  const builder = fs.readFileSync(path.join(REPOSITORY_ROOT, "scripts", "build-macos-launcher-package.js"), "utf8");
  assert.match(builder, /UNSIGNED_ENGINEERING_ONLY/);
  assert.match(builder, /-UNSIGNED-ENGINEERING/);
});

test("macOS binary build gate rejects non-macOS hosts", () => {
  assert.throws(() => assertMacBuildHost("arm64", { platform: "win32", hostArch: "x64" }), /macOS host/);
});
