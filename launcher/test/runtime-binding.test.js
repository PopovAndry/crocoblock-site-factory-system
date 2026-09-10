"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  RUNTIME_BINDING_FILENAME,
  assertReadyRuntimeBinding,
  buildRuntimeBindingPayload,
  createPendingRuntimeBinding,
  createReadyRuntimeBinding,
  normalizeRuntimeBindingPayload,
  normalizeRuntimeBindingState,
  readRuntimeBindingArtifact,
  verifyScaffoldRuntimeBinding,
  writeRuntimeBindingArtifact
} = require("../src/runtime-binding");
const { createDockerCompose } = require("../src/templates");
const { createProjectScaffold, readProjectBySlug, readStrictProjectInventory, saveProjectRecord } = require("../src/project-store");
const { assertRuntimeBindingBeforeProvision, buildDockerComposeInvocation: buildProvisionComposeInvocation } = require("../src/provision");
const { assertRuntimeBindingBeforeAgentInstall, buildDockerComposeInvocation: buildAgentComposeInvocation } = require("../src/install-agent");

function temporaryProjectsRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-runtime-binding-"));
}

test("runtime binding has exact pending and ready state schemas", () => {
  const pending = createPendingRuntimeBinding();
  assert.deepEqual(normalizeRuntimeBindingState(pending), pending);
  const ready = createReadyRuntimeBinding("a".repeat(64));
  assert.deepEqual(normalizeRuntimeBindingState(ready), ready);
  assert.throws(() => normalizeRuntimeBindingState({ ...pending, sha256: "a".repeat(64) }), /Runtime binding/);
  assert.throws(() => normalizeRuntimeBindingState({ ...ready, artifact: "binding.json" }), /Runtime binding/);
});

test("new scaffold promotes only an exact persisted binding and canonical compose", (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const created = createProjectScaffold({ name: "Binding Test", slug: "binding-test", port: 49111, projectsRoot });
  const state = readProjectBySlug("binding-test", projectsRoot);
  const artifactPath = path.join(state.runtimePath, RUNTIME_BINDING_FILENAME);
  const artifact = readRuntimeBindingArtifact(state.runtimePath);
  assert.equal(created.project.runtime_binding.status, "ready");
  assert.equal(state.project.runtime_binding.sha256, artifact.sha256);
  assert.deepEqual(artifact.payload, buildRuntimeBindingPayload(state.project));
  assert.equal(fs.readFileSync(state.composePath, "utf8"), createDockerCompose(state.project));
  assert.deepEqual(assertReadyRuntimeBinding({ projectState: state, projectsRoot, readStrictProjectInventory }), {
    project_id: state.project.project_id,
    project_slug: state.project.slug,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex")
  });
});

test("canonical compose exposes one read-only fixed binding mount to each required service", () => {
  const compose = createDockerCompose();
  const mount = "./runtime-binding-v1.json:/run/csf/project-binding.json:ro";
  assert.equal(compose.split(mount).length - 1, 2);
  assert.match(compose, /wordpress:[\s\S]*?runtime-binding-v1\.json:\/run\/csf\/project-binding\.json:ro/);
  assert.match(compose, /wpcli:[\s\S]*?runtime-binding-v1\.json:\/run\/csf\/project-binding\.json:ro/);
});

test("ready host gate rejects artifact, hash, identity, and compose drift before runtime actions", (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  createProjectScaffold({ name: "Binding Gate", slug: "binding-gate", port: 49112, projectsRoot });
  const state = readProjectBySlug("binding-gate", projectsRoot);
  const artifactPath = path.join(state.runtimePath, RUNTIME_BINDING_FILENAME);
  const originalArtifact = fs.readFileSync(artifactPath);
  const originalCompose = fs.readFileSync(state.composePath, "utf8");
  const assertBlocked = () => assert.throws(() => assertReadyRuntimeBinding({ projectState: state, projectsRoot, readStrictProjectInventory }), (error) => {
    assert.match(error.code, /^runtime_binding_/);
    assert.doesNotMatch(error.message, /[A-Z]:\\|factory-runtime-binding|project-binding\.json/i);
    return true;
  });

  fs.writeFileSync(artifactPath, JSON.stringify({ ...buildRuntimeBindingPayload(state.project), unexpected: true }), "utf8");
  assertBlocked();
  fs.writeFileSync(artifactPath, originalArtifact);

  state.project.runtime_binding.sha256 = "0".repeat(64);
  assertBlocked();
  state.project.runtime_binding.sha256 = crypto.createHash("sha256").update(originalArtifact).digest("hex");

  fs.writeFileSync(state.composePath, originalCompose.replace(":ro", ":rw"), "utf8");
  assertBlocked();
  fs.writeFileSync(state.composePath, originalCompose.replace("      - ./runtime-binding-v1.json:/run/csf/project-binding.json:ro\n", ""), "utf8");
  assertBlocked();
  fs.writeFileSync(state.composePath, originalCompose.replace(
    "      - ./runtime-binding-v1.json:/run/csf/project-binding.json:ro",
    "      - ./runtime-binding-v1.json:/run/csf/project-binding.json:ro\n      - ./runtime-binding-v1.json:/run/csf/project-binding.json:ro"
  ), "utf8");
  assertBlocked();
  fs.writeFileSync(state.composePath, originalCompose);

  const payload = JSON.parse(originalArtifact);
  payload.project_slug = "other-project";
  fs.writeFileSync(artifactPath, JSON.stringify(payload), "utf8");
  assertBlocked();

  fs.writeFileSync(artifactPath, originalArtifact);
  const originalLstatSync = fs.lstatSync;
  fs.lstatSync = function projectRootAsReparse(filePath, ...args) {
    if (path.resolve(String(filePath)) === path.resolve(projectsRoot)) {
      return { isDirectory: () => true, isSymbolicLink: () => true };
    }
    return originalLstatSync.call(fs, filePath, ...args);
  };
  try {
    assert.throws(() => assertReadyRuntimeBinding({ projectState: state, projectsRoot, readStrictProjectInventory }),
      (error) => error.code === "runtime_binding_projects_root_unsafe");
  } finally {
    fs.lstatSync = originalLstatSync;
  }
});

