"use strict";

const { createLauncherServer } = require("./server");
const {
  DEFAULT_PROJECTS_ROOT,
  createProjectScaffold,
  listProjects,
  readProjectBySlug,
  resolveProjectsRoot
} = require("./project-store");
const { provisionProject } = require("./provision");
const { installAgent } = require("./install-agent");
const { planProject } = require("./plan");
const { readDependencies } = require("./dependencies");
const { installDependency } = require("./install-dependency");
const { configureAi, enableLiveAi, estimateAi, getAiStatus, getModelProfile } = require("./ai");
const { generateProject } = require("./generate");
const { getSiteStatus } = require("./site");
const { refreshState, readStateStatus, planState, applyStatePlan, rollbackStateApply } = require("./state");
const { generateProofPack } = require("./proof-pack");
const { runAlphaSmoke } = require("./alpha-smoke");
const { runProjectOperation } = require("./project-operation-coordinator");

function parseArguments(argv) {
  const [, , command, ...rest] = argv;
  const flags = {};
  const positionals = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(flags, key)) {
      const currentValue = flags[key];
      flags[key] = Array.isArray(currentValue) ? currentValue.concat(next) : [currentValue, next];
    } else {
      flags[key] = next;
    }
    index += 1;
  }

  return { command, flags, positionals };
}

async function runCoordinatedCliOperation(flags, operationType, fingerprintInput, metadata, safety, execute) {
  return runProjectOperation({
    slug: flags.slug,
    projectsRoot: flags["projects-root"],
    operationType,
    idempotencyKey: flags["idempotency-key"],
    fingerprintInput,
    metadata: metadata || {},
    safety: safety || {},
    execute
  });
}

function printOperationSummary(result) {
  if (!result || !result.operation) {
    return;
  }
  console.log("  Operation ID: " + String(result.operation.operation_id || "Unavailable"));
  console.log("  Operation status: " + String(result.operation.status || "unknown"));
  console.log("  Idempotent replay: " + String(result.idempotentReplay === true));
}

function printUsage() {
  console.log([
    "Factory Launcher",
    "",
    "Commands:",
    "  node launcher/src/cli.js start [--port 3847] [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js create --name \"Kyiv Realty\" --port 8120 [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js list [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js provision --slug kyiv-realty [--idempotency-key <key>] [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js install-agent --slug kyiv-realty [--idempotency-key <key>] [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js plan --slug kyiv-realty --prompt \"Create a real estate site for Kyiv apartments\" [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js dependencies --slug kyiv-realty [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js install-dependency --slug kyiv-realty --dependency jet-engine [--idempotency-key <key>] [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js ai --slug kyiv-realty status [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js ai --slug kyiv-realty configure --mode mock --model-profile balanced [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js ai --slug kyiv-realty configure --provider openai --model-profile balanced --key-env FACTORY_OPENAI_API_KEY [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js ai --slug kyiv-realty enable-live [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js ai --slug kyiv-realty estimate --prompt \"Create a real estate site for Kyiv apartments\" [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js generate --slug kyiv-realty [--idempotency-key <key>] [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js site --slug kyiv-realty status [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js site --slug kyiv-realty open --target home [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js state --slug kyiv-realty refresh [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js state --slug kyiv-realty status [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js state --slug kyiv-realty plan --prompt \"Create a premium real estate site for Odesa\" [--overwrite-field hero_title] [--ai live --confirm-live --estimate latest] [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js state --slug kyiv-realty apply --plan latest [--confirm-overwrite hero_title] [--idempotency-key <key>] [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js state --slug kyiv-realty rollback --apply latest [--idempotency-key <key>] [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js site --slug kyiv-realty open --target frontend-edit-login [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js proof-pack --slug kyiv-realty [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js alpha-smoke --slug kyiv-realty [--require generated-site|full-alpha] [--json] [--projects-root \"C:\\sf-factory-projects\"]"
  ].join("\n"));
}

async function runStart(flags) {
  const server = createLauncherServer({
    host: "127.0.0.1",
    port: Number(flags.port || 3847),
    projectsRoot: flags["projects-root"]
  });

  const details = await server.listen();
  console.log("Factory Launcher running at http://" + details.host + ":" + String(details.port));
  console.log("Projects root: " + details.projectsRoot);
}

function runCreate(flags) {
  const result = createProjectScaffold({
    name: flags.name,
    port: Number(flags.port || 8099),
    projectsRoot: flags["projects-root"]
  });

  console.log("Created project scaffold:");
  console.log("  Site name: " + result.project.site_name);
  console.log("  Slug: " + result.project.slug);
  console.log("  Path: " + result.project.runtime_path);
  console.log("  WordPress URL: " + result.project.wp_url);
  console.log("  Next step: Provision WordPress");
  console.log("  Files written:");
  for (const filePath of result.files_written) {
    console.log("    " + filePath);
  }
}

function runList(flags) {
  const projectsRoot = resolveProjectsRoot(flags["projects-root"] || DEFAULT_PROJECTS_ROOT);
  const projects = listProjects(projectsRoot);

  if (projects.length === 0) {
    console.log("No Factory Launcher projects found in " + projectsRoot);
    return;
  }

  console.log("Factory Launcher projects in " + projectsRoot);
  for (const project of projects) {
    console.log([
      "- " + project.site_name,
      "  slug: " + project.slug,
      "  wp_port: " + String(project.wp_port),
      "  runtime.status: " + String(project.runtime && project.runtime.status),
      "  agent.status: " + String(project.agent && project.agent.status),
      "  created_at: " + String(project.created_at)
    ].join("\n"));
  }
}

