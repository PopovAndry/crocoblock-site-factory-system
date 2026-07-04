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
  writeEnvFile,
  writeJsonFile
} = require("./project-store");
const { runCommand } = require("./runtime-tools");
const {
  fetchJsonWithBasicAuth,
  fetchJsonWithCookie,
  requestJson,
  waitForUrl
} = require("./agent-client");

const PLUGIN_SLUG = "crocoblock-site-factory";
const APP_PASSWORD_NAME = "Factory Launcher";
const DOCKER_TIMEOUT_MS = 120000;
function timestampCompact() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function getPluginSourcePath() {
  return path.resolve(__dirname, "..", "..", "wordpress-plugin");
}


function getPluginDestinationPath(projectState) {
  return path.join(projectState.runtimePath, "wordpress", "wp-content", "plugins", PLUGIN_SLUG);
}

function assertSafePluginPaths(projectState) {
  const sourcePath = getPluginSourcePath();
  const destinationPath = getPluginDestinationPath(projectState);
  const runtimePath = assertSafeRuntimePath(projectState.runtimePath, resolveProjectsRoot(projectState.projectsRoot));
  const pluginsRoot = path.join(runtimePath, "wordpress", "wp-content", "plugins");

  if (!sourcePath.startsWith(path.resolve(__dirname, "..", "..") + path.sep) || !fs.existsSync(path.join(sourcePath, "crocoblock-site-factory.php"))) {
    throw new Error("Local Site Factory plugin source is unavailable: " + sourcePath);
  }

  if (!destinationPath.startsWith(pluginsRoot + path.sep)) {
    throw new Error("Plugin destination path is outside the launcher runtime plugin directory.");
  }

  return {
    sourcePath,
    destinationPath
  };
}

function copyPluginIntoRuntime(projectState) {
  const pluginPaths = assertSafePluginPaths(projectState);

  ensureDirectory(path.dirname(pluginPaths.destinationPath));

  if (fs.existsSync(pluginPaths.destinationPath)) {
    fs.rmSync(pluginPaths.destinationPath, { recursive: true, force: true });
  }

  fs.cpSync(pluginPaths.sourcePath, pluginPaths.destinationPath, { recursive: true });

  return pluginPaths;
}

async function runDockerCompose(runtimePath, proofStem, args, options) {
  return runCommand("docker", ["compose"].concat(args), {
    cwd: runtimePath,
    logPath: path.join(runtimePath, "logs", proofStem + "-" + options.logSuffix + ".log"),
    timeoutMs: options.timeoutMs || DOCKER_TIMEOUT_MS,
    ignoreExitCode: Boolean(options.ignoreExitCode)
  });
}

async function runWpCli(runtimePath, proofStem, wpArgs, options) {
  return runDockerCompose(runtimePath, proofStem, [
    "run", "--rm", "-T", "--entrypoint", "php", "wpcli",
    "-d", "memory_limit=512M",
    "/usr/local/bin/wp"
  ].concat(wpArgs), options);
}

async function ensureAgentApplicationPassword(projectState, proofStem, warnings) {
  if (projectState.env.WP_APP_PASSWORD) {
    return {
      username: projectState.env.WP_ADMIN_USER,
      password: projectState.env.WP_APP_PASSWORD
    };
  }

  const result = await runWpCli(projectState.runtimePath, proofStem, [
    "user", "application-password", "create",
    projectState.env.WP_ADMIN_USER,
    APP_PASSWORD_NAME,
    "--porcelain",
    "--path=/var/www/html",
    "--allow-root"
  ], {
    logSuffix: "wp-app-password-create"
  });

  const password = String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .pop() || "";

  if (!password) {
    throw new Error("Application password creation did not return a password.");
  }

  projectState.env.WP_APP_PASSWORD_NAME = APP_PASSWORD_NAME;
  projectState.env.WP_APP_PASSWORD = password;
  writeEnvFile(projectState.envPath, projectState.env);
  warnings.push("Created a new local application password for Launcher to call the Agent.");

  return {
    username: projectState.env.WP_ADMIN_USER,
    password
  };
}

async function loginWithAdminCookie(projectState) {
  const body = [
    "log=" + encodeURIComponent(projectState.env.WP_ADMIN_USER),
    "pwd=" + encodeURIComponent(projectState.env.WP_ADMIN_PASSWORD),
    "wp-submit=" + encodeURIComponent("Log In"),
    "redirect_to=" + encodeURIComponent(projectState.project.wp_url + "/wp-admin/"),
    "testcookie=1"
  ].join("&");
  const response = await requestJson(projectState.project.wp_url + "/wp-login.php", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
      "Cookie": "wordpress_test_cookie=WP%20Cookie%20check"
    },
    body
  });
  const setCookie = Array.isArray(response.headers["set-cookie"]) ? response.headers["set-cookie"] : [];
  const cookieHeader = setCookie.map((cookie) => String(cookie).split(";")[0]).join("; ");

  if (!cookieHeader) {
    throw new Error("Admin cookie login did not return authentication cookies.");
  }

  return cookieHeader;
}

