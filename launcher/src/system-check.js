"use strict";

const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const {
  OFFICIAL_DOCKER_DESKTOP_URL,
  getPlatformIdentity
} = require("./platform-runtime");
const { listApprovedDependencySources } = require("./dependency-sources");

const CHECK_STATES = Object.freeze({
  PASS: "PASS",
  WARNING: "WARNING",
  ACTION_REQUIRED: "ACTION_REQUIRED",
  UNSUPPORTED: "UNSUPPORTED",
  ERROR: "ERROR"
});
const MINIMUM_FREE_DISK_BYTES = 20 * 1024 * 1024 * 1024;
const RECOMMENDED_MEMORY_BYTES = 8 * 1024 * 1024 * 1024;

function safeCheck(id, label, state, message, details) {
  return Object.assign({ id, label, state, message }, details || {});
}

function probeDocker(options) {
  const runner = options && options.spawnSync || spawnSync;
  let detected;
  try {
    detected = runner("docker", ["--version"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000
    });
  } catch (error) {
    detected = { error: { code: "ENOENT" } };
  }
  if (detected && detected.error && detected.error.code === "ENOENT") {
    return { detected: false, running: false };
  }
  if (!detected || detected.status !== 0) {
    return { detected: false, running: false };
  }
  let daemon;
  try {
    daemon = runner("docker", ["version", "--format", "{{.Server.Version}}"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000
    });
  } catch (error) {
    daemon = null;
  }
  return {
    detected: true,
    running: Boolean(daemon && daemon.status === 0 && String(daemon.stdout || "").trim())
  };
}

function availableDiskBytes(directory, options) {
  const statfs = options && options.statfsSync || fs.statfsSync;
  const stats = statfs(directory);
  return Number(stats.bavail) * Number(stats.bsize);
}

function summarizeSystemCheck(checks) {
  if (checks.some((check) => check.state === CHECK_STATES.UNSUPPORTED)) {
    return { state: CHECK_STATES.UNSUPPORTED, title: "Unsupported system", message: "This system cannot run the evaluation build." };
  }
  if (checks.some((check) => check.state === CHECK_STATES.ERROR)) {
    return { state: CHECK_STATES.ERROR, title: "Action required", message: "Site Factory could not initialize required local storage." };
  }
  if (checks.some((check) => check.state === CHECK_STATES.ACTION_REQUIRED)) {
    return { state: CHECK_STATES.ACTION_REQUIRED, title: "Action required", message: "Complete the items below, then recheck." };
  }
  if (checks.some((check) => check.state === CHECK_STATES.WARNING)) {
    return { state: CHECK_STATES.WARNING, title: "System ready", message: "Site Factory can continue, with the warning below." };
  }
  return { state: CHECK_STATES.PASS, title: "System ready", message: "This system is ready for Site Factory." };
}

