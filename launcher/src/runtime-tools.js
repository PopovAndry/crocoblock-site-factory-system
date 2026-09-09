"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { ensureDirectory } = require("./project-store");

function tailText(text, maxLength) {
  const content = String(text || "");
  if (content.length <= maxLength) {
    return content;
  }
  return content.slice(content.length - maxLength);
}

function runCommand(command, args, options) {
  const logPath = options.logPath;
  const cwd = options.cwd;
  const timeoutMs = options.timeoutMs || 120000;
  const ignoreExitCode = Boolean(options.ignoreExitCode);
  const env = options.env || process.env;
  const sensitiveOutput = options.sensitiveOutput === true;
  const sensitiveCategory = String(options.sensitiveCategory || "sensitive-command");
  const outputLimitBytes = sensitiveOutput ? (options.outputLimitBytes || 131072) : Infinity;

  ensureDirectory(path.dirname(logPath));

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const logStream = fs.createWriteStream(logPath, { flags: "w" });
    if (sensitiveOutput) logStream.write("[" + sensitiveCategory + "]\n");
    else logStream.write("$ " + [command].concat(args).join(" ") + "\n\n");
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputExceeded = false;

    let sensitiveSummaryWritten = false;
    const writeSensitiveSummary = (status, code) => {
      if (!sensitiveOutput || sensitiveSummaryWritten) return;
      sensitiveSummaryWritten = true;
      logStream.write("status=" + status + " code=" + String(code === undefined ? "unknown" : code) + " stdout_bytes=" + stdoutBytes + " stderr_bytes=" + stderrBytes + "\n");
    };

    const finish = (error, result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      logStream.end();

      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    };

    child.on("error", (error) => {
      writeSensitiveSummary("spawn_error", error && error.code || "unknown");
      if (error.code === "ENOENT") {
        finish(new Error(sensitiveOutput ? "Sensitive command unavailable." : "Command not found: " + command));
        return;
      }
      finish(error);
    });

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdoutBytes += Buffer.byteLength(text, "utf8");
      stdout += text;
      if (!sensitiveOutput) logStream.write(text);
      if (stdoutBytes + stderrBytes > outputLimitBytes) { outputExceeded = true; child.kill("SIGTERM"); }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderrBytes += Buffer.byteLength(text, "utf8");
      stderr += text;
      if (!sensitiveOutput) logStream.write(text);
      if (stdoutBytes + stderrBytes > outputLimitBytes) { outputExceeded = true; child.kill("SIGTERM"); }
    });

    child.on("close", (code) => {
      const result = {
        code,
        stdout,
        stderr,
        logPath
      };

      if (outputExceeded) {
        writeSensitiveSummary("output_limit", code);
        const error = new Error(sensitiveOutput ? "Sensitive command output exceeded its limit." : "Command output exceeded its limit.");
        error.code = "command_output_limit";
        finish(error);
        return;
      }

      writeSensitiveSummary(code === 0 ? "ok" : "failed", code);

      if (code !== 0 && !ignoreExitCode) {
        finish(new Error(sensitiveOutput ? "Sensitive command failed (" + code + ")." : "Command failed (" + code + "): " + [command].concat(args).join(" ") + "\n" + tailText(stderr || stdout, 1200)));
        return;
      }

      finish(null, result);
    });

    const timeoutHandle = setTimeout(() => {
      child.kill("SIGTERM");
      writeSensitiveSummary("timeout", "timeout");
      finish(new Error(sensitiveOutput ? "Sensitive command timed out." : "Command timed out after " + String(timeoutMs) + " ms: " + [command].concat(args).join(" ")));
    }, timeoutMs);
  });
}

module.exports = {
  runCommand,
  tailText
};
