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

function parseArguments(argv) {
  const [, , command, ...rest] = argv;
  const flags = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    index += 1;
  }

  return { command, flags };
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
    "  node launcher/src/cli.js install-dependency --slug kyiv-realty --dependency jet-engine --zip \"C:\\sf-vendor\\jet-engine.zip\" [--projects-root \"C:\\sf-factory-projects\"]"
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
    default:
      printUsage();
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
