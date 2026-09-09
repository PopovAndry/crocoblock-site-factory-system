"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runCommand } = require("../src/runtime-tools");

function logPath(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-runtime-tools-")), name + ".log");
}

test("sensitive command keeps observer sentinels out of persistent logs on success and failure", async () => {
  const successSentinel = "observer-hmac-sentinel-success";
  const successLog = logPath("success");
  const success = await runCommand(process.execPath, ["-e", "process.stdout.write(" + JSON.stringify(successSentinel) + ")"], { cwd: process.cwd(), logPath: successLog, sensitiveOutput: true, sensitiveCategory: "verify-existing-observer", outputLimitBytes: 1024 });
  assert.equal(success.stdout, successSentinel);
  assert.equal(fs.readFileSync(successLog, "utf8").includes(successSentinel), false);
  const failureSentinel = "observer-hmac-sentinel-failure";
  const failureLog = logPath("failure");
  await assert.rejects(() => runCommand(process.execPath, ["-e", "process.stderr.write(" + JSON.stringify(failureSentinel) + ");process.exit(7)"], { cwd: process.cwd(), logPath: failureLog, sensitiveOutput: true, sensitiveCategory: "verify-existing-observer", outputLimitBytes: 1024 }), /Sensitive command failed/);
  const failureLogText = fs.readFileSync(failureLog, "utf8");
  assert.equal(failureLogText.includes(failureSentinel), false);
});

test("sensitive command enforces bounded output without persisting its sentinel", async () => {
  const sentinel = "observer-hmac-sentinel-output-limit";
  const outputLog = logPath("limit");
  await assert.rejects(() => runCommand(process.execPath, ["-e", "process.stdout.write(" + JSON.stringify(sentinel.repeat(20)) + ")"], { cwd: process.cwd(), logPath: outputLog, sensitiveOutput: true, sensitiveCategory: "verify-existing-observer", outputLimitBytes: 16 }), { code: "command_output_limit" });
  assert.equal(fs.readFileSync(outputLog, "utf8").includes(sentinel), false);
});

test("ordinary command logging remains persistent by default", async () => {
  const sentinel = "ordinary-command-log-sentinel";
  const ordinaryLog = logPath("ordinary");
  await runCommand(process.execPath, ["-e", "process.stdout.write(" + JSON.stringify(sentinel) + ")"], { cwd: process.cwd(), logPath: ordinaryLog });
  assert.equal(fs.readFileSync(ordinaryLog, "utf8").includes(sentinel), true);
});
