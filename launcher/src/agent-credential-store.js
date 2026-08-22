"use strict";

const crypto = require("node:crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("node:child_process");
const {
  CAPABILITIES,
  SIGNED_AUTH_VERSION,
  createSigningCredential,
  redactSigningCredential
} = require("./agent-signed-auth");
const {
  assertSafeRuntimePath,
  ensureDirectory,
  resolveProjectsRoot
} = require("./project-store");

const AGENT_AUTH_SECRET_RELATIVE_PATH = path.join("secrets", "agent-auth.json");
const AGENT_AUTH_ROTATION_RELATIVE_PATH = path.join("secrets", "agent-auth-rotation.json");
const WINDOWS_SYSTEM_SID = "S-1-5-18";
const WINDOWS_ADMINISTRATORS_SID = "S-1-5-32-544";
const WINDOWS_CANONICAL_DACL_FLAGS = "PAI";
const WINDOWS_SDDL_SID_ALIASES = Object.freeze({
  BA: WINDOWS_ADMINISTRATORS_SID,
  SY: WINDOWS_SYSTEM_SID
});

function timestampIso() {
  return new Date().toISOString();
}

function createAgentCredentialError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function agentAuthSecretPath(projectState) {
  const projectsRoot = projectState.projectsRoot
    ? resolveProjectsRoot(projectState.projectsRoot)
    : path.dirname(path.resolve(projectState.runtimePath));
  const safeRuntimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  return path.join(safeRuntimePath, AGENT_AUTH_SECRET_RELATIVE_PATH);
}

function runWindowsAclCommand(executable, args, options) {
  const runner = options && typeof options.runCommand === "function"
    ? options.runCommand
    : (command, commandArgs) => spawnSync(command, commandArgs, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000
    });
  let result;
  try {
    result = runner(executable, args);
  } catch (error) {
    throw createAgentCredentialError("agent_signed_acl_tool_unavailable", "Credential ACL tool is unavailable.");
  }

  if (!result || typeof result.status !== "number") {
    throw createAgentCredentialError("agent_signed_acl_tool_unavailable", "Credential ACL tool returned no status.");
  }

  if (result.status !== 0) {
    throw createAgentCredentialError("agent_signed_acl_apply_failed", "Credential ACL hardening failed.");
  }

  return {
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || "")
  };
}

function parseWhoamiCsvSid(output) {
  const line = String(output || "").split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean).pop() || "";
  const match = line.match(/^"([^"]*)","([^"]+)"$/);
  if (match) {
    return match[2];
  }
  const parts = line.split(",");
  return String(parts[parts.length - 1] || "").replace(/^"|"$/g, "").trim();
}

function normalizeWindowsSid(value) {
  const sid = String(value || "").trim().toUpperCase();
  if (!/^S-\d+-\d+(?:-\d+)+$/.test(sid)) {
    throw createAgentCredentialError("agent_signed_acl_verification_failed", "Credential ACL verification did not return valid data.");
  }
  return sid;
}

function resolveCurrentWindowsUserSid(options) {
  if (options && options.currentUserSid) {
    return normalizeWindowsSid(options.currentUserSid);
  }

  const result = runWindowsAclCommand("whoami.exe", ["/user", "/fo", "csv", "/nh"], options);
  const sid = parseWhoamiCsvSid(result.stdout);
  if (!/^S-\d+-\d+(?:-\d+)+$/i.test(sid)) {
    throw createAgentCredentialError("agent_signed_acl_tool_unavailable", "Unable to resolve current Windows user SID.");
  }
  return normalizeWindowsSid(sid);
}

function invalidWindowsAcl() {
  return createAgentCredentialError(
    "agent_signed_acl_verification_failed",
    "Credential ACL verification did not return valid data."
  );
}

