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

function writePackageManifest(resources) {
  fs.mkdirSync(resources, { recursive: true });
  fs.writeFileSync(path.join(resources, "package-manifest.json"), JSON.stringify({
    schema_version: 1,
    artifact_class: "INTERNAL_EVALUATION",
    artifact_label: "INTERNAL EVALUATION BUILD",
    application_name: "Crocoblock Site Factory",
    application_version: "0.1.0",
    architecture: "x64",
    rehearsal: { frozen_project_slug: "win-ceo-rehearsal-smoke-3" }
  }), "utf8");
}

function createCanonicalPackagedDependencyModule(root) {
  const packageRoot = path.join(root, "Crocoblock-Site-Factory-Windows-x64-0.1.0-beta");
  const launcherRoot = path.join(packageRoot, "app", "launcher");
  const sourceRoot = path.join(launcherRoot, "src");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.cpSync(path.join(__dirname, "..", "src", "dependency-sources.js"), path.join(sourceRoot, "dependency-sources.js"), { force: true });
  fs.cpSync(path.join(__dirname, "..", "src", "dependency-catalog.js"), path.join(sourceRoot, "dependency-catalog.js"), { force: true });
  fs.cpSync(path.join(__dirname, "..", "src", "platform-runtime.js"), path.join(sourceRoot, "platform-runtime.js"), { force: true });
  fs.copyFileSync(path.join(__dirname, "..", "package.json"), path.join(launcherRoot, "package.json"));
  const resources = path.join(packageRoot, "resources");
  writePackageManifest(resources);
  return {
    resources,
    sources: require(path.join(sourceRoot, "dependency-sources.js"))
  };
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

test("packaged dependency resources are resolved from the canonical installed layout", (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packaged = createCanonicalPackagedDependencyModule(root);
  writePackage(path.join(packaged.resources, "managed-packages"), "jet-form-builder.zip");
  const source = packaged.sources.resolveApprovedDependencySource("jet-form-builder", {
    packagedMode: true,
    packagedResourceDirectory: packaged.resources,
    applicationDataDirectory: path.join(root, "data"),
    includeDevelopmentFallback: false
  });
  assert.equal(source.mode, "packaged_resource");
  assert.equal(source.readOnly, true);
  assert.equal(source.absolutePath, path.join(packaged.resources, "managed-packages", "jet-form-builder.zip"));
});

test("packaged mode is authoritative and never falls back to development or application data", (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const development = path.join(root, "development");
  const data = path.join(root, "data");
  const packaged = createCanonicalPackagedDependencyModule(root);
  writePackage(development, "kava.zip");
  writePackage(path.join(data, "managed-packages"), "kava.zip");

  const source = packaged.sources.resolveApprovedDependencySource("kava", {
    packagedMode: true,
    environment: { FACTORY_VENDOR_DIR: development },
    packagedResourceDirectory: packaged.resources,
    applicationDataDirectory: data
  });

  assert.equal(source.mode, "packaged_resource");
  assert.equal(source.exists, false);
  assert.equal(source.absolutePath, path.join(packaged.resources, "managed-packages", "kava.zip"));
  assert.deepEqual(packaged.sources.dependencySourceRoots({
    packagedMode: true,
    environment: { FACTORY_VENDOR_DIR: development },
    packagedResourceDirectory: packaged.resources,
    applicationDataDirectory: data
  }).map((entry) => entry.mode), ["packaged_resource"]);
});

test("packaged dependency resolution rejects a caller-selected resource root and ignores FACTORY_VENDOR_DIR", (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packaged = createCanonicalPackagedDependencyModule(root);
  const attacker = path.join(root, "attacker resources");
  const vendor = path.join(root, "vendor");
  writePackage(path.join(attacker, "managed-packages"), "kava.zip");
  writePackage(vendor, "kava.zip");
  assert.throws(() => packaged.sources.resolveApprovedDependencySource("kava", {
    packagedMode: true,
    environment: { FACTORY_VENDOR_DIR: vendor, FACTORY_PACKAGED_RESOURCES: attacker },
    packagedResourceDirectory: attacker
  }), (error) => !String(error.message).includes(attacker) && /Packaged dependency resources are invalid/.test(error.message));
  const source = packaged.sources.resolveApprovedDependencySource("kava", {
    packagedMode: true,
    environment: { FACTORY_VENDOR_DIR: vendor, FACTORY_PACKAGED_RESOURCES: attacker },
    packagedResourceDirectory: packaged.resources
  });
  assert.equal(source.mode, "packaged_resource");
  assert.equal(source.exists, false);
  assert.equal(source.absolutePath.includes(attacker), false);
});

test("packaged dependency resolution rejects a managed-package reparse entry without following it", (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packaged = createCanonicalPackagedDependencyModule(root);
  const target = path.join(root, "external managed packages");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "kava.zip"), "attacker package", "utf8");
  const managed = path.join(packaged.resources, "managed-packages");
  try {
    fs.symlinkSync(target, managed, "junction");
  } catch (error) {
    try {
      fs.symlinkSync(target, managed, "dir");
    } catch (linkError) {
      t.skip("Local symlink and junction creation are unavailable on this host.");
      return;
    }
  }
  assert.throws(() => packaged.sources.resolveApprovedDependencySource("kava", {
    packagedMode: true,
    packagedResourceDirectory: packaged.resources
  }), /Packaged dependency resources are invalid/);
  assert.equal(fs.existsSync(path.join(target, "kava.zip")), true);
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
  assert.deepEqual(roots.map((source) => source.mode), ["application_data_bundle"]);
  assert.equal(roots.some((source) => source.root.endsWith(".zip")), false);
});
