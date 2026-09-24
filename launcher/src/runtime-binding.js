"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  createDockerCompose,
  normalizeProjectNetworkAllocation,
  sameProjectNetworkAllocation
} = require("./templates");

const RUNTIME_BINDING_SCHEMA_VERSION = 1;
const RUNTIME_BINDING_KIND = "server_owned_runtime_binding";
const RUNTIME_BINDING_FILENAME = "runtime-binding-v1.json";
const RUNTIME_BINDING_MAX_BYTES = 16 * 1024;
const RUNTIME_BINDING_TEMP_PREFIX = ".runtime-binding-v1.json.";
const RUNTIME_BINDING_TEMP_SUFFIX = ".tmp";
const CONTAINER_RUNTIME_BINDING_PATH = "/run/csf/project-binding.json";
const PROJECT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROJECT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function runtimeBindingError(code) {
  const error = new Error("Runtime binding validation failed.");
  error.code = code;
  error.statusCode = 409;
  return error;
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = keys.slice().sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function normalizeProjectIdentity(project) {
  if (!project || typeof project !== "object" || Array.isArray(project)
    || typeof project.project_id !== "string" || !PROJECT_UUID_PATTERN.test(project.project_id)
    || typeof project.slug !== "string" || !PROJECT_SLUG_PATTERN.test(project.slug)) {
    throw runtimeBindingError("runtime_binding_identity_invalid");
  }
  return {
    project_id: project.project_id,
    project_slug: project.slug
  };
}

function createPendingRuntimeBinding() {
  return {
    schema_version: RUNTIME_BINDING_SCHEMA_VERSION,
    status: "pending",
    artifact: RUNTIME_BINDING_FILENAME
  };
}

function normalizeRuntimeBindingState(value) {
  if (hasExactKeys(value, ["schema_version", "status", "artifact"])
    && value.schema_version === RUNTIME_BINDING_SCHEMA_VERSION
    && value.status === "pending"
    && value.artifact === RUNTIME_BINDING_FILENAME) {
    return createPendingRuntimeBinding();
  }
  if (hasExactKeys(value, ["schema_version", "status", "artifact", "sha256"])
    && value.schema_version === RUNTIME_BINDING_SCHEMA_VERSION
    && value.status === "ready"
    && value.artifact === RUNTIME_BINDING_FILENAME
    && typeof value.sha256 === "string"
    && SHA256_PATTERN.test(value.sha256)) {
    return {
      schema_version: RUNTIME_BINDING_SCHEMA_VERSION,
      status: "ready",
      artifact: RUNTIME_BINDING_FILENAME,
      sha256: value.sha256
    };
  }
  throw runtimeBindingError("runtime_binding_state_invalid");
}

function createReadyRuntimeBinding(sha256) {
  if (typeof sha256 !== "string" || !SHA256_PATTERN.test(sha256)) {
    throw runtimeBindingError("runtime_binding_hash_invalid");
  }
  return {
    schema_version: RUNTIME_BINDING_SCHEMA_VERSION,
    status: "ready",
    artifact: RUNTIME_BINDING_FILENAME,
    sha256
  };
}

function isRuntimeBindingDeclared(project) {
  return Boolean(project && Object.prototype.hasOwnProperty.call(project, "runtime_binding"));
}

function buildRuntimeBindingPayload(project) {
  const identity = normalizeProjectIdentity(project);
  return {
    schema_version: RUNTIME_BINDING_SCHEMA_VERSION,
    binding_kind: RUNTIME_BINDING_KIND,
    project_id: identity.project_id,
    project_slug: identity.project_slug
  };
}

function normalizeRuntimeBindingPayload(value) {
  if (!hasExactKeys(value, ["schema_version", "binding_kind", "project_id", "project_slug"])
    || value.schema_version !== RUNTIME_BINDING_SCHEMA_VERSION
    || value.binding_kind !== RUNTIME_BINDING_KIND) {
    throw runtimeBindingError("runtime_binding_payload_invalid");
  }
  return buildRuntimeBindingPayload({
    project_id: value.project_id,
    slug: value.project_slug
  });
}

function serializeRuntimeBindingPayload(project) {
  return JSON.stringify(buildRuntimeBindingPayload(project), null, 2) + "\n";
}

function pathsEqual(leftPath, rightPath) {
  const left = path.resolve(leftPath);
  const right = path.resolve(rightPath);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function assertDirectRuntimePath(runtimePath, projectsRoot) {
  if (typeof runtimePath !== "string" || typeof projectsRoot !== "string") {
    throw runtimeBindingError("runtime_binding_path_invalid");
  }
  const resolvedRuntimePath = path.resolve(runtimePath);
  const resolvedProjectsRoot = path.resolve(projectsRoot);
  if (pathsEqual(resolvedRuntimePath, resolvedProjectsRoot)
    || !pathsEqual(path.dirname(resolvedRuntimePath), resolvedProjectsRoot)) {
    throw runtimeBindingError("runtime_binding_path_invalid");
  }
  return { runtimePath: resolvedRuntimePath, projectsRoot: resolvedProjectsRoot };
}

function assertRegularPath(filePath, kind) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    throw runtimeBindingError("runtime_binding_" + kind + "_missing");
  }
  if (((kind === "runtime" || kind === "projects_root") && (!stat.isDirectory() || stat.isSymbolicLink()))
    || (kind !== "runtime" && kind !== "projects_root" && (!stat.isFile() || stat.isSymbolicLink()))) {
    throw runtimeBindingError("runtime_binding_" + kind + "_unsafe");
  }
  return stat;
}

