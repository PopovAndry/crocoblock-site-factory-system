"use strict";

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const launcherPackage = require("../package.json");

const APPLICATION_NAME = launcherPackage.factoryDesktop.applicationName;
const APPLICATION_NAMESPACE = launcherPackage.factoryDesktop.applicationName;
const BUNDLE_IDENTIFIER = launcherPackage.factoryDesktop.bundleIdentifier;
const OFFICIAL_DOCKER_DESKTOP_URL = "https://www.docker.com/products/docker-desktop/";
const SUPPORTED_PRODUCT_TARGETS = new Set([
  "win32/x64",
  "darwin/arm64",
  "darwin/x64"
]);

function getPlatformIdentity(options) {
  const platform = options && options.platform || process.platform;
  const arch = options && options.arch || process.arch;
  const key = platform + "/" + arch;
  return {
    platform,
    arch,
    key,
    supported: SUPPORTED_PRODUCT_TARGETS.has(key),
    productTarget: SUPPORTED_PRODUCT_TARGETS.has(key)
  };
}

function platformPath(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function normalizePlatformPath(value, platform) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("A non-empty filesystem path is required.");
  }
  return platformPath(platform || process.platform).resolve(value);
}

function resolvePlatformDirectories(options) {
  const safeOptions = options || {};
  const identity = getPlatformIdentity(safeOptions);
  const pathApi = platformPath(identity.platform);
  const environment = safeOptions.environment || process.env;
  const homeDirectory = safeOptions.homeDirectory || os.homedir();
  const temporaryRoot = safeOptions.temporaryDirectory || os.tmpdir();
  let applicationData;
  let cache;
  let logs;
  let projects;

  if (identity.platform === "win32") {
    applicationData = pathApi.join(environment.LOCALAPPDATA || homeDirectory, APPLICATION_NAMESPACE);
    cache = pathApi.join(applicationData, "cache");
    logs = pathApi.join(applicationData, "logs");
    projects = pathApi.join(environment.USERPROFILE || homeDirectory, "Documents", "Factory Projects");
  } else if (identity.platform === "darwin") {
    applicationData = pathApi.join(homeDirectory, "Library", "Application Support", APPLICATION_NAMESPACE);
    cache = pathApi.join(homeDirectory, "Library", "Caches", APPLICATION_NAMESPACE);
    logs = pathApi.join(homeDirectory, "Library", "Logs", APPLICATION_NAMESPACE);
    projects = pathApi.join(homeDirectory, "Documents", "Factory Projects");
  } else {
    const dataHome = environment.XDG_DATA_HOME || pathApi.join(homeDirectory, ".local", "share");
    const cacheHome = environment.XDG_CACHE_HOME || pathApi.join(homeDirectory, ".cache");
    applicationData = pathApi.join(dataHome, "crocoblock-site-factory");
    cache = pathApi.join(cacheHome, "crocoblock-site-factory");
    logs = pathApi.join(applicationData, "logs");
    projects = pathApi.join(homeDirectory, "Factory Projects");
  }

  const packagedResourceRoot = process.resourcesPath
    || pathApi.join(pathApi.dirname(process.execPath), "resources");
  const developmentResourceRoot = safeOptions.developmentResourceDirectory
    || path.resolve(__dirname, "..", "resources");

  return {
    identity,
    applicationData: pathApi.resolve(applicationData),
    cache: pathApi.resolve(cache),
    logs: pathApi.resolve(logs),
    projects: pathApi.resolve(projects),
    temporary: pathApi.resolve(pathApi.join(temporaryRoot, "crocoblock-site-factory")),
    packagedResources: pathApi.resolve(packagedResourceRoot),
    developmentResources: path.resolve(developmentResourceRoot)
  };
}

function packagedMetadataError() {
  return new Error("Packaged application metadata is missing or invalid.");
}

