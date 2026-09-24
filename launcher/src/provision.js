"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const {
  assertSafeRuntimePath,
  ensureDirectory,
  readProjectBySlug,
  readStrictProjectInventory,
  resolveProjectsRoot,
  saveProjectRecord,
  normalizeProjectNetworkAllocation,
  writeJsonFile
} = require("./project-store");
const { sameProjectNetworkAllocation } = require("./templates");
const { assertReadyRuntimeBinding, isRuntimeBindingDeclared } = require("./runtime-binding");
const { runCommand, tailText } = require("./runtime-tools");

const DOCKER_TIMEOUT_MS = 120000;
const HTTP_WAIT_TIMEOUT_MS = 120000;
const HTTP_WAIT_INTERVAL_MS = 3000;

function projectNetworkPreflightError(code) {
  const error = new Error("Project network allocation could not be verified safely.");
  error.code = code;
  error.statusCode = 409;
  return error;
}

function parseIpv4Cidr(value) {
  if (typeof value !== "string" || !/^\d{1,3}(?:\.\d{1,3}){3}\/(?:[0-9]|[12]\d|3[0-2])$/.test(value)) {
    throw projectNetworkPreflightError("project_network_allocation_invalid");
  }
  const [address, prefixText] = value.split("/");
  const octets = address.split(".").map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw projectNetworkPreflightError("project_network_allocation_invalid");
  }
  const prefix = Number(prefixText);
  const numeric = octets.reduce((total, part) => total * 256 + part, 0);
  const blockSize = 2 ** (32 - prefix);
  const start = Math.floor(numeric / blockSize) * blockSize;
  if (numeric !== start) {
    throw projectNetworkPreflightError("project_network_allocation_invalid");
  }
  return { value, start, end: start + blockSize - 1 };
}

function cidrsOverlap(left, right) {
  const leftRange = parseIpv4Cidr(left);
  const rightRange = parseIpv4Cidr(right);
  return leftRange.start <= rightRange.end && rightRange.start <= leftRange.end;
}

function parseDockerNetworkSubnets(text) {
  let value;
  try {
    value = JSON.parse(String(text || ""));
  } catch (_) {
    throw projectNetworkPreflightError("project_network_observation_invalid");
  }
  if (!Array.isArray(value)) {
    throw projectNetworkPreflightError("project_network_observation_invalid");
  }
  const subnets = [];
  for (const network of value) {
    if (!network || typeof network !== "object" || Array.isArray(network)
      || !network.IPAM || typeof network.IPAM !== "object" || Array.isArray(network.IPAM)
      || !Array.isArray(network.IPAM.Config)) {
      throw projectNetworkPreflightError("project_network_observation_invalid");
    }
    for (const config of network.IPAM.Config) {
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw projectNetworkPreflightError("project_network_observation_invalid");
      }
      if (config.Subnet === undefined || config.Subnet === null || config.Subnet === "") continue;
      subnets.push(parseIpv4Cidr(config.Subnet).value);
    }
  }
  return subnets;
}

function parseActiveRouteCidrs(text) {
  let value;
  try {
    value = JSON.parse(String(text || ""));
  } catch (_) {
    throw projectNetworkPreflightError("project_network_observation_invalid");
  }
  const routes = value === null ? [] : Array.isArray(value) ? value : [value];
  if (routes.some((route) => typeof route !== "string")) {
    throw projectNetworkPreflightError("project_network_observation_invalid");
  }
  return routes.map((route) => parseIpv4Cidr(route).value);
}

