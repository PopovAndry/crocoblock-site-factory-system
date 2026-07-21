"use strict";

const { spawnSync } = require("node:child_process");

function validateReleasePrerequisites(options) {
  const environment = options && options.environment || process.env;
  const missing = [];
  if (!environment.APPLE_DEVELOPER_IDENTITY) missing.push("APPLE_DEVELOPER_IDENTITY (Developer ID Application identity in the macOS keychain)");
  if (!environment.APPLE_NOTARY_KEYCHAIN_PROFILE) missing.push("APPLE_NOTARY_KEYCHAIN_PROFILE (preconfigured notarytool keychain profile)");
  if (missing.length) {
    const error = new Error("macOS evaluation packaging requires: " + missing.join("; ") + ".");
    error.code = "macos_release_prerequisite_missing";
    throw error;
  }
  return {
    identity: environment.APPLE_DEVELOPER_IDENTITY,
    notaryProfile: environment.APPLE_NOTARY_KEYCHAIN_PROFILE
  };
}

function runTool(command, args, options) {
  const runner = options && options.spawnSync || spawnSync;
  const result = runner(command, args, { encoding: "utf8", stdio: "pipe", shell: false });
  if (!result || result.error || result.status !== 0) {
    const error = new Error("macOS package security verification failed at " + command + ".");
    error.code = "macos_package_security_step_failed";
    throw error;
  }
}

function signApplication(appPath, config, prerequisites, options) {
  runTool("codesign", ["--force", "--deep", "--options", "runtime", "--timestamp", "--entitlements", config.entitlementsPath, "--sign", prerequisites.identity, appPath], options);
  runTool("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], options);
}

function signNotarizeAndVerifyDmg(dmgPath, prerequisites, options) {
  runTool("codesign", ["--force", "--timestamp", "--sign", prerequisites.identity, dmgPath], options);
  runTool("xcrun", ["notarytool", "submit", dmgPath, "--keychain-profile", prerequisites.notaryProfile, "--wait"], options);
  runTool("xcrun", ["stapler", "staple", dmgPath], options);
  runTool("xcrun", ["stapler", "validate", dmgPath], options);
  runTool("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", dmgPath], options);
}

module.exports = {
  signApplication,
  signNotarizeAndVerifyDmg,
  validateReleasePrerequisites
};
