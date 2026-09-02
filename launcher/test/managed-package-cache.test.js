"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectScaffold } = require("../src/project-store");
const { listApprovedDependencySources } = require("../src/dependency-sources");
const { installDependency } = require("../src/install-dependency");
const {
  createManagedDependencyInstallPlan,
  getCacheEntryPaths,
  readManagedDependencyInstallPlan,
  resolveCachePackagePath,
  verifyManagedPackageCacheEntry
} = require("../src/managed-package-cache");
const { validateZipPackage } = require("../src/package-validator");
const { resolveDependencyDefinition } = require("../src/dependency-catalog");

let portCounter = 29100;

function crc32Placeholder() {
  return 0;
}

function dosDateTime() {
  return {
    time: 0,
    date: 0
  };
}

function createStoredZip(filePath, entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.content || "", "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc32Placeholder(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc32Placeholder(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(entry.directory ? 0x40000000 : 0x20, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const centralOffset = offset;
  const centralSize = centralDirectory.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat(localParts.concat([centralDirectory, eocd])));
}

function createStoredZipWithDeclaredSizes(filePath, entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.content || "", "utf8");
    const declaredCompressedSize = entry.declaredCompressedSize != null ? entry.declaredCompressedSize : data.length;
    const declaredUncompressedSize = entry.declaredUncompressedSize != null ? entry.declaredUncompressedSize : data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc32Placeholder(data), 14);
    local.writeUInt32LE(declaredCompressedSize, 18);
    local.writeUInt32LE(declaredUncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc32Placeholder(data), 16);
    central.writeUInt32LE(declaredCompressedSize, 20);
    central.writeUInt32LE(declaredUncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(entry.directory ? 0x40000000 : 0x20, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const centralOffset = offset;
  const centralSize = centralDirectory.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat(localParts.concat([centralDirectory, eocd])));
}

function withVendorDir(vendorDir, callback) {
  const previous = process.env.FACTORY_VENDOR_DIR;
  process.env.FACTORY_VENDOR_DIR = vendorDir;
  try {
    return callback();
  } finally {
    if (previous == null) {
      delete process.env.FACTORY_VENDOR_DIR;
    } else {
      process.env.FACTORY_VENDOR_DIR = previous;
    }
  }
}

function createTempProjectsRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-managed-cache-"));
}

function createTempProject(projectsRoot, slug) {
  return createProjectScaffold({
    name: slug,
    slug,
    port: portCounter += 1,
    projectsRoot
  });
}

function createKavaZip(vendorDir) {
  const zipPath = path.join(vendorDir, "kava.zip");
  createStoredZip(zipPath, [
    { name: "kava/", directory: true },
    { name: "kava/style.css", content: "/*\nTheme Name: Kava\nVersion: 2.1.4\n*/\n" }
  ]);
  return zipPath;
}

function createJetFormBuilderZip(vendorDir, entries) {
  const zipPath = path.join(vendorDir, "jet-form-builder.zip");
  createStoredZip(zipPath, entries || [
    { name: "jetformbuilder/", directory: true },
    { name: "jetformbuilder/jet-form-builder.php", content: "<?php\n/*\nPlugin Name: JetFormBuilder\nVersion: 3.6.5.1\n*/\n" }
  ]);
  return zipPath;
}

test("approved dependency sources are redacted for browser responses", () => {
  const vendorDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-vendor-"));
  createKavaZip(vendorDir);

  withVendorDir(vendorDir, () => {
    const sources = listApprovedDependencySources();
    const kava = sources.find((source) => source.key === "kava");
    assert.equal(kava.filename, "kava.zip");
    assert.equal(kava.exists, true);
    assert.equal(typeof kava.size, "number");
    assert.equal(Object.prototype.hasOwnProperty.call(kava, "absolutePath"), false);
    assert.equal(JSON.stringify(sources).includes(vendorDir), false);
  });
});

