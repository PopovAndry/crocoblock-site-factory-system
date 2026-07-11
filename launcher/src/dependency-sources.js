"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_VENDOR_DIR = "C:\\sf-vendor";

const APPROVED_DEPENDENCY_SOURCES = {
  "kava": {
    key: "kava",
    label: "Kava",
    filename: "kava.zip"
  },
  "jet-engine": {
    key: "jet-engine",
    label: "JetEngine",
    filename: "jet-engine.zip"
  },
  "jet-smart-filters": {
    key: "jet-smart-filters",
    label: "JetSmartFilters",
    filename: "jet-smart-filters.zip"
  }
};

function resolveVendorDirectory() {
  return path.resolve(process.env.FACTORY_VENDOR_DIR || DEFAULT_VENDOR_DIR);
}

function resolveApprovedDependencySource(dependencyKey) {
  const key = String(dependencyKey || "").trim().toLowerCase();
  const definition = APPROVED_DEPENDENCY_SOURCES[key];

  if (!definition) {
    throw new Error(
      "Unsupported dependency. Allowed values: " + Object.keys(APPROVED_DEPENDENCY_SOURCES).join(", ")
    );
  }

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
  return Object.keys(APPROVED_DEPENDENCY_SOURCES).map((key) => {
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
