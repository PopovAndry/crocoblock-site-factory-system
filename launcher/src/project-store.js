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

function resolveProjectsRoot(projectsRoot) {
  return path.resolve(projectsRoot || DEFAULT_PROJECTS_ROOT);
}

function normalizePath(inputPath) {
  return path.resolve(inputPath);
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

  const existingProjects = listProjects(projectsRoot);
  const conflictingPortProject = existingProjects.find((project) => Number(project.wp_port) === requestedPort);
  if (conflictingPortProject) {
    throw new Error(
      "WordPress port " + String(requestedPort) + " is already assigned to project " + conflictingPortProject.slug + "."
    );
  }

  const runtimePath = path.join(projectsRoot, slug);
  if (fs.existsSync(runtimePath)) {
    throw new Error("Project already exists: " + runtimePath);
  }

  const project = createProjectRecord(siteName, slug, runtimePath, requestedPort);
  const filesWritten = [
    path.join(runtimePath, "factory-project.json"),
    path.join(runtimePath, ".env"),
    path.join(runtimePath, "docker-compose.yml")
  ];

  ensureDirectory(runtimePath);
  for (const subdirectory of PROJECT_SUBDIRECTORIES) {
    ensureDirectory(path.join(runtimePath, subdirectory));
  }

  writeJsonFile(filesWritten[0], toStoredProject(project));
  writeEnvFile(filesWritten[1], parseEnvContent(createEnvFile(project)));
  fs.writeFileSync(filesWritten[2], createDockerCompose(project), "utf8");

  return {
    project: sanitizeProject(project),
    files_written: filesWritten,
    directories_written: PROJECT_SUBDIRECTORIES.map((name) => path.join(runtimePath, name))
  };
}

function readProjectRecord(runtimePath) {
  const manifestPath = path.join(runtimePath, "factory-project.json");
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
  const manifestPath = path.join(runtimePath, "factory-project.json");

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

  return {
    project,
    manifestPath,
    runtimePath,
    envPath: path.join(runtimePath, ".env"),
    composePath: path.join(runtimePath, "docker-compose.yml"),
    env: parseEnvFile(path.join(runtimePath, ".env"))
  };
}

function saveProjectRecord(projectState, project) {
  project.updated_at = timestampIso();
  writeJsonFile(projectState.manifestPath, toStoredProject(project));
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
  assertSafeRuntimePath,
  createProjectScaffold,
  ensureDirectory,
  ensureSafeProjectsRoot,
  listProjects,
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
