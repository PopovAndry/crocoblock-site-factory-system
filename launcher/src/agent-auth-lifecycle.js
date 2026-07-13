"use strict";

const crypto = require("crypto");
const path = require("path");
const {
  createSigningCredential
} = require("./agent-signed-auth");
const {
  fetchJsonWithSignedAuth
} = require("./agent-client");
const {
  readProjectBySlug,
  resolveProjectsRoot,
  writeJsonFile
} = require("./project-store");
const {
  markAgentSigningCredentialRevoked,
  readAgentAuthRotationState,
  readAgentSigningCredential,
  redactAgentSigningCredential,
  requireAgentSigningCredential,
  writeAgentAuthRotationState,
  writeAgentSigningCredential
} = require("./agent-credential-store");

const ROTATION_SCHEMA = "factory_agent_auth_rotation_state";
const ROTATION_VERSION = 1;

function timestampCompact() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function timestampIso() {
  return new Date().toISOString();
}

function createLifecycleError(code, message, statusCode) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode || 400;
  return error;
}

function restBase(projectState) {
  return String(projectState.project.wp_url || "").replace(/\/$/, "") + "/wp-json/factory/v1";
}

function sanitizeResponseError(error) {
  return {
    code: error && (error.code || error.responseJson && error.responseJson.code) || "agent_auth_lifecycle_error",
    status_code: error && error.statusCode || null,
    message: error && error.message ? String(error.message).replace(/\s+/g, " ").slice(0, 240) : "Agent auth lifecycle failed."
  };
}

function isRetryableAgentError(error) {
  const code = String(error && error.code || "");
  if (["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE"].includes(code)) {
    return true;
  }
  const statusCode = Number(error && error.statusCode || 0);
  return statusCode >= 500 && statusCode < 600;
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function writeLifecycleProof(projectState, kind, proof) {
  const proofId = "agent-auth-" + kind + "-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
  const proofPath = path.join(projectState.runtimePath, "proofs", proofId + ".json");
  writeJsonFile(proofPath, Object.assign({
    proof_id: proofId,
    project_slug: projectState.project.slug,
    wp_url: projectState.project.wp_url,
    created_at: timestampIso()
  }, proof));
  return proofPath;
}

function sanitizedRotationState(state) {
  if (!state) {
    return null;
  }
  return {
    schema: state.schema || ROTATION_SCHEMA,
    version: Number(state.version || ROTATION_VERSION),
    rotation_id: state.rotation_id || null,
    project_slug: state.project_slug || null,
    status: state.status || null,
    stage: state.stage || null,
    old_key_id: state.old_key_id || null,
    new_key_id: state.new_key_id || null,
    created_at: state.created_at || null,
    updated_at: state.updated_at || null,
    completed_at: state.completed_at || null,
    error: state.error || null
  };
}

function writeRotationState(projectState, state) {
  const next = Object.assign({}, state, {
    updated_at: timestampIso()
  });
  const pathWritten = writeAgentAuthRotationState(projectState, next);
  return {
    state: next,
    path: pathWritten
  };
}

function createInitialRotationState(projectState, currentCredential) {
  const newCredential = createSigningCredential({
    projectSlug: projectState.project.slug,
    capabilities: Array.isArray(currentCredential.capabilities) ? currentCredential.capabilities.slice() : []
  });
  return {
    schema: ROTATION_SCHEMA,
    version: ROTATION_VERSION,
    rotation_id: "rot-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex"),
    project_slug: projectState.project.slug,
    status: "preparing",
    stage: "preparing",
    old_key_id: currentCredential.key_id,
    old_credential: currentCredential,
    new_key_id: newCredential.key_id,
    new_credential: newCredential,
    created_at: timestampIso(),
    updated_at: timestampIso(),
    completed_at: null,
    error: null
  };
}

