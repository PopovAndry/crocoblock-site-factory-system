"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { listDependencyDefinitions } = require("../launcher/src/dependency-catalog");
const { validateZipPackage } = require("../launcher/src/package-validator");

const APPLICATION_NAME = "Crocoblock Site Factory";
const APPLICATION_EXECUTABLE = APPLICATION_NAME + ".exe";
const ARTIFACT_LABEL = "INTERNAL EVALUATION BUILD";
const DEFAULT_VENDOR_DIRECTORY = "C:\\sf-vendor";
// Internal-evaluation archives are small; these bounds prevent a hung or noisy
// external archiver from becoming a package-build control boundary.
const TAR_TIMEOUT_MS = 120000;
const TAR_MAX_BUFFER = 1024 * 1024;

function packageFilesystemError() {
  return new Error("Windows package build filesystem layout is invalid.");
}

function isReparseEntry(stat) {
  return stat.isSymbolicLink();
}

function sameFilesystemPath(left, right) {
  const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  return normalize(path.resolve(left)) === normalize(path.resolve(right));
}

function isPathInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== "" && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

function requireNormalPath(targetPath, expectedType) {
  let stat;
  try {
    stat = fs.lstatSync(targetPath);
  } catch (error) {
    throw packageFilesystemError();
  }
  if (isReparseEntry(stat) || (expectedType === "directory" && !stat.isDirectory()) || (expectedType === "file" && !stat.isFile())) {
    throw packageFilesystemError();
  }
  try {
    return fs.realpathSync.native(targetPath);
  } catch (error) {
    throw packageFilesystemError();
  }
}

function canonicalPlannedPath(targetPath) {
  const resolved = path.resolve(targetPath);
  const suffix = [];
  let current = resolved;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw packageFilesystemError();
    }
    suffix.unshift(path.basename(current));
    current = parent;
  }
  const canonicalAncestor = requireNormalPath(current, "directory");
  return path.resolve(canonicalAncestor, ...suffix);
}

function resolveBuildPath(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw packageFilesystemError();
  }
  return path.resolve(value);
}

function assertNoReparseSourceEntries(sourceRoot, destinationPrefix, destinationPaths) {
  const canonicalRoot = requireNormalPath(sourceRoot, "directory");
  const stack = [canonicalRoot];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      throw packageFilesystemError();
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      let stat;
      try {
        stat = fs.lstatSync(entryPath);
      } catch (error) {
        throw packageFilesystemError();
      }
      if (isReparseEntry(stat)) {
        throw packageFilesystemError();
      }
      if (destinationPrefix) {
        const relative = path.relative(canonicalRoot, entryPath).replace(/\\/g, "/");
        destinationPaths.push(destinationPrefix + "/" + relative);
      }
      if (stat.isDirectory()) {
        stack.push(entryPath);
      } else if (!stat.isFile()) {
        throw packageFilesystemError();
      }
    }
  }
  return canonicalRoot;
}

function assertUniqueDestinationPaths(paths) {
  const seen = new Set();
  for (const destinationPath of paths) {
    const normalized = String(destinationPath || "").replace(/\\/g, "/");
    if (!normalized || normalized.startsWith("/") || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      throw packageFilesystemError();
    }
    const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) {
      throw packageFilesystemError();
    }
    seen.add(key);
  }
}

function validateBuildFilesystem(options) {
  const repositoryRoot = requireNormalPath(options.repositoryRoot, "directory");
  const outputRoot = canonicalPlannedPath(options.outputRoot);
  const nodeExecutable = requireNormalPath(options.nodeExecutable, "file");
  const destinationPaths = [];
  const sourceRoots = [
    assertNoReparseSourceEntries(path.join(repositoryRoot, "launcher", "src"), "app/launcher/src", destinationPaths),
    assertNoReparseSourceEntries(path.join(repositoryRoot, "launcher", "contracts"), "app/launcher/contracts", destinationPaths),
    assertNoReparseSourceEntries(path.join(repositoryRoot, "wordpress-plugin"), "app/wordpress-plugin", destinationPaths),
    assertNoReparseSourceEntries(path.join(repositoryRoot, "launcher", "windows-installer"), "installer", destinationPaths),
    assertNoReparseSourceEntries(options.vendorDirectory, null, destinationPaths)
  ];
  requireNormalPath(path.join(repositoryRoot, "launcher", "package.json"), "file");
  for (const dependency of listDependencyDefinitions()) {
    const vendorZip = path.join(options.vendorDirectory, dependency.slug + ".zip");
    requireNormalPath(vendorZip, "file");
    destinationPaths.push("resources/managed-packages/" + dependency.slug + ".zip");
  }
  destinationPaths.push(APPLICATION_EXECUTABLE, "app/launcher/package.json", "Launch Crocoblock Site Factory.vbs", "resources/package-manifest.json");
  assertUniqueDestinationPaths(destinationPaths);
  for (const sourceRoot of sourceRoots.concat(nodeExecutable)) {
    if (sameFilesystemPath(outputRoot, sourceRoot) || isPathInside(outputRoot, sourceRoot) || isPathInside(sourceRoot, outputRoot)) {
      throw packageFilesystemError();
    }
  }
  return { repositoryRoot, outputRoot, nodeExecutable };
}

