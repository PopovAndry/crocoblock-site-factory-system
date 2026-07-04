"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  assertSafeRuntimePath,
  ensureDirectory,
  readProjectBySlug,
  resolveProjectsRoot,
  saveProjectRecord,
  writeJsonFile
} = require("./project-store");
const { runCommand } = require("./runtime-tools");
const { waitForUrl } = require("./agent-client");
const { buildDependencyStateRecord, fetchDependencyStatus } = require("./dependencies");

const DOCKER_TIMEOUT_MS = 180000;

const SUPPORTED_DEPENDENCIES = {
  "kava": {
    slug: "kava",
    type: "theme",
    wp_slug: "kava"
  },
  "jet-engine": {
    slug: "jet-engine",
    type: "plugin",
    wp_slug: "jet-engine"
  },
  "jet-smart-filters": {
    slug: "jet-smart-filters",
    type: "plugin",
    wp_slug: "jet-smart-filters"
  }
};

function timestampCompact() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function isAbsoluteZipPath(zipPath) {
  return path.isAbsolute(zipPath) && !/^https?:\/\//i.test(zipPath);
}

function resolveDependencyDefinition(slug) {
  const key = String(slug || "").trim().toLowerCase();
  const dependency = SUPPORTED_DEPENDENCIES[key];

  if (!dependency) {
    throw new Error(
      "Unsupported dependency. Allowed values: " + Object.keys(SUPPORTED_DEPENDENCIES).join(", ")
    );
  }

  return dependency;
}

function validateZipSourcePath(zipPath) {
  const resolvedZipPath = path.resolve(String(zipPath || ""));

  if (!isAbsoluteZipPath(resolvedZipPath)) {
    throw new Error("ZIP path must be an absolute local filesystem path.");
  }

  if (path.extname(resolvedZipPath).toLowerCase() !== ".zip") {
    throw new Error("ZIP path must point to a .zip file.");
  }

  if (!fs.existsSync(resolvedZipPath)) {
    throw new Error("ZIP file not found: " + resolvedZipPath);
  }

  const stat = fs.statSync(resolvedZipPath);
  if (!stat.isFile()) {
    throw new Error("ZIP path is not a file: " + resolvedZipPath);
  }

  return resolvedZipPath;
}

function copyZipIntoRuntime(runtimePath, dependency, sourceZipPath) {
  const zipsRoot = path.join(runtimePath, "dependency-zips");
  const destinationName = dependency.slug + "-" + path.basename(sourceZipPath);
  const destinationPath = path.join(zipsRoot, destinationName);

  ensureDirectory(zipsRoot);

  if (!destinationPath.startsWith(zipsRoot + path.sep)) {
    throw new Error("Dependency ZIP destination escaped the runtime dependency-zips directory.");
  }

  fs.copyFileSync(sourceZipPath, destinationPath);

  return {
    zipsRoot,
    destinationPath,
    containerPath: "/dependency-zips/" + destinationName
  };
}

async function runDockerCompose(runtimePath, proofStem, args, options) {
  return runCommand("docker", ["compose"].concat(args), {
    cwd: runtimePath,
    logPath: path.join(runtimePath, "logs", proofStem + "-" + options.logSuffix + ".log"),
    timeoutMs: options.timeoutMs || DOCKER_TIMEOUT_MS,
    ignoreExitCode: Boolean(options.ignoreExitCode)
  });
}

async function runWpCli(runtimePath, proofStem, dependencyZipsPath, wpArgs, options) {
  const composeArgs = [
    "run", "--rm", "-T"
  ];

  if (dependencyZipsPath) {
    composeArgs.push("-v", dependencyZipsPath + ":/dependency-zips");
  }

  composeArgs.push(
    "--entrypoint", "php",
    "wpcli",
    "-d", "memory_limit=512M",
    "/usr/local/bin/wp"
  );

  return runDockerCompose(runtimePath, proofStem, composeArgs.concat(wpArgs), options);
}

async function checkDependencyInstalled(runtimePath, proofStem, dependency, dependencyZipsPath) {
  const args = dependency.type === "theme"
    ? ["theme", "is-installed", dependency.wp_slug, "--path=/var/www/html", "--allow-root"]
    : ["plugin", "is-installed", dependency.wp_slug, "--path=/var/www/html", "--allow-root"];
  const result = await runWpCli(runtimePath, proofStem, dependencyZipsPath, args, {
    logSuffix: dependency.slug + "-is-installed",
    ignoreExitCode: true
  });

  return result.code === 0;
}

async function checkDependencyActive(runtimePath, proofStem, dependency, dependencyZipsPath) {
  const args = dependency.type === "theme"
    ? ["theme", "is-active", dependency.wp_slug, "--path=/var/www/html", "--allow-root"]
    : ["plugin", "is-active", dependency.wp_slug, "--path=/var/www/html", "--allow-root"];
  const result = await runWpCli(runtimePath, proofStem, dependencyZipsPath, args, {
    logSuffix: dependency.slug + "-is-active",
    ignoreExitCode: true
  });

  return result.code === 0;
}