async function runProvision(flags) {
  if (!flags.slug) {
    throw new Error("Provision requires --slug <slug>.");
  }

  const operationResult = await runCoordinatedCliOperation(
    flags,
    "provision",
    { project_slug: flags.slug, operation_type: "provision" },
    {},
    {},
    async () => {
      const result = await provisionProject({
        slug: flags.slug,
        projectsRoot: flags["projects-root"]
      });
      return {
        result,
        proofRef: result.proofPath,
        resultSummary: {
          status: "ready",
          wp_url: result.project.wp_url,
          root_http_status: result.rootHttpStatus,
          wp_json_status: result.wpJsonStatus
        }
      };
    }
  );
  if (operationResult.idempotentReplay) {
    console.log("Provision request replayed from operation history:");
    printOperationSummary(operationResult);
    return;
  }
  const result = operationResult.result;

  console.log("Provisioned WordPress runtime:");
  console.log("  Site name: " + result.project.site_name);
  console.log("  Slug: " + result.project.slug);
  console.log("  Runtime path: " + result.safeRuntimePath);
  console.log("  WordPress URL: " + result.project.wp_url);
  console.log("  Root HTTP status: " + String(result.rootHttpStatus));
  console.log("  /wp-json/ status: " + String(result.wpJsonStatus));
  console.log("  Docker services started: " + result.proof.docker_services_started.join(", "));
  console.log("  Proof file: " + result.proofPath);
  printOperationSummary(operationResult);
}

async function runInstallAgent(flags) {
  if (!flags.slug) {
    throw new Error("install-agent requires --slug <slug>.");
  }

  const operationResult = await runCoordinatedCliOperation(
    flags,
    "install_agent",
    { project_slug: flags.slug, operation_type: "install_agent" },
    {},
    {},
    async () => {
      const result = await installAgent({
        slug: flags.slug,
        projectsRoot: flags["projects-root"]
      });
      return {
        result,
        proofRef: result.proofPath,
        resultSummary: {
          status: "ready",
          rest_base: result.restBase,
          health_status: result.health && result.health.status || null,
          capabilities_status: result.capabilities && result.capabilities.status || null
        }
      };
    }
  );
  if (operationResult.idempotentReplay) {
    console.log("Install Agent request replayed from operation history:");
    printOperationSummary(operationResult);
    return;
  }
  const result = operationResult.result;

  console.log("Installed Site Factory Agent:");
  console.log("  Site name: " + result.project.site_name);
  console.log("  Slug: " + result.project.slug);
  console.log("  WordPress URL: " + result.project.wp_url);
  console.log("  Plugin active: true");
  console.log("  REST base: " + result.restBase);
  console.log("  Health status: " + String(result.health.status));
  console.log("  Capabilities status: " + String(result.capabilities.status));
  console.log("  Proof file: " + result.proofPath);
  printOperationSummary(operationResult);
}

async function runPlan(flags) {
  if (!flags.slug) {
    throw new Error("plan requires --slug <slug>.");
  }

  if (!flags.prompt) {
    throw new Error("plan requires --prompt \"<prompt>\".");
  }

  const result = await planProject({
    slug: flags.slug,
    prompt: flags.prompt,
    projectsRoot: flags["projects-root"]
  });

  console.log("Completed read-only planning run:");
  console.log("  Site name: " + result.project.site_name);
  console.log("  Slug: " + result.project.slug);
  console.log("  WordPress URL: " + result.project.wp_url);
  console.log("  Run ID: " + result.run.run_id);
  console.log("  Stages completed: " + String(result.stagesCompleted) + "/" + String(result.run.stages.length));
  console.log("  Applies changes: false");
  console.log("  Any provider called: " + String(result.proof.any_provider_called));
  console.log("  Personalization source: " + String(result.proof.prompt_personalization && result.proof.prompt_personalization.source || "local_interpreter"));
  console.log("  Personalization fields: " + Object.keys(result.proof.prompt_personalization && result.proof.prompt_personalization.fields || {}).join(", "));
  console.log("  Run file: " + result.runPath);
  console.log("  Proof file: " + result.proofPath);
}

async function runDependencies(flags) {
  if (!flags.slug) {
    throw new Error("dependencies requires --slug <slug>.");
  }

  const result = await readDependencies({
    slug: flags.slug,
    projectsRoot: flags["projects-root"]
  });

  console.log("Read dependency status:");
  console.log("  Site name: " + result.project.site_name);
  console.log("  Slug: " + result.project.slug);
  console.log("  WordPress URL: " + result.project.wp_url);
  console.log("  Can generate: " + String(result.proof.can_generate));
  console.log("  Legal handoff required: " + String(result.proof.legal_handoff_required));
  console.log("  Blockers: " + (result.blockers.length ? result.blockers.join(" | ") : "None"));
  console.log("  Proof file: " + result.proofPath);
}