function parseWindowsAclSddl(value, expectedDirectory) {
  let record = String(value || "").replace(/^\uFEFF/, "");
  if (record.endsWith("\r\n")) {
    record = record.slice(0, -2);
  } else if (record.endsWith("\n")) {
    record = record.slice(0, -1);
  }
  if (!record || /\r(?!\n)/.test(record)) {
    throw invalidWindowsAcl();
  }
  const lines = record.split(/\r\n|\n/);
  if (lines.length !== 2 || !lines[0] || lines[0].startsWith("D:") || !lines[1].startsWith("D:")) {
    throw invalidWindowsAcl();
  }

  const descriptor = lines[1];
  const prefix = "D:" + WINDOWS_CANONICAL_DACL_FLAGS;
  if (!descriptor.startsWith(prefix)) {
    throw invalidWindowsAcl();
  }
  const access = [];
  const expectedFlags = expectedDirectory ? "OICI" : "";
  let cursor = prefix.length;
  while (cursor < descriptor.length) {
    if (descriptor[cursor] !== "(") {
      throw invalidWindowsAcl();
    }
    const close = descriptor.indexOf(")", cursor + 1);
    if (close === -1 || descriptor.slice(cursor + 1, close).includes("(")) {
      throw invalidWindowsAcl();
    }
    const fields = descriptor.slice(cursor + 1, close).split(";");
    if (fields.length !== 6 ||
        fields[0] !== "A" ||
        fields[1] !== expectedFlags ||
        fields[2] !== "FA" ||
        fields[3] !== "" ||
        fields[4] !== "" ||
        fields[5] === "") {
      throw invalidWindowsAcl();
    }
    const sidToken = fields[5].toUpperCase();
    const canonicalSid = WINDOWS_SDDL_SID_ALIASES[sidToken] || normalizeWindowsSid(sidToken);
    access.push({
      sid: canonicalSid,
      rights: "FullControl",
      type: "Allow",
      inherited: false,
      inheritance_flags: expectedFlags
    });
    cursor = close + 1;
  }
  if (access.length === 0) {
    throw invalidWindowsAcl();
  }
  return {
    protected: true,
    dacl_flags: WINDOWS_CANONICAL_DACL_FLAGS,
    type: expectedDirectory ? "directory" : "file",
    access
  };
}

function readWindowsAclSummary(filePath, expectedDirectory, options) {
  const readFileSync = options && options.readFileSync ? options.readFileSync : fs.readFileSync;
  const unlinkSync = options && options.unlinkSync ? options.unlinkSync : fs.unlinkSync;
  const summaryPath = path.join(
    path.dirname(filePath),
    ".factory-acl-" + process.pid + "-" + crypto.randomBytes(8).toString("hex") + ".txt"
  );
  try {
    try {
      runWindowsAclCommand("icacls.exe", [filePath, "/save", summaryPath, "/c"], options);
    } catch (error) {
      throw invalidWindowsAcl();
    }
    let record;
    try {
      record = readFileSync(summaryPath).toString("utf16le");
    } catch (error) {
      throw invalidWindowsAcl();
    }
    return parseWindowsAclSddl(record, expectedDirectory);
  } finally {
    try {
      unlinkSync(summaryPath);
    } catch (error) {
      // A failed ACL read remains the actionable result.
    }
  }
}

function verifyWindowsCredentialAcl(filePath, currentUserSid, expectedDirectory, options) {
  const summary = readWindowsAclSummary(filePath, expectedDirectory, options);
  const entries = Array.isArray(summary && summary.access) ? summary.access : [];
  const allowedSids = new Set([
    normalizeWindowsSid(currentUserSid),
    WINDOWS_SYSTEM_SID,
    WINDOWS_ADMINISTRATORS_SID
  ]);
  const actualSids = new Set(entries.map((entry) => entry.sid));
  if (allowedSids.size !== 3 || entries.length !== 3 || actualSids.size !== 3) {
    throw createAgentCredentialError("agent_signed_acl_verification_failed", "Credential ACL contains an unexpected principal.");
  }
  for (const sid of actualSids) {
    if (!allowedSids.has(sid)) {
      throw createAgentCredentialError("agent_signed_acl_verification_failed", "Credential ACL contains an unexpected principal.");
    }
  }

  return summary;
}