function readOrCreateRotationState(projectState, currentCredential) {
  const existing = readAgentAuthRotationState(projectState);
  if (existing && existing.status !== "completed") {
    if (String(existing.project_slug || "") !== projectState.project.slug) {
      throw createLifecycleError("agent_auth_rotation_project_mismatch", "Stored rotation belongs to another project.", 409);
    }
    if (!existing.new_credential || String(existing.new_key_id || "") !== String(existing.new_credential.key_id || "")) {
      throw createLifecycleError("agent_auth_rotation_state_invalid", "Stored rotation state is incomplete.", 409);
    }
    return existing;
  }
  return createInitialRotationState(projectState, currentCredential);
}

async function registerNewAgentKey(projectState, baseUrl, signingCredential, state) {
  const body = JSON.stringify({
    credential: state.new_credential
  });
  return (await fetchJsonWithSignedAuth(baseUrl + "/agent/auth/rotate", signingCredential, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body)
    },
    body
  })).json;
}

async function revokeAgentKey(projectState, baseUrl, signingCredential, keyId) {
  const body = JSON.stringify({
    key_id: keyId,
    confirm_revoke: true
  });
  return (await fetchJsonWithSignedAuth(baseUrl + "/agent/auth/revoke", signingCredential, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body)
    },
    body
  })).json;
}

async function signedHealth(baseUrl, credential) {
  return (await fetchJsonWithSignedAuth(baseUrl + "/agent/health", credential)).json;
}

async function signedHealthFailureCode(baseUrl, credential) {
  try {
    await signedHealth(baseUrl, credential);
    return null;
  } catch (error) {
    return error && error.responseJson && error.responseJson.code || error.code || "signed_request_failed";
  }
}

async function rotateAgentAuth(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  projectState.projectsRoot = projectsRoot;
  const baseUrl = restBase(projectState);
  const currentCredential = requireAgentSigningCredential(projectState);
  let state = readOrCreateRotationState(projectState, currentCredential);
  let statePath = writeRotationState(projectState, state).path;
  const previousCredential = state.old_credential && state.old_credential.key_id
    ? state.old_credential
    : currentCredential;
  let rotationResponse = null;
  let newHealth = null;
  let oldFailureCode = null;

  try {
    if (!["new_key_registered", "new_key_verified", "local_promoted", "old_key_revoked", "completed"].includes(state.stage)) {
      state = writeRotationState(projectState, Object.assign({}, state, {
        status: "preparing",
        stage: "preparing",
        error: null
      })).state;
      rotationResponse = await registerNewAgentKey(projectState, baseUrl, previousCredential, state);
      state = writeRotationState(projectState, Object.assign({}, state, {
        status: "new_key_registered",
        stage: "new_key_registered"
      })).state;
    }

    if (!["new_key_verified", "local_promoted", "old_key_revoked", "completed"].includes(state.stage)) {
      newHealth = await signedHealth(baseUrl, state.new_credential);
      state = writeRotationState(projectState, Object.assign({}, state, {
        status: "new_key_verified",
        stage: "new_key_verified"
      })).state;
    }

    if (!["local_promoted", "old_key_revoked", "completed"].includes(state.stage)) {
      writeAgentSigningCredential(projectState, state.new_credential);
      state = writeRotationState(projectState, Object.assign({}, state, {
        status: "local_promoted",
        stage: "local_promoted"
      })).state;
    }

    if (!["old_key_revoked", "completed"].includes(state.stage)) {
      const activeCredential = readAgentSigningCredential(projectState);
      let revokeResponse = null;
      let revokeError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          revokeResponse = await revokeAgentKey(projectState, baseUrl, activeCredential, state.old_key_id);
          revokeError = null;
          break;
        } catch (error) {
          revokeError = error;
          const oldKeyStatus = await signedHealthFailureCode(baseUrl, previousCredential);
          if (oldKeyStatus === "signed_auth_key_revoked") {
            revokeResponse = {
              code: "agent_auth_revoke_completed",
              recovered_after_error: true
            };
            revokeError = null;
            break;
          }
          if (!isRetryableAgentError(error) || attempt >= 1) {
            throw error;
          }
          await delay(250);
        }
      }
      if (revokeError) {
        throw revokeError;
      }
      state = writeRotationState(projectState, Object.assign({}, state, {
        status: "old_key_revoked",
        stage: "old_key_revoked",
        revoke_code: revokeResponse.code || null
      })).state;
    }

    const activeCredential = readAgentSigningCredential(projectState);
    oldFailureCode = await signedHealthFailureCode(baseUrl, previousCredential);
    newHealth = await signedHealth(baseUrl, activeCredential);
    const completed = {
      schema: ROTATION_SCHEMA,
      version: ROTATION_VERSION,
      rotation_id: state.rotation_id,
      project_slug: projectState.project.slug,
      status: "completed",
      stage: "completed",
      old_key_id: state.old_key_id,
      new_key_id: activeCredential.key_id,
      created_at: state.created_at,
      updated_at: timestampIso(),
      completed_at: timestampIso(),
      error: null
    };
    statePath = writeRotationState(projectState, completed).path;

    const proofPath = writeLifecycleProof(projectState, "rotate", {
      status: "ok",
      code: "agent_auth_rotation_completed",
      applies_changes: true,
      operation: "agent_auth_rotate",
      old_key_id: completed.old_key_id,
      new_key_id: completed.new_key_id,
      new_health_code: newHealth.code || null,
      old_key_rejection_code: oldFailureCode,
      rotation_state: sanitizedRotationState(completed),
      rotation_state_path: statePath,
      rotation_response_code: rotationResponse && rotationResponse.code || null,
      warnings: []
    });

    return {
      status: "ok",
      code: "agent_auth_rotation_completed",
      project: projectState.project,
      oldKeyId: completed.old_key_id,
      newKeyId: completed.new_key_id,
      rotationState: sanitizedRotationState(completed),
      rotationStatePath: statePath,
      proofPath,
      oldKeyRejectionCode: oldFailureCode,
      health: newHealth
    };
  } catch (error) {
    writeRotationState(projectState, Object.assign({}, state, {
      status: "failed_recoverable",
      error: sanitizeResponseError(error)
    }));
    throw error;
  }
}

