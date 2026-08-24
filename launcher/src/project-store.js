"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createDockerCompose, createEnvFile } = require("./templates");

function getSystemRoot() {
  return path.parse(process.cwd()).root || path.sep;
}

const DEFAULT_PROJECTS_ROOT = path.join(getSystemRoot(), "sf-factory-projects");
const BLOCKED_ROOTS = [
  "crocoblock-site-factory-system",
  "sf-playable-beta",
  "sf-slate-visual-smoke",
  "sf-controlled-generate-smoke"
].map((directoryName) => path.join(getSystemRoot(), directoryName));
const PROJECT_SUBDIRECTORIES = ["runs", "proofs", "snapshots", "logs", "exports", "secrets", "wordpress", "mysql"];
const PROJECT_STORE_LOCK_DIRECTORY = ".factory-project-store.lock";
const PROJECT_STORE_INTERNAL_DIRECTORIES = new Set([
  PROJECT_STORE_LOCK_DIRECTORY,
  ".factory-cache",
  ".factory-recovery"
]);
const PROJECT_STORE_LOCK_OWNER_FILE = "owner.json";
const PROJECT_STORE_LOCK_WAIT_MS = 1500;
const PROJECT_STORE_LOCK_POLL_MS = 10;
const PROJECT_STORE_LOCK_SLEEP = new Int32Array(new SharedArrayBuffer(4));
const PROJECT_STATE_BINDING = Symbol("factory_project_state_binding");
const PROJECT_MANIFEST_FILENAME = "factory-project.json";
const PROJECT_MANIFEST_TEMP_PREFIX = ".factory-project.json.";
const PROJECT_MANIFEST_TEMP_SUFFIX = ".tmp";
const PROJECT_RUNTIME_MARKERS = new Set([
  PROJECT_MANIFEST_FILENAME,
  ".env",
  "docker-compose.yml",
  "wordpress",
  "mysql"
]);

function createProjectStoreError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}

function projectStoreUnavailableError() {
  return createProjectStoreError(
    "Project storage is busy. Try again.",
    "project_store_unavailable"
  );
}

function projectPortConflictError() {
  return createProjectStoreError(
    "The selected local website port is already assigned to another project.",
    "project_port_conflict"
  );
}

function projectStoreInventoryInvalidError() {
  return createProjectStoreError(
    "Project storage is inconsistent. Resolve project storage and try again.",
    "project_store_inventory_invalid"
  );
}

function projectIdentityMismatchError() {
  return createProjectStoreError(
    "Project identity does not match the stored project.",
    "project_identity_mismatch"
  );
}

function projectManifestWriteError() {
  return createProjectStoreError(
    "Project storage could not be updated. Try again.",
    "project_store_write_failed"
  );
}

function normalizeCanonicalProjectPort(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : null;
  }
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 && String(port) === value ? port : null;
}

function acquireProjectStoreLock(projectsRoot) {
  const lockPath = path.join(projectsRoot, PROJECT_STORE_LOCK_DIRECTORY);
  const ownerPath = path.join(lockPath, PROJECT_STORE_LOCK_OWNER_FILE);
  const token = crypto.randomBytes(32).toString("hex");
  const deadline = Date.now() + PROJECT_STORE_LOCK_WAIT_MS;
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      try {
        fs.writeFileSync(ownerPath, JSON.stringify({
          schema: "factory_project_store_lock",
          version: 1,
          owner_token: token,
          pid: process.pid
        }) + "\n", { encoding: "utf8", flag: "wx" });
      } catch (error) {
        try {
          fs.rmSync(lockPath, { recursive: true, force: true });
        } catch (cleanupError) {
          // A failed acquisition remains fail closed if its private artifact cannot be removed.
        }
        throw projectStoreUnavailableError();
      }
      return { lockPath, ownerPath, token };
    } catch (error) {
      if (error && error.code !== "EEXIST") {
        if (error && error.code === "project_store_unavailable") {
          throw error;
        }
        throw projectStoreUnavailableError();
      }
      if (Date.now() >= deadline) {
        throw projectStoreUnavailableError();
      }
      Atomics.wait(PROJECT_STORE_LOCK_SLEEP, 0, 0, PROJECT_STORE_LOCK_POLL_MS);
    }
  }
}

