"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const PACKAGE_CONFIG_FILE = "launcher-config.json";
const RUNTIME_STATE_FILE = "launcher-runtime.json";
const LOG_FILE = "launcher.log";
const DEFAULT_LAUNCHER_PORT = 3847;

function defaultDataRoot(environment) {
  const env = environment || process.env;
  return path.join(env.LOCALAPPDATA || os.homedir(), "Crocoblock Site Factory");
}

function defaultProjectsRoot(environment) {
  const env = environment || process.env;
  return path.join(env.USERPROFILE || os.homedir(), "Documents", "Factory Projects");
}

function resolveRuntimePaths(options) {
  const dataRoot = path.resolve(options && options.dataRoot || defaultDataRoot(options && options.environment));
  return {
    dataRoot,
    configDirectory: path.join(dataRoot, "config"),
    logDirectory: path.join(dataRoot, "logs"),
    runtimeDirectory: path.join(dataRoot, "runtime"),
    configPath: path.join(dataRoot, "config", PACKAGE_CONFIG_FILE),
    logPath: path.join(dataRoot, "logs", LOG_FILE),
    runtimeStatePath: path.join(dataRoot, "runtime", RUNTIME_STATE_FILE)
  };
}

function sanitizeLogText(value) {
  return String(value == null ? "" : value)
    .replace(/\b(Authorization|password|token|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z]:\\[^\r\n\"']+/g, "[redacted-path]")
    .replace(/(?:^|\s)\/[A-Za-z0-9_./-]+/g, " [redacted-path]")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
}

function writeAtomicJson(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(directory, "." + path.basename(filePath) + "." + process.pid + ".tmp");
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (cleanupError) {
      // The original write error remains the actionable result.
    }
    throw error;
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return null;
  }
}

function normalizePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Launcher port must be between 1024 and 65535.");
  }
  return port;
}

function loadPackageConfig(runtimePaths, options) {
  const stored = readJsonFile(runtimePaths.configPath) || {};
  const requestedProjectsRoot = options && options.projectsRoot;
  const requestedPort = options && options.port;
  return {
    schema_version: 1,
    projects_root: path.resolve(requestedProjectsRoot || stored.projects_root || defaultProjectsRoot(options && options.environment)),
    preferred_port: normalizePort(requestedPort || stored.preferred_port || DEFAULT_LAUNCHER_PORT)
  };
}

function savePackageConfig(runtimePaths, config) {
  writeAtomicJson(runtimePaths.configPath, {
    schema_version: 1,
    projects_root: path.resolve(config.projects_root),
    preferred_port: normalizePort(config.preferred_port)
  });
}

function ensureWritableDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
  const probePath = path.join(directoryPath, ".write-probe-" + process.pid + "-" + crypto.randomBytes(4).toString("hex"));
  try {
    fs.writeFileSync(probePath, "ok", "utf8");
  } finally {
    try {
      fs.unlinkSync(probePath);
    } catch (error) {
      // A failed cleanup is detected by the caller's storage policy instead of exposing a path.
    }
  }
}

