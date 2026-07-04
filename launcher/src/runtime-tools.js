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
    logStream.write("$ " + [command].concat(args).join(" ") + "\n\n");

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
      if (error.code === "ENOENT") {
        finish(new Error("Command not found: " + command));
        return;
      }
      finish(error);
    });

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      logStream.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      logStream.write(text);
    });

    child.on("close", (code) => {
      const result = {
        code,
        stdout,
        stderr,
        logPath
      };

      if (code !== 0 && !ignoreExitCode) {
        finish(new Error("Command failed (" + code + "): " + [command].concat(args).join(" ") + "\n" + tailText(stderr || stdout, 1200)));
        return;
      }

      finish(null, result);
    });

    const timeoutHandle = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("Command timed out after " + String(timeoutMs) + " ms: " + [command].concat(args).join(" ")));
    }, timeoutMs);
  });
}

module.exports = {
  runCommand,
  tailText
};
