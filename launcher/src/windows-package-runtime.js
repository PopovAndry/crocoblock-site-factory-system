"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  openExternalUrl,
  resolveCanonicalPackagedLayout,
  resolvePlatformDirectories
} = require("./platform-runtime");
const { collectSystemCheck } = require("./system-check");

const PACKAGE_CONFIG_FILE = "launcher-config.json";
const RUNTIME_STATE_FILE = "launcher-runtime.json";
const LOG_FILE = "launcher.log";
const DEFAULT_LAUNCHER_PORT = 3847;

function defaultDataRoot(environment, options) {
  return resolvePlatformDirectories(Object.assign({}, options || {}, {
    environment: environment || process.env
  })).applicationData;
}

function defaultProjectsRoot(environment, options) {
  return resolvePlatformDirectories(Object.assign({}, options || {}, {
    environment: environment || process.env
  })).projects;
}

function resolveRuntimePaths(options) {
  const platformDirectories = resolvePlatformDirectories(options);
  const dataRoot = path.resolve(options && options.dataRoot || platformDirectories.applicationData);
  return {
    dataRoot,
    configDirectory: path.join(dataRoot, "config"),
    cacheDirectory: options && options.cacheDirectory || options && options.dataRoot && path.join(dataRoot, "cache") || platformDirectories.cache,
    logDirectory: options && options.logDirectory || options && options.dataRoot && path.join(dataRoot, "logs") || platformDirectories.logs,
    runtimeDirectory: path.join(dataRoot, "runtime"),
    packagedResourceDirectory: platformDirectories.packagedResources,
    developmentResourceDirectory: platformDirectories.developmentResources,
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

function loadPackageManifest(packageLayout) {
  const canonicalLayout = resolveCanonicalPackagedLayout();
  if (packageLayout && (
    path.resolve(packageLayout.packageRoot || "") !== canonicalLayout.packageRoot
    || path.resolve(packageLayout.resourcesDirectory || "") !== canonicalLayout.resourcesDirectory
    || path.resolve(packageLayout.manifestPath || "") !== canonicalLayout.manifestPath
  )) {
    throw new Error("Packaged application metadata is missing or invalid.");
  }
  const manifest = readJsonFile(canonicalLayout.manifestPath);
  if (!manifest || manifest.schema_version !== 1 || manifest.artifact_class !== "INTERNAL_EVALUATION") {
    throw new Error("Packaged application metadata is missing or invalid.");
  }
  if (manifest.application_name !== "Crocoblock Site Factory" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(manifest.application_version || ""))) {
    throw new Error("Packaged application identity is invalid.");
  }
  if (manifest.architecture !== "x64" || manifest.artifact_label !== "INTERNAL EVALUATION BUILD") {
    throw new Error("Packaged application target is invalid.");
  }
  if (!manifest.rehearsal || manifest.rehearsal.frozen_project_slug !== "win-ceo-rehearsal-smoke-3") {
    throw new Error("Packaged rehearsal contract is invalid.");
  }
  return manifest;
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
    projects_root: path.resolve(requestedProjectsRoot || stored.projects_root || defaultProjectsRoot(options && options.environment, options)),
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
  const packageManifest = options && options.packageManifest || null;
  const dependencySourceOptions = options && options.dependencySourceOptions || {
    environment: options && options.environment,
    packagedResourceDirectory: runtimePaths.packagedResourceDirectory,
    applicationDataDirectory: runtimePaths.dataRoot,
    developmentResourceDirectory: runtimePaths.developmentResourceDirectory,
    packagedMode: Boolean(packageManifest),
    includeDevelopmentFallback: packageManifest ? false : undefined
  };
  const portAvailability = await findAvailablePort(config.preferred_port, options);
  const diagnostics = [
    packageManifest
      ? { label: "Application", status: "ready", message: packageManifest.application_name + " " + packageManifest.application_version + " · " + packageManifest.artifact_label + "." }
      : null,
    diagnoseDocker(options),
    diagnoseProjectsRoot(config.projects_root),
    diagnoseDataRoot(runtimePaths, options),
    portAvailability.preferredAvailable
      ? { label: "Launcher port", status: "ready", message: "Launcher port is ready." }
      : { label: "Launcher port", status: "fallback", message: "Preferred Launcher port is in use. A local fallback port will be used." }
  ].filter(Boolean);
  const attentionRequired = diagnostics.some((diagnostic) => ["missing", "stopped", "unavailable"].includes(diagnostic.status));
  const systemCheck = collectSystemCheck({
    platform: options && options.platform,
    arch: options && options.arch,
    applicationDataDirectory: runtimePaths.dataRoot,
    projectsDirectory: config.projects_root,
    ensureWritableDirectory: options && options.ensureWritableDirectory || ensureWritableDirectory,
    statfsSync: options && options.statfsSync,
    totalMemory: options && options.totalMemory,
    spawnSync: options && options.spawnSync,
    dependencySources: options && options.dependencySources,
    dependencySourceOptions,
    initializationFailure: options && options.initializationFailure
  });
  return {
    diagnostics,
    listeningPort: portAvailability.port,
    systemCheck,
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

function listenControlServer(token, close, status) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const loopback = request.socket && (request.socket.remoteAddress === "127.0.0.1" || request.socket.remoteAddress === "::ffff:127.0.0.1");
      if (!loopback || !secureCompare(token, request.headers["x-factory-runtime-token"])) {
        response.writeHead(404, { "Cache-Control": "no-store" });
        response.end();
        return;
      }
      if (request.method === "GET" && request.url === "/status") {
        response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(status()));
        return;
      }
      if (request.method !== "POST" || request.url !== "/close") {
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

function requestRuntimeStatus(state, requestImplementation) {
  return new Promise((resolve, reject) => {
    const request = (requestImplementation || http.request)({
      host: "127.0.0.1",
      port: Number(state && state.control_port),
      method: "GET",
      path: "/status",
      headers: { "X-Factory-Runtime-Token": state && state.control_token },
      timeout: 1500
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(new Error("Packaged Launcher status is unavailable."));
          return;
        }
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!value || !Number.isInteger(Number(value.launcher_port))) {
            throw new Error("invalid status");
          }
          resolve(value);
        } catch (error) {
          reject(new Error("Packaged Launcher status is invalid."));
        }
      });
    });
    request.once("timeout", () => request.destroy(new Error("timeout")));
    request.once("error", () => reject(new Error("Packaged Launcher is not running.")));
    request.end();
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

function openBrowser(url, spawnImplementation, options) {
  return openExternalUrl(url, Object.assign({}, options || {}, {
    spawn: spawnImplementation
  }));
}

module.exports = {
  DEFAULT_LAUNCHER_PORT,
  appendSafeLog,
  collectRuntimeDiagnostics,
  defaultDataRoot,
  defaultProjectsRoot,
  findAvailablePort,
  listenControlServer,
  loadPackageManifest,
  loadPackageConfig,
  openBrowser,
  readJsonFile,
  requestRuntimeShutdown,
  requestRuntimeStatus,
  resolveRuntimePaths,
  sanitizeLogText,
  savePackageConfig,
  writeAtomicJson
};
