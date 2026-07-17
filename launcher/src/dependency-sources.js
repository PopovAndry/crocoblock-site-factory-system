"use strict";

const fs = require("fs");
const path = require("path");
const { listDependencyDefinitions, resolveDependencyDefinition } = require("./dependency-catalog");

const DEFAULT_VENDOR_DIR = path.join(path.parse(process.cwd()).root || path.sep, "sf-vendor");

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

function resolveVendorDirectory() {
  return path.resolve(process.env.FACTORY_VENDOR_DIR || DEFAULT_VENDOR_DIR);
}

function resolveApprovedDependencySource(dependencyKey) {
  const dependency = resolveDependencyDefinition(dependencyKey);
  const key = dependency.slug;
  const definition = getApprovedDependencySources()[key];

  const vendorDir = resolveVendorDirectory();
  const absolutePath = path.join(vendorDir, definition.filename);
  const exists = fs.existsSync(absolutePath);
  const stat = exists ? fs.statSync(absolutePath) : null;

  return {
    key: definition.key,
    label: definition.label,
    filename: definition.filename,
    absolutePath,
    exists,
    size: stat && stat.isFile() ? stat.size : null
  };
}

function listApprovedDependencySources() {
  return Object.keys(getApprovedDependencySources()).map((key) => {
    const source = resolveApprovedDependencySource(key);
    return {
      key: source.key,
      label: source.label,
      filename: source.filename,
      exists: source.exists,
      size: source.size
    };
  });
}

module.exports = {
  DEFAULT_VENDOR_DIR,
  listApprovedDependencySources,
  resolveApprovedDependencySource,
  resolveVendorDirectory
};