function releaseProjectStoreLock(lock) {
  let owner;
  try {
    owner = JSON.parse(fs.readFileSync(lock.ownerPath, "utf8"));
  } catch (error) {
    throw projectStoreUnavailableError();
  }
  if (!owner || owner.schema !== "factory_project_store_lock" || owner.version !== 1
    || typeof owner.owner_token !== "string" || owner.owner_token !== lock.token) {
    throw projectStoreUnavailableError();
  }
  try {
    fs.unlinkSync(lock.ownerPath);
    fs.rmdirSync(lock.lockPath);
  } catch (error) {
    throw projectStoreUnavailableError();
  }
}

function withProjectStoreTransaction(projectsRoot, callback) {
  const lock = acquireProjectStoreLock(projectsRoot);
  let result;
  let primaryError = null;
  try {
    result = callback();
  } catch (error) {
    primaryError = error;
  }
  try {
    releaseProjectStoreLock(lock);
  } catch (error) {
    if (!primaryError) {
      primaryError = error;
    }
  }
  if (primaryError) {
    throw primaryError;
  }
  return result;
}

function resolveProjectsRoot(projectsRoot) {
  return path.resolve(projectsRoot || DEFAULT_PROJECTS_ROOT);
}

function normalizePath(inputPath) {
  return path.resolve(inputPath);
}

function pathComparisonKey(inputPath) {
  const resolved = normalizePath(inputPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function pathsEqual(leftPath, rightPath) {
  return pathComparisonKey(leftPath) === pathComparisonKey(rightPath);
}

function hasParentTraversal(inputPath) {
  return typeof inputPath === "string" && inputPath.split(/[\\/]+/).includes("..");
}

function isPathInside(parentPath, childPath) {
  const normalizedParent = normalizePath(parentPath);
  const normalizedChild = normalizePath(childPath);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(normalizedParent + path.sep);
}

function slugifyProjectName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function validateExplicitSlug(slug) {
  const trimmed = String(slug || "").trim().toLowerCase();
  if (!trimmed) {
    throw new Error("Project slug is required.");
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
    throw new Error("Project slug must use lowercase letters, numbers, and single hyphens only.");
  }

  return trimmed;
}

function ensureSafeProjectsRoot(projectsRoot) {
  const resolved = resolveProjectsRoot(projectsRoot);

  for (const blockedRoot of BLOCKED_ROOTS) {
    if (isPathInside(blockedRoot, resolved)) {
      throw new Error("Refusing to create project scaffolds inside blocked path: " + normalizePath(blockedRoot));
    }
  }

  return resolved;
}

function assertSafeRuntimePath(runtimePath, projectsRoot) {
  const resolvedRuntimePath = normalizePath(runtimePath);
  const resolvedProjectsRoot = resolveProjectsRoot(projectsRoot);

  if (!isPathInside(resolvedProjectsRoot, resolvedRuntimePath)) {
    throw new Error("Runtime path is outside the allowed projects root: " + resolvedRuntimePath);
  }

  for (const blockedRoot of BLOCKED_ROOTS) {
    const normalizedBlockedRoot = normalizePath(blockedRoot);
    if (resolvedRuntimePath === normalizedBlockedRoot) {
      throw new Error("Runtime path points to a blocked location: " + resolvedRuntimePath);
    }
  }

  return resolvedRuntimePath;
}

function assertDirectProjectRuntimePath(runtimePath, projectsRoot) {
  if (typeof runtimePath !== "string" || !runtimePath || hasParentTraversal(runtimePath)) {
    throw projectIdentityMismatchError();
  }
  const resolvedRuntimePath = assertSafeRuntimePath(runtimePath, projectsRoot);
  const resolvedProjectsRoot = resolveProjectsRoot(projectsRoot);
  if (!pathsEqual(path.dirname(resolvedRuntimePath), resolvedProjectsRoot)
    || pathsEqual(resolvedRuntimePath, resolvedProjectsRoot)) {
    throw projectIdentityMismatchError();
  }
  return resolvedRuntimePath;
}

function randomSuffix(length) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
}

function randomPassword(prefix) {
  return prefix + randomSuffix(12);
}

function timestampIso() {
  return new Date().toISOString();
}

function defaultAiMetadata() {
  return {
    mode: "mock",
    provider: "mock",
    model_profile: "balanced",
    model: "local_interpreter",
    key_status: "not_required",
    key_source: null,
    key_env_name: null,
    key_masked: "",
    key_present: false,
    key_tested: false,
    key_tested_at: null,
    live_calls_enabled: false,
    last_estimate: null,
    last_live_call: null,
    updated_at: timestampIso()
  };
}

function defaultGenerationMetadata() {
  return {
    status: "not_generated",
    last_generate_run_id: null,
    last_proof_id: null,
    generated_at: null,
    last_operation_id: null,
    last_plan_id: null
  };
}

function defaultGeneratedSiteMetadata() {
  return {
    present: false,
    urls: {}
  };
}

function defaultCreateWebsiteMetadata() {
  return null;
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function removeManifestTempFile(tempPath) {
  let cleanupError = null;
  for (let attempt = 0; attempt < 3 && fs.existsSync(tempPath); attempt += 1) {
    try {
      fs.unlinkSync(tempPath);
      cleanupError = null;
    } catch (error) {
      cleanupError = error;
    }
  }
  if (fs.existsSync(tempPath)) {
    throw cleanupError || new Error("Manifest temporary file cleanup failed.");
  }
}

function writeProjectManifestAtomic(manifestPath, project) {
  let payload;
  try {
    payload = JSON.stringify(toStoredProject(project), null, 2) + "\n";
  } catch (error) {
    throw projectManifestWriteError();
  }

  const manifestDirectory = path.dirname(manifestPath);
  const tempPath = path.join(
    manifestDirectory,
    PROJECT_MANIFEST_TEMP_PREFIX + crypto.randomBytes(16).toString("hex") + PROJECT_MANIFEST_TEMP_SUFFIX
  );
  let descriptor = null;
  let primaryError = null;
  try {
    descriptor = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(descriptor, payload, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempPath, manifestPath);
  } catch (error) {
    primaryError = error;
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch (error) {
        if (!primaryError) {
          primaryError = error;
        }
      }
    }
    try {
      removeManifestTempFile(tempPath);
    } catch (error) {
      if (!primaryError) {
        primaryError = error;
      }
    }
  }
  if (primaryError) {
    throw projectManifestWriteError();
  }
}

function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return parseEnvContent(content);
}

