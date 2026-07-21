"use strict";

const fs = require("fs");
const path = require("path");
const { listDependencyDefinitions, resolveDependencyDefinition } = require("./dependency-catalog");

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

function dependencySourceRoots(options) {
  const safeOptions = options || {};
  const environment = safeOptions.environment || process.env;
  const roots = [];
  if (environment.FACTORY_VENDOR_DIR || safeOptions.developmentVendorDirectory) {
    roots.push({ mode: "development_override", root: resolveVendorDirectory(safeOptions), readOnly: true });
  }
  if (safeOptions.packagedResourceDirectory) {
    roots.push({
      mode: "packaged_resource",
      root: path.resolve(safeOptions.packagedResourceDirectory, MANAGED_PACKAGE_DIRECTORY),
      readOnly: true
    });
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
  const stat = exists ? fs.statSync(absolutePath) : null;

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
