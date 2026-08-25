"use strict";

const fs = require("fs");
const path = require("path");
const { listDependencyDefinitions, resolveDependencyDefinition } = require("./dependency-catalog");
const { resolveCanonicalPackagedLayout } = require("./platform-runtime");

const DEFAULT_VENDOR_DIR = path.join(path.parse(process.cwd()).root || path.sep, "sf-vendor");
const MANAGED_PACKAGE_DIRECTORY = "managed-packages";

function getApprovedDependencySources() {
  return Object.fromEntries(listDependencyDefinitions().map((dependency) => [
    dependency.slug,
    {
      key: dependency.slug,
      label: dependency.label,
      filename: dependency.slug + ".zip"
    }
  ]));
}

function resolveVendorDirectory(options) {
  const environment = options && options.environment || process.env;
  return path.resolve(environment.FACTORY_VENDOR_DIR || options && options.developmentVendorDirectory || DEFAULT_VENDOR_DIR);
}

function isPathWithin(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

function packagedDependencyError() {
  return new Error("Packaged dependency resources are invalid.");
}

function sameFilesystemPath(left, right) {
  const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  return normalize(path.resolve(left)) === normalize(path.resolve(right));
}

function resolveCanonicalPackagedResourceDirectory(options) {
  const layout = resolveCanonicalPackagedLayout();
  if (options && options.packagedResourceDirectory) {
    let requested;
    try {
      requested = fs.realpathSync.native(options.packagedResourceDirectory);
    } catch (error) {
      throw packagedDependencyError();
    }
    if (!sameFilesystemPath(requested, layout.resourcesDirectory)) {
      throw packagedDependencyError();
    }
  }
  return layout.resourcesDirectory;
}

function packagedManagedDirectory(resourcesDirectory) {
  const managedDirectory = path.join(resourcesDirectory, MANAGED_PACKAGE_DIRECTORY);
  if (!fs.existsSync(managedDirectory)) {
    return managedDirectory;
  }
  try {
    const stat = fs.lstatSync(managedDirectory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw packagedDependencyError();
    }
    const canonical = fs.realpathSync.native(managedDirectory);
    if (!isPathWithin(canonical, resourcesDirectory)) {
      throw packagedDependencyError();
    }
    return canonical;
  } catch (error) {
    if (error && error.message === "Packaged dependency resources are invalid.") {
      throw error;
    }
    throw packagedDependencyError();
  }
}

function dependencySourceRoots(options) {
  const safeOptions = options || {};
  const environment = safeOptions.environment || process.env;
  if (safeOptions.packagedMode === true) {
    const resourcesDirectory = resolveCanonicalPackagedResourceDirectory(safeOptions);
    return [{
      mode: "packaged_resource",
      root: packagedManagedDirectory(resourcesDirectory),
      readOnly: true
    }];
  }
  const roots = [];
  if (environment.FACTORY_VENDOR_DIR || safeOptions.developmentVendorDirectory) {
    roots.push({ mode: "development_override", root: resolveVendorDirectory(safeOptions), readOnly: true });
  }
  if (safeOptions.applicationDataDirectory) {
    roots.push({
      mode: "application_data_bundle",
      root: path.resolve(safeOptions.applicationDataDirectory, MANAGED_PACKAGE_DIRECTORY),
      readOnly: false
    });
  }
  if (!roots.length || safeOptions.includeDevelopmentFallback !== false) {
    roots.push({ mode: "development_default", root: resolveVendorDirectory(safeOptions), readOnly: true });
  }
  return roots.filter((source, index) => roots.findIndex((entry) => entry.root === source.root) === index);
}

function resolveApprovedDependencySource(dependencyKey, options) {
  const dependency = resolveDependencyDefinition(dependencyKey);
  const key = dependency.slug;
  const definition = getApprovedDependencySources()[key];
  const roots = dependencySourceRoots(options);
  const candidates = roots.map((source) => {
    const absolutePath = path.resolve(source.root, definition.filename);
    if (!isPathWithin(absolutePath, source.root)) {
      throw new Error("Approved dependency source escaped its trusted root.");
    }
    return Object.assign({}, source, { absolutePath, exists: fs.existsSync(absolutePath) });
  });
  const selected = candidates.find((candidate) => candidate.exists) || candidates[0];
  const absolutePath = selected.absolutePath;
  const exists = fs.existsSync(absolutePath);
  let stat = null;
  if (exists) {
    stat = fs.lstatSync(absolutePath);
    if (selected.mode === "packaged_resource") {
      let canonical;
      try {
        canonical = fs.realpathSync.native(absolutePath);
      } catch (error) {
        throw packagedDependencyError();
      }
      if (stat.isSymbolicLink() || !stat.isFile() || !isPathWithin(canonical, selected.root)) {
        throw packagedDependencyError();
      }
    }
  }

  return {
    key: definition.key,
    label: definition.label,
    filename: definition.filename,
    mode: selected.mode,
    readOnly: selected.readOnly,
    absolutePath,
    exists,
    size: stat && stat.isFile() ? stat.size : null
  };
}

function listApprovedDependencySources(options) {
  return Object.keys(getApprovedDependencySources()).map((key) => {
    const source = resolveApprovedDependencySource(key, options);
    return {
      key: source.key,
      label: source.label,
      filename: source.filename,
      mode: source.mode,
      exists: source.exists,
      size: source.size
    };
  });
}

module.exports = {
  DEFAULT_VENDOR_DIR,
  MANAGED_PACKAGE_DIRECTORY,
  dependencySourceRoots,
  isPathWithin,
  listApprovedDependencySources,
  resolveApprovedDependencySource,
  resolveVendorDirectory
};