function loadPackageIdentity(repositoryRoot) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "launcher", "package.json"), "utf8"));
  const applicationName = packageJson.factoryDesktop && packageJson.factoryDesktop.applicationName;
  if (applicationName !== APPLICATION_NAME || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(packageJson.version || ""))) {
    throw new Error("Launcher package identity or version is invalid.");
  }
  return {
    applicationName,
    version: packageJson.version,
    architecture: "x64",
    packageDirectoryName: "Crocoblock-Site-Factory-Windows-x64-" + packageJson.version + "-beta",
    archiveName: "Crocoblock-Site-Factory-Windows-x64-" + packageJson.version + "-beta.zip"
  };
}

function copyPackageSources(repositoryRoot, packageRoot, nodeExecutable, vendorDirectory) {
  const launcherSource = path.join(repositoryRoot, "launcher", "src");
  const installerSource = path.join(repositoryRoot, "launcher", "windows-installer");
  const appRoot = path.join(packageRoot, "app");
  const launcherDestination = path.join(appRoot, "launcher");
  const installerDestination = path.join(packageRoot, "installer");
  const resourcesDestination = path.join(packageRoot, "resources");
  const managedPackagesDestination = path.join(resourcesDestination, "managed-packages");

  fs.mkdirSync(launcherDestination, { recursive: true });
  fs.mkdirSync(managedPackagesDestination, { recursive: true });
  fs.cpSync(launcherSource, path.join(launcherDestination, "src"), {
    recursive: true,
    filter(sourcePath) {
      return path.basename(sourcePath) !== "cli.js";
    }
  });
  fs.cpSync(path.join(repositoryRoot, "launcher", "contracts"), path.join(launcherDestination, "contracts"), { recursive: true });
  fs.copyFileSync(path.join(repositoryRoot, "launcher", "package.json"), path.join(launcherDestination, "package.json"));
  fs.cpSync(path.join(repositoryRoot, "wordpress-plugin"), path.join(appRoot, "wordpress-plugin"), {
    recursive: true,
    filter(sourcePath) {
      return !new Set([".git", "node_modules", "tests"]).has(path.basename(sourcePath));
    }
  });
  fs.cpSync(installerSource, installerDestination, { recursive: true });
  fs.copyFileSync(nodeExecutable, path.join(packageRoot, APPLICATION_EXECUTABLE));

  const packagedDependencies = [];
  for (const dependency of listDependencyDefinitions()) {
    const filename = dependency.slug + ".zip";
    const sourcePath = path.join(vendorDirectory, filename);
    if (!fs.existsSync(sourcePath)) {
      throw new Error("Approved build input is missing for " + dependency.slug + ".");
    }
    const validation = validateZipPackage(sourcePath, dependency);
    fs.copyFileSync(sourcePath, path.join(managedPackagesDestination, filename));
    packagedDependencies.push({
      key: dependency.slug,
      filename,
      sha256: validation.sha256,
      byte_size: validation.byte_size,
      version: validation.product.version
    });
  }
  return packagedDependencies;
}