async function createRestNonce(projectState, proofStem) {
  const username = String(projectState.env.WP_ADMIN_USER || "");
  const phpCode = [
    "$user = get_user_by(\"login\", " + JSON.stringify(username) + ");",
    "if ( ! $user ) { fwrite(STDERR, \"missing-user\\n\"); exit(1); }",
    "wp_set_current_user( $user->ID );",
    "echo wp_create_nonce( \"wp_rest\" );"
  ].join(" ");
  const result = await runWpCli(projectState.runtimePath, proofStem, [
    "eval",
    phpCode,
    "--path=/var/www/html",
    "--allow-root"
  ], {
    logSuffix: "wp-rest-nonce"
  });

  const nonce = String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() || "";
  if (!nonce) {
    throw new Error("Failed to create wp_rest nonce for admin cookie auth.");
  }

  return nonce;
}

async function installAgent(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  projectState.projectsRoot = projectsRoot;
  const safeRuntimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const proofId = "agent-install-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
  const warnings = [];

  if ((projectState.project.runtime && projectState.project.runtime.status) !== "provisioned") {
    throw new Error("Launcher project must be provisioned before Agent install.");
  }

  if (!fs.existsSync(projectState.composePath) || !fs.existsSync(projectState.envPath)) {
    throw new Error("Provisioned launcher runtime is missing docker-compose.yml or .env.");
  }

  await waitForUrl(projectState.project.wp_url);

  const pluginPaths = copyPluginIntoRuntime(projectState);
  const activation = await runWpCli(safeRuntimePath, proofId, [
    "plugin", "activate", PLUGIN_SLUG, "--path=/var/www/html", "--allow-root"
  ], {
    logSuffix: "wp-plugin-activate",
    ignoreExitCode: true
  });

  if (activation.code !== 0 && !/already active/i.test(activation.stdout + "\n" + activation.stderr)) {
    throw new Error("Site Factory Agent activation failed.\n" + (activation.stderr || activation.stdout));
  }

  if (/already active/i.test(activation.stdout + "\n" + activation.stderr)) {
    warnings.push("agent_already_installed");
  }

  const activeCheck = await runWpCli(safeRuntimePath, proofId, [
    "plugin", "is-active", PLUGIN_SLUG, "--path=/var/www/html", "--allow-root"
  ], {
    logSuffix: "wp-plugin-is-active",
    ignoreExitCode: true
  });

  if (activeCheck.code !== 0) {
    throw new Error("Site Factory Agent is not active after installation.");
  }

  const restBase = projectState.project.wp_url + "/wp-json/factory/v1";
  let health;
  let capabilities;

  try {
    const auth = await ensureAgentApplicationPassword(projectState, proofId, warnings);
    health = (await fetchJsonWithBasicAuth(restBase + "/agent/health", auth.username, auth.password)).json;
    capabilities = (await fetchJsonWithBasicAuth(restBase + "/agent/capabilities", auth.username, auth.password)).json;
  } catch (error) {
    const cookieHeader = await loginWithAdminCookie(projectState);
    const restNonce = await createRestNonce(projectState, proofId);
    warnings.push("Agent endpoint auth fell back to admin cookie context.");
    health = (await fetchJsonWithCookie(restBase + "/agent/health", cookieHeader, restNonce)).json;
    capabilities = (await fetchJsonWithCookie(restBase + "/agent/capabilities", cookieHeader, restNonce)).json;
  }

  const proof = {
    proof_id: proofId,
    project_id: projectState.project.project_id,
    slug: projectState.project.slug,
    wp_url: projectState.project.wp_url,
    plugin_slug: PLUGIN_SLUG,
    plugin_active: true,
    health_ok: "ok" === String(health.status || ""),
    capabilities_ok: "ok" === String(capabilities.status || ""),
    rest_base: restBase,
    frontend_safe_edit_fields: Array.isArray(capabilities.frontend_safe_edit_fields) ? capabilities.frontend_safe_edit_fields : [],
    supported_verticals: Array.isArray(capabilities.supported_verticals) ? capabilities.supported_verticals : [],
    created_at: new Date().toISOString(),
    warnings,
    applies_changes: true,
    mutation_scope: "launcher_project_runtime_only"
  };

  const proofPath = path.join(safeRuntimePath, "proofs", proofId + ".json");
  writeJsonFile(proofPath, proof);

  projectState.project.agent = {
    status: "installed",
    version: health.plugin_version || null,
    rest_base: restBase,
    health: {
      status: health.status || null,
      code: health.code || null,
      plugin_version: health.plugin_version || null,
      wp_version: health.wp_version || null,
      php_version: health.php_version || null,
      site_url: health.site_url || null,
      home_url: health.home_url || null,
      active_theme: health.active_theme || null,
      generated_site_present: health.generated_site_present,
      last_run_id: health.last_run_id || null,
      auth_mode: health.auth_mode || null
    },
    capabilities: {
      status: capabilities.status || null,
      code: capabilities.code || null,
      capabilities: capabilities.capabilities || {},
      frontend_safe_edit_fields: capabilities.frontend_safe_edit_fields || [],
      supported_verticals: capabilities.supported_verticals || []
    },
    installed_at: proof.created_at
  };

  projectState.project.runtime = Object.assign({}, projectState.project.runtime || {}, {
    last_agent_proof_id: proofId
  });

  saveProjectRecord(projectState, projectState.project);

  return {
    project: projectState.project,
    proof,
    proofPath,
    pluginPaths,
    restBase,
    health,
    capabilities
  };
}

module.exports = {
  installAgent,
  createRestNonce,
  ensureAgentApplicationPassword,
  loginWithAdminCookie
};
