"use strict";

const { createLauncherServer } = require("./server");
const {
  DEFAULT_PROJECTS_ROOT,
  createProjectScaffold,
  listProjects,
  resolveProjectsRoot
} = require("./project-store");

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

  return {
    command,
    flags
  };
}

function printUsage() {
  console.log([
    "Factory Launcher",
    "",
    "Commands:",
    "  node launcher/src/cli.js start [--port 3847] [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js create --name \"Kyiv Realty\" --port 8120 [--projects-root \"C:\\sf-factory-projects\"]",
    "  node launcher/src/cli.js list [--projects-root \"C:\\sf-factory-projects\"]"
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
      "  agent.status: " + String(project.agent && project.agent.status),
      "  created_at: " + String(project.created_at)
    ].join("\n"));
  }
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
    default:
      printUsage();
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
