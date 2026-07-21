"use strict";

const crypto = require("crypto");
const fs = require("fs");
const { createLauncherServer } = require("./server");
const {
  appendSafeLog,
  collectRuntimeDiagnostics,
  listenControlServer,
  loadPackageConfig,
  openBrowser,
  readJsonFile,
  requestRuntimeShutdown,
  resolveRuntimePaths,
  savePackageConfig,
  writeAtomicJson
} = require("./windows-package-runtime");

function parsePackageArguments(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function startPackagedLauncher(options) {
  const runtimePaths = resolveRuntimePaths(options);
  const config = loadPackageConfig(runtimePaths, options);
  const runtimeDiagnostics = await collectRuntimeDiagnostics(config, runtimePaths, options);
  const runtimeToken = crypto.randomBytes(32).toString("hex");
  let launcher = null;
  let controlServer = null;
  let closePromise = null;

  function close() {
    if (closePromise) {
      return closePromise;
    }
    closePromise = (async () => {
      try {
        if (launcher) {
          await launcher.close({ closeConnections: true });
        }
        if (controlServer) {
          await closeServer(controlServer);
        }
      } finally {
        try {
          fs.unlinkSync(runtimePaths.runtimeStatePath);
        } catch (error) {
          if (error.code !== "ENOENT") {
            appendSafeLog(runtimePaths, "shutdown_cleanup_failed", { message: error.message });
          }
        }
        appendSafeLog(runtimePaths, "launcher_stopped", { result: "closed" });
      }
    })();
    return closePromise;
  }

  launcher = createLauncherServer({
    host: "127.0.0.1",
    port: runtimeDiagnostics.listeningPort,
    projectsRoot: config.projects_root,
    packagedRuntime: {
      summary: runtimeDiagnostics.summary,
      diagnostics: runtimeDiagnostics.diagnostics,
      systemCheck: runtimeDiagnostics.systemCheck
    },
    dependencySourceOptions: {
      environment: options && options.environment,
      packagedResourceDirectory: runtimePaths.packagedResourceDirectory,
      applicationDataDirectory: runtimePaths.dataRoot,
      developmentResourceDirectory: runtimePaths.developmentResourceDirectory
    },
    skipRestoreReconciliation: true
  });

  const details = await launcher.listen();
  controlServer = await listenControlServer(runtimeToken, close);
  const controlAddress = controlServer.address();
  writeAtomicJson(runtimePaths.runtimeStatePath, {
    schema_version: 1,
    launcher_port: details.port,
    control_port: controlAddress.port,
    control_token: runtimeToken
  });
  appendSafeLog(runtimePaths, "launcher_started", { result: "ready" });

  const url = "http://" + details.host + ":" + String(details.port);
  if (!options || options.openBrowser !== false) {
    openBrowser(url, options && options.spawn, options);
  }

  return {
    close,
    details,
    runtimeDiagnostics,
    runtimePaths,
    url
  };
}

async function configurePackagedLauncher(options) {
  const runtimePaths = resolveRuntimePaths(options);
  const config = loadPackageConfig(runtimePaths, options);
  savePackageConfig(runtimePaths, config);
  appendSafeLog(runtimePaths, "launcher_configured", { result: "saved" });
  return config;
}

async function shutdownPackagedLauncher(options) {
  const runtimePaths = resolveRuntimePaths(options);
  const state = readJsonFile(runtimePaths.runtimeStatePath);
  if (!state || !Number.isInteger(Number(state.control_port)) || !/^[a-f0-9]{64}$/i.test(String(state.control_token || ""))) {
    throw new Error("Packaged Launcher is not running.");
  }
  await requestRuntimeShutdown(state, options && options.requestImplementation);
}

async function runPackageCli(argv, options) {
  const flags = parsePackageArguments(argv || process.argv.slice(2));
  const runtimeOptions = Object.assign({}, options || {}, {
    dataRoot: flags["data-root"] || options && options.dataRoot,
    projectsRoot: flags["projects-root"] || options && options.projectsRoot,
    port: flags.port || options && options.port
  });
  if (flags.configure) {
    await configurePackagedLauncher(runtimeOptions);
    return { action: "configured" };
  }
  if (flags.shutdown) {
    await shutdownPackagedLauncher(runtimeOptions);
    return { action: "stopped" };
  }
  return startPackagedLauncher(runtimeOptions);
}

if (require.main === module) {
  runPackageCli().catch((error) => {
    process.stderr.write("Factory Launcher could not start. Check Factory Launcher diagnostics.\n");
    process.exitCode = 1;
  });
}

module.exports = {
  configurePackagedLauncher,
  parsePackageArguments,
  runPackageCli,
  shutdownPackagedLauncher,
  startPackagedLauncher
};
