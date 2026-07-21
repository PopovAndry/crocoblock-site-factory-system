"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  assertSafeRuntimePath,
  ensureDirectory,
  readProjectBySlug,
  resolveProjectsRoot,
  writeJsonFile
} = require("./project-store");
const { resolveDependencyDefinition } = require("./dependency-catalog");
const { resolveApprovedDependencySource } = require("./dependency-sources");
const { sha256File, validateZipPackage } = require("./package-validator");

const SCHEMA = "factory_managed_dependency_install_plan";
const CACHE_SCHEMA = "factory_managed_package_cache_entry";
const PLAN_VERSION = 1;
const CACHE_VERSION = 1;
const DEFAULT_PROVIDER = "development_local";

function timestampCompact() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeChmod(filePath, mode) {
  try {
    fs.chmodSync(filePath, mode);
  } catch (error) {
    // Windows may ignore POSIX-style permissions. The cache remains project-local.
  }
}

function atomicWriteJson(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  const tempPath = filePath + ".tmp-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  safeChmod(tempPath, 0o600);
  fs.renameSync(tempPath, filePath);
}

function atomicCopyFile(sourcePath, destinationPath) {
  ensureDirectory(path.dirname(destinationPath));
  const tempPath = destinationPath + ".tmp-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
  fs.copyFileSync(sourcePath, tempPath);
  safeChmod(tempPath, 0o600);
  fs.renameSync(tempPath, destinationPath);
}

function getCacheRoot(projectsRoot) {
  return path.join(resolveProjectsRoot(projectsRoot), ".factory-cache", "managed-packages");
}

function getCacheEntryPaths(projectsRoot, sha256) {
  const normalizedHash = String(sha256 || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedHash)) {
    throw new Error("Invalid package cache hash.");
  }
  const entryRoot = path.join(getCacheRoot(projectsRoot), "sha256", normalizedHash.slice(0, 2), normalizedHash);
  return {
    entryRoot,
    packagePath: path.join(entryRoot, "package.zip"),
    metadataPath: path.join(entryRoot, "metadata.json")
  };
}

function getQuarantinePath(projectsRoot, dependencyKey) {
  return path.join(
    getCacheRoot(projectsRoot),
    "quarantine",
    dependencyKey + "-" + timestampCompact() + "-" + crypto.randomBytes(4).toString("hex") + ".zip"
  );
}

function getPlanDirectory(runtimePath) {
  return path.join(runtimePath, "runs", "dependency-install-plans");
}

function getPlanPath(runtimePath, planId) {
  const safePlanId = String(planId || "").trim();
  if (!/^dependency-plan-[a-z0-9-]+$/.test(safePlanId)) {
    throw new Error("Invalid dependency install plan id.");
  }
  return path.join(getPlanDirectory(runtimePath), safePlanId + ".json");
}

function summarizePlan(plan) {
  return {
    schema: plan.schema,
    version: plan.version,
    plan_id: plan.plan_id,
    project_slug: plan.project_slug,
    dependency_key: plan.dependency_key,
    provider: plan.provider,
    source: plan.source,
    package: plan.package,
    cache_ref: plan.cache_ref,
    status: plan.status,
    created_at: plan.created_at,
    expires_at: plan.expires_at,
    warnings: plan.warnings || []
  };
}

function writeCacheEntry(projectsRoot, quarantinePath, validation, sourceSummary) {
  const paths = getCacheEntryPaths(projectsRoot, validation.sha256);
  const metadata = {
    schema: CACHE_SCHEMA,
    version: CACHE_VERSION,
    sha256: validation.sha256,
    byte_size: validation.byte_size,
    entry_count: validation.entry_count,
    total_uncompressed_size: validation.total_uncompressed_size,
    product: validation.product,
    source: sourceSummary,
    cached_at: new Date().toISOString()
  };

  if (!fs.existsSync(paths.packagePath)) {
    atomicCopyFile(quarantinePath, paths.packagePath);
  }
  atomicWriteJson(paths.metadataPath, metadata);

  return {
    cache_ref: {
      type: "sha256",
      sha256: validation.sha256
    },
    metadata
  };
}