function sameFilesystemPath(left, right) {
  const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  return normalize(path.resolve(left)) === normalize(path.resolve(right));
}

function requireNormalExistingPath(targetPath, expectedType) {
  let stat;
  try {
    stat = fs.lstatSync(targetPath);
  } catch (error) {
    throw packagedMetadataError();
  }
  if (stat.isSymbolicLink() || (expectedType === "directory" && !stat.isDirectory()) || (expectedType === "file" && !stat.isFile())) {
    throw packagedMetadataError();
  }
  try {
    fs.accessSync(targetPath, fs.constants.R_OK);
    return fs.realpathSync.native(targetPath);
  } catch (error) {
    throw packagedMetadataError();
  }
}

function resolveCanonicalPackagedLayout() {
  // The portable Windows builder always installs this module at
  // <package-root>/app/launcher/src. Do not accept an environment or caller path here.
  const packageRootPath = path.resolve(__dirname, "..", "..", "..");
  const resourcesPath = path.join(packageRootPath, "resources");
  const manifestPath = path.join(resourcesPath, "package-manifest.json");
  const packageRoot = requireNormalExistingPath(packageRootPath, "directory");
  const resources = requireNormalExistingPath(resourcesPath, "directory");
  const manifest = requireNormalExistingPath(manifestPath, "file");
  const expectedResources = path.join(packageRoot, "resources");
  const expectedManifest = path.join(resources, "package-manifest.json");
  if (!sameFilesystemPath(resources, expectedResources) || !sameFilesystemPath(manifest, expectedManifest)) {
    throw packagedMetadataError();
  }
  return Object.freeze({
    packageRoot,
    resourcesDirectory: resources,
    manifestPath: manifest
  });
}

function assertSafeExternalUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch (error) {
    throw new Error("Only valid HTTP or HTTPS links can be opened.");
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Only credential-free HTTP or HTTPS links can be opened.");
  }
  return parsed.toString();
}

function externalOpenCommand(platform, url) {
  if (platform === "win32") {
    return { command: "explorer.exe", args: [url] };
  }
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  return { command: "xdg-open", args: [url] };
}

function openExternalUrl(value, options) {
  const safeOptions = options || {};
  const url = assertSafeExternalUrl(value);
  const platform = safeOptions.platform || process.platform;
  const command = externalOpenCommand(platform, url);
  const spawnImplementation = safeOptions.spawn || spawn;
  const child = spawnImplementation(command.command, command.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false
  });
  if (child && typeof child.unref === "function") {
    child.unref();
  }
  return command;
}

function spawnOwnedProcess(command, args, options) {
  if (!Array.isArray(args)) {
    throw new Error("Launcher-owned process arguments must be an array.");
  }
  const safeOptions = options || {};
  const spawnImplementation = safeOptions.spawn || spawn;
  return spawnImplementation(command, args.slice(), {
    cwd: safeOptions.cwd,
    env: safeOptions.env,
    detached: Boolean(safeOptions.detached),
    stdio: safeOptions.stdio || "pipe",
    windowsHide: true,
    shell: false
  });
}

function stopOwnedProcess(child, options) {
  if (!child || typeof child.kill !== "function") {
    throw new Error("Only a Launcher-owned child process can be stopped.");
  }
  return child.kill(options && options.signal || "SIGTERM");
}

function resolveDockerCommand() {
  return { executable: "docker", composeArgs: ["compose"] };
}

module.exports = {
  APPLICATION_NAME,
  APPLICATION_NAMESPACE,
  BUNDLE_IDENTIFIER,
  OFFICIAL_DOCKER_DESKTOP_URL,
  assertSafeExternalUrl,
  externalOpenCommand,
  getPlatformIdentity,
  normalizePlatformPath,
  openExternalUrl,
  resolveCanonicalPackagedLayout,
  resolveDockerCommand,
  resolvePlatformDirectories,
  spawnOwnedProcess,
  stopOwnedProcess
};