function collectSystemCheck(options) {
  const safeOptions = options || {};
  const identity = getPlatformIdentity(safeOptions);
  const checks = [];
  const ensureWritable = safeOptions.ensureWritableDirectory;
  const memoryBytes = Number((safeOptions.totalMemory || os.totalmem)());
  const initializationFailure = safeOptions.initializationFailure;

  checks.push(safeCheck("operating_system", "Operating system",
    ["win32", "darwin"].includes(identity.platform) ? CHECK_STATES.PASS : CHECK_STATES.UNSUPPORTED,
    identity.platform === "darwin" ? "macOS is supported." : identity.platform === "win32" ? "Windows is supported." : "This operating system is not supported for evaluation."));
  checks.push(safeCheck("architecture", "Processor",
    identity.supported ? CHECK_STATES.PASS : CHECK_STATES.UNSUPPORTED,
    identity.supported ? (identity.arch === "arm64" ? "Apple Silicon is supported." : "Intel 64-bit is supported.") : "This processor architecture is not supported."));

  for (const storage of [
    { id: "application_data", label: "Application storage", directory: safeOptions.applicationDataDirectory },
    { id: "project_storage", label: "Project storage", directory: safeOptions.projectsDirectory }
  ]) {
    try {
      if (typeof ensureWritable !== "function") {
        throw new Error("storage probe unavailable");
      }
      ensureWritable(storage.directory);
      checks.push(safeCheck(storage.id, storage.label, CHECK_STATES.PASS, storage.label + " is writable."));
    } catch (error) {
      checks.push(safeCheck(storage.id, storage.label, CHECK_STATES.ERROR, storage.label + " is unavailable."));
    }
  }

  try {
    const freeBytes = availableDiskBytes(safeOptions.applicationDataDirectory, safeOptions);
    checks.push(safeCheck("disk", "Free disk space",
      freeBytes >= (safeOptions.minimumFreeDiskBytes || MINIMUM_FREE_DISK_BYTES) ? CHECK_STATES.PASS : CHECK_STATES.ACTION_REQUIRED,
      freeBytes >= (safeOptions.minimumFreeDiskBytes || MINIMUM_FREE_DISK_BYTES) ? "Free disk space meets the evaluation threshold." : "Free at least 20 GB before creating a website."));
  } catch (error) {
    checks.push(safeCheck("disk", "Free disk space", CHECK_STATES.ERROR, "Free disk space could not be checked."));
  }

  checks.push(safeCheck("memory", "Memory",
    memoryBytes >= (safeOptions.recommendedMemoryBytes || RECOMMENDED_MEMORY_BYTES) ? CHECK_STATES.PASS : CHECK_STATES.WARNING,
    memoryBytes >= (safeOptions.recommendedMemoryBytes || RECOMMENDED_MEMORY_BYTES) ? "Available system memory meets the recommended threshold." : "At least 8 GB of memory is recommended."));

  const docker = safeOptions.docker || probeDocker(safeOptions);
  checks.push(safeCheck("docker_application", "Docker Desktop",
    docker.detected ? CHECK_STATES.PASS : CHECK_STATES.ACTION_REQUIRED,
    docker.detected ? "Docker Desktop is installed." : "Docker Desktop is required. Choose the official installer for " + (identity.arch === "arm64" ? "Apple Silicon" : "Intel") + ".",
    docker.detected ? {} : { action: { label: "Get Docker Desktop", url: OFFICIAL_DOCKER_DESKTOP_URL } }));
  checks.push(safeCheck("docker_daemon", "Docker service",
    !docker.detected || docker.running ? (docker.running ? CHECK_STATES.PASS : CHECK_STATES.ACTION_REQUIRED) : CHECK_STATES.ACTION_REQUIRED,
    docker.running ? "Docker is running and responsive." : docker.detected ? "Start Docker Desktop, then recheck." : "Install and open Docker Desktop, then recheck."));

  const sources = safeOptions.dependencySources || listApprovedDependencySources(safeOptions.dependencySourceOptions);
  const packageSourceReady = sources.length > 0 && sources.every((source) => source.exists === true);
  checks.push(safeCheck("managed_packages", "Crocoblock packages",
    packageSourceReady ? CHECK_STATES.PASS : CHECK_STATES.ACTION_REQUIRED,
    packageSourceReady ? "Approved evaluation packages are available." : "Approved evaluation packages must be supplied through a trusted Factory source."));
  checks.push(safeCheck("initialization", "Application initialization",
    initializationFailure ? CHECK_STATES.ERROR : CHECK_STATES.PASS,
    initializationFailure ? "Site Factory initialization did not complete." : "Site Factory initialized without a blocking error."));

  return Object.assign({
    checks,
    dockerLicensingNote: "Company eligibility for Docker Desktop licensing must be confirmed separately.",
    recheckPath: "/"
  }, summarizeSystemCheck(checks));
}

module.exports = {
  CHECK_STATES,
  MINIMUM_FREE_DISK_BYTES,
  RECOMMENDED_MEMORY_BYTES,
  collectSystemCheck,
  probeDocker,
  summarizeSystemCheck
};