function canBindPort(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, host || "127.0.0.1", () => {
      probe.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(preferredPort, options) {
  const canBind = options && options.canBindPort || canBindPort;
  const preferred = normalizePort(preferredPort);
  if (await canBind(preferred, "127.0.0.1")) {
    return { port: preferred, preferredAvailable: true };
  }
  for (let candidate = preferred + 1; candidate <= Math.min(preferred + 24, 65535); candidate += 1) {
    if (await canBind(candidate, "127.0.0.1")) {
      return { port: candidate, preferredAvailable: false };
    }
  }
  throw new Error("No local Launcher port is available.");
}

function diagnoseDocker(options) {
  const spawnVersion = options && options.spawnSync || spawnSync;
  try {
    const result = spawnVersion("docker", ["version", "--format", "{{.Server.Version}}"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000
    });
    if (result && result.error && result.error.code === "ENOENT") {
      return { label: "Docker", status: "missing", message: "Docker is not installed or is unavailable." };
    }
    if (!result || result.status !== 0 || !String(result.stdout || "").trim()) {
      return { label: "Docker", status: "stopped", message: "Docker is installed but its local service is not ready." };
    }
    return { label: "Docker", status: "ready", message: "Docker local service is ready." };
  } catch (error) {
    return { label: "Docker", status: "stopped", message: "Docker local service is not ready." };
  }
}

function diagnoseProjectsRoot(projectsRoot) {
  try {
    if (!fs.existsSync(projectsRoot)) {
      return { label: "Projects", status: "empty", message: "No Factory projects have been found yet." };
    }
    fs.readdirSync(projectsRoot, { withFileTypes: true });
    return { label: "Projects", status: "ready", message: "Factory project storage is available." };
  } catch (error) {
    return { label: "Projects", status: "unavailable", message: "Factory project storage is unavailable." };
  }
}

function diagnoseDataRoot(runtimePaths, options) {
  try {
    const ensureWritable = options && options.ensureWritableDirectory || ensureWritableDirectory;
    ensureWritable(runtimePaths.configDirectory);
    ensureWritable(runtimePaths.logDirectory);
    ensureWritable(runtimePaths.runtimeDirectory);
    return { label: "Application data", status: "ready", message: "Application data storage is ready." };
  } catch (error) {
    return { label: "Application data", status: "unavailable", message: "Application data storage is unavailable." };
  }
}

async function collectRuntimeDiagnostics(config, runtimePaths, options) {
  const portAvailability = await findAvailablePort(config.preferred_port, options);
  const diagnostics = [
    diagnoseDocker(options),
    diagnoseProjectsRoot(config.projects_root),
    diagnoseDataRoot(runtimePaths, options),
    portAvailability.preferredAvailable
      ? { label: "Launcher port", status: "ready", message: "Launcher port is ready." }
      : { label: "Launcher port", status: "fallback", message: "Preferred Launcher port is in use. A local fallback port will be used." }
  ];
  const attentionRequired = diagnostics.some((diagnostic) => ["missing", "stopped", "unavailable"].includes(diagnostic.status));
  return {
    diagnostics,
    listeningPort: portAvailability.port,
    summary: attentionRequired ? "Some local services need attention." : "Runtime checks completed."
  };
}

function appendSafeLog(runtimePaths, event, details) {
  const payload = Object.assign({
    at: new Date().toISOString(),
    event: sanitizeLogText(event)
  }, details || {});
  const safePayload = Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, sanitizeLogText(value)]));
  fs.mkdirSync(runtimePaths.logDirectory, { recursive: true });
  fs.appendFileSync(runtimePaths.logPath, JSON.stringify(safePayload) + "\n", "utf8");
}

function secureCompare(left, right) {
  const expected = Buffer.from(String(left || ""), "utf8");
  const actual = Buffer.from(String(right || ""), "utf8");
  return expected.length > 0 && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function listenControlServer(token, close) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const loopback = request.socket && (request.socket.remoteAddress === "127.0.0.1" || request.socket.remoteAddress === "::ffff:127.0.0.1");
      if (!loopback || request.method !== "POST" || request.url !== "/close" || !secureCompare(token, request.headers["x-factory-runtime-token"])) {
        response.writeHead(404, { "Cache-Control": "no-store" });
        response.end();
        return;
      }
      response.writeHead(204, { "Cache-Control": "no-store" });
      response.end();
      setImmediate(close);
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function requestRuntimeShutdown(state, requestImplementation) {
  return new Promise((resolve, reject) => {
    const request = (requestImplementation || http.request)({
      host: "127.0.0.1",
      port: Number(state.control_port),
      method: "POST",
      path: "/close",
      headers: { "X-Factory-Runtime-Token": state.control_token }
    }, (response) => {
      response.resume();
      if (response.statusCode === 204) {
        resolve();
        return;
      }
      reject(new Error("Packaged Launcher did not accept the shutdown request."));
    });
    request.once("error", () => reject(new Error("Packaged Launcher is not running.")));
    request.end();
  });
}

function openBrowser(url, spawnImplementation) {
  const spawnBrowser = spawnImplementation || spawn;
  const child = spawnBrowser("cmd", ["/d", "/s", "/c", "start", "", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

module.exports = {
  DEFAULT_LAUNCHER_PORT,
  appendSafeLog,
  collectRuntimeDiagnostics,
  defaultDataRoot,
  defaultProjectsRoot,
  findAvailablePort,
  listenControlServer,
  loadPackageConfig,
  openBrowser,
  readJsonFile,
  requestRuntimeShutdown,
  resolveRuntimePaths,
  sanitizeLogText,
  savePackageConfig,
  writeAtomicJson
};