async function runInstallDependency(flags) {
  if (!flags.slug) {
    throw new Error("install-dependency requires --slug <slug>.");
  }

  if (!flags.dependency) {
    throw new Error("install-dependency requires --dependency <dependency-slug>.");
  }

  if (flags.zip) {
    throw new Error("install-dependency no longer accepts --zip. Packages are resolved from the managed trusted catalog.");
  }

  const operationResult = await runCoordinatedCliOperation(
    flags,
    "install_dependency",
    {
      project_slug: flags.slug,
      operation_type: "install_dependency",
      dependency_key: flags.dependency
    },
    {
      dependency_key: flags.dependency
    },
    {},
    async () => {
      const result = await installDependency({
        slug: flags.slug,
        dependency: flags.dependency,
        projectsRoot: flags["projects-root"]
      });
      return {
        result,
        proofRef: result.proofPath,
        resultSummary: {
          status: "ok",
          dependency_key: result.dependency && result.dependency.slug || flags.dependency,
          installed: result.proof && result.proof.installed === true,
          active: result.proof && result.proof.active === true,
          can_generate_after: result.proof && result.proof.can_generate_after === true
        }
      };
    }
  );
  if (operationResult.idempotentReplay) {
    console.log("Dependency install request replayed from operation history:");
    printOperationSummary(operationResult);
    return;
  }
  const result = operationResult.result;

  console.log("Installed dependency from local ZIP:");
  console.log("  Site name: " + result.project.site_name);
  console.log("  Slug: " + result.project.slug);
  console.log("  Dependency: " + result.dependency.slug);
  console.log("  ZIP source: " + result.proof.zip_source_path);
  console.log("  ZIP copied: " + result.proof.zip_copied_path);
  console.log("  Installed: " + String(result.proof.installed));
  console.log("  Active: " + String(result.proof.active));
  console.log("  Can generate after: " + String(result.proof.can_generate_after));
  console.log("  Blockers after: " + (result.proof.blockers_after.length ? result.proof.blockers_after.join(" | ") : "None"));
  console.log("  Proof file: " + result.proofPath);
  printOperationSummary(operationResult);
}

function printAiStatus(result) {
  const profile = getModelProfile(result.ai.model_profile);
  console.log("Launcher AI status:");
  console.log("  Site name: " + result.project.site_name);
  console.log("  Slug: " + result.project.slug);
  console.log("  Mode: " + result.ai.mode);
  console.log("  Provider: " + result.ai.provider);
  console.log("  Model profile: " + result.ai.model_profile + " (" + profile.label + ")");
  console.log("  Model: " + String(result.ai.model || "unknown"));
  console.log("  Key status: " + result.ai.key_status);
  console.log("  Key source: " + String(result.ai.key_source || "none"));
  console.log("  Key env name: " + String(result.ai.key_env_name || "none"));
  console.log("  Key present: " + String(result.ai.key_present === true));
  console.log("  Key masked: " + String(result.ai.key_masked || "not stored"));
  console.log("  Live calls enabled: " + String(result.ai.live_calls_enabled === true));
  console.log("  Last estimate: " + (result.ai.last_estimate ? String(result.ai.last_estimate.estimated_total_tokens || result.ai.last_estimate.total || 0) + " tokens [" + String(result.ai.last_estimate.estimate_id || "no-id") + "]" : "Not recorded"));
  console.log("  Last live call: " + (result.ai.last_live_call ? String(result.ai.last_live_call.status || "unknown") + " [" + String(result.ai.last_live_call.call_id || "no-id") + "]" : "Not recorded"));
}

function printAiConfigureResult(result) {
  console.log("Configured launcher AI metadata:");
  console.log("  Site name: " + result.project.site_name);
  console.log("  Slug: " + result.project.slug);
  console.log("  Mode: " + result.ai.mode);
  console.log("  Provider: " + result.ai.provider);
  console.log("  Model profile: " + result.ai.model_profile);
  console.log("  Model: " + String(result.ai.model || "unknown"));
  console.log("  Key status: " + result.ai.key_status);
  console.log("  Key source: " + String(result.ai.key_source || "none"));
  console.log("  Key env name: " + String(result.ai.key_env_name || "none"));
  console.log("  Key masked: " + String(result.ai.key_masked || "not stored"));
  console.log("  Live calls enabled: " + String(result.ai.live_calls_enabled === true));
  console.log("  Proof file: " + result.proofPath);
}

function printAiEstimateResult(result) {
  console.log("Estimated launcher AI tokens:");
  console.log("  Site name: " + result.project.site_name);
  console.log("  Slug: " + result.project.slug);
  console.log("  Mode: " + result.ai.mode);
  console.log("  Provider: " + result.ai.provider);
  console.log("  Key status: " + result.ai.key_status);
  console.log("  Model profile: " + result.ai.model_profile);
  console.log("  Model: " + String(result.ai.model || "unknown"));
  console.log("  Estimate ID: " + String(result.estimate.estimate_id));
  console.log("  Estimated input tokens: " + String(result.estimate.estimated_input_tokens));
  console.log("  Estimated output tokens: " + String(result.estimate.estimated_output_tokens));
  console.log("  Estimated total tokens: " + String(result.estimate.estimated_total_tokens));
  console.log("  Estimated cost: " + String(result.estimate.estimated_cost == null ? "Unavailable" : result.estimate.estimated_cost));
  console.log("  Uncertainty: " + result.estimate.uncertainty);
  console.log("  Provider called: false");
  console.log("  Proof file: " + result.proofPath);
}

