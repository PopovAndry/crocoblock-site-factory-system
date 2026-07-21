"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  dependencySourceRoots,
  listApprovedDependencySources,
  resolveApprovedDependencySource
} = require("../src/dependency-sources");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-portable-sources-"));
}

function writePackage(root, filename) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, filename), "synthetic-package", "utf8");
}

test("explicit development source remains the first trusted source", () => {
  const root = tempRoot();
  const development = path.join(root, "development");
  const packaged = path.join(root, "resources");
  writePackage(development, "kava.zip");
  writePackage(path.join(packaged, "managed-packages"), "kava.zip");
  const source = resolveApprovedDependencySource("kava", {
    environment: { FACTORY_VENDOR_DIR: development },
    packagedResourceDirectory: packaged
  });
  assert.equal(source.mode, "development_override");
  assert.equal(source.absolutePath, path.join(development, "kava.zip"));
});

test("packaged dependency resources are resolved as read-only", () => {
  const root = tempRoot();
  const resources = path.join(root, "App.app", "Contents", "Resources");
  writePackage(path.join(resources, "managed-packages"), "jet-engine.zip");
  const source = resolveApprovedDependencySource("jet-engine", {
    packagedResourceDirectory: resources,
    applicationDataDirectory: path.join(root, "data"),
    includeDevelopmentFallback: false
  });
  assert.equal(source.mode, "packaged_resource");
  assert.equal(source.readOnly, true);
});

test("application-data managed bundle is portable and mutable outside app resources", () => {
  const root = tempRoot();
  const data = path.join(root, "Library", "Application Support", "Crocoblock Site Factory");
  writePackage(path.join(data, "managed-packages"), "jet-smart-filters.zip");
  const source = resolveApprovedDependencySource("jet-smart-filters", {
    applicationDataDirectory: data,
    includeDevelopmentFallback: false
  });
  assert.equal(source.mode, "application_data_bundle");
  assert.equal(source.readOnly, false);
  assert.equal(source.absolutePath.startsWith(data), true);
});

test("trusted catalog remains authoritative and browser inventory omits roots", () => {
  const root = tempRoot();
  const data = path.join(root, "data");
  writePackage(path.join(data, "managed-packages"), "kava.zip");
  const inventory = listApprovedDependencySources({ applicationDataDirectory: data, includeDevelopmentFallback: false });
  assert.throws(() => resolveApprovedDependencySource("../../arbitrary", { applicationDataDirectory: data }));
  assert.equal(inventory.some((source) => Object.hasOwn(source, "absolutePath")), false);
  assert.equal(JSON.stringify(inventory).includes(root), false);
});

test("source root selection does not accept a dependency path", () => {
  const roots = dependencySourceRoots({
    packagedResourceDirectory: "/Applications/Factory.app/Contents/Resources",
    applicationDataDirectory: "/Users/evaluator/Library/Application Support/Factory",
    includeDevelopmentFallback: false
  });
  assert.deepEqual(roots.map((source) => source.mode), ["packaged_resource", "application_data_bundle"]);
  assert.equal(roots.some((source) => source.root.endsWith(".zip")), false);
});