function hardenWindowsCredentialPath(filePath, options) {
  const currentUserSid = resolveCurrentWindowsUserSid(options);
  const statSync = options && options.statSync ? options.statSync : fs.statSync;
  const isDirectory = statSync(filePath).isDirectory();
  const fullControl = isDirectory ? ":(OI)(CI)F" : ":F";
  runWindowsAclCommand("icacls.exe", [filePath, "/reset"], options);
  runWindowsAclCommand("icacls.exe", [filePath, "/inheritance:r"], options);
  runWindowsAclCommand("icacls.exe", [
    filePath,
    "/grant:r",
    "*" + currentUserSid + fullControl,
    "*" + WINDOWS_SYSTEM_SID + fullControl,
    "*" + WINDOWS_ADMINISTRATORS_SID + fullControl
  ], options);
  return verifyWindowsCredentialAcl(filePath, currentUserSid, isDirectory, options);
}

function verifyPosixCredentialPermissions(filePath, expectedDirectory, options) {
  const statSync = options && options.statSync ? options.statSync : fs.statSync;
  let stats;
  try {
    stats = statSync(filePath);
  } catch (error) {
    throw createAgentCredentialError(
      "agent_signed_posix_permissions_verification_failed",
      "Credential permissions could not be verified."
    );
  }
  const actualMode = Number(stats.mode) & 0o777;
  const expectedMode = expectedDirectory ? 0o700 : 0o600;
  if (Boolean(stats.isDirectory()) !== Boolean(expectedDirectory) || actualMode !== expectedMode) {
    throw createAgentCredentialError(
      "agent_signed_posix_permissions_verification_failed",
      "Credential permissions are not owner-only."
    );
  }
  return { mode: actualMode, type: expectedDirectory ? "directory" : "file" };
}

function hardenCredentialPath(filePath, options) {
  const platform = options && options.platform ? options.platform : process.platform;
  if (platform === "win32") {
    return hardenWindowsCredentialPath(filePath, options);
  }

  try {
    const statSync = options && options.statSync ? options.statSync : fs.statSync;
    const chmodSync = options && options.chmodSync ? options.chmodSync : fs.chmodSync;
    const isDirectory = statSync(filePath).isDirectory();
    chmodSync(filePath, isDirectory ? 0o700 : 0o600);
    return verifyPosixCredentialPermissions(filePath, isDirectory, options);
  } catch (error) {
    if (error && error.code === "agent_signed_posix_permissions_verification_failed") {
      throw error;
    }
    throw createAgentCredentialError("agent_signed_acl_apply_failed", "Credential permissions could not be restricted.");
  }
}

function hardenAgentSecretContainer(filePath, options) {
  hardenCredentialPath(path.dirname(filePath), options);
}

function atomicWriteJson(filePath, value, options) {
  ensureDirectory(path.dirname(filePath));
  hardenAgentSecretContainer(filePath, options);
  const temporaryPath = filePath + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  hardenCredentialPath(temporaryPath, options);
  fs.renameSync(temporaryPath, filePath);
  hardenCredentialPath(filePath, options);
}