function printAiLiveEnableResult(result) {
  console.log("Enabled launcher live AI gate:");
  console.log("  Site name: " + result.project.site_name);
  console.log("  Slug: " + result.project.slug);
  console.log("  Provider: " + result.ai.provider);
  console.log("  Model profile: " + result.ai.model_profile);
  console.log("  Model: " + String(result.ai.model || "unknown"));
  console.log("  Key status: " + result.ai.key_status);
  console.log("  Live calls enabled: " + String(result.ai.live_calls_enabled === true));
  console.log("  Proof file: " + result.proofPath);
}

function parseAiSubcommand(parsed) {
  return String(parsed.positionals[0] || "").trim().toLowerCase();
}

async function runAi(parsed) {
  if (!parsed.flags.slug) {
    throw new Error("ai requires --slug <slug>.");
  }

  const subcommand = parseAiSubcommand(parsed);
  switch (subcommand) {
    case "status": {
      const result = getAiStatus({
        slug: parsed.flags.slug,
        projectsRoot: parsed.flags["projects-root"]
      });
      printAiStatus(result);
      return;
    }
    case "configure": {
      const result = configureAi({
        slug: parsed.flags.slug,
        projectsRoot: parsed.flags["projects-root"],
        mode: parsed.flags.mode,
        provider: parsed.flags.provider,
        modelProfile: parsed.flags["model-profile"],
        keyEnv: parsed.flags["key-env"]
      });
      printAiConfigureResult(result);
      return;
    }
    case "estimate": {
      const result = estimateAi({
        slug: parsed.flags.slug,
        projectsRoot: parsed.flags["projects-root"],
        prompt: parsed.flags.prompt
      });
      printAiEstimateResult(result);
      return;
    }
    case "enable-live": {
      const result = enableLiveAi({
        slug: parsed.flags.slug,
        projectsRoot: parsed.flags["projects-root"]
      });
      printAiLiveEnableResult(result);
      return;
    }
    default:
      throw new Error("ai requires a subcommand: status | configure | estimate | enable-live.");
  }
}

async function runGenerate(flags) {
  if (!flags.slug) {
    throw new Error("generate requires --slug <slug>.");
  }

  const projectState = readProjectBySlug(flags.slug, flags["projects-root"]);
  const planId = String(projectState.project.current_run_id || "");
  const operationResult = await runCoordinatedCliOperation(
    flags,
    "controlled_generate",
    {
      project_slug: flags.slug,
      operation_type: "controlled_generate",
      plan_id: planId
    },
    {
      plan_id: planId
    },
    {
      live_ai_used: false,
      apply_used: false,
      rollback_used: false
    },
    async (context) => {
      const result = await generateProject({
        slug: flags.slug,
        projectsRoot: flags["projects-root"],
        operationId: context.operationId,
        onProgress: async (statusDetail) => {
          await context.setStage(statusDetail || "executing");
        }
      });
      return {
        result,
        proofRef: result.proofPath,
        resultSummary: {
          status: result.executeData.status || "ok",
          code: result.executeData.code || "controlled_generate_completed",
          provider_called: false,
          counts_before: result.beforeCounts || null,
          counts_after: result.afterCounts || null,
          generated_urls: result.generatedUrls || {}
        }
      };
    }
  );
  if (operationResult.idempotentReplay) {
    console.log("Controlled generate request replayed from operation history:");
    printOperationSummary(operationResult);
    return;
  }
  const result = operationResult.result;

  console.log("Completed controlled generate:");
  console.log("  Site name: " + result.project.site_name);
  console.log("  Slug: " + result.project.slug);
  console.log("  WordPress URL: " + result.project.wp_url);
  console.log("  Status: " + String(result.executeData.status || "unknown"));
  console.log("  Code: " + String(result.executeData.code || "unknown"));
  console.log("  Applies changes: " + String(result.proof.applies_changes));
  console.log("  Mutation status: " + String(result.proof.mutation_status || "unknown"));
  console.log("  Personalization source: " + String(result.proof.personalization && result.proof.personalization.source || "local_interpreter"));
  console.log("  Applied fields: " + ((result.proof.personalization && result.proof.personalization.applied_fields || []).join(", ") || "None"));
  console.log("  Proof file: " + result.proofPath);
  console.log("  Home: " + String(result.generatedUrls.home || result.generatedUrls.root || result.project.wp_url));
  console.log("  Properties: " + String(result.generatedUrls.properties || "Unavailable"));
  console.log("  Contact: " + String(result.generatedUrls.contact || "Unavailable"));
  printOperationSummary(operationResult);
}

function formatCountChange(beforeValue, afterValue) {
  if (beforeValue == null && afterValue == null) {
    return "Unavailable";
  }

  if (beforeValue == null) {
    return "? -> " + String(afterValue);
  }

  if (afterValue == null) {
    return String(beforeValue) + " -> ?";
  }

  return String(beforeValue) + " -> " + String(afterValue);
}