async function readProvisionNetworkObservation(options) {
  const runner = options.commandRunner || runCommand;
  const commandOptions = {
    cwd: options.runtimePath,
    logPath: path.join(options.runtimePath, "logs", options.proofStem + "-network-observation.log"),
    timeoutMs: 30000,
    env: dockerComposeEnvironment()
  };
  let listed;
  try {
    listed = await runner("docker", ["network", "ls", "-q"], commandOptions);
  } catch (_) {
    throw projectNetworkPreflightError("project_network_observation_unavailable");
  }
  const ids = String(listed && listed.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (ids.length === 0 || ids.some((id) => !/^[a-f0-9]{12,64}$/i.test(id))) {
    throw projectNetworkPreflightError("project_network_observation_invalid");
  }
  let inspected;
  try {
    inspected = await runner("docker", ["network", "inspect"].concat(ids), commandOptions);
  } catch (_) {
    throw projectNetworkPreflightError("project_network_observation_unavailable");
  }
  let routes;
  try {
    routes = await runner("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "Get-NetRoute -AddressFamily IPv4 | Where-Object { $_.DestinationPrefix -ne '0.0.0.0/0' } | Select-Object -ExpandProperty DestinationPrefix | ConvertTo-Json -Compress"
    ], Object.assign({}, commandOptions, {
      env: process.env,
      logPath: path.join(options.runtimePath, "logs", options.proofStem + "-network-routes.log")
    }));
  } catch (_) {
    throw projectNetworkPreflightError("project_network_observation_unavailable");
  }
  return {
    dockerSubnets: parseDockerNetworkSubnets(inspected.stdout),
    activeRouteCidrs: parseActiveRouteCidrs(routes.stdout)
  };
}

async function assertProvisionNetworkPreflight(options) {
  const projectState = options && options.projectState;
  const project = projectState && projectState.project;
  let allocation;
  try {
    allocation = normalizeProjectNetworkAllocation(project && project.network_allocation);
  } catch (_) {
    throw projectNetworkPreflightError("project_network_allocation_missing");
  }
  const inventory = typeof options.readStrictProjectInventory === "function"
    ? options.readStrictProjectInventory(options.projectsRoot)
    : options.inventory;
  const authoritative = Array.isArray(inventory) && inventory.find((record) => record
    && record.projectId === project.project_id && record.slug === project.slug
    && path.resolve(record.runtimePath) === path.resolve(projectState.runtimePath));
  if (!authoritative || !sameProjectNetworkAllocation(authoritative.project.network_allocation, allocation)) {
    throw projectNetworkPreflightError("project_network_allocation_authority_mismatch");
  }
  const observation = options.networkObservation || await readProvisionNetworkObservation({
    runtimePath: projectState.runtimePath,
    proofStem: options.proofStem,
    commandRunner: options.commandRunner
  });
  if (!observation || !Array.isArray(observation.dockerSubnets) || !Array.isArray(observation.activeRouteCidrs)) {
    throw projectNetworkPreflightError("project_network_observation_invalid");
  }
  const collisions = observation.dockerSubnets.concat(observation.activeRouteCidrs)
    .some((candidate) => cidrsOverlap(allocation.subnet, candidate));
  if (collisions) {
    throw projectNetworkPreflightError("project_network_allocation_collision");
  }
  return allocation;
}

function timestampCompact() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    const request = http.get(targetUrl, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode || 0,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
    });

    request.setTimeout(10000, () => {
      request.destroy(new Error("HTTP request timed out: " + targetUrl));
    });

    request.on("error", reject);
  });
}

function isWpAlreadyInstalledError(text) {
  return /already installed/i.test(text || "");
}

function createWordPressHtaccess() {
  return [
    "# BEGIN WordPress",
    "<IfModule mod_rewrite.c>",
    "RewriteEngine On",
    "RewriteBase /",
    "RewriteRule ^index\\.php$ - [L]",
    "RewriteCond %{REQUEST_FILENAME} !-f",
    "RewriteCond %{REQUEST_FILENAME} !-d",
    "RewriteRule . /index.php [L]",
    "</IfModule>",
    "# END WordPress",
    ""
  ].join("\n");
}