test("artifact write is atomic and the promotion verifier refuses a pending mismatch", (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const runtimePath = path.join(projectsRoot, "atomic-binding");
  fs.mkdirSync(runtimePath, { recursive: true });
  const project = {
    project_id: "123e4567-e89b-12d3-a456-426614174000",
    slug: "atomic-binding",
    runtime_binding: createPendingRuntimeBinding()
  };
  fs.writeFileSync(path.join(runtimePath, "docker-compose.yml"), createDockerCompose(project), "utf8");
  const written = writeRuntimeBindingArtifact(runtimePath, project);
  assert.equal(verifyScaffoldRuntimeBinding(runtimePath, project, written.sha256).sha256, written.sha256);
  assert.throws(() => verifyScaffoldRuntimeBinding(runtimePath, project, "0".repeat(64)), /Runtime binding/);
  const artifactPath = path.join(runtimePath, RUNTIME_BINDING_FILENAME);
  const before = fs.readFileSync(artifactPath);
  const originalRenameSync = fs.renameSync;
  fs.renameSync = function rejectBindingPromotion(source, target) {
    if (path.resolve(String(target)) === path.resolve(artifactPath)) {
      throw new Error("controlled promotion failure");
    }
    return originalRenameSync.call(fs, source, target);
  };
  try {
    assert.throws(() => writeRuntimeBindingArtifact(runtimePath, project), /Runtime binding/);
  } finally {
    fs.renameSync = originalRenameSync;
  }
  assert.deepEqual(fs.readFileSync(artifactPath), before);
  assert.deepEqual(fs.readdirSync(runtimePath).filter((name) => name.startsWith(".runtime-binding-v1.json.")), []);
});

test("runtime binding state is immutable through ordinary project saves", (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  createProjectScaffold({ name: "Immutable Binding", slug: "immutable-binding", port: 49113, projectsRoot });
  const state = readProjectBySlug("immutable-binding", projectsRoot);
  state.project.runtime_binding = createPendingRuntimeBinding();
  assert.throws(() => saveProjectRecord(state, state.project), (error) => error.code === "project_identity_mismatch");
});

test("Provision and Agent enforce declared v1 state before their container actions and retain legacy compatibility", (t) => {
  const projectsRoot = temporaryProjectsRoot();
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  createProjectScaffold({ name: "Binding Workflow Gate", slug: "binding-workflow-gate", port: 49114, projectsRoot });
  const state = readProjectBySlug("binding-workflow-gate", projectsRoot);
  assert.equal(assertRuntimeBindingBeforeProvision(state, projectsRoot).project_slug, "binding-workflow-gate");
  assert.equal(assertRuntimeBindingBeforeAgentInstall(state, projectsRoot).project_slug, "binding-workflow-gate");

  state.project.runtime_binding = createPendingRuntimeBinding();
  for (const gate of [assertRuntimeBindingBeforeProvision, assertRuntimeBindingBeforeAgentInstall]) {
    assert.throws(() => gate(state, projectsRoot), (error) => error.code === "runtime_binding_not_ready");
  }

  delete state.project.runtime_binding;
  assert.equal(assertRuntimeBindingBeforeProvision(state, projectsRoot), null);
  assert.equal(assertRuntimeBindingBeforeAgentInstall(state, projectsRoot), null);
});

test("Provision and Agent pin the canonical Compose file and discard inherited COMPOSE_FILE", () => {
  const priorComposeFile = process.env.COMPOSE_FILE;
  process.env.COMPOSE_FILE = "C:\\outside\\docker-compose.yml";
  try {
    for (const buildInvocation of [buildProvisionComposeInvocation, buildAgentComposeInvocation]) {
      const invocation = buildInvocation("C:\\projects\\bound-runtime", ["up", "-d", "wordpress"]);
      assert.deepEqual(invocation.args, [
        "compose", "-f", "C:\\projects\\bound-runtime\\docker-compose.yml", "up", "-d", "wordpress"
      ]);
      assert.equal(Object.prototype.hasOwnProperty.call(invocation.env, "COMPOSE_FILE"), false);
    }
  } finally {
    if (priorComposeFile === undefined) delete process.env.COMPOSE_FILE;
    else process.env.COMPOSE_FILE = priorComposeFile;
  }
});

test("payload validator rejects extra authority fields", () => {
  assert.deepEqual(normalizeRuntimeBindingPayload({
    schema_version: 1,
    binding_kind: "server_owned_runtime_binding",
    project_id: "123e4567-e89b-12d3-a456-426614174000",
    project_slug: "strict-payload"
  }), {
    schema_version: 1,
    binding_kind: "server_owned_runtime_binding",
    project_id: "123e4567-e89b-12d3-a456-426614174000",
    project_slug: "strict-payload"
  });
  assert.throws(() => normalizeRuntimeBindingPayload({
    schema_version: 1,
    binding_kind: "server_owned_runtime_binding",
    project_id: "123e4567-e89b-12d3-a456-426614174000",
    project_slug: "strict-payload",
    wp_port: 49114
  }), /Runtime binding/);
});