function writePortableLauncher(packageRoot) {
  const content = [
    "Option Explicit",
    "Dim shell, fso, packageRoot, executablePath, entryPath",
    "Set shell = CreateObject(\"WScript.Shell\")",
    "Set fso = CreateObject(\"Scripting.FileSystemObject\")",
    "packageRoot = fso.GetParentFolderName(WScript.ScriptFullName)",
    "executablePath = fso.BuildPath(packageRoot, \"" + APPLICATION_EXECUTABLE + "\")",
    "entryPath = fso.BuildPath(packageRoot, \"app\\launcher\\src\\windows-package-main.js\")",
    "shell.Run Chr(34) & executablePath & Chr(34) & \" \" & Chr(34) & entryPath & Chr(34) & \" --launch\", 0, False",
    ""
  ].join("\r\n");
  fs.writeFileSync(path.join(packageRoot, "Launch Crocoblock Site Factory.vbs"), content, "utf8");
}

function scanPackageArtifact(packageRoot) {
  const blockedPathPatterns = [
    /[a-z]:\\+(?:[^\r\n"']*\\+)?crocoblock-site-factory-system(?:\\+|\b)/i,
    /[a-z]:\\+sf-vendor(?:\\+|\b)/i,
    /[a-z]:\\+users\\+[^\\\r\n"']+/i
  ];
  const blockedContentPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /WP_(?:ADMIN_)?PASSWORD\s*=\s*[^\s"']{8,}/i,
    /Authorization:\s*(?:Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/i
  ];
  const blockedNames = new Set([".git", "node_modules", "test", "tests", "proofs", "runs", "logs", "screenshots", "secrets"]);
  const stack = [packageRoot];
  const files = [];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      const relativePath = path.relative(packageRoot, entryPath).replace(/\\/g, "/");
      const stat = fs.lstatSync(entryPath);
      if (isReparseEntry(stat)) {
        throw packageFilesystemError();
      }
      if (entry.isDirectory()) {
        if (blockedNames.has(entry.name.toLowerCase())) {
          throw new Error("Package contains a development or runtime-state directory: " + entry.name + ".");
        }
        stack.push(entryPath);
        continue;
      }
      if (/\.(?:log|tmp|cache|key|pem|p12|mobileprovision)$/i.test(entry.name) || /^\.env(?:\.|$)/i.test(entry.name)) {
        throw new Error("Package contains a blocked runtime or credential file.");
      }
      files.push(relativePath);
      if (!/\.(?:js|cmd|vbs|txt|json|css|php|md|yml|yaml|xml|html)$/i.test(entry.name)) {
        continue;
      }
      const content = fs.readFileSync(entryPath, "utf8");
      if (blockedPathPatterns.some((pattern) => pattern.test(content))) {
        throw new Error("Package contains a developer-specific absolute path.");
      }
      if (blockedContentPatterns.some((pattern) => pattern.test(content))) {
        throw new Error("Package contains credential-like content.");
      }
    }
  }
  return files.sort();
}

function buildWindowsLauncherPackage(options) {
  const requested = options || {};
  const vendorDirectory = path.resolve(requested.vendorDirectory || DEFAULT_VENDOR_DIRECTORY);
  const validatedPaths = validateBuildFilesystem({
    repositoryRoot: resolveBuildPath(requested.repositoryRoot),
    outputRoot: resolveBuildPath(requested.outputRoot),
    nodeExecutable: resolveBuildPath(requested.nodeExecutable || process.execPath),
    vendorDirectory
  });
  const repositoryRoot = validatedPaths.repositoryRoot;
  const outputRoot = validatedPaths.outputRoot;
  const nodeExecutable = validatedPaths.nodeExecutable;
  const identity = loadPackageIdentity(repositoryRoot);
  const packageRoot = path.join(outputRoot, identity.packageDirectoryName);
  if (fs.existsSync(packageRoot)) {
    throw new Error("Package output already exists. Choose a clean output directory.");
  }
  fs.mkdirSync(outputRoot, { recursive: true });
  const managedPackages = copyPackageSources(repositoryRoot, packageRoot, nodeExecutable, vendorDirectory);
  writePortableLauncher(packageRoot);
  const manifest = {
    schema_version: 1,
    artifact_class: "INTERNAL_EVALUATION",
    artifact_label: ARTIFACT_LABEL,
    package_type: "windows_node_sidecar_portable_with_installer",
    application_name: identity.applicationName,
    application_version: identity.version,
    architecture: identity.architecture,
    signed: false,
    public_release_ready: false,
    launch_executable: APPLICATION_EXECUTABLE,
    launch_entry: "app/launcher/src/windows-package-main.js",
    portable_launcher: "Launch Crocoblock Site Factory.vbs",
    installer: "installer/install.cmd",
    uninstall: "installer/uninstall.cmd",
    resources: {
      launcher: "app/launcher",
      agent_plugin: "app/wordpress-plugin",
      real_estate_contract: "app/launcher/contracts/real-estate-contract.v1.json",
      managed_packages: "resources/managed-packages"
    },
    rehearsal: {
      frozen_project_slug: "win-ceo-rehearsal-smoke-3"
    },
    managed_packages: managedPackages
  };
  fs.writeFileSync(path.join(packageRoot, "resources", "package-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const inventory = scanPackageArtifact(packageRoot);
  return { packageRoot, manifest, inventory, identity };
}

function removePartialArchive(archivePath) {
  try {
    const stat = fs.lstatSync(archivePath);
    if (stat.isFile() || stat.isSymbolicLink()) {
      fs.unlinkSync(archivePath);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      // The archive failure remains the public result.
    }
  }
}

function createZipArchive(packageRoot, archivePath, options) {
  const resolvedArchivePath = path.resolve(archivePath || packageRoot + ".zip");
  if (fs.existsSync(resolvedArchivePath)) {
    throw new Error("Windows package archive could not be created.");
  }
  const spawnArchive = options && options.spawnSync || spawnSync;
  let result;
  try {
    result = spawnArchive("tar", ["-a", "-c", "-f", resolvedArchivePath, "-C", path.dirname(packageRoot), path.basename(packageRoot)], {
      encoding: "utf8",
      windowsHide: true,
      shell: false,
      timeout: TAR_TIMEOUT_MS,
      maxBuffer: TAR_MAX_BUFFER
    });
  } catch (error) {
    removePartialArchive(resolvedArchivePath);
    throw new Error("Windows package archive could not be created.");
  }
  if (!result || result.error || result.status !== 0 || result.signal) {
    removePartialArchive(resolvedArchivePath);
    throw new Error("Windows package archive could not be created.");
  }
  try {
    const archiveStat = fs.lstatSync(resolvedArchivePath);
    if (archiveStat.isSymbolicLink() || !archiveStat.isFile()) {
      throw new Error("invalid archive");
    }
  } catch (error) {
    removePartialArchive(resolvedArchivePath);
    throw new Error("Windows package archive could not be created.");
  }
  return resolvedArchivePath;
}

function writeArchiveChecksum(archivePath) {
  const digest = crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
  const checksumPath = archivePath + ".sha256";
  fs.writeFileSync(checksumPath, digest + "  " + path.basename(archivePath) + "\n", "utf8");
  return { algorithm: "SHA256", digest, checksumPath };
}

function parseBuildArguments(argv) {
  const argumentsByName = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) {
      continue;
    }
    const key = argv[index].slice(2);
    argumentsByName[key] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
  }
  return argumentsByName;
}

if (require.main === module) {
  try {
    const flags = parseBuildArguments(process.argv.slice(2));
    const repositoryRoot = path.resolve(__dirname, "..");
    const result = buildWindowsLauncherPackage({
      repositoryRoot,
      outputRoot: flags["output-root"] || path.join(repositoryRoot, "build", "windows"),
      nodeExecutable: flags["node-executable"] || process.execPath,
      vendorDirectory: flags["vendor-directory"] || DEFAULT_VENDOR_DIRECTORY
    });
    const archivePath = createZipArchive(result.packageRoot, path.join(path.dirname(result.packageRoot), result.identity.archiveName));
    const checksum = writeArchiveChecksum(archivePath);
    process.stdout.write("Windows internal evaluation package created: " + archivePath + "\n");
    process.stdout.write("SHA256: " + checksum.digest + "\n");
  } catch (error) {
    process.stderr.write("Windows package build failed: " + error.message + "\n");
    process.exitCode = 1;
  }
}

module.exports = {
  APPLICATION_EXECUTABLE,
  ARTIFACT_LABEL,
  TAR_MAX_BUFFER,
  TAR_TIMEOUT_MS,
  assertNoReparseSourceEntries,
  assertUniqueDestinationPaths,
  buildWindowsLauncherPackage,
  createZipArchive,
  loadPackageIdentity,
  parseBuildArguments,
  scanPackageArtifact,
  validateBuildFilesystem,
  writeArchiveChecksum
};