function parseEnvContent(content) {
  const result = {};

  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    result[key] = value;
  }

  return result;
}

function serializeEnvFile(env) {
  const orderedKeys = [
    "PROJECT_SLUG",
    "WP_PORT",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
    "DB_ROOT_PASSWORD",
    "WP_ADMIN_USER",
    "WP_ADMIN_PASSWORD",
    "WP_APP_PASSWORD_NAME",
    "WP_APP_PASSWORD"
  ];
  const remainingKeys = Object.keys(env).filter((key) => !orderedKeys.includes(key)).sort();
  const lines = ["# Alpha local runtime credentials. Do not use for production."];

  for (const key of orderedKeys.concat(remainingKeys)) {
    if (!Object.prototype.hasOwnProperty.call(env, key)) {
      continue;
    }
    lines.push(key + "=" + String(env[key]));
  }

  lines.push("");
  return lines.join("\n");
}

function writeEnvFile(filePath, env) {
  fs.writeFileSync(filePath, serializeEnvFile(env), "utf8");
}

function createProjectRecord(siteName, slug, runtimePath, wpPort) {
  const now = timestampIso();

  return {
    project_id: crypto.randomUUID(),
    site_name: siteName,
    slug,
    runtime_path: runtimePath,
    wp_url: "http://127.0.0.1:" + String(wpPort),
    wp_port: wpPort,
    db_name: "factory_" + slug.replace(/-/g, "_"),
    db_user: "factory_" + randomSuffix(8),
    db_password: randomPassword("db_"),
    db_root_password: randomPassword("root_"),
    admin_user: "factory_admin",
    admin_password: randomPassword("wp_"),
    runtime: {
      status: "not_provisioned",
      provisioned_at: null,
      wp_json_ok: false,
      last_proof_id: null,
      last_agent_proof_id: null
    },
    agent: {
      status: "not_installed",
      health: null,
      capabilities: null
    },
    current_run_id: null,
    dependency_state: null,
    ai: defaultAiMetadata(),
    generation: defaultGenerationMetadata(),
    generated_site: defaultGeneratedSiteMetadata(),
    create_website: defaultCreateWebsiteMetadata(),
    usage: {
      total_tokens: 0,
      total_cost_estimate: null
    },
    created_at: now,
    updated_at: now
  };
}

