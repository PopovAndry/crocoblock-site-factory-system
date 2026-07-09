"use strict";

const { createLauncherServer } = require("./server");
const {
  DEFAULT_PROJECTS_ROOT,
  createProjectScaffold,
  listProjects,
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

function printUsage() {
  console.log([
    "Factory Launcher",
    "",
    "Commands:",
    "  node launcher/src/cli.js start [--port 3847] [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js create --name \"Kyiv Realty\" --port 8120 [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js list [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js provision --slug kyiv-realty [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js install-agent --slug kyiv-realty [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js plan --slug kyiv-realty --prompt \"Create a real estate site for Kyiv apartments\" [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js dependencies --slug kyiv-realty [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js install-dependency --slug kyiv-realty --dependency jet-engine --zip \"C:\\sf-vendor\\jet-engine.zip\" [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js ai --slug kyiv-realty status [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js ai --slug kyiv-realty configure --mode mock --model-profile balanced [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js ai --slug kyiv-realty configure --provider openai --model-profile balanced --key-env FACTORY_OPENAI_API_KEY [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js ai --slug kyiv-realty enable-live [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js ai --slug kyiv-realty estimate --prompt \"Create a real estate site for Kyiv apartments\" [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js generate --slug kyiv-realty [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js site --slug kyiv-realty status [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js site --slug kyiv-realty open --target home [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js state --slug kyiv-realty refresh [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js state --slug kyiv-realty status [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js state --slug kyiv-realty plan --prompt \"Create a premium real estate site for Odesa\" [--overwrite-field hero_title] [--ai live --confirm-live --estimate latest] [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js state --slug kyiv-realty apply --plan latest [--confirm-overwrite hero_title] [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js state --slug kyiv-realty rollback --apply latest [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js site --slug kyiv-realty open --target frontend-edit-login [--projects-root \"C:\\sf-factory-projects\"]"
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

  const result = await provisionProject({
    slug: flags.slug,
    projectsRoot: flags["projects-root"]
  });

  console.log("Provisioned WordPress runtime:");
  console.log("  Site name: " + result.project.site_name);
  console.log("  Slug: " + result.project.slug);
  console.log("  Runtime path: " + result.safeRuntimePath);
  console.log("  WordPress URL: " + result.project.wp_url);
  console.log("  Root HTTP status: " + String(result.rootHttpStatus));
  console.log("  /wp-json/ status: " + String(result.wpJsonStatus));
  console.log("  Docker services started: " + result.proof.docker_services_started.join(", "));
  console.log("  Proof file: " + result.proofPath);
}

async function runInstallAgent(flags) {
  if (!flags.slug) {
    throw new Error("install-agent requires --slug <slug>.");
  }

  const result = await installAgent({
    slug: flags.slug,
    projectsRoot: flags["projects-root"]
  });

  console.log("Installed Site Factory Agent:");
  console.log("  Site name: " + result.project.site_name);
  console.log("  Slug: " + result.project.slug);
  console.log("  WordPress URL: " + result.project.wp_url);
  console.log("  Plugin active: true");
  console.log("  REST base: " + result.restBase);
  console.log("  Health status: " + String(result.health.status));
  console.log("  Capabilities status: " + String(result.capabilities.status));
  console.log("  Proof file: " + result.proofPath);
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

  if (!flags.zip) {
    throw new Error("install-dependency requires --zip \"<absolute-zip-path>\".");
  }

  const result = await installDependency({
    slug: flags.slug,
    dependency: flags.dependency,
    zip: flags.zip,
    projectsRoot: flags["projects-root"]
  });

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

  const result = await generateProject({
    slug: flags.slug,
    projectsRoot: flags["projects-root"]
  });

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
    const result = await applyStatePlan({
      slug: parsed.flags.slug,
      projectsRoot: parsed.flags["projects-root"],
      planPath: parsed.flags.plan,
      confirmOverwriteFields: parsed.flags["confirm-overwrite"]
    });

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
    return;
  }

  if (subcommand === "rollback") {
    const result = await rollbackStateApply({
      slug: parsed.flags.slug,
      projectsRoot: parsed.flags["projects-root"],
      applyPath: parsed.flags.apply
    });

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
    return;
  }

  throw new Error("state requires a subcommand: refresh | status | plan | apply | rollback.");
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