function printSiteStatus(result) {
  const site = result.site;
  const urls = site.generated_urls || {};
  const counts = site.counts_summary || {};
  const beforeCounts = counts.before || {};
  const afterCounts = counts.after || {};
  const personalization = site.personalization || null;

  console.log("Generated site status:");
  console.log("  Project name: " + result.project.site_name);
  console.log("  Slug: " + result.project.slug);
  console.log("  WordPress URL: " + result.project.wp_url);
  console.log("  Generated site present: " + String(site.generated_site_present));
  console.log("  Generation status: " + String(site.generation_status || "not_generated"));
  console.log("  Latest generate proof ID: " + String(site.latest_generate_proof_id || "Unavailable"));
  console.log("  Latest generate proof path: " + String(site.latest_generate_proof_path || "Unavailable"));
  console.log("  Home: " + String(urls.home || urls.root || "Unavailable"));
  console.log("  Properties: " + String(urls.properties || "Unavailable"));
  console.log("  Contact: " + String(urls.contact || "Unavailable"));
  console.log("  Frontend Edit: " + (site.frontend_edit_available ? String(site.frontend_edit_url) : "Unavailable"));
  console.log("  Frontend Edit login: " + (site.frontend_edit_login_url ? String(site.frontend_edit_login_url) : "Unavailable"));
  console.log("  Frontend Edit available: " + String(site.frontend_edit_available));
  console.log("  Frontend Edit auth required: " + String(site.frontend_edit_auth_required));
  console.log("  Frontend Edit note: " + String(site.frontend_edit_note || "Unavailable"));
  console.log("  Page count: " + formatCountChange(beforeCounts.pages, afterCounts.pages));
  console.log("  Property count: " + formatCountChange(beforeCounts.properties, afterCounts.properties));
  console.log("  Attachment count: " + formatCountChange(beforeCounts.attachments, afterCounts.attachments));
  console.log("  Personalization source: " + String(personalization && personalization.source || "Unavailable"));
  console.log("  Personalization provider_called: " + String(personalization && personalization.provider_called === true));
  console.log("  Personalization applied fields: " + ((personalization && personalization.applied_fields || []).join(", ") || "None"));
  console.log("  URL status: home=" + String(site.url_status && site.url_status.home || "n/a") + ", properties=" + String(site.url_status && site.url_status.properties || "n/a") + ", contact=" + String(site.url_status && site.url_status.contact || "n/a"));
  console.log("  Next suggested action: " + String(site.next_suggested_action || "Review the latest proof."));

  if (site.warnings && site.warnings.length) {
    console.log("  Warnings: " + site.warnings.join(" | "));
  }
}

function normalizeSiteTarget(value) {
  const normalized = String(value || "home").trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "frontendedit") {
    return "frontend-edit";
  }
  if (normalized === "frontendeditlogin") {
    return "frontend-edit-login";
  }
  return normalized;
}

async function runSite(parsed) {
  if (!parsed.flags.slug) {
    throw new Error("site requires --slug <slug>.");
  }

  const subcommand = String(parsed.positionals[0] || "status").trim().toLowerCase();
  const result = await getSiteStatus({
    slug: parsed.flags.slug,
    projectsRoot: parsed.flags["projects-root"],
    persistProject: true,
    checkUrls: subcommand === "status"
  });

  if (subcommand === "status") {
    printSiteStatus(result);
    return;
  }

  if (subcommand === "open") {
    const target = normalizeSiteTarget(parsed.flags.target);
    const urls = result.site.generated_urls || {};
    const targetUrlMap = {
      home: urls.home || urls.root || result.project.wp_url,
      properties: urls.properties || null,
      contact: urls.contact || null,
      "frontend-edit": result.site.frontend_edit_available ? result.site.frontend_edit_url : null,
      "frontend-edit-login": result.site.frontend_edit_available ? result.site.frontend_edit_login_url : null
    };
    const targetUrl = targetUrlMap[target];

    if (!targetUrl) {
      throw new Error("No URL is available for site target: " + target);
    }

    console.log("Open this URL in your browser:");
    console.log("  Target: " + target);
    console.log("  URL: " + targetUrl);
    return;
  }

  throw new Error("site requires a subcommand: status | open.");
}

function printStateStatus(result) {
  if (!result.exists) {
    console.log("Managed state status:");
    console.log("  Site name: " + result.project.site_name);
    console.log("  Slug: " + result.project.slug);
    console.log("  State exists: false");
    console.log("  State path: " + result.statePath);
    console.log("  Next step: state refresh");
    return;
  }

  const summary = result.summary;
  console.log("Managed state status:");
  console.log("  Site name: " + result.project.site_name);
  console.log("  Slug: " + result.project.slug);
  console.log("  Schema/version: " + summary.schema + " v" + String(summary.version));
  console.log("  Generation status: " + String(summary.generation_status));
  console.log("  Pages: " + String(summary.pages));
  console.log("  Property count: " + String(summary.property_count));
  console.log("  Attachment count: " + String(summary.attachment_count));
  console.log("  Personalization source: " + String(summary.personalization_source));
  console.log("  Applied personalization fields: " + (summary.personalization_fields.length ? summary.personalization_fields.join(", ") : "None"));
  console.log("  User overrides count: " + String(summary.user_overrides_count));
  console.log("  Protected fields: " + (summary.protected_fields.length ? summary.protected_fields.join(", ") : "None"));
  console.log("  Last apply method: " + String(summary.latest_apply_method || "None"));
  console.log("  Last applied fields: " + (summary.last_applied_fields.length ? summary.last_applied_fields.join(", ") : "None"));
  console.log("  Latest effective mutation: " + String(summary.latest_effective_mutation_method || "None"));
  console.log("  Latest effective mutation fields: " + (summary.last_effective_mutation_fields.length ? summary.last_effective_mutation_fields.join(", ") : "None"));
  if (summary.latest_rollback_id) {
    console.log("  Latest rollback id: " + String(summary.latest_rollback_id));
    console.log("  Latest rollback fields: " + (summary.last_rollback_fields.length ? summary.last_rollback_fields.join(", ") : "None"));
    if (summary.latest_rollback_proof_path) {
      console.log("  Latest rollback proof: " + String(summary.latest_rollback_proof_path));
    }
  }
  console.log("  Effective safe fields:");
  if (summary.effective_safe_fields.length) {
    for (const field of summary.effective_safe_fields) {
      let line = "    - " + field.field_key + ": " + field.value + " [" + field.source;
      if (field.protected) {
        line += ", protected";
      }
      line += ", render:" + field.rendered_check + "]";
      console.log(line);
    }
  } else {
    console.log("    None");
  }
  if (summary.effective_safe_field_warnings.length) {
    console.log("  Effective field warnings:");
    for (const warning of summary.effective_safe_field_warnings) {
      console.log("    - " + warning);
    }
  }
  console.log("  Drift status: " + String(summary.drift_status));
  console.log("  State path: " + summary.state_path);
}

