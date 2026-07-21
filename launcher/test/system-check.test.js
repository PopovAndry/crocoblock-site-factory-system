"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CHECK_STATES, collectSystemCheck } = require("../src/system-check");

function readyOptions(overrides) {
  return Object.assign({
    platform: "darwin",
    arch: "arm64",
    applicationDataDirectory: "/safe/app-data",
    projectsDirectory: "/safe/projects",
    ensureWritableDirectory() {},
    statfsSync() { return { bavail: 30, bsize: 1024 * 1024 * 1024 }; },
    totalMemory() { return 16 * 1024 * 1024 * 1024; },
    docker: { detected: true, running: true },
    dependencySources: [{ key: "kava", exists: true }, { key: "jet-engine", exists: true }]
  }, overrides || {});
}

test("System Check reports ready when every blocking prerequisite passes", () => {
  const result = collectSystemCheck(readyOptions());
  assert.equal(result.state, CHECK_STATES.PASS);
  assert.equal(result.title, "System ready");
  assert.equal(result.checks.every((check) => check.state === CHECK_STATES.PASS), true);
});

test("System Check distinguishes Docker missing from installed but stopped", () => {
  const missing = collectSystemCheck(readyOptions({ docker: { detected: false, running: false } }));
  const stopped = collectSystemCheck(readyOptions({ docker: { detected: true, running: false } }));
  assert.equal(missing.state, CHECK_STATES.ACTION_REQUIRED);
  assert.equal(missing.checks.find((check) => check.id === "docker_application").action.url, "https://www.docker.com/products/docker-desktop/");
  assert.match(stopped.checks.find((check) => check.id === "docker_daemon").message, /Start Docker Desktop/);
  assert.equal(stopped.checks.find((check) => check.id === "docker_application").state, CHECK_STATES.PASS);
});

test("System Check reports unsupported architecture", () => {
  const result = collectSystemCheck(readyOptions({ arch: "ia32" }));
  assert.equal(result.state, CHECK_STATES.UNSUPPORTED);
  assert.equal(result.title, "Unsupported system");
});

test("System Check reports unwritable application data as an error", () => {
  const result = collectSystemCheck(readyOptions({
    ensureWritableDirectory(directory) {
      if (directory === "/safe/app-data") throw new Error("password=do-not-echo");
    }
  }));
  assert.equal(result.state, CHECK_STATES.ERROR);
  assert.equal(JSON.stringify(result).includes("do-not-echo"), false);
});

test("System Check makes low disk blocking and low memory a warning", () => {
  const result = collectSystemCheck(readyOptions({
    statfsSync() { return { bavail: 2, bsize: 1024 * 1024 * 1024 }; },
    totalMemory() { return 4 * 1024 * 1024 * 1024; }
  }));
  assert.equal(result.checks.find((check) => check.id === "disk").state, CHECK_STATES.ACTION_REQUIRED);
  assert.equal(result.checks.find((check) => check.id === "memory").state, CHECK_STATES.WARNING);
  assert.equal(result.state, CHECK_STATES.ACTION_REQUIRED);
});

test("System Check reports missing trusted managed packages without exposing paths", () => {
  const result = collectSystemCheck(readyOptions({ dependencySources: [{ key: "kava", exists: false, absolutePath: "/private/source.zip" }] }));
  assert.equal(result.checks.find((check) => check.id === "managed_packages").state, CHECK_STATES.ACTION_REQUIRED);
  assert.equal(JSON.stringify(result).includes("/private/source.zip"), false);
});
