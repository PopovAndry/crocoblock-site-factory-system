"use strict";

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
const WINDOWS_USERS_SID = "S-1-5-32-545";
const WINDOWS_AUTHENTICATED_USERS_SID = "S-1-5-11";
const WINDOWS_EVERYONE_SID = "S-1-1-0";

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

function resolveCurrentWindowsUserSid(options) {
  if (options && options.currentUserSid) {
    return String(options.currentUserSid);
  }

  const result = runWindowsAclCommand("whoami.exe", ["/user", "/fo", "csv", "/nh"], options);
  const sid = parseWhoamiCsvSid(result.stdout);
  if (!/^S-\d-\d+-.+/.test(sid)) {
    throw createAgentCredentialError("agent_signed_acl_tool_unavailable", "Unable to resolve current Windows user SID.");
  }
  return sid;
}

function readWindowsAclSummary(filePath, options) {
  const script = [
    "& {",
    "param([string]$target)",
    "$ErrorActionPreference = 'Stop';",
    "$acl = Get-Acl -LiteralPath $target;",
    "$access = @($acl.Access | ForEach-Object {",
    "  $sid = $null;",
    "  try { $sid = $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $sid = $_.IdentityReference.Value }",
    "  [pscustomobject]@{ sid = $sid; rights = $_.FileSystemRights.ToString(); type = $_.AccessControlType.ToString(); inherited = $_.IsInherited }",
    "});",
    "$ownerSid = $acl.Owner;",
    "try { $ownerSid = (New-Object System.Security.Principal.NTAccount($acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value } catch {}",
    "[pscustomobject]@{ protected = $acl.AreAccessRulesProtected; owner_sid = $ownerSid; access = $access } | ConvertTo-Json -Depth 5 -Compress",
    "}"
  ].join(" ");
  const result = runWindowsAclCommand("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
    filePath
  ], options);

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw createAgentCredentialError("agent_signed_acl_verification_failed", "Credential ACL verification did not return valid data.");
  }
}

function hasFullControlAllow(summary, sid) {
  const entries = Array.isArray(summary && summary.access) ? summary.access : [];
  return entries.some((entry) => {
    return String(entry.sid || "") === sid
      && String(entry.type || "").toLowerCase() === "allow"
      && String(entry.rights || "").includes("FullControl");
  });
}

function hasAnyAllow(summary, sid) {
  const entries = Array.isArray(summary && summary.access) ? summary.access : [];
  return entries.some((entry) => {
    return String(entry.sid || "") === sid && String(entry.type || "").toLowerCase() === "allow";
  });
}

function verifyWindowsCredentialAcl(filePath, currentUserSid, options) {
  const summary = readWindowsAclSummary(filePath, options);
  const entries = Array.isArray(summary && summary.access) ? summary.access : [];
  const inherited = entries.some((entry) => entry.inherited === true);
  const broadSids = [WINDOWS_USERS_SID, WINDOWS_AUTHENTICATED_USERS_SID, WINDOWS_EVERYONE_SID];

  if (!summary || summary.protected !== true || inherited) {
    throw createAgentCredentialError("agent_signed_acl_verification_failed", "Credential ACL inheritance remains enabled.");
  }

  if (!hasFullControlAllow(summary, currentUserSid) ||
      !hasFullControlAllow(summary, WINDOWS_SYSTEM_SID) ||
      !hasFullControlAllow(summary, WINDOWS_ADMINISTRATORS_SID)) {
    throw createAgentCredentialError("agent_signed_acl_verification_failed", "Credential ACL required principals are missing.");
  }

  if (broadSids.some((sid) => hasAnyAllow(summary, sid))) {
    throw createAgentCredentialError("agent_signed_acl_verification_failed", "Credential ACL still grants broad local access.");
  }

  return summary;
}

function hardenWindowsCredentialPath(filePath, options) {
  const currentUserSid = resolveCurrentWindowsUserSid(options);
  runWindowsAclCommand("icacls.exe", [filePath, "/inheritance:r"], options);
  runWindowsAclCommand("icacls.exe", [
    filePath,
    "/grant:r",
    "*" + currentUserSid + ":F",
    "*" + WINDOWS_SYSTEM_SID + ":F",
    "*" + WINDOWS_ADMINISTRATORS_SID + ":F"
  ], options);
  try {
    runWindowsAclCommand("icacls.exe", [
      filePath,
      "/remove:g",
      "*" + WINDOWS_USERS_SID,
      "*" + WINDOWS_AUTHENTICATED_USERS_SID,
      "*" + WINDOWS_EVERYONE_SID
    ], options);
  } catch (error) {
    // Some Windows builds return non-zero when an ACE is already absent. The
    // verification step below remains the fail-closed source of truth.
  }
  return verifyWindowsCredentialAcl(filePath, currentUserSid, options);
}

function hardenCredentialPath(filePath, options) {
  const platform = options && options.platform ? options.platform : process.platform;
  if (platform === "win32") {
    return hardenWindowsCredentialPath(filePath, options);
  }

  try {
    const statSync = options && options.statSync ? options.statSync : fs.statSync;
    const chmodSync = options && options.chmodSync ? options.chmodSync : fs.chmodSync;
    chmodSync(filePath, statSync(filePath).isDirectory() ? 0o700 : 0o600);
  } catch (error) {
    throw createAgentCredentialError("agent_signed_acl_apply_failed", "Credential permissions could not be restricted.");
  }
  return null;
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