function toStoredProject(project) {
  return {
    project_id: project.project_id,
    site_name: project.site_name,
    slug: project.slug,
    runtime_path: project.runtime_path,
    wp_url: project.wp_url,
    wp_port: project.wp_port,
    db_name: project.db_name,
    admin_user: project.admin_user,
    runtime: project.runtime || {
      status: "not_provisioned",
      provisioned_at: null,
      wp_json_ok: false,
      last_proof_id: null,
      last_agent_proof_id: null
    },
    agent: project.agent,
    current_run_id: project.current_run_id,
    dependency_state: project.dependency_state,
    ai: Object.assign(defaultAiMetadata(), project.ai || {}),
    generation: Object.assign(defaultGenerationMetadata(), project.generation || {}),
    generated_site: Object.assign(defaultGeneratedSiteMetadata(), project.generated_site || {}),
    create_website: project.create_website && typeof project.create_website === "object"
      ? JSON.parse(JSON.stringify(project.create_website))
      : defaultCreateWebsiteMetadata(),
    usage: project.usage,
    created_at: project.created_at,
    updated_at: project.updated_at
  };
}

function sanitizeProject(project) {
  const stored = toStoredProject(project);
  return {
    project_id: stored.project_id,
    site_name: stored.site_name,
    slug: stored.slug,
    runtime_path: stored.runtime_path,
    wp_url: stored.wp_url,
    wp_port: stored.wp_port,
    db_name: stored.db_name,
    admin_user: stored.admin_user,
    runtime: stored.runtime,
    agent: stored.agent,
    current_run_id: stored.current_run_id,
    dependency_state: stored.dependency_state,
    ai: Object.assign(defaultAiMetadata(), stored.ai || {}),
    generation: Object.assign(defaultGenerationMetadata(), stored.generation || {}),
    generated_site: Object.assign(defaultGeneratedSiteMetadata(), stored.generated_site || {}),
    create_website: stored.create_website && typeof stored.create_website === "object"
      ? {
        status: stored.create_website.status || null,
        profile: stored.create_website.profile || null,
        business: stored.create_website.business || {},
        internal_stage: stored.create_website.internal_stage || null,
        created_at: stored.create_website.created_at || null,
        updated_at: stored.create_website.updated_at || null,
        completed_at: stored.create_website.completed_at || null,
        result: stored.create_website.result || null,
        failure: stored.create_website.failure || null
      }
      : defaultCreateWebsiteMetadata(),
    usage: stored.usage,
    created_at: stored.created_at,
    updated_at: stored.updated_at
  };
}

function validateStrictProjectRecord(data, runtimePath, projectsRoot) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw projectStoreInventoryInvalidError();
  }
  const requiredStrings = ["project_id", "site_name", "slug", "runtime_path", "wp_url", "db_name", "admin_user", "created_at", "updated_at"];
  for (const field of requiredStrings) {
    if (typeof data[field] !== "string" || !data[field].trim() || data[field] !== data[field].trim()) {
      throw projectStoreInventoryInvalidError();
    }
  }
  let validatedSlug;
  try {
    validatedSlug = validateExplicitSlug(data.slug);
  } catch (error) {
    throw projectStoreInventoryInvalidError();
  }
  if (validatedSlug !== data.slug || typeof data.wp_port !== "number"
    || normalizeCanonicalProjectPort(data.wp_port) === null) {
    throw projectStoreInventoryInvalidError();
  }
  const directRuntimePath = assertDirectProjectRuntimePath(runtimePath, projectsRoot);
  if (hasParentTraversal(data.runtime_path)
    || !pathsEqual(data.runtime_path, directRuntimePath)
    || !pathsEqual(path.join(projectsRoot, data.slug), directRuntimePath)) {
    throw projectStoreInventoryInvalidError();
  }
  const manifestPath = path.join(directRuntimePath, PROJECT_MANIFEST_FILENAME);
  if (Object.prototype.hasOwnProperty.call(data, "manifest_path")
    && (typeof data.manifest_path !== "string" || hasParentTraversal(data.manifest_path)
      || !pathsEqual(data.manifest_path, manifestPath))) {
    throw projectStoreInventoryInvalidError();
  }
  return {
    project: data,
    projectId: data.project_id,
    slug: data.slug,
    port: data.wp_port,
    runtimePath: directRuntimePath,
    manifestPath
  };
}