async function runState(parsed) {
  if (!parsed.flags.slug) {
    throw new Error("state requires --slug <slug>.");
  }

  const subcommand = String(parsed.positionals[0] || "status").trim().toLowerCase();

  if (subcommand === "refresh") {
    const result = await refreshState({
      slug: parsed.flags.slug,
      projectsRoot: parsed.flags["projects-root"]
    });

    console.log("Refreshed managed state:");
    console.log("  Site name: " + result.project.site_name);
    console.log("  Slug: " + result.project.slug);
    console.log("  State path: " + result.statePath);
    console.log("  Snapshot path: " + result.snapshotPath);
    console.log("  Proof path: " + result.proofPath);
    console.log("  Personalization source: " + String(result.summary.personalization_source));
    console.log("  User overrides count: " + String(result.summary.user_overrides_count));
    console.log("  Protected fields: " + (result.summary.protected_fields.length ? result.summary.protected_fields.join(", ") : "None"));
    console.log("  Effective safe fields: " + (result.summary.effective_safe_fields.length
      ? result.summary.effective_safe_fields.map((field) => field.field_key + " [" + field.source + "]").join(", ")
      : "None"));
    return;
  }

  if (subcommand === "status") {
    printStateStatus(readStateStatus({
      slug: parsed.flags.slug,
      projectsRoot: parsed.flags["projects-root"]
    }));
    return;
  }

  if (subcommand === "plan") {
    const result = await planState({
      slug: parsed.flags.slug,
      projectsRoot: parsed.flags["projects-root"],
      prompt: parsed.flags.prompt,
      overwriteFields: parsed.flags["overwrite-field"],
      aiSource: parsed.flags.ai,
      confirmLive: parsed.flags["confirm-live"] === true,
      estimate: parsed.flags.estimate
    });
    const protectedFields = Array.isArray(result.plan.current && result.plan.current.protected_fields)
      ? result.plan.current.protected_fields
      : [];
    const fieldScope = result.plan.field_scope && typeof result.plan.field_scope === "object"
      ? result.plan.field_scope
      : { included_fields: [], excluded_fields: [], preserved_protected_fields: [] };
    console.log("Managed state plan:");
    console.log("  Site name: " + result.project.site_name);
    console.log("  Slug: " + result.project.slug);
    console.log("  Plan ID: " + result.plan.plan_id);
    console.log("  Applies changes: false");
    console.log("  Provider called: " + String(result.plan.provider_called === true));
    console.log("  AI source: " + String(result.plan.source && result.plan.source.ai_source || result.plan.source.prompt_personalization_source || "local_interpreter"));
    if (result.plan.source && result.plan.source.provider) {
      console.log("  Provider: " + String(result.plan.source.provider));
    }
    if (result.plan.source && result.plan.source.model) {
      console.log("  Model: " + String(result.plan.source.model));
    }
    if (result.plan.source && result.plan.source.estimate_id) {
      console.log("  Estimate ID: " + String(result.plan.source.estimate_id));
    }
    console.log("  Field changes: " + String(result.plan.diff.field_changes.length));
    console.log("  Preserved protected fields: " + ((fieldScope.preserved_protected_fields || []).length ? fieldScope.preserved_protected_fields.join(", ") : "None"));
    console.log("  Excluded fields: " + ((fieldScope.excluded_fields || []).length ? fieldScope.excluded_fields.join(", ") : "None"));
    console.log("  Included fields: " + ((fieldScope.included_fields || []).length ? fieldScope.included_fields.join(", ") : "None"));
    console.log("  Requires confirmation fields: " + ((fieldScope.requires_confirmation_fields || []).length ? fieldScope.requires_confirmation_fields.join(", ") : "None"));
    console.log("  Conflicts: " + String(result.plan.conflicts.length));
    console.log("  Protected fields: " + (protectedFields.length ? protectedFields.join(", ") : "None"));
    console.log("  Can apply without confirmation: " + String(result.plan.can_apply_without_confirmation));
    if (result.plan.confirmation_required && result.plan.confirmation_required.required) {
      console.log("  Confirmation required: true");
      console.log("  Confirmation fields: " + result.plan.confirmation_required.fields.join(", "));
    }
    console.log("  Plan path: " + result.planPath);
    console.log("  Proof path: " + result.proofPath);
    if (result.aiCandidateProofPath) {
      console.log("  AI candidate proof path: " + result.aiCandidateProofPath);
    }
    return;
  }

  if (subcommand === "apply") {
    const operationResult = await runCoordinatedCliOperation(
      parsed.flags,
      "state_apply",
      {
        project_slug: parsed.flags.slug,
        operation_type: "state_apply",
        plan_path: parsed.flags.plan || "latest",
        confirm_overwrite_fields: parsed.flags["confirm-overwrite"] || []
      },
      {
        plan_ref: parsed.flags.plan || "latest"
      },
      {
        live_ai_used: false,
        apply_used: true,
        rollback_used: false
      },
      async () => {
        const result = await applyStatePlan({
          slug: parsed.flags.slug,
          projectsRoot: parsed.flags["projects-root"],
          planPath: parsed.flags.plan,
          confirmOverwriteFields: parsed.flags["confirm-overwrite"]
        });
        return {
          result,
          proofRef: result.proofPath || null,
          resultSummary: {
            status: result.status,
            code: result.code,
            apply_method: result.apply ? result.apply.apply_method : (result.proof ? result.proof.apply_method : null)
          }
        };
      }
    );
    if (operationResult.idempotentReplay) {
      console.log("Managed state apply replayed from operation history:");
      printOperationSummary(operationResult);
      return;
    }
    const result = operationResult.result;

    console.log("Managed state apply:");
    console.log("  Site name: " + result.project.site_name);
    console.log("  Slug: " + result.project.slug);
    console.log("  Status: " + String(result.status));
    console.log("  Code: " + String(result.code));
    if (result.status === "blocked") {
      console.log("  Apply method: " + String((result.proof && result.proof.apply_method) || "unknown"));
      console.log("  Conflicts: " + String((result.conflicts || []).length));
      if (result.proof && result.proof.confirmation && result.proof.confirmation.required) {
        console.log("  Confirmation required fields: " + ((result.proof.confirmation.required_fields || []).length ? result.proof.confirmation.required_fields.join(", ") : "None"));
      }
      console.log("  Proof path: " + result.proofPath);
      console.log("  State path: " + result.statePath);
      return;
    }
    console.log("  Apply method: " + String((result.apply && result.apply.apply_method) || "unknown"));
    console.log("  Applied fields: " + ((result.apply.applied_fields || []).length ? result.apply.applied_fields.join(", ") : "None"));
    console.log("  Ignored fields: " + ((result.apply.ignored_fields || []).length ? result.apply.ignored_fields.join(", ") : "None"));
    console.log("  Field-only manifest: " + String(result.apply.field_only_apply && result.apply.field_only_apply.agent_manifest || "Unavailable"));
    console.log("  Overwritten protected fields: " + ((result.apply.confirmation && result.apply.confirmation.overwritten_protected_fields || []).length ? result.apply.confirmation.overwritten_protected_fields.join(", ") : "None"));
    console.log("  Proof path: " + result.proofPath);
    console.log("  State path: " + result.statePath);
    printOperationSummary(operationResult);
    return;
  }

  if (subcommand === "rollback") {
    const operationResult = await runCoordinatedCliOperation(
      parsed.flags,
      "state_rollback",
      {
        project_slug: parsed.flags.slug,
        operation_type: "state_rollback",
        apply_path: parsed.flags.apply || "latest"
      },
      {
        apply_ref: parsed.flags.apply || "latest"
      },
      {
        live_ai_used: false,
        apply_used: false,
        rollback_used: true
      },
      async () => {
        const result = await rollbackStateApply({
          slug: parsed.flags.slug,
          projectsRoot: parsed.flags["projects-root"],
          applyPath: parsed.flags.apply
        });
        return {
          result,
          proofRef: result.proofPath || null,
          resultSummary: {
            status: result.status,
            code: result.code,
            rollback_fields: result.rollback ? Object.keys(result.rollback.rollback_fields || {}) : []
          }
        };
      }
    );
    if (operationResult.idempotentReplay) {
      console.log("Managed state rollback replayed from operation history:");
      printOperationSummary(operationResult);
      return;
    }
    const result = operationResult.result;

    console.log("Managed state rollback:");
    console.log("  Site name: " + result.project.site_name);
    console.log("  Slug: " + result.project.slug);
    console.log("  Status: " + String(result.status));
    console.log("  Code: " + String(result.code));
    if (result.status === "unavailable") {
      console.log("  State path: " + result.statePath);
      return;
    }
    if (result.status === "blocked") {
      console.log("  Protected conflicts: " + String((result.protectedConflicts || []).length));
      console.log("  Proof path: " + result.proofPath);
      console.log("  State path: " + result.statePath);
      return;
    }
    console.log("  Rollback fields: " + Object.keys(result.rollback.rollback_fields || {}).join(", "));
    console.log("  Applied fields: " + ((result.rollback.applied_fields || []).length ? result.rollback.applied_fields.join(", ") : "None"));
    console.log("  Proof path: " + result.proofPath);
    console.log("  State path: " + result.statePath);
    printOperationSummary(operationResult);
    return;
  }

  throw new Error("state requires a subcommand: refresh | status | plan | apply | rollback.");
}

