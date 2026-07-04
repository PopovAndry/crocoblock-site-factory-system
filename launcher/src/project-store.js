"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createDockerCompose, createEnvFile } = require("./templates");

const DEFAULT_PROJECTS_ROOT = "C:\\sf-factory-projects";
const BLOCKED_ROOTS = [
  "C:\\crocoblock-site-factory-system",
  "C:\\sf-playable-beta",
  "C:\\sf-slate-visual-smoke",
  "C:\\sf-controlled-generate-smoke"
];
const PROJECT_SUBDIRECTORIES = ["runs", "proofs", "snapshots", "logs", "exports"];

function resolveProjectsRoot(projectsRoot) {
  const target = projectsRoot || DEFAULT_PROJECTS_ROOT;
  return path.resolve(target);
}

function slugifyProjectName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function ensureSafeProjectsRoot(projectsRoot) {
  const resolved = resolveProjectsRoot(projectsRoot);

  for (const blockedRoot of BLOCKED_ROOTS) {
    const normalizedBlocked = path.resolve(blockedRoot);
    if (resolved === normalizedBlocked || resolved.startsWith(normalizedBlocked + path.sep)) {
      throw new Error("Refusing to create project scaffolds inside blocked path: " + normalizedBlocked);
    }
  }

  return resolved;
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

function createProjectRecord(siteName, slug, runtimePath, wpPort) {
  const now = timestampIso();
  const dbName = "factory_" + slug.replace(/-/g, "_");

  return {
    project_id: crypto.randomUUID(),
    site_name: siteName,
    slug,
    runtime_path: runtimePath,
    wp_url: "http://127.0.0.1:" + String(wpPort),
    wp_port: wpPort,
    db_name: dbName,
    db_user: "factory_" + randomSuffix(8),
    db_password: randomPassword("db_"),
    db_root_password: randomPassword("root_"),
    admin_user: "factory_admin",
    admin_password: randomPassword("wp_"),
    agent: {
      status: "not_installed",
      health: null,
      capabilities: null
    },
    current_run_id: null,
    dependency_state: null,
    ai: {
      provider: null,
      model_profile: "balanced"
    },
    usage: {
      total_tokens: 0,
      total_cost_estimate: null
    },
    created_at: now,
    updated_at: now
  };
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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

  const slug = slugifyProjectName(siteName);
  if (!slug) {
    throw new Error("Project name did not produce a valid slug.");
  }

  ensureDirectory(projectsRoot);

  const runtimePath = path.join(projectsRoot, slug);
  if (fs.existsSync(runtimePath)) {
    throw new Error("Project already exists: " + runtimePath);
  }

  const project = createProjectRecord(siteName, slug, runtimePath, requestedPort);

  ensureDirectory(runtimePath);
  for (const subdirectory of PROJECT_SUBDIRECTORIES) {
    ensureDirectory(path.join(runtimePath, subdirectory));
  }

  const filesWritten = [
    path.join(runtimePath, "factory-project.json"),
    path.join(runtimePath, ".env"),
    path.join(runtimePath, "docker-compose.yml")
  ];

  writeJsonFile(filesWritten[0], {
    project_id: project.project_id,
    site_name: project.site_name,
    slug: project.slug,
    runtime_path: project.runtime_path,
    wp_url: project.wp_url,
    wp_port: project.wp_port,
    db_name: project.db_name,
    admin_user: project.admin_user,
    agent: project.agent,
    current_run_id: project.current_run_id,
    dependency_state: project.dependency_state,
    ai: project.ai,
    usage: project.usage,
    created_at: project.created_at,
    updated_at: project.updated_at
  });
  fs.writeFileSync(filesWritten[1], createEnvFile(project), "utf8");
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

function listProjects(projectsRoot) {
  const resolvedRoot = resolveProjectsRoot(projectsRoot);
  if (!fs.existsSync(resolvedRoot)) {
    return [];
  }

  const entries = fs.readdirSync(resolvedRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => readProjectRecord(path.join(resolvedRoot, entry.name)))
    .filter(Boolean)
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
}

function sanitizeProject(project) {
  return {
    project_id: project.project_id,
    site_name: project.site_name,
    slug: project.slug,
    runtime_path: project.runtime_path,
    wp_url: project.wp_url,
    wp_port: project.wp_port,
    db_name: project.db_name,
    admin_user: project.admin_user,
    agent: project.agent,
    current_run_id: project.current_run_id,
    dependency_state: project.dependency_state,
    ai: project.ai,
    usage: project.usage,
    created_at: project.created_at,
    updated_at: project.updated_at
  };
}

module.exports = {
  DEFAULT_PROJECTS_ROOT,
  createProjectScaffold,
  ensureSafeProjectsRoot,
  listProjects,
  resolveProjectsRoot,
  slugifyProjectName
};