function validateAgentSigningCredential(record, expectedSlug, options) {
  const safeOptions = options || {};
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    const error = new Error("Agent signing credential is malformed.");
    error.code = "agent_signed_credential_malformed";
    throw error;
  }

  if (record.contract_version !== SIGNED_AUTH_VERSION || record.schema !== "factory_agent_signing_credential") {
    const error = new Error("Agent signing credential contract is unsupported.");
    error.code = "agent_signed_credential_unsupported";
    throw error;
  }

  if (!record.key_id || typeof record.key_id !== "string") {
    const error = new Error("Agent signing credential is missing key_id.");
    error.code = "agent_signed_credential_malformed";
    throw error;
  }

  if (!record.signing_secret || typeof record.signing_secret !== "string") {
    const error = new Error("Agent signing credential is missing signing_secret.");
    error.code = "agent_signed_credential_malformed";
    throw error;
  }

  let secretBytes = Buffer.from(String(record.signing_secret), "utf8");
  if (/^[A-Za-z0-9_-]+$/.test(record.signing_secret)) {
    try {
      const decoded = Buffer.from(record.signing_secret, "base64url");
      if (decoded.length >= 32) {
        secretBytes = decoded;
      }
    } catch (error) {
      secretBytes = Buffer.from(record.signing_secret, "utf8");
    }
  }
  if (secretBytes.length < 32) {
    const error = new Error("Agent signing credential secret is too short.");
    error.code = "agent_signed_credential_malformed";
    throw error;
  }

  if (record.project_slug !== expectedSlug) {
    const error = new Error("Agent signing credential belongs to a different project.");
    error.code = "agent_signed_credential_project_mismatch";
    throw error;
  }

  if (record.status !== "active" && safeOptions.allowInactive !== true) {
    const error = new Error("Agent signing credential is not active.");
    error.code = record.status === "revoked" ? "agent_signed_credential_revoked" : "agent_signed_credential_disabled";
    throw error;
  }

  if (!Array.isArray(record.capabilities) || !record.capabilities.every((capability) => CAPABILITIES.includes(capability))) {
    const error = new Error("Agent signing credential capabilities are invalid.");
    error.code = "agent_signed_credential_malformed";
    throw error;
  }

  return record;
}

function readAgentSigningCredential(projectState, options) {
  const filePath = agentAuthSecretPath(projectState);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    const wrapped = new Error("Agent signing credential file is not valid JSON.");
    wrapped.code = "agent_signed_credential_malformed";
    throw wrapped;
  }

  const credential = validateAgentSigningCredential(parsed, projectState.project.slug, {
    allowInactive: options && options.allowInactive === true
  });
  hardenAgentSecretContainer(filePath, options && options.acl);
  hardenCredentialPath(filePath, options && options.acl);
  return credential;
}

function requireAgentSigningCredential(projectState) {
  const credential = readAgentSigningCredential(projectState);
  if (!credential) {
    const error = new Error("Agent signed authentication credential is missing. Run Agent install/repair to bootstrap signed auth.");
    error.code = "agent_signed_credential_missing";
    throw error;
  }
  return credential;
}

function ensureAgentSigningCredential(projectState, options) {
  const safeOptions = options || {};
  const aclOptions = safeOptions.acl || null;
  let existing = null;
  try {
    existing = readAgentSigningCredential(projectState, { acl: aclOptions });
  } catch (error) {
    if (!(safeOptions.replaceRevoked === true && error && error.code === "agent_signed_credential_revoked")) {
      throw error;
    }
  }
  if (existing) {
    const desiredCapabilities = Array.isArray(safeOptions.capabilities) ? safeOptions.capabilities.slice() : CAPABILITIES;
    const currentCapabilities = Array.isArray(existing.capabilities) ? existing.capabilities.slice() : [];
    const sameCapabilities = desiredCapabilities.length === currentCapabilities.length
      && desiredCapabilities.every((capability, index) => capability === currentCapabilities[index]);
    if (safeOptions.upgradeCapabilities === true && !sameCapabilities) {
      const upgraded = Object.assign({}, existing, {
        capabilities: desiredCapabilities
      });
      const filePath = agentAuthSecretPath(projectState);
      atomicWriteJson(filePath, upgraded, aclOptions);
      return {
        credential: upgraded,
        created: false,
        upgraded: true,
        path: filePath,
        sanitized: redactAgentSigningCredential(upgraded)
      };
    }
    return {
      credential: existing,
      created: false,
      upgraded: false,
      path: agentAuthSecretPath(projectState),
      sanitized: redactAgentSigningCredential(existing)
    };
  }

  const credential = createSigningCredential({
    keyId: safeOptions.keyId,
    projectSlug: projectState.project.slug,
    createdAt: safeOptions.createdAt || timestampIso(),
    capabilities: safeOptions.capabilities || CAPABILITIES
  });
  const filePath = agentAuthSecretPath(projectState);
  atomicWriteJson(filePath, credential, aclOptions);

  return {
    credential,
    created: true,
    upgraded: false,
    path: filePath,
    sanitized: redactAgentSigningCredential(credential)
  };
}