function readStrictProjectInventory(projectsRoot) {
  const resolvedProjectsRoot = ensureSafeProjectsRoot(projectsRoot);
  try {
    const rootRealPath = fs.realpathSync.native(resolvedProjectsRoot);
    const entries = fs.readdirSync(resolvedProjectsRoot, { withFileTypes: true });
    const inventory = [];
    for (const entry of entries) {
      if (PROJECT_STORE_INTERNAL_DIRECTORIES.has(entry.name)) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
          throw projectStoreInventoryInvalidError();
        }
        if (entry.name !== PROJECT_STORE_LOCK_DIRECTORY) {
          const internalEntries = fs.readdirSync(path.join(resolvedProjectsRoot, entry.name), { withFileTypes: true });
          if (internalEntries.some((internalEntry) => PROJECT_RUNTIME_MARKERS.has(internalEntry.name))) {
            throw projectStoreInventoryInvalidError();
          }
        }
        continue;
      }
      if (entry.isSymbolicLink()) {
        throw projectStoreInventoryInvalidError();
      }
      if (!entry.isDirectory()) {
        continue;
      }
      const runtimePath = path.join(resolvedProjectsRoot, entry.name);
      const runtimeStat = fs.lstatSync(runtimePath);
      const runtimeRealPath = fs.realpathSync.native(runtimePath);
      if (!runtimeStat.isDirectory() || runtimeStat.isSymbolicLink()
        || !pathsEqual(path.dirname(runtimeRealPath), rootRealPath)) {
        throw projectStoreInventoryInvalidError();
      }
      const manifestPath = path.join(runtimePath, PROJECT_MANIFEST_FILENAME);
      const manifestStat = fs.lstatSync(manifestPath);
      if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
        throw projectStoreInventoryInvalidError();
      }
      const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      inventory.push(validateStrictProjectRecord(data, runtimePath, resolvedProjectsRoot));
    }

    const slugs = new Set();
    const identities = new Set();
    const ports = new Set();
    const manifests = new Set();
    for (const record of inventory) {
      const slugKey = record.slug.toLowerCase();
      const identityKey = record.projectId.toLowerCase();
      const manifestKey = pathComparisonKey(record.manifestPath);
      if (slugs.has(slugKey) || identities.has(identityKey) || ports.has(record.port) || manifests.has(manifestKey)) {
        throw projectStoreInventoryInvalidError();
      }
      slugs.add(slugKey);
      identities.add(identityKey);
      ports.add(record.port);
      manifests.add(manifestKey);
    }
    return inventory;
  } catch (error) {
    if (error && error.code === "project_store_inventory_invalid") {
      throw error;
    }
    throw projectStoreInventoryInvalidError();
  }
}

function bindProjectState(projectState, projectsRoot, runtimePath, manifestPath) {
  Object.defineProperty(projectState, PROJECT_STATE_BINDING, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({ projectsRoot, runtimePath, manifestPath })
  });
  return projectState;
}

