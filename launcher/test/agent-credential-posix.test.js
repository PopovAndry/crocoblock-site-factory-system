"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { hardenCredentialPath } = require("../src/agent-credential-store");

function virtualPermissions(isDirectory, initialMode, appliedMode) {
  let mode = initialMode;
  return {
    options: {
      platform: "darwin",
      statSync() { return { isDirectory: () => isDirectory, mode }; },
      chmodSync(target, requested) { mode = appliedMode == null ? requested : appliedMode; }
    },
    mode() { return mode; }
  };
}

test("POSIX credential files are corrected to mode 0600 and verified", () => {
  const permissions = virtualPermissions(false, 0o100644);
  const result = hardenCredentialPath("credential.json", permissions.options);
  assert.equal(permissions.mode(), 0o600);
  assert.deepEqual(result, { mode: 0o600, type: "file" });
});

test("POSIX credential directories are corrected to mode 0700 and verified", () => {
  const permissions = virtualPermissions(true, 0o40755);
  const result = hardenCredentialPath("secrets", permissions.options);
  assert.equal(permissions.mode(), 0o700);
  assert.deepEqual(result, { mode: 0o700, type: "directory" });
});

test("POSIX credential hardening fails closed when chmod does not take effect", () => {
  const permissions = virtualPermissions(false, 0o100644, 0o100644);
  assert.throws(
    () => hardenCredentialPath("credential.json", permissions.options),
    (error) => error.code === "agent_signed_posix_permissions_verification_failed"
  );
});

test("POSIX permission errors never include secret content or filesystem paths", () => {
  const secret = "sensitive-signing-secret";
  assert.throws(
    () => hardenCredentialPath("/Users/private/" + secret, {
      platform: "darwin",
      statSync() { throw new Error(secret); }
    }),
    (error) => !error.message.includes(secret) && !error.message.includes("/Users/private")
  );
});