async function waitForHttpOk(targetUrl) {
  const deadline = Date.now() + HTTP_WAIT_TIMEOUT_MS;
  let lastError = "WordPress HTTP readiness check did not start.";

  while (Date.now() < deadline) {
    try {
      const response = await requestUrl(targetUrl);
      if (response.statusCode >= 200 && response.statusCode < 500) {
        return response;
      }
      lastError = "HTTP " + String(response.statusCode) + " from " + targetUrl;
    } catch (error) {
      lastError = error.message;
    }

    await delay(HTTP_WAIT_INTERVAL_MS);
  }

  throw new Error("Timed out waiting for WordPress HTTP readiness at " + targetUrl + ". Last error: " + lastError);
}

async function waitForWpJsonOk(targetUrl) {
  const deadline = Date.now() + HTTP_WAIT_TIMEOUT_MS;
  let lastError = "wp-json readiness check did not start.";

  while (Date.now() < deadline) {
    try {
      const response = await requestUrl(targetUrl);
      if (response.statusCode === 200) {
        return response;
      }
      lastError = "HTTP " + String(response.statusCode) + " from " + targetUrl;
    } catch (error) {
      lastError = error.message;
    }

    await delay(HTTP_WAIT_INTERVAL_MS);
  }

  throw new Error("Timed out waiting for wp-json at " + targetUrl + ". Last error: " + lastError);
}

async function ensureDockerAvailable(runtimePath, proofStem) {
  return runCommand("docker", ["compose", "version"], {
    cwd: runtimePath,
    logPath: path.join(runtimePath, "logs", proofStem + "-docker-version.log"),
    timeoutMs: 30000,
    env: dockerComposeEnvironment()
  });
}

function dockerComposeEnvironment() {
  const env = Object.assign({}, process.env);
  delete env.COMPOSE_FILE;
  return env;
}

function buildDockerComposeInvocation(runtimePath, args) {
  return {
    args: ["compose", "-f", path.join(runtimePath, "docker-compose.yml")].concat(args),
    env: dockerComposeEnvironment()
  };
}

async function runDockerCompose(runtimePath, proofStem, args, options) {
  const invocation = buildDockerComposeInvocation(runtimePath, args);
  return runCommand("docker", invocation.args, {
    cwd: runtimePath,
    logPath: path.join(runtimePath, "logs", proofStem + "-" + options.logSuffix + ".log"),
    timeoutMs: options.timeoutMs || DOCKER_TIMEOUT_MS,
    ignoreExitCode: Boolean(options.ignoreExitCode),
    env: invocation.env
  });
}

async function runDocker(runtimePath, proofStem, args, options) {
  return runCommand("docker", args, {
    cwd: runtimePath,
    logPath: path.join(runtimePath, "logs", proofStem + "-" + options.logSuffix + ".log"),
    timeoutMs: options.timeoutMs || DOCKER_TIMEOUT_MS,
    ignoreExitCode: Boolean(options.ignoreExitCode)
  });
}

function assertRuntimeBindingBeforeProvision(projectState, projectsRoot) {
  if (isRuntimeBindingDeclared(projectState.project)) {
    return assertReadyRuntimeBinding({
      projectState,
      projectsRoot,
      readStrictProjectInventory
    });
  }
  return null;
}

async function runWpCli(runtimePath, proofStem, wpArgs, options) {
  return runDockerCompose(runtimePath, proofStem, [
    "run", "--rm", "-T", "--entrypoint", "php", "wpcli",
    "-d", "memory_limit=512M",
    "/usr/local/bin/wp"
  ].concat(wpArgs), options);
}

function getWpConfigPath(projectState) {
  return path.join(projectState.runtimePath, "wordpress", "wp-config.php");
}

