"use strict";

const path = require("path");
const crypto = require("crypto");
const {
  assertSafeRuntimePath,
  readProjectBySlug,
  resolveProjectsRoot,
  saveProjectRecord,
  writeJsonFile
} = require("./project-store");
const { runCommand } = require("./runtime-tools");
const { waitForUrl } = require("./agent-client");
const { buildDependencyStateRecord, fetchDependencyStatus } = require("./dependencies");
const { resolveDependencyDefinition } = require("./dependency-catalog");
const {
  createManagedDependencyInstallPlan,
  readManagedDependencyInstallPlan,
  resolveCachePackagePath
} = require("./managed-package-cache");

const DOCKER_TIMEOUT_MS = 180000;

function timestampCompact() {
  return new Date().toISOString().replace(/[:.]/g, "-");
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
  if (options.zip || options.zipPath || options.sourcePath) {
    const error = new Error("Direct dependency ZIP paths are not accepted. Create a managed dependency install plan first.");
    error.code = "direct_dependency_zip_not_allowed";
    throw error;
  }

  if ((projectState.project.runtime && projectState.project.runtime.status) !== "provisioned") {
    throw new Error("Launcher project must be provisioned before dependency install.");
  }

  if ((projectState.project.agent && projectState.project.agent.status) !== "installed") {
    throw new Error("Site Factory Agent must be installed before dependency install.");
  }

  const managedPlanResult = options.planId
    ? readManagedDependencyInstallPlan({
      slug: options.slug,
      planId: options.planId,
      projectsRoot
    })
    : createManagedDependencyInstallPlan({
      slug: options.slug,
      dependency: options.dependency,
      projectsRoot
    });
  const dependency = resolveDependencyDefinition(managedPlanResult.plan.dependency_key);
  const cachePackagePath = resolveCachePackagePath(
    projectsRoot,
    managedPlanResult.plan.cache_ref,
    managedPlanResult.plan.package
  );
  const dependencyZipsPath = path.dirname(cachePackagePath);
  const containerZipPath = "/dependency-zips/" + path.basename(cachePackagePath);
  const proofId = "dependency-install-" + dependency.slug + "-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
  const createdAt = new Date().toISOString();
  const warnings = [];

  await waitForUrl(projectState.project.wp_url);

  const installStatus = await installOrActivateDependency(
    safeRuntimePath,
    proofId,
    dependency,
    containerZipPath,
    dependencyZipsPath,
    warnings
  );

  const dependencyStatus = await fetchDependencyStatus(projectState, warnings);
  const summary = dependencyStatus.summary;
  const payload = dependencyStatus.payload;

  const proof = {
    proof_id: proofId,
    project_id: projectState.project.project_id,
    slug: projectState.project.slug,
    dependency_install_plan_id: managedPlanResult.plan.plan_id,
    dependency_slug: dependency.slug,
    dependency_type: dependency.type,
    wp_slug: dependency.wp_slug,
    provider: managedPlanResult.plan.provider,
    source: managedPlanResult.plan.source,
    package: managedPlanResult.plan.package,
    cache_ref: managedPlanResult.plan.cache_ref,
    installed: installStatus.installed,
    active: installStatus.active,
    dependency_state_after: buildDependencyStateRecord(payload, summary, proofId, createdAt),
    blockers_after: summary.blockers,
    can_generate_after: summary.can_generate,
    legal_source: "managed_trusted_catalog",
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