test("ZIP validator rejects traversal entries and validates WordPress identity", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-zip-validator-"));
  const goodZip = path.join(tempDir, "kava.zip");
  const badZip = path.join(tempDir, "bad.zip");
  const backslashTraversalZip = path.join(tempDir, "bad-backslash.zip");
  const wrongIdentityZip = path.join(tempDir, "wrong-identity.zip");
  const malformedZip = path.join(tempDir, "malformed.zip");
  const oversizedZip = path.join(tempDir, "oversized.zip");
  createStoredZip(goodZip, [
    { name: "kava/", directory: true },
    { name: "kava/style.css", content: "/*\nTheme Name: Kava\nVersion: 2.1.4\n*/\n" }
  ]);
  createStoredZip(badZip, [
    { name: "../evil.php", content: "<?php" }
  ]);
  createStoredZip(backslashTraversalZip, [
    { name: "..\\evil.php", content: "<?php" }
  ]);
  createStoredZip(wrongIdentityZip, [
    { name: "kava/", directory: true },
    { name: "kava/readme.txt", content: "not a theme header" }
  ]);
  fs.writeFileSync(malformedZip, "not a zip file", "utf8");
  createStoredZipWithDeclaredSizes(oversizedZip, [
    {
      name: "kava/style.css",
      content: "/*\nTheme Name: Kava\nVersion: 2.1.4\n*/\n",
      declaredUncompressedSize: 129 * 1024 * 1024
    }
  ]);

  const validation = validateZipPackage(goodZip, resolveDependencyDefinition("kava"));
  assert.equal(validation.valid, true);
  assert.equal(validation.product.version, "2.1.4");
  assert.match(validation.sha256, /^[a-f0-9]{64}$/);
  assert.throws(
    () => validateZipPackage(badZip, resolveDependencyDefinition("kava")),
    /path traversal/
  );
  assert.throws(
    () => validateZipPackage(backslashTraversalZip, resolveDependencyDefinition("kava")),
    /path traversal/
  );
  assert.throws(
    () => validateZipPackage(wrongIdentityZip, resolveDependencyDefinition("kava")),
    /expected product identity file/
  );
  assert.throws(
    () => validateZipPackage(malformedZip, resolveDependencyDefinition("kava")),
    /central directory not found/
  );
  assert.throws(
    () => validateZipPackage(oversizedZip, resolveDependencyDefinition("kava")),
    /too large/
  );
});

test("managed install plan creates immutable cache metadata without exposing local source paths", () => {
  const projectsRoot = createTempProjectsRoot();
  const vendorDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-vendor-"));
  createTempProject(projectsRoot, "managed-cache-project");
  createKavaZip(vendorDir);

  withVendorDir(vendorDir, () => {
    const result = createManagedDependencyInstallPlan({
      slug: "managed-cache-project",
      dependency: "kava",
      projectsRoot
    });

    assert.equal(result.summary.dependency_key, "kava");
    assert.equal(result.summary.provider, "development_local");
    assert.equal(result.summary.source.filename, "kava.zip");
    assert.equal(result.summary.package.product.version, "2.1.4");
    assert.match(result.summary.package.sha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(result.summary).includes(vendorDir), false);
    assert.equal(JSON.stringify(result.summary).includes(projectsRoot), false);

    const stored = readManagedDependencyInstallPlan({
      slug: "managed-cache-project",
      planId: result.plan.plan_id,
      projectsRoot
    });
    const cachePath = resolveCachePackagePath(projectsRoot, stored.plan.cache_ref);
    assert.equal(fs.existsSync(cachePath), true);
  });
});

test("JetFormBuilder uses its native root and identity through quarantine, cache, and an install plan", () => {
  const projectsRoot = createTempProjectsRoot();
  const vendorDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-vendor-"));
  createTempProject(projectsRoot, "jet-form-builder-cache-project");
  const zipPath = createJetFormBuilderZip(vendorDir);

  withVendorDir(vendorDir, () => {
    const dependency = resolveDependencyDefinition("jet-form-builder");
    const validation = validateZipPackage(zipPath, dependency);
    assert.deepEqual(validation.product, {
      slug: "jet-form-builder",
      type: "plugin",
      wp_slug: "jetformbuilder",
      zip_root: "jetformbuilder",
      identity_file: "jetformbuilder/jet-form-builder.php",
      version: "3.6.5.1"
    });

    const result = createManagedDependencyInstallPlan({
      slug: "jet-form-builder-cache-project",
      dependency: "jet-form-builder",
      projectsRoot
    });
    assert.equal(result.summary.source.filename, "jet-form-builder.zip");
    assert.equal(result.summary.package.product.version, "3.6.5.1");
    assert.equal(result.summary.package.product.identity_file, "jetformbuilder/jet-form-builder.php");
    assert.equal(result.summary.cache_ref.sha256, validation.sha256);
    assert.equal(JSON.stringify(result.summary).includes(vendorDir), false);

    const stored = readManagedDependencyInstallPlan({
      slug: "jet-form-builder-cache-project",
      planId: result.plan.plan_id,
      projectsRoot
    });
    const cachePath = resolveCachePackagePath(projectsRoot, stored.plan.cache_ref, stored.plan.package);
    fs.appendFileSync(cachePath, "tampered");
    assert.throws(
      () => verifyManagedPackageCacheEntry(projectsRoot, stored.plan.cache_ref, stored.plan.package),
      /digest changed/
    );
  });
});