async function ensureWordPressFiles(projectState, proofStem) {
  const wordpressPath = path.join(projectState.runtimePath, "wordpress");
  ensureDirectory(wordpressPath);
  ensureDirectory(path.join(projectState.runtimePath, "mysql"));

  await runDockerCompose(projectState.runtimePath, proofStem, ["up", "-d", "mysql"], {
    logSuffix: "docker-up-mysql"
  });

  if (!fs.existsSync(path.join(wordpressPath, "wp-settings.php"))) {
    const bootstrapContainerName = "factory-wordpress-bootstrap-" + crypto.randomBytes(4).toString("hex");

    try {
      await runDocker(projectState.runtimePath, proofStem, [
        "create", "--name", bootstrapContainerName, "wordpress:php8.2-apache"
      ], {
        logSuffix: "docker-create-wordpress-bootstrap"
      });

      await runDocker(projectState.runtimePath, proofStem, [
        "cp", bootstrapContainerName + ":/usr/src/wordpress/.", wordpressPath
      ], {
        logSuffix: "docker-copy-wordpress-core",
        timeoutMs: 180000
      });
    } finally {
      await runDocker(projectState.runtimePath, proofStem, [
        "rm", "-f", bootstrapContainerName
      ], {
        logSuffix: "docker-remove-wordpress-bootstrap",
        ignoreExitCode: true
      });
    }
  }

  if (fs.existsSync(getWpConfigPath(projectState))) {
    return;
  }

  const configCreate = await runWpCli(projectState.runtimePath, proofStem, [
    "config", "create",
    "--path=/var/www/html",
    "--dbname=" + projectState.env.DB_NAME,
    "--dbuser=" + projectState.env.DB_USER,
    "--dbpass=" + projectState.env.DB_PASSWORD,
    "--dbhost=mysql:3306",
    "--skip-check",
    "--force",
    "--allow-root"
  ], {
    logSuffix: "wp-config-create",
    ignoreExitCode: true
  });

  if (fs.existsSync(getWpConfigPath(projectState))) {
    return;
  }

  throw new Error(
    "wp config create did not produce wp-config.php at " + getWpConfigPath(projectState) +
    ".\n" + tailText(configCreate.stderr || configCreate.stdout, 1200)
  );
}

async function ensureWordPressInstalled(projectState, proofStem, warnings) {
  const isInstalled = await runWpCli(projectState.runtimePath, proofStem, [
    "core", "is-installed",
    "--url=" + projectState.project.wp_url,
    "--path=/var/www/html",
    "--allow-root"
  ], {
    logSuffix: "wp-core-is-installed",
    ignoreExitCode: true
  });

  if (isInstalled.code === 0) {
    warnings.push("WordPress core was already installed. Reused existing install.");
    return {
      wpCoreInstalled: true,
      alreadyInstalled: true
    };
  }

  const install = await runWpCli(projectState.runtimePath, proofStem, [
    "core", "install",
    "--path=/var/www/html",
    "--url=" + projectState.project.wp_url,
    "--title=" + projectState.project.site_name,
    "--admin_user=" + projectState.env.WP_ADMIN_USER,
    "--admin_password=" + projectState.env.WP_ADMIN_PASSWORD,
    "--admin_email=alpha-launcher@" + projectState.project.slug + ".local",
    "--skip-email",
    "--allow-root"
  ], {
    logSuffix: "wp-core-install",
    ignoreExitCode: true
  });

  if (install.code === 0 || isWpAlreadyInstalledError(install.stderr) || isWpAlreadyInstalledError(install.stdout)) {
    if (install.code !== 0) {
      warnings.push("wp core install reported already installed after apply boundary check.");
    }
    return {
      wpCoreInstalled: true,
      alreadyInstalled: false
    };
  }

  throw new Error("wp core install failed.\n" + tailText(install.stderr || install.stdout, 1200));
}

async function enableWordPressRestRouting(projectState, proofStem) {
  fs.writeFileSync(path.join(projectState.runtimePath, "wordpress", ".htaccess"), createWordPressHtaccess(), "utf8");

  await runDockerCompose(projectState.runtimePath, proofStem, [
    "exec", "-T", "wordpress", "sed", "-ri", "-e", "s/AllowOverride None/AllowOverride All/g", "/etc/apache2/apache2.conf"
  ], {
    logSuffix: "apache-allowoverride-all",
    ignoreExitCode: true
  });

  await runDockerCompose(projectState.runtimePath, proofStem, [
    "exec", "-T", "wordpress", "a2enmod", "rewrite"
  ], {
    logSuffix: "apache-enable-rewrite",
    ignoreExitCode: true
  });

  await runDockerCompose(projectState.runtimePath, proofStem, [
    "exec", "-T", "wordpress", "apache2ctl", "-k", "graceful"
  ], {
    logSuffix: "apache-graceful-reload",
    ignoreExitCode: true
  });

  await runWpCli(projectState.runtimePath, proofStem, [
    "rewrite", "structure", "/%postname%/", "--path=/var/www/html", "--hard", "--allow-root"
  ], {
    logSuffix: "wp-rewrite-structure",
    ignoreExitCode: true
  });
}