function createManagedDependencyInstallPlan(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  projectState.projectsRoot = projectsRoot;
  const runtimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const dependency = resolveDependencyDefinition(options.dependency || options.dependencyKey);
  const provider = options.provider || DEFAULT_PROVIDER;

  if (provider !== DEFAULT_PROVIDER) {
    const error = new Error("Unsupported dependency package provider.");
    error.code = "unsupported_dependency_provider";
    throw error;
  }

  const approvedSource = resolveApprovedDependencySource(dependency.slug, options.dependencySourceOptions);
  if (!approvedSource.exists) {
    const error = new Error("Approved dependency ZIP is missing for " + dependency.slug + ".");
    error.code = "approved_dependency_zip_missing";
    throw error;
  }

  const quarantinePath = getQuarantinePath(projectsRoot, dependency.slug);
  atomicCopyFile(approvedSource.absolutePath, quarantinePath);

  let validation;
  let cacheEntry;
  const sourceSummary = {
    provider,
    key: dependency.slug,
    filename: approvedSource.filename,
    source_mode: approvedSource.mode,
    byte_size: approvedSource.size
  };

  try {
    validation = validateZipPackage(quarantinePath, dependency);
    cacheEntry = writeCacheEntry(projectsRoot, quarantinePath, validation, sourceSummary);
  } finally {
    try {
      fs.rmSync(quarantinePath, { force: true });
    } catch (error) {
      // A leftover quarantine file is not a valid install source and is safe to clean manually.
    }
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  const planId = "dependency-plan-" + dependency.slug + "-" + timestampCompact().toLowerCase() + "-" + crypto.randomBytes(3).toString("hex");
  const plan = {
    schema: SCHEMA,
    version: PLAN_VERSION,
    plan_id: planId,
    project_slug: projectState.project.slug,
    dependency_key: dependency.slug,
    provider,
    source: sourceSummary,
    package: {
      sha256: validation.sha256,
      byte_size: validation.byte_size,
      product: validation.product
    },
    cache_ref: cacheEntry.cache_ref,
    status: "ready",
    created_at: now.toISOString(),
    expires_at: expiresAt,
    warnings: []
  };

  const planPath = getPlanPath(runtimePath, planId);
  atomicWriteJson(planPath, plan);

  return {
    project: projectState.project,
    dependency,
    plan,
    planPath,
    summary: summarizePlan(plan)
  };
}

function readManagedDependencyInstallPlan(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  projectState.projectsRoot = projectsRoot;
  const runtimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const planPath = getPlanPath(runtimePath, options.planId);

  if (!fs.existsSync(planPath)) {
    const error = new Error("Dependency install plan not found.");
    error.code = "dependency_install_plan_not_found";
    throw error;
  }

  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  if (plan.schema !== SCHEMA || plan.version !== PLAN_VERSION) {
    const error = new Error("Unsupported dependency install plan schema.");
    error.code = "dependency_install_plan_invalid";
    throw error;
  }
  if (plan.project_slug !== projectState.project.slug) {
    const error = new Error("Dependency install plan does not belong to this project.");
    error.code = "dependency_install_plan_project_mismatch";
    throw error;
  }
  if (plan.status !== "ready") {
    const error = new Error("Dependency install plan is not ready.");
    error.code = "dependency_install_plan_not_ready";
    throw error;
  }
  if (Date.parse(plan.expires_at || "") < Date.now()) {
    const error = new Error("Dependency install plan has expired. Preview the install again.");
    error.code = "dependency_install_plan_expired";
    throw error;
  }

  return {
    projectState,
    dependency: resolveDependencyDefinition(plan.dependency_key),
    plan,
    planPath,
    summary: summarizePlan(plan)
  };
}

function readCacheMetadata(metadataPath) {
  try {
    return JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  } catch (error) {
    const readError = new Error("Managed package cache metadata is invalid.");
    readError.code = "managed_package_cache_invalid_metadata";
    throw readError;
  }
}

function verifyManagedPackageCacheEntry(projectsRoot, cacheRef, expectedPackage) {
  if (!cacheRef || cacheRef.type !== "sha256") {
    throw new Error("Unsupported package cache reference.");
  }
  const paths = getCacheEntryPaths(projectsRoot, cacheRef.sha256);
  if (!fs.existsSync(paths.packagePath) || !fs.existsSync(paths.metadataPath)) {
    const error = new Error("Verified package cache entry is missing.");
    error.code = "managed_package_cache_missing";
    throw error;
  }
  const metadata = readCacheMetadata(paths.metadataPath);
  if (metadata.schema !== CACHE_SCHEMA || metadata.version !== CACHE_VERSION) {
    const error = new Error("Managed package cache metadata is unsupported.");
    error.code = "managed_package_cache_invalid_metadata";
    throw error;
  }
  if (String(metadata.sha256 || "").toLowerCase() !== String(cacheRef.sha256 || "").toLowerCase()) {
    const error = new Error("Managed package cache metadata does not match the requested digest.");
    error.code = "managed_package_cache_metadata_mismatch";
    throw error;
  }
  if (expectedPackage && String(expectedPackage.sha256 || "").toLowerCase() !== String(cacheRef.sha256 || "").toLowerCase()) {
    const error = new Error("Managed package cache reference does not match the approved plan package.");
    error.code = "managed_package_cache_plan_mismatch";
    throw error;
  }
  if (expectedPackage && expectedPackage.product) {
    const expectedProduct = expectedPackage.product;
    const actualProduct = metadata.product || {};
    const keys = ["slug", "type", "wp_slug", "zip_root", "identity_file", "version"];
    for (const key of keys) {
      if (expectedProduct[key] != null && actualProduct[key] !== expectedProduct[key]) {
        const error = new Error("Managed package cache metadata does not match the approved plan product.");
        error.code = "managed_package_cache_plan_mismatch";
        throw error;
      }
    }
  }
  const actualDigest = sha256File(paths.packagePath);
  if (actualDigest !== String(cacheRef.sha256 || "").toLowerCase()) {
    const error = new Error("Managed package cache verification failed because the cached package digest changed.");
    error.code = "managed_package_cache_digest_mismatch";
    throw error;
  }

  return {
    packagePath: paths.packagePath,
    metadata,
    digest: actualDigest
  };
}

function resolveCachePackagePath(projectsRoot, cacheRef, expectedPackage) {
  return verifyManagedPackageCacheEntry(projectsRoot, cacheRef, expectedPackage).packagePath;
}

module.exports = {
  CACHE_SCHEMA,
  DEFAULT_PROVIDER,
  SCHEMA,
  createManagedDependencyInstallPlan,
  getCacheEntryPaths,
  readManagedDependencyInstallPlan,
  resolveCachePackagePath,
  summarizePlan,
  verifyManagedPackageCacheEntry
};