function createProjectScaffold(options) {
  const siteName = String(options.name || "").trim();
  const requestedPort = Number(options.port || 8099);
  const projectsRoot = ensureSafeProjectsRoot(options.projectsRoot);

  if (!siteName) {
    throw new Error("Project name is required.");
  }

  if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535) {
    throw new Error("Port must be an integer between 1024 and 65535.");
  }

  const slug = options.slug
    ? validateExplicitSlug(options.slug)
    : slugifyProjectName(siteName);
  if (!slug) {
    throw new Error("Project name did not produce a valid slug.");
  }

  ensureDirectory(projectsRoot);

  return withProjectStoreTransaction(projectsRoot, () => {
    const lockedProjectsRoot = ensureSafeProjectsRoot(projectsRoot);
    const existingProjects = readStrictProjectInventory(lockedProjectsRoot);
    const conflictingPortProject = existingProjects.find(
      (record) => record.port === requestedPort
    );
    if (conflictingPortProject) {
      throw projectPortConflictError();
    }

    const runtimePath = path.join(lockedProjectsRoot, slug);
    if (fs.existsSync(runtimePath)) {
      throw createProjectStoreError("The project already exists.", "project_exists");
    }

    const project = createProjectRecord(siteName, slug, runtimePath, requestedPort);
    const filesWritten = [
      path.join(runtimePath, PROJECT_MANIFEST_FILENAME),
      path.join(runtimePath, ".env"),
      path.join(runtimePath, "docker-compose.yml")
    ];
    let runtimeCreated = false;
    try {
      fs.mkdirSync(runtimePath);
      runtimeCreated = true;
      for (const subdirectory of PROJECT_SUBDIRECTORIES) {
        ensureDirectory(path.join(runtimePath, subdirectory));
      }
      writeProjectManifestAtomic(filesWritten[0], project);
      writeEnvFile(filesWritten[1], parseEnvContent(createEnvFile(project)));
      fs.writeFileSync(filesWritten[2], createDockerCompose(project), "utf8");
    } catch (error) {
      if (runtimeCreated) {
        try {
          fs.rmSync(runtimePath, { recursive: true, force: true });
        } catch (cleanupError) {
          // Preserve the primary scaffold failure; the transaction lock still serializes writers.
        }
      }
      throw error;
    }

    return {
      project: sanitizeProject(project),
      files_written: filesWritten,
      directories_written: PROJECT_SUBDIRECTORIES.map((name) => path.join(runtimePath, name))
    };
  });
}

function readProjectRecord(runtimePath) {
  const manifestPath = path.join(runtimePath, PROJECT_MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!data.runtime) {
      data.runtime = {
        status: "not_provisioned",
        provisioned_at: null,
        wp_json_ok: false,
        last_proof_id: null,
        last_agent_proof_id: null
      };
    }
    data.ai = Object.assign(defaultAiMetadata(), data.ai || {});
    data.generation = Object.assign(defaultGenerationMetadata(), data.generation || {});
    data.generated_site = Object.assign(defaultGeneratedSiteMetadata(), data.generated_site || {});
    data.create_website = data.create_website && typeof data.create_website === "object" ? data.create_website : null;
    return sanitizeProject(data);
  } catch (error) {
    return {
      site_name: path.basename(runtimePath),
      slug: path.basename(runtimePath),
      runtime_path: runtimePath,
      error: "Invalid factory-project.json"
    };
  }
}

function readProjectBySlug(slug, projectsRoot) {
  const safeSlug = slugifyProjectName(slug);
  if (!safeSlug) {
    throw new Error("A valid project slug is required.");
  }

  const resolvedProjectsRoot = resolveProjectsRoot(projectsRoot);
  const runtimePath = path.join(resolvedProjectsRoot, safeSlug);
  const manifestPath = path.join(runtimePath, PROJECT_MANIFEST_FILENAME);

  assertSafeRuntimePath(runtimePath, resolvedProjectsRoot);

  if (!fs.existsSync(manifestPath)) {
    throw new Error("Factory project not found: " + runtimePath);
  }

  const project = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!project.runtime) {
    project.runtime = {
      status: "not_provisioned",
      provisioned_at: null,
      wp_json_ok: false,
      last_proof_id: null,
      last_agent_proof_id: null
    };
  }
  project.ai = Object.assign(defaultAiMetadata(), project.ai || {});
  project.generation = Object.assign(defaultGenerationMetadata(), project.generation || {});
  project.generated_site = Object.assign(defaultGeneratedSiteMetadata(), project.generated_site || {});
  project.create_website = project.create_website && typeof project.create_website === "object" ? project.create_website : null;

  return bindProjectState({
    project,
    manifestPath,
    runtimePath,
    envPath: path.join(runtimePath, ".env"),
    composePath: path.join(runtimePath, "docker-compose.yml"),
    env: parseEnvFile(path.join(runtimePath, ".env"))
  }, resolvedProjectsRoot, runtimePath, manifestPath);
}

