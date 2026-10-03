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

test("spawn refusal reports start-not-established before any command output", async () => {
  const observed = [];
  const refusal = Object.assign(new Error("refused"), { code: "EPERM", errno: -4048, syscall: "spawn" });
  await assert.rejects(() => runCommand("ignored", [], {
    cwd: process.cwd(),
    logPath: logPath("spawn-refusal"),
    spawnProcess: () => { throw refusal; },
    childProcessObserver: {
      onStartNotEstablished: (error) => observed.push({ code: error.code, errno: error.errno, syscall: error.syscall })
    }
  }), { code: "EPERM" });
  assert.deepEqual(observed, [{ code: "EPERM", errno: -4048, syscall: "spawn" }]);
});

test("acknowledged child start is followed by one exit observation", async () => {
  const observed = [];
  const result = await runCommand(process.execPath, ["-e", "process.exit(0)"], {
    cwd: process.cwd(),
    logPath: logPath("spawn-acknowledged"),
    childProcessObserver: {
      onStartAcknowledged: () => observed.push("started"),
      onExit: (value) => observed.push({ code: value.code, signal: value.signal })
    }
  });
  assert.equal(result.code, 0);
  assert.deepEqual(observed, ["started", { code: 0, signal: null }]);
});

test("observer persistence failures after dispatch cannot return command success", async () => {
  const startFailure = Object.assign(new Error("start journal unavailable"), { code: "journal_start_failed" });
  await assert.rejects(() => runCommand(process.execPath, ["-e", "setTimeout(() => process.exit(0), 200)"], {
    cwd: process.cwd(),
    logPath: logPath("spawn-observer-start-failure"),
    childProcessObserver: { onStartAcknowledged: () => { throw startFailure; } }
  }), { code: "journal_start_failed" });

  const exitFailure = Object.assign(new Error("exit journal unavailable"), { code: "journal_exit_failed" });
  await assert.rejects(() => runCommand(process.execPath, ["-e", "process.exit(0)"], {
    cwd: process.cwd(),
    logPath: logPath("spawn-observer-exit-failure"),
    childProcessObserver: { onExit: () => { throw exitFailure; } }
  }), { code: "journal_exit_failed" });
});