async function runProofPack(flags) {
  if (!flags.slug) {
    throw new Error("proof-pack requires --slug <slug>.");
  }

  const result = await generateProofPack({
    slug: flags.slug,
    projectsRoot: flags["projects-root"]
  });

  console.log("Alpha proof pack generated:");
  console.log("  Site name: " + result.project.site_name);
  console.log("  Slug: " + result.project.slug);
  console.log("  WordPress URL: " + result.project.wp_url);
  console.log("  Readiness: " + String(result.proofPack.readiness_status));
  if (result.proofPack.readiness) {
    console.log("  Overall readiness: " + String(result.proofPack.readiness.alpha_evaluator_ready && result.proofPack.readiness.alpha_evaluator_ready.status || "unknown"));
    console.log("  Generated site readiness: " + String(result.proofPack.readiness.generated_site_ready && result.proofPack.readiness.generated_site_ready.status || "unknown"));
    console.log("  AI safe-apply history readiness: " + String(result.proofPack.readiness.ai_safe_apply_history_ready && result.proofPack.readiness.ai_safe_apply_history_ready.status || "unknown"));
    console.log("  Secrets readiness: " + String(result.proofPack.readiness.secrets_ready && result.proofPack.readiness.secrets_ready.status || "unknown"));
    console.log("  Missing proof categories: " + ((result.proofPack.missing_proof_categories || []).length ? result.proofPack.missing_proof_categories.join(", ") : "None"));
  }
  console.log("  Latest effective mutation: " + String(
    result.proofPack.current_state_summary
    && result.proofPack.current_state_summary.summary
    && result.proofPack.current_state_summary.summary.latest_effective_mutation_method || "None"
  ));
  console.log("  Protected fields: " + (
    result.proofPack.current_state_summary
    && result.proofPack.current_state_summary.summary
    && Array.isArray(result.proofPack.current_state_summary.summary.protected_fields)
    && result.proofPack.current_state_summary.summary.protected_fields.length
      ? result.proofPack.current_state_summary.summary.protected_fields.join(", ")
      : "None"
  ));
  console.log("  JSON proof pack: " + result.jsonPath);
  console.log("  Markdown proof pack: " + result.markdownPath);
}