function saveProjectRecord(projectState, project) {
  const binding = projectState && projectState[PROJECT_STATE_BINDING];
  if (!binding || !project || typeof project !== "object" || Array.isArray(project)
    || typeof projectState.runtimePath !== "string" || hasParentTraversal(projectState.runtimePath)
    || typeof projectState.manifestPath !== "string" || hasParentTraversal(projectState.manifestPath)
    || !pathsEqual(projectState.runtimePath, binding.runtimePath)
    || !pathsEqual(projectState.manifestPath, binding.manifestPath)) {
    throw projectIdentityMismatchError();
  }
  const projectsRoot = ensureSafeProjectsRoot(binding.projectsRoot);
  const runtimePath = assertDirectProjectRuntimePath(binding.runtimePath, projectsRoot);
  const manifestPath = path.join(runtimePath, PROJECT_MANIFEST_FILENAME);
  if (!pathsEqual(binding.manifestPath, manifestPath)) {
    throw projectIdentityMismatchError();
  }
  return withProjectStoreTransaction(projectsRoot, () => {
    const lockedProjectsRoot = ensureSafeProjectsRoot(projectsRoot);
    const inventory = readStrictProjectInventory(lockedProjectsRoot);
    const current = inventory.find((record) => pathsEqual(record.manifestPath, manifestPath));
    if (!current) {
      throw projectIdentityMismatchError();
    }
    if (project.project_id !== current.projectId || project.slug !== current.slug
      || typeof project.runtime_path !== "string" || hasParentTraversal(project.runtime_path)
      || !pathsEqual(project.runtime_path, current.runtimePath)
      || Object.prototype.hasOwnProperty.call(project, "manifest_path")
        && (typeof project.manifest_path !== "string" || hasParentTraversal(project.manifest_path)
          || !pathsEqual(project.manifest_path, current.manifestPath))) {
      throw projectIdentityMismatchError();
    }
    const requestedPort = normalizeCanonicalProjectPort(project && project.wp_port);
    if (typeof project.wp_port !== "number" || requestedPort === null) {
      throw projectStoreInventoryInvalidError();
    }
    const conflict = inventory.find((record) => {
      return !pathsEqual(record.manifestPath, current.manifestPath) && record.port === requestedPort;
    });
    if (conflict) {
      throw projectPortConflictError();
    }
    const updatedAt = timestampIso();
    const nextProject = Object.assign({}, project, {
      project_id: current.projectId,
      slug: current.slug,
      runtime_path: current.project.runtime_path,
      updated_at: updatedAt
    });
    validateStrictProjectRecord(toStoredProject(nextProject), runtimePath, lockedProjectsRoot);
    writeProjectManifestAtomic(manifestPath, nextProject);
    project.updated_at = updatedAt;
  });
}

function listProjects(projectsRoot) {
  const resolvedRoot = resolveProjectsRoot(projectsRoot);
  if (!fs.existsSync(resolvedRoot)) {
    return [];
  }

  return fs.readdirSync(resolvedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readProjectRecord(path.join(resolvedRoot, entry.name)))
    .filter(Boolean)
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
}

module.exports = {
  BLOCKED_ROOTS,
  DEFAULT_PROJECTS_ROOT,
  PROJECT_SUBDIRECTORIES,
  PROJECT_STORE_LOCK_DIRECTORY,
  assertSafeRuntimePath,
  createProjectScaffold,
  ensureDirectory,
  ensureSafeProjectsRoot,
  listProjects,
  normalizeCanonicalProjectPort,
  parseEnvFile,
  writeEnvFile,
  readProjectBySlug,
  resolveProjectsRoot,
  saveProjectRecord,
  validateExplicitSlug,
  slugifyProjectName,
  defaultAiMetadata,
  defaultGeneratedSiteMetadata,
  defaultCreateWebsiteMetadata,
  defaultGenerationMetadata,
  writeJsonFile
};