async function installOrActivateDependency(runtimePath, proofStem, dependency, containerZipPath, dependencyZipsPath, warnings) {
  const alreadyInstalled = await checkDependencyInstalled(runtimePath, proofStem, dependency, dependencyZipsPath);
  const alreadyActive = await checkDependencyActive(runtimePath, proofStem, dependency, dependencyZipsPath);

  if (alreadyActive) {
    warnings.push("dependency_already_active");
    return {
      installed: true,
      active: true
    };
  }

  if (alreadyInstalled) {
    warnings.push("dependency_already_installed");
    const activateArgs = dependency.type === "theme"
      ? ["theme", "activate", dependency.wp_slug, "--path=/var/www/html", "--allow-root"]
      : ["plugin", "activate", dependency.wp_slug, "--path=/var/www/html", "--allow-root"];
    const activateResult = await runWpCli(runtimePath, proofStem, dependencyZipsPath, activateArgs, {
      logSuffix: dependency.slug + "-activate",
      ignoreExitCode: true
    });

    if (activateResult.code !== 0) {
      throw new Error(
        "Existing dependency activation failed for " + dependency.slug + ".\n" +
        (activateResult.stderr || activateResult.stdout)
      );
    }
  } else {
    const installArgs = dependency.type === "theme"
      ? ["theme", "install", containerZipPath, "--activate", "--path=/var/www/html", "--allow-root"]
      : ["plugin", "install", containerZipPath, "--activate", "--path=/var/www/html", "--allow-root"];
    const installResult = await runWpCli(runtimePath, proofStem, dependencyZipsPath, installArgs, {
      logSuffix: dependency.slug + "-install",
      ignoreExitCode: true
    });

    if (installResult.code !== 0) {
      throw new Error(
        "Dependency install failed for " + dependency.slug + ".\n" +
        (installResult.stderr || installResult.stdout)
      );
    }
  }

  const installed = await checkDependencyInstalled(runtimePath, proofStem, dependency, dependencyZipsPath);
  const active = await checkDependencyActive(runtimePath, proofStem, dependency, dependencyZipsPath);

  if (!installed || !active) {
    throw new Error("Dependency verification failed after install for " + dependency.slug + ".");
  }

  return {
    installed,
    active
  };
}

async function installDependency(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  projectState.projectsRoot = projectsRoot;
  const safeRuntimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const dependency = resolveDependencyDefinition(options.dependency);
  const zipSourcePath = validateZipSourcePath(options.zip);
  const proofId = "dependency-install-" + dependency.slug + "-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
  const createdAt = new Date().toISOString();
  const warnings = [];

  if ((projectState.project.runtime && projectState.project.runtime.status) !== "provisioned") {
    throw new Error("Launcher project must be provisioned before dependency install.");
  }

  if ((projectState.project.agent && projectState.project.agent.status) !== "installed") {
    throw new Error("Site Factory Agent must be installed before dependency install.");
  }

  await waitForUrl(projectState.project.wp_url);

  const copiedZip = copyZipIntoRuntime(safeRuntimePath, dependency, zipSourcePath);
  const installStatus = await installOrActivateDependency(
    safeRuntimePath,
    proofId,
    dependency,
    copiedZip.containerPath,
    copiedZip.zipsRoot,
    warnings
  );

  const dependencyStatus = await fetchDependencyStatus(projectState, warnings);
  const summary = dependencyStatus.summary;
  const payload = dependencyStatus.payload;

  const proof = {
    proof_id: proofId,
    project_id: projectState.project.project_id,
    slug: projectState.project.slug,
    dependency_slug: dependency.slug,
    dependency_type: dependency.type,
    wp_slug: dependency.wp_slug,
    zip_source_path: zipSourcePath,
    zip_copied_path: copiedZip.destinationPath,
    installed: installStatus.installed,
    active: installStatus.active,
    dependency_state_after: buildDependencyStateRecord(payload, summary, proofId, createdAt),
    blockers_after: summary.blockers,
    can_generate_after: summary.can_generate,
    legal_source: "user_provided_zip",
    applies_changes: true,
    mutation_scope: "launcher_project_runtime_only",
    warnings,
    created_at: createdAt
  };

  const proofPath = path.join(safeRuntimePath, "proofs", proofId + ".json");
  writeJsonFile(proofPath, proof);

  projectState.project.dependency_state = proof.dependency_state_after;
  saveProjectRecord(projectState, projectState.project);

  return {
    project: projectState.project,
    proof,
    proofPath,
    dependency
  };
}

module.exports = {
  installDependency
};
