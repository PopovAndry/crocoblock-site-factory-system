"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const {
  DEFAULT_PROJECTS_ROOT,
  createProjectScaffold,
  listProjects,
  resolveProjectsRoot
} = require("./project-store");
const { planProject } = require("./plan");

const UI_DIR = path.join(__dirname, "ui");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, statusCode, body, contentType) {
  response.writeHead(statusCode, {
    "Content-Type": contentType || "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large."));
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function renderHomePage(config) {
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "  <meta charset=\"utf-8\">",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "  <title>Factory Launcher</title>",
    "  <link rel=\"stylesheet\" href=\"/assets/styles.css\">",
    "</head>",
    "<body>",
    "  <main class=\"launcher-shell\">",
    "    <header class=\"hero\">",
    "      <p class=\"eyebrow\">Standalone launcher - outside WordPress</p>",
    "      <div class=\"hero-row\">",
    "        <div>",
    "          <h1>Factory Launcher</h1>",
    "          <p class=\"hero-copy\">Project scaffolding, local WordPress provisioning, Agent pairing, and read-only planning live here. Controlled generate still stays off in this slice.</p>",
    "        </div>",
    "        <div class=\"hero-status\">",
    "          <div><span>Runtime</span><strong>Not provisioned</strong></div>",
    "          <div><span>Agent</span><strong>Paired per project</strong></div>",
    "          <div><span>AI</span><strong>Read-only planning</strong></div>",
    "        </div>",
    "      </div>",
    "    </header>",
    "    <section class=\"milestone-card\">",
    "      <h2>Next milestone</h2>",
    "      <p>Controlled generate and proof</p>",
    "      <button type=\"button\" class=\"button button-disabled\" disabled>Generate disabled</button>",
    "    </section>",
    "    <section class=\"panel-grid\">",
    "      <section class=\"panel\">",
    "        <div class=\"panel-header\">",
    "          <h2>Create project</h2>",
    "          <p>Write a local project scaffold without starting Docker or touching WordPress.</p>",
    "        </div>",
    "        <form id=\"create-project-form\" class=\"project-form\">",
    "          <label>",
    "            <span>Site name</span>",
    "            <input name=\"name\" type=\"text\" required placeholder=\"Kyiv Realty\">",
    "          </label>",
    "          <label>",
    "            <span>WordPress port</span>",
    "            <input name=\"port\" type=\"number\" min=\"1024\" max=\"65535\" value=\"8120\" required>",
    "          </label>",
    "          <label>",
    "            <span>Projects root</span>",
    "            <input name=\"projectsRoot\" type=\"text\" value=\"" + escapeHtml(config.projectsRoot) + "\">",
    "          </label>",
    "          <button type=\"submit\" class=\"button\">Create project scaffold</button>",
    "        </form>",
    "        <div id=\"create-result\" class=\"result-box\" hidden></div>",
    "      </section>",
    "      <section class=\"panel\">",
    "        <div class=\"panel-header\">",
    "          <h2>Projects</h2>",
    "          <p>Scaffolded runtimes waiting for provisioning.</p>",
    "        </div>",
    "        <div id=\"project-list\" class=\"project-list\"></div>",
    "      </section>",
    "    </section>",
    "    <section class=\"panel-grid\">",
    "      <section class=\"panel\">",
    "        <div class=\"panel-header\">",
    "          <h2>Read-only planning</h2>",
    "          <p>Send a prompt to the paired Site Factory Agent and capture plan proof without mutating WordPress.</p>",
    "        </div>",
    "        <form id=\"plan-project-form\" class=\"project-form\">",
    "          <label>",
    "            <span>Project</span>",
    "            <select name=\"slug\" id=\"plan-project-slug\"></select>",
    "          </label>",
    "          <label>",
    "            <span>Prompt</span>",
    "            <textarea name=\"prompt\" rows=\"5\" required placeholder=\"Create a real estate site for Kyiv apartments\"></textarea>",
    "          </label>",
    "          <button type=\"submit\" class=\"button\">Run read-only plan</button>",
    "        </form>",
    "        <div id=\"plan-result\" class=\"result-box\" hidden></div>",
    "      </section>",
    "      <section class=\"panel\">",
    "        <div class=\"panel-header\">",
    "          <h2>Latest run</h2>",
    "          <p>Launcher-only run metadata and stage summaries.</p>",
    "        </div>",
    "        <div id=\"latest-run\" class=\"project-list\"></div>",
    "      </section>",
    "    </section>",
    "    <section class=\"panel single-panel\">",
    "      <div class=\"panel-header\">",
    "        <h2>AI / model / tokens</h2>",
    "        <p>Placeholder only in this slice. No provider calls and no settings writes yet.</p>",
    "      </div>",
    "      <div class=\"placeholder-grid\">",
    "        <div><span>Provider</span><strong>Not configured here yet</strong></div>",
    "        <div><span>Model profile</span><strong>Balanced</strong></div>",
    "        <div><span>Total tokens</span><strong id=\"launcher-total-tokens\">0</strong></div>",
      "      </div>",
    "    </section>",
    "  </main>",
    "  <script>window.FactoryLauncherConfig = " + JSON.stringify({
      projectsRoot: config.projectsRoot
    }) + ";</script>",
    "  <script src=\"/assets/app.js\"></script>",
    "</body>",
    "</html>"
  ].join("\n");
}