async function runAlphaSmokeCli(flags) {
  if (!flags.slug) {
    throw new Error("alpha-smoke requires --slug <slug>.");
  }

  const result = await runAlphaSmoke({
    slug: flags.slug,
    projectsRoot: flags["projects-root"],
    requirement: flags.require,
    json: flags.json === true
  });

  if (flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.exit_code_recommended;
    return;
  }

  console.log("Alpha smoke: " + result.slug);
  console.log("  Requirement: " + result.requirement);
  console.log("  Status: " + String(result.status || "unknown").toUpperCase());
  console.log("  Generated site: " + String(result.readiness && result.readiness.generated_site_ready && result.readiness.generated_site_ready.status || "unknown"));
  console.log("  AI safe apply history: " + String(result.readiness && result.readiness.ai_safe_apply_history_ready && result.readiness.ai_safe_apply_history_ready.status || "unknown"));
  console.log("  Secrets: " + String(result.readiness && result.readiness.secrets_ready && result.readiness.secrets_ready.status || "unknown"));
  console.log("  Overall alpha evaluator: " + String(result.readiness && result.readiness.alpha_evaluator_ready && result.readiness.alpha_evaluator_ready.status || "unknown"));
  console.log("  Counts: pages=" + String(result.counts.pages) + " properties=" + String(result.counts.properties) + " attachments=" + String(result.counts.attachments));
  console.log("  URLs: home=" + String(result.urls.home.status) + " properties=" + String(result.urls.properties.status) + " contact=" + String(result.urls.contact.status));
  console.log("  Proof pack: " + String(result.proofs.proof_pack_json || "Unavailable"));
  console.log("  Summary proof: " + String(result.proofs.alpha_smoke_summary || "Unavailable"));
  if (result.readiness && result.readiness.ai_safe_apply_history_ready && Array.isArray(result.readiness.ai_safe_apply_history_ready.missing_proof_categories) && result.readiness.ai_safe_apply_history_ready.missing_proof_categories.length) {
    console.log("  Missing AI history: " + result.readiness.ai_safe_apply_history_ready.missing_proof_categories.join(", "));
  }
  if (Array.isArray(result.notes) && result.notes.length) {
    for (const note of result.notes) {
      console.log("  Note: " + note);
    }
  }
  if (Array.isArray(result.blockers) && result.blockers.length) {
    for (const blocker of result.blockers) {
      console.log("  Blocker: " + blocker);
    }
  }
  if (Array.isArray(result.warnings) && result.warnings.length) {
    for (const warning of result.warnings) {
      console.log("  Warning: " + warning);
    }
  }

  process.exitCode = result.exit_code_recommended;
}

async function main() {
  const parsed = parseArguments(process.argv);

  switch (parsed.command) {
    case "start":
      await runStart(parsed.flags);
      return;
    case "create":
      runCreate(parsed.flags);
      return;
    case "list":
      runList(parsed.flags);
      return;
    case "provision":
      await runProvision(parsed.flags);
      return;
    case "install-agent":
      await runInstallAgent(parsed.flags);
      return;
    case "plan":
      await runPlan(parsed.flags);
      return;
    case "dependencies":
      await runDependencies(parsed.flags);
      return;
    case "install-dependency":
      await runInstallDependency(parsed.flags);
      return;
    case "ai":
      await runAi(parsed);
      return;
    case "generate":
      await runGenerate(parsed.flags);
      return;
    case "site":
      await runSite(parsed);
      return;
    case "state":
      await runState(parsed);
      return;
    case "proof-pack":
      await runProofPack(parsed.flags);
      return;
    case "alpha-smoke":
      await runAlphaSmokeCli(parsed.flags);
      return;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

main().catch((error) => {
  if (error && error.code) {
    console.error(String(error.code) + ": " + error.message);
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});
