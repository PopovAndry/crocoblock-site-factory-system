"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

function verifyMacPackage(dmgPath, options) {
  if ((options && options.platform || process.platform) !== "darwin") throw new Error("macOS package verification requires macOS.");
  const runner = options && options.spawnSync || spawnSync;
  const target = path.resolve(dmgPath);
  for (const step of [
    ["codesign", ["--verify", "--strict", "--verbose=2", target]],
    ["xcrun", ["stapler", "validate", target]],
    ["spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", target]]
  ]) {
    const result = runner(step[0], step[1], { encoding: "utf8", stdio: "pipe", shell: false });
    if (!result || result.error || result.status !== 0) throw new Error("macOS package verification failed.");
  }
  return true;
}

if (require.main === module) {
  try {
    if (!process.argv[2]) throw new Error("Provide the DMG path to verify.");
    verifyMacPackage(process.argv[2]);
    process.stdout.write("macOS package signature, staple, and Gatekeeper checks passed.\n");
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  }
}

module.exports = { verifyMacPackage };
