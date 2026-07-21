"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertSafeExternalUrl,
  externalOpenCommand,
  getPlatformIdentity,
  openExternalUrl,
  resolvePlatformDirectories,
  spawnOwnedProcess,
  stopOwnedProcess
} = require("../src/platform-runtime");

test("product platform identity recognizes Windows and both macOS architectures", () => {
  assert.equal(getPlatformIdentity({ platform: "win32", arch: "x64" }).supported, true);
  assert.equal(getPlatformIdentity({ platform: "darwin", arch: "arm64" }).supported, true);
  assert.equal(getPlatformIdentity({ platform: "darwin", arch: "x64" }).supported, true);
});

test("product platform identity fails closed for unsupported targets", () => {
  assert.equal(getPlatformIdentity({ platform: "darwin", arch: "ia32" }).supported, false);
  assert.equal(getPlatformIdentity({ platform: "linux", arch: "x64" }).productTarget, false);
});

test("macOS mutable directories use standard user locations outside the app bundle", () => {
  const directories = resolvePlatformDirectories({
    platform: "darwin",
    arch: "arm64",
    homeDirectory: "/Users/evaluator",
    temporaryDirectory: "/private/tmp",
    packagedResourceDirectory: "/Applications/Crocoblock Site Factory.app/Contents/Resources"
  });
  assert.equal(directories.applicationData, "/Users/evaluator/Library/Application Support/Crocoblock Site Factory");
  assert.equal(directories.cache, "/Users/evaluator/Library/Caches/Crocoblock Site Factory");
  assert.equal(directories.logs, "/Users/evaluator/Library/Logs/Crocoblock Site Factory");
  assert.equal(directories.projects, "/Users/evaluator/Documents/Factory Projects");
  for (const mutable of [directories.applicationData, directories.cache, directories.logs, directories.projects, directories.temporary]) {
    assert.equal(mutable.startsWith(directories.packagedResources), false);
  }
});

test("Windows portable directories preserve existing LOCALAPPDATA and Documents defaults", () => {
  const directories = resolvePlatformDirectories({
    platform: "win32",
    arch: "x64",
    environment: { LOCALAPPDATA: "C:\\Users\\Eva\\AppData\\Local", USERPROFILE: "C:\\Users\\Eva" },
    homeDirectory: "C:\\Users\\Eva",
    temporaryDirectory: "C:\\Temp",
    packagedResourceDirectory: "C:\\Program Files\\Crocoblock Site Factory\\resources"
  });
  assert.equal(directories.applicationData, "C:\\Users\\Eva\\AppData\\Local\\Crocoblock Site Factory");
  assert.equal(directories.projects, "C:\\Users\\Eva\\Documents\\Factory Projects");
});

test("external URL boundary accepts only credential-free HTTP and HTTPS", () => {
  assert.equal(assertSafeExternalUrl("https://www.docker.com/products/docker-desktop/").startsWith("https://"), true);
  assert.throws(() => assertSafeExternalUrl("file:///etc/passwd"));
  assert.throws(() => assertSafeExternalUrl("javascript:alert(1)"));
  assert.throws(() => assertSafeExternalUrl("https://user:secret@example.test/"));
});

test("external open commands are platform-specific argument arrays", () => {
  assert.deepEqual(externalOpenCommand("darwin", "https://example.test/"), { command: "open", args: ["https://example.test/"] });
  assert.deepEqual(externalOpenCommand("win32", "https://example.test/"), { command: "explorer.exe", args: ["https://example.test/"] });
});

test("external URL opening never enables a shell", () => {
  let invocation;
  openExternalUrl("https://example.test/path?q=one%20two", {
    platform: "darwin",
    spawn(command, args, options) {
      invocation = { command, args, options };
      return { unref() {} };
    }
  });
  assert.equal(invocation.command, "open");
  assert.deepEqual(invocation.args, ["https://example.test/path?q=one%20two"]);
  assert.equal(invocation.options.shell, false);
});

test("Launcher-owned process spawn and stop stay scoped to the returned child", () => {
  let invocation;
  const child = { kill(signal) { return signal === "SIGTERM"; } };
  const returned = spawnOwnedProcess("tool", ["--safe", "value"], {
    spawn(command, args, options) {
      invocation = { command, args, options };
      return child;
    }
  });
  assert.equal(returned, child);
  assert.equal(invocation.options.shell, false);
  assert.equal(stopOwnedProcess(returned), true);
  assert.throws(() => stopOwnedProcess({}));
});