test("JetFormBuilder rejects a wrong native root, identity, and malformed package", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-jfb-validator-"));
  const dependency = resolveDependencyDefinition("jet-form-builder");
  const wrongRoot = path.join(tempDir, "wrong-root.zip");
  const wrongIdentity = path.join(tempDir, "wrong-identity.zip");
  const malformed = path.join(tempDir, "malformed.zip");
  createStoredZip(wrongRoot, [
    { name: "jet-form-builder/", directory: true },
    { name: "jet-form-builder/jet-form-builder.php", content: "<?php\n/*\nPlugin Name: JetFormBuilder\nVersion: 3.6.5.1\n*/\n" }
  ]);
  createJetFormBuilderZip(tempDir, [
    { name: "jetformbuilder/", directory: true },
    { name: "jetformbuilder/readme.txt", content: "wrong identity" }
  ]);
  fs.renameSync(path.join(tempDir, "jet-form-builder.zip"), wrongIdentity);
  fs.writeFileSync(malformed, "not a ZIP", "utf8");

  assert.throws(() => validateZipPackage(wrongRoot, dependency), /expected product root/);
  assert.throws(() => validateZipPackage(wrongIdentity, dependency), /expected product identity file/);
  assert.throws(() => validateZipPackage(malformed, dependency), /central directory not found/);
});

test("installer rejects direct caller-provided ZIP paths before runtime mutation", async () => {
  const projectsRoot = createTempProjectsRoot();
  const vendorDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-vendor-"));
  const zipPath = createKavaZip(vendorDir);
  createTempProject(projectsRoot, "direct-zip-project");

  await assert.rejects(
    () => installDependency({
      slug: "direct-zip-project",
      dependency: "kava",
      zip: zipPath,
      projectsRoot
    }),
    /Direct dependency ZIP paths are not accepted/
  );
});

test("invalid managed package sources do not promote cache entries or write install plans", () => {
  const projectsRoot = createTempProjectsRoot();
  const vendorDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-vendor-"));
  createTempProject(projectsRoot, "invalid-managed-package-project");
  createStoredZip(path.join(vendorDir, "kava.zip"), [
    { name: "kava/", directory: true },
    { name: "kava/readme.txt", content: "wrong identity" }
  ]);

  withVendorDir(vendorDir, () => {
    assert.throws(
      () => createManagedDependencyInstallPlan({
        slug: "invalid-managed-package-project",
        dependency: "kava",
        projectsRoot
      }),
      /expected product identity file/
    );
  });

  const runtimePath = path.join(projectsRoot, "invalid-managed-package-project");
  const planDir = path.join(runtimePath, "runs", "dependency-install-plans");
  const cacheRoot = path.join(projectsRoot, ".factory-cache", "managed-packages");
  assert.equal(fs.existsSync(planDir), false);
  if (fs.existsSync(cacheRoot)) {
    const packageFiles = [];
    for (const entry of fs.readdirSync(cacheRoot, { recursive: true })) {
      if (String(entry).endsWith("package.zip") || String(entry).endsWith("metadata.json")) {
        packageFiles.push(entry);
      }
    }
    assert.equal(packageFiles.length, 0);
  }
});

test("cached package digest is rechecked before install use", () => {
  const projectsRoot = createTempProjectsRoot();
  const vendorDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-vendor-"));
  createTempProject(projectsRoot, "managed-cache-integrity-project");
  createKavaZip(vendorDir);

  withVendorDir(vendorDir, () => {
    const result = createManagedDependencyInstallPlan({
      slug: "managed-cache-integrity-project",
      dependency: "kava",
      projectsRoot
    });
    const stored = readManagedDependencyInstallPlan({
      slug: "managed-cache-integrity-project",
      planId: result.plan.plan_id,
      projectsRoot
    });
    const cachePath = resolveCachePackagePath(projectsRoot, stored.plan.cache_ref, stored.plan.package);
    fs.appendFileSync(cachePath, "tampered");

    assert.throws(
      () => verifyManagedPackageCacheEntry(projectsRoot, stored.plan.cache_ref, stored.plan.package),
      /digest changed/
    );
    assert.throws(
      () => resolveCachePackagePath(projectsRoot, stored.plan.cache_ref, stored.plan.package),
      /digest changed/
    );

    const cachePaths = getCacheEntryPaths(projectsRoot, stored.plan.cache_ref.sha256);
    assert.equal(fs.existsSync(cachePaths.packagePath), true);
    assert.equal(fs.existsSync(cachePaths.metadataPath), true);
  });
});