function removeTempFile(tempPath) {
  try {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  } catch (error) {
    throw runtimeBindingError("runtime_binding_write_failed");
  }
}

function writeRuntimeBindingArtifact(runtimePath, project) {
  const targetPath = path.join(runtimePath, RUNTIME_BINDING_FILENAME);
  const tempPath = path.join(
    runtimePath,
    RUNTIME_BINDING_TEMP_PREFIX + crypto.randomBytes(16).toString("hex") + RUNTIME_BINDING_TEMP_SUFFIX
  );
  const payload = serializeRuntimeBindingPayload(project);
  const bytes = Buffer.from(payload, "utf8");
  let descriptor = null;
  let failure = null;
  try {
    assertRegularPath(runtimePath, "runtime");
    descriptor = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempPath, targetPath);
    assertRegularPath(targetPath, "artifact");
    const promoted = fs.readFileSync(targetPath);
    if (!promoted.equals(bytes)) {
      throw runtimeBindingError("runtime_binding_write_failed");
    }
    return {
      artifactPath: targetPath,
      sha256: crypto.createHash("sha256").update(promoted).digest("hex")
    };
  } catch (error) {
    failure = error;
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch (error) {
        if (!failure) failure = error;
      }
    }
    try {
      removeTempFile(tempPath);
    } catch (error) {
      if (!failure) failure = error;
    }
  }
  if (failure && failure.code && String(failure.code).startsWith("runtime_binding_")) {
    throw failure;
  }
  throw runtimeBindingError("runtime_binding_write_failed");
}

function readRuntimeBindingArtifact(runtimePath) {
  const artifactPath = path.join(runtimePath, RUNTIME_BINDING_FILENAME);
  const stat = assertRegularPath(artifactPath, "artifact");
  if (stat.size < 1 || stat.size > RUNTIME_BINDING_MAX_BYTES) {
    throw runtimeBindingError("runtime_binding_artifact_size_invalid");
  }
  let bytes;
  let value;
  try {
    bytes = fs.readFileSync(artifactPath);
    if (bytes.length !== stat.size || bytes.length > RUNTIME_BINDING_MAX_BYTES) {
      throw new Error("size mismatch");
    }
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw runtimeBindingError("runtime_binding_artifact_invalid");
  }
  return {
    artifactPath,
    payload: normalizeRuntimeBindingPayload(value),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex")
  };
}

function assertCanonicalCompose(runtimePath, project) {
  const composePath = path.join(runtimePath, "docker-compose.yml");
  assertRegularPath(composePath, "compose");
  let compose;
  try {
    compose = fs.readFileSync(composePath, "utf8");
  } catch (error) {
    throw runtimeBindingError("runtime_binding_compose_invalid");
  }
  if (compose !== createDockerCompose(project)) {
    throw runtimeBindingError("runtime_binding_compose_invalid");
  }
  return composePath;
}