function serveAsset(response, assetName) {
  const assetPath = path.join(UI_DIR, assetName);
  if (!fs.existsSync(assetPath)) {
    sendText(response, 404, "Not found");
    return;
  }

  const contentType = assetName.endsWith(".css")
    ? "text/css; charset=utf-8"
    : "application/javascript; charset=utf-8";
  sendText(response, 200, fs.readFileSync(assetPath, "utf8"), contentType);
}

function createLauncherServer(options) {
  const host = options.host || "127.0.0.1";
  const port = Number(options.port || 3847);
  const projectsRoot = resolveProjectsRoot(options.projectsRoot || DEFAULT_PROJECTS_ROOT);

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, "http://" + host + ":" + String(port));

    try {
      if (request.method === "GET" && requestUrl.pathname === "/") {
        sendText(response, 200, renderHomePage({ projectsRoot }), "text/html; charset=utf-8");
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/assets/styles.css") {
        serveAsset(response, "styles.css");
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/assets/app.js") {
        serveAsset(response, "app.js");
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/health") {
        sendJson(response, 200, {
          ok: true,
          service: "factory-launcher",
          mode: "alpha_scaffold_and_provisioning",
          host,
          port,
          projects_root: projectsRoot
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/projects") {
        sendJson(response, 200, {
          projects_root: projectsRoot,
          projects: listProjects(projectsRoot)
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/projects") {
        const rawBody = await readRequestBody(request);
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const result = createProjectScaffold({
          name: payload.name,
          port: payload.port,
          projectsRoot: payload.projectsRoot || projectsRoot
        });

        sendJson(response, 201, {
          ok: true,
          status: "created",
          next_step: "Provision WordPress",
          project: result.project,
          files_written: result.files_written,
          directories_written: result.directories_written
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/projects\/[^/]+\/plan$/.test(requestUrl.pathname)) {
        const rawBody = await readRequestBody(request);
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const slug = decodeURIComponent(requestUrl.pathname.split("/")[3] || "");
        const result = await planProject({
          slug,
          prompt: payload.prompt,
          projectsRoot: payload.projectsRoot || projectsRoot
        });

        sendJson(response, 200, {
          ok: true,
          status: result.run.status,
          run: result.run,
          proof: result.proof,
          run_path: result.runPath,
          proof_path: result.proofPath,
          project: result.project
        });
        return;
      }

      sendText(response, 404, "Not found");
    } catch (error) {
      const statusCode = request.method === "POST" && (requestUrl.pathname === "/api/projects" || /^\/api\/projects\/[^/]+\/plan$/.test(requestUrl.pathname)) ? 400 : 500;
      sendJson(response, statusCode, {
        ok: false,
        error: error.message
      });
    }
  });

  return {
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          resolve({
            host,
            port,
            projectsRoot
          });
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

module.exports = {
  createLauncherServer
};