async function revokeAgentAuth(options) {
  if (options.confirmRevoke !== true) {
    throw createLifecycleError("agent_auth_revoke_confirmation_required", "Credential revoke requires explicit confirmation.", 400);
  }

  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const projectState = readProjectBySlug(options.slug, projectsRoot);
  projectState.projectsRoot = projectsRoot;
  const baseUrl = restBase(projectState);
  const currentCredential = requireAgentSigningCredential(projectState);
  const revokeResponse = await revokeAgentKey(projectState, baseUrl, currentCredential, currentCredential.key_id);
  const revokedAt = revokeResponse && revokeResponse.credential && revokeResponse.credential.revoked_at || timestampIso();
  const local = markAgentSigningCredentialRevoked(projectState, {
    keyId: currentCredential.key_id,
    revokedAt
  });
  const rejectionCode = await signedHealthFailureCode(baseUrl, currentCredential);
  const proofPath = writeLifecycleProof(projectState, "revoke", {
    status: "ok",
    code: "agent_auth_revoke_completed",
    applies_changes: true,
    operation: "agent_auth_revoke",
    key_id: currentCredential.key_id,
    local_credential: local.sanitized,
    agent_response_code: revokeResponse && revokeResponse.code || null,
    revoked_key_rejection_code: rejectionCode,
    warnings: []
  });

  return {
    status: "ok",
    code: "agent_auth_revoke_completed",
    project: projectState.project,
    keyId: currentCredential.key_id,
    revokedAt,
    proofPath,
    revokedKeyRejectionCode: rejectionCode,
    localCredential: local.sanitized,
    repairRequired: true
  };
}

module.exports = {
  rotateAgentAuth,
  revokeAgentAuth,
  sanitizedRotationState
};