function verifyScaffoldRuntimeBinding(runtimePath, project, expectedSha256) {
  const state = normalizeRuntimeBindingState(project.runtime_binding);
  if (state.status !== "pending") {
    throw runtimeBindingError("runtime_binding_not_pending");
  }
  const artifact = readRuntimeBindingArtifact(runtimePath);
  const identity = normalizeProjectIdentity(project);
  if (artifact.payload.project_id !== identity.project_id || artifact.payload.project_slug !== identity.project_slug
    || artifact.sha256 !== expectedSha256) {
    throw runtimeBindingError("runtime_binding_artifact_mismatch");
  }
  assertCanonicalCompose(runtimePath, project);
  return artifact;
}

function sameRuntimeBindingState(left, right) {
  const leftDeclared = left !== undefined;
  const rightDeclared = right !== undefined;
  if (leftDeclared !== rightDeclared) return false;
  if (!leftDeclared) return true;
  try {
    return JSON.stringify(normalizeRuntimeBindingState(left)) === JSON.stringify(normalizeRuntimeBindingState(right));
  } catch (error) {
    return false;
  }
}

function assertReadyRuntimeBinding(options) {
  try {
    const projectState = options && options.projectState;
    const project = projectState && projectState.project;
    if (!isRuntimeBindingDeclared(project)) {
      throw runtimeBindingError("runtime_binding_unbound_legacy");
    }
    const state = normalizeRuntimeBindingState(project.runtime_binding);
    if (state.status !== "ready") {
      throw runtimeBindingError("runtime_binding_not_ready");
    }
    const paths = assertDirectRuntimePath(projectState.runtimePath, options.projectsRoot);
    assertRegularPath(paths.projectsRoot, "projects_root");
    assertRegularPath(paths.runtimePath, "runtime");
    if (!pathsEqual(project.runtime_path, paths.runtimePath)) {
      throw runtimeBindingError("runtime_binding_path_invalid");
    }
    const inventory = typeof options.readStrictProjectInventory === "function"
      ? options.readStrictProjectInventory(paths.projectsRoot)
      : options.inventory;
    if (!Array.isArray(inventory)) {
      throw runtimeBindingError("runtime_binding_inventory_invalid");
    }
    const authoritative = inventory.find((record) => record && pathsEqual(record.runtimePath, paths.runtimePath));
    if (!authoritative || authoritative.projectId !== project.project_id || authoritative.slug !== project.slug
      || !sameRuntimeBindingState(authoritative.project.runtime_binding, state)
      || !sameProjectNetworkAllocation(authoritative.project.network_allocation, project.network_allocation)) {
      throw runtimeBindingError("runtime_binding_authority_mismatch");
    }
    if (Object.prototype.hasOwnProperty.call(project, "network_allocation")) {
      normalizeProjectNetworkAllocation(project.network_allocation);
    }
    const artifact = readRuntimeBindingArtifact(paths.runtimePath);
    const identity = normalizeProjectIdentity(project);
    if (artifact.sha256 !== state.sha256
      || artifact.payload.project_id !== identity.project_id
      || artifact.payload.project_slug !== identity.project_slug) {
      throw runtimeBindingError("runtime_binding_artifact_mismatch");
    }
    assertCanonicalCompose(paths.runtimePath, project);
    return {
      project_id: identity.project_id,
      project_slug: identity.project_slug,
      sha256: artifact.sha256
    };
  } catch (error) {
    if (error && typeof error.code === "string" && error.code.startsWith("runtime_binding_")) {
      throw error;
    }
    throw runtimeBindingError("runtime_binding_validation_failed");
  }
}

module.exports = {
  CONTAINER_RUNTIME_BINDING_PATH,
  RUNTIME_BINDING_FILENAME,
  RUNTIME_BINDING_KIND,
  RUNTIME_BINDING_MAX_BYTES,
  RUNTIME_BINDING_SCHEMA_VERSION,
  assertCanonicalCompose,
  assertReadyRuntimeBinding,
  buildRuntimeBindingPayload,
  createPendingRuntimeBinding,
  createReadyRuntimeBinding,
  isRuntimeBindingDeclared,
  normalizeRuntimeBindingPayload,
  normalizeRuntimeBindingState,
  readRuntimeBindingArtifact,
  sameRuntimeBindingState,
  verifyScaffoldRuntimeBinding,
  writeRuntimeBindingArtifact
};