function writeAgentSigningCredential(projectState, credential, options) {
  const filePath = agentAuthSecretPath(projectState);
  const validated = validateAgentSigningCredential(credential, projectState.project.slug, {
    allowInactive: options && options.allowInactive === true
  });
  atomicWriteJson(filePath, validated, options && options.acl);
  return {
    credential: validated,
    path: filePath,
    sanitized: redactAgentSigningCredential(validated)
  };
}

function markAgentSigningCredentialRevoked(projectState, options) {
  const filePath = agentAuthSecretPath(projectState);
  const credential = readAgentSigningCredential(projectState, {
    allowInactive: true,
    acl: options && options.acl
  });
  if (!credential) {
    const error = new Error("Agent signed authentication credential is missing.");
    error.code = "agent_signed_credential_missing";
    throw error;
  }
  const expectedKeyId = options && options.keyId ? String(options.keyId) : credential.key_id;
  if (String(credential.key_id || "") !== expectedKeyId) {
    const error = new Error("Agent signing credential key mismatch.");
    error.code = "agent_signed_credential_key_mismatch";
    throw error;
  }
  const revoked = Object.assign({}, credential, {
    status: "revoked",
    revoked_at: options && options.revokedAt || timestampIso()
  });
  atomicWriteJson(filePath, revoked, options && options.acl);
  return {
    credential: revoked,
    path: filePath,
    sanitized: redactAgentSigningCredential(revoked)
  };
}

function agentAuthRotationStatePath(projectState) {
  const projectsRoot = projectState.projectsRoot
    ? resolveProjectsRoot(projectState.projectsRoot)
    : path.dirname(path.resolve(projectState.runtimePath));
  const safeRuntimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  return path.join(safeRuntimePath, AGENT_AUTH_ROTATION_RELATIVE_PATH);
}

function readAgentAuthRotationState(projectState, options) {
  const filePath = agentAuthRotationStatePath(projectState);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  hardenAgentSecretContainer(filePath, options && options.acl);
  hardenCredentialPath(filePath, options && options.acl);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

function writeAgentAuthRotationState(projectState, state, options) {
  const filePath = agentAuthRotationStatePath(projectState);
  atomicWriteJson(filePath, state, options && options.acl);
  return filePath;
}

function redactAgentSigningCredential(credential) {
  const redacted = redactSigningCredential(credential || {});
  return {
    schema: redacted.schema || "factory_agent_signing_credential",
    version: redacted.version || 1,
    contract_version: redacted.contract_version || SIGNED_AUTH_VERSION,
    key_id: redacted.key_id || null,
    status: redacted.status || null,
    created_at: redacted.created_at || null,
    revoked_at: redacted.revoked_at || null,
    capabilities: Array.isArray(redacted.capabilities) ? redacted.capabilities.slice() : [],
    project_slug: redacted.project_slug || null,
    signing_secret: "[redacted]"
  };
}

module.exports = {
  AGENT_AUTH_SECRET_RELATIVE_PATH,
  AGENT_AUTH_ROTATION_RELATIVE_PATH,
  agentAuthSecretPath,
  agentAuthRotationStatePath,
  hardenCredentialPath,
  verifyPosixCredentialPermissions,
  parseWhoamiCsvSid,
  resolveCurrentWindowsUserSid,
  ensureAgentSigningCredential,
  markAgentSigningCredentialRevoked,
  readAgentAuthRotationState,
  readAgentSigningCredential,
  redactAgentSigningCredential,
  requireAgentSigningCredential,
  validateAgentSigningCredential,
  writeAgentAuthRotationState,
  writeAgentSigningCredential
};
