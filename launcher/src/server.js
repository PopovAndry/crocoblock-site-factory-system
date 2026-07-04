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
    "          <p class=\"hero-copy\">Project scaffolding and local WordPress provisioning live here. Agent pairing, planning, and proof come next.</p>",
    "        </div>",
    "        <div class=\"hero-status\">",
    "          <div><span>Runtime</span><strong>Not provisioned</strong></div>",
    "          <div><span>Agent</span><strong>Not paired</strong></div>",
    "          <div><span>AI</span><strong>Placeholder only</strong></div>",
    "        </div>",
    "      </div>",
    "    </header>",
    "    <section class=\"milestone-card\">",
    "      <h2>Next milestone</h2>",
    "      <p>Provision WordPress</p>",
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
    "    <section class=\"panel single-panel\">",
    "      <div class=\"panel-header\">",
    "        <h2>AI / model / tokens</h2>",
    "        <p>Placeholder only in this slice. No provider calls and no settings writes yet.</p>",
    "      </div>",
    "      <div class=\"placeholder-grid\">",
    "        <div><span>Provider</span><strong>Not configured here yet</strong></div>",
    "        <div><span>Model profile</span><strong>Balanced</strong></div>",
    "        <div><span>Total tokens</span><strong>0</strong></div>",
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

      sendText(response, 404, "Not found");
    } catch (error) {
      const statusCode = request.method === "POST" && requestUrl.pathname === "/api/projects" ? 400 : 500;
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