async function provisionProject(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  const safeRuntimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const proofId = "provision-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
  const proofStem = proofId;
  const warnings = [];

  if (!fs.existsSync(projectState.composePath)) {
    throw new Error("docker-compose.yml is missing: " + projectState.composePath);
  }

  if (!fs.existsSync(projectState.envPath)) {
    throw new Error(".env is missing: " + projectState.envPath);
  }

  if (path.dirname(projectState.composePath) !== safeRuntimePath) {
    throw new Error("docker-compose.yml must live inside the project runtime path.");
  }

  if (path.dirname(projectState.envPath) !== safeRuntimePath) {
    throw new Error(".env must live inside the project runtime path.");
  }

  assertRuntimeBindingBeforeProvision(projectState, projectsRoot);
  if (Object.prototype.hasOwnProperty.call(projectState.project, "network_allocation")) {
    await assertProvisionNetworkPreflight({
      projectState,
      projectsRoot,
      proofStem,
      readStrictProjectInventory
    });
  }

  await ensureDockerAvailable(safeRuntimePath, proofStem);
  await ensureWordPressFiles(projectState, proofStem);
  await runDockerCompose(safeRuntimePath, proofStem, ["up", "-d", "wordpress"], {
    logSuffix: "docker-up-wordpress"
  });

  const rootResponse = await waitForHttpOk(projectState.project.wp_url);
  const installState = await ensureWordPressInstalled(projectState, proofStem, warnings);
  await enableWordPressRestRouting(projectState, proofStem);
  const wpJsonResponse = await waitForWpJsonOk(projectState.project.wp_url + "/wp-json/");
  const runningServicesResult = await runDockerCompose(safeRuntimePath, proofStem, [
    "ps", "--services", "--status", "running"
  ], {
    logSuffix: "docker-ps-running"
  });

  const dockerServicesStarted = runningServicesResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const proof = {
    proof_id: proofId,
    project_id: projectState.project.project_id,
    slug: projectState.project.slug,
    wp_url: projectState.project.wp_url,
    wp_port: projectState.project.wp_port,
    docker_compose_file: projectState.composePath,
    docker_services_started: dockerServicesStarted,
    wp_core_installed: installState.wpCoreInstalled,
    wp_json_ok: wpJsonResponse.statusCode === 200,
    admin_user: projectState.project.admin_user,
    created_at: new Date().toISOString(),
    warnings,
    applies_changes: true,
    mutation_scope: "launcher_project_runtime_only"
  };

  const proofPath = path.join(safeRuntimePath, "proofs", proofId + ".json");
  writeJsonFile(proofPath, proof);

  projectState.project.runtime = {
    status: "provisioned",
    provisioned_at: proof.created_at,
    wp_json_ok: true,
    last_proof_id: proofId
  };
  saveProjectRecord(projectState, projectState.project);

  return {
    project: projectState.project,
    proof,
    proofPath,
    safeRuntimePath,
    rootHttpStatus: rootResponse.statusCode,
    wpJsonStatus: wpJsonResponse.statusCode
  };
}

module.exports = {
  provisionProject,
  assertRuntimeBindingBeforeProvision,
  assertProvisionNetworkPreflight,
  buildDockerComposeInvocation,
  cidrsOverlap,
  parseActiveRouteCidrs,
  parseDockerNetworkSubnets,
  readProvisionNetworkObservation
};
