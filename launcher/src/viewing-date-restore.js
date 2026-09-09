"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { readProjectBySlug, resolveProjectsRoot, validateExplicitSlug } = require("./project-store");
const { listOperations } = require("./project-operation-store");
const { deriveProjectBinding } = require("./structural-snapshot-store");
const { createRestorePlan } = require("./structural-restore-plan");
const { executeManagedWebsiteRestore, extractTarArchive } = require("./structural-restore-execution");
const { prepareViewingDateAuthority, assertAfter, assertBaseline, nativeRead } = require("./viewing-date-apply");
const { runCommand } = require("./runtime-tools");
const { requireAgentSigningCredential } = require("./agent-credential-store");

const PROJECT_SLUG = "csf-st-viewing-before-v1";
const PLAN_ID = "viewing-date-plan-a3b7868a-4c58-4ec1-93ea-28dd8c9003ba";
const SNAPSHOT_ID = "snapshot-2026-09-04t07-33-05-548z-cc33fa13cbce";
const APPLY_OPERATION_ID = "op-2026-09-06T13-49-59-817Z-1a5aa2";
const RESTORE_HANDLE = "viewing-date-restore-st1-v1";
const AFTER_FORM_SHA256 = "34384225dd3c4cdfaa45c8916d4358533d526127c34e64e621512b9cf76dcb78";
const BASELINE_FORM_SHA256 = "d29de1ec4d8a16db103b005f31e0be293a556c80eed6fb55f1b420cb239527f4";
const AFTER_RECORDS = Object.freeze({ count: 97, fingerprint: "3b7e29d6538897677b46e9030583a6384167d34e257b5cfc3a8306dc4eae2355" });
const BASELINE_RECORDS = Object.freeze({ count: 95, fingerprint: "eb693ce888d1147c575314e8102c37348bc8848f7d4103fec29e80b4a50cfb9b" });
const RESTORE_IDENTITY_SCHEMA = "csf_viewing_date_restore_identity";
const RESTORE_IDENTITY_VERSION = 1;
const AGENT_CREDENTIAL_OPTION = "factory_agent_signed_auth_credentials";
const AGENT_CREDENTIAL_FIELDS = Object.freeze(["schema", "version", "contract_version", "key_id", "status", "created_at", "revoked_at", "capabilities", "project_slug"]);
const AGENT_REPLAY_PREFIX = "factory_agent_replay_";
const AGENT_RATE_PREFIX = "factory_agent_rate_";

function fail(code, message, statusCode) {
  const error = new Error(message || "Viewing-date Restore cannot proceed safely.");
  error.code = code;
  error.statusCode = statusCode || 409;
  return error;
}

function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
}

function equal(left, right) {
  return stable(left) === stable(right);
}

function fileIdentity(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw fail("viewing_date_restore_env_drift", "Runtime configuration could not be verified safely.");
  return { dev: stat.dev, ino: stat.ino, size: stat.size, sha256: digestFile(filePath) };
}

function assertStableEnv(left, right) {
  if (!equal(left, right)) throw fail("viewing_date_restore_env_drift", "Runtime configuration changed during Restore.");
}

function assertApplicationPasswordIdentity(value) {
  if (!value || typeof value !== "object" || !Number.isInteger(value.user_id) || value.user_id < 1 || !Number.isInteger(value.count) || value.count < 0
    || !Array.isArray(value.entries) || value.entries.length !== value.count || !/^[a-f0-9]{64}$/.test(value.structure_hmac || "")) {
    throw fail("viewing_date_restore_application_password_drift", "Application Password state could not be verified safely.");
  }
  const ids = new Set();
  for (const entry of value.entries) {
    if (!entry || typeof entry !== "object" || typeof entry.uuid !== "string" || !entry.uuid || ids.has(entry.uuid)
      || Object.keys(entry).sort().join(",") !== "app_id,created,last_ip,last_used,name,uuid"
      || typeof entry.app_id !== "string" || typeof entry.name !== "string" || !Number.isInteger(entry.created)
      || !(entry.last_used === null || Number.isInteger(entry.last_used)) || !(entry.last_ip === null || typeof entry.last_ip === "string")) {
      throw fail("viewing_date_restore_application_password_drift", "Application Password state could not be verified safely.");
    }
    ids.add(entry.uuid);
  }
  return value;
}

function assertUnchangedApplicationPasswordIdentity(before, after) {
  assertApplicationPasswordIdentity(before);
  assertApplicationPasswordIdentity(after);
  if (!equal(before, after)) throw fail("viewing_date_restore_application_password_drift", "Application Password state changed during Agent verification.");
  return after;
}

function credentialSecretBytes(secret) {
  const text = String(secret || "");
  if (/^[A-Za-z0-9_-]+$/.test(text)) {
    try {
      const decoded = Buffer.from(text, "base64url");
      if (decoded.length >= 32) return decoded;
    } catch (_) { /* fall through to UTF-8 */ }
  }
  return Buffer.from(text, "utf8");
}

function verifyCredentialChallenge(expectedSecret, nonce, response) {
  if (!Buffer.isBuffer(nonce) || nonce.length < 32 || !/^[a-f0-9]{64}$/.test(String(response || ""))) throw fail("viewing_date_restore_agent_secret_mismatch", "Factory Agent credential could not be verified safely.");
  const expected = crypto.createHmac("sha256", credentialSecretBytes(expectedSecret)).update(nonce.toString("hex"), "utf8").digest();
  const actual = Buffer.from(response, "hex");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw fail("viewing_date_restore_agent_secret_mismatch", "Factory Agent credential could not be verified safely.");
}

function assertAgentCredentialObservation(value, projectSlug) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 2 || value.option_name !== AGENT_CREDENTIAL_OPTION || !Array.isArray(value.credentials) || value.credentials.length < 1) {
    throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent credentials could not be verified safely.");
  }
  for (const credential of value.credentials) {
    if (!credential || typeof credential !== "object" || Array.isArray(credential)
      || Object.keys(credential).sort().join(",") !== AGENT_CREDENTIAL_FIELDS.slice().sort().join(",")
      || credential.project_slug !== projectSlug || !Array.isArray(credential.capabilities)
      || !["schema", "contract_version", "key_id", "status", "created_at"].every((key) => typeof credential[key] === "string") || !Number.isInteger(credential.version)
      || !(credential.revoked_at === null || typeof credential.revoked_at === "string")
      || credential.capabilities.some((entry) => typeof entry !== "string")) {
      throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent credentials could not be verified safely.");
    }
  }
  return value;
}

async function readAgentCredentialObservation(projectState, options) {
  if (options && typeof options.readAgentCredentials === "function") {
    return assertAgentCredentialObservation(await options.readAgentCredentials(projectState), projectState.project.slug);
  }
  const script = "$v=get_option('factory_agent_signed_auth_credentials',null);if(!is_array($v)){echo '{}';return;}$f=['contract_version','key_id','status','created_at','revoked_at','capabilities','project_slug'];$c=[];foreach($v as $r){if(!is_array($r)){echo '{}';return;}$x=[];foreach($f as $k){if(!array_key_exists($k,$r)){echo '{}';return;}$x[$k]=$r[$k];}$c[]=$x;}echo wp_json_encode(['option_name'=>'factory_agent_signed_auth_credentials','credentials'=>$c]);";
  const result = await runCommand("docker", ["compose", "run", "--rm", "-T", "--entrypoint", "php", "wpcli", "/usr/local/bin/wp", "eval", script, "--path=/var/www/html", "--allow-root"], {
    cwd: projectState.runtimePath,
    logPath: path.join(projectState.runtimePath, "logs", "viewing-date-restore-agent-observation.log"),
    timeoutMs: 120000
  });
  try {
    return assertAgentCredentialObservation(JSON.parse(String(result.stdout || "").trim()), projectState.project.slug);
  } catch (_) { throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent credentials could not be verified safely."); }
}

function replayOptionName(keyId, requestId) {
  return AGENT_REPLAY_PREFIX + crypto.createHash("sha256").update(String(keyId) + "\n" + String(requestId), "utf8").digest("hex");
}

function parseCanonicalRateCounter(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent rate guard could not be verified safely.");
  const parsed = BigInt(value);
  if (parsed < 1n || parsed > 600n) throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent rate guard could not be verified safely.");
  return parsed;
}

function assertAgentRepairSurface(value, projectSlug) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== "credential,other_factory_options,rates,replays") {
    throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent repair surface could not be verified safely.");
  }
  assertAgentCredentialObservation(value.credential, projectSlug);
  if (!Array.isArray(value.replays) || !Array.isArray(value.rates) || !Array.isArray(value.other_factory_options)) {
    throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent repair surface could not be verified safely.");
  }
  const validateEntries = (entries, replay) => {
    const names = new Set();
    let previousName = null;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || names.has(entry.name)
        || typeof entry.name !== "string" || typeof entry.autoload !== "string") throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent repair surface could not be verified safely.");
      names.add(entry.name);
      if (previousName !== null && previousName >= entry.name) throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent repair surface could not be verified safely.");
      previousName = entry.name;
      if (replay) {
        if (!new RegExp("^" + AGENT_REPLAY_PREFIX + "[a-f0-9]{64}$").test(entry.name) || !/^[0-9]+$/.test(String(entry.value))) throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent replay guard could not be verified safely.");
      } else if (entry.name === AGENT_CREDENTIAL_OPTION || entry.name.startsWith(AGENT_REPLAY_PREFIX) || !/^[a-f0-9]{64}$/.test(String(entry.value_sha256 || ""))) {
        throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent repair surface could not be verified safely.");
      }
    }
  };
  validateEntries(value.replays, true);
  let previousRateName = null;
  for (const entry of value.rates) {
    if (!entry || !new RegExp("^" + AGENT_RATE_PREFIX + "[a-f0-9]{64}$").test(entry.name || "") || !["no", "off"].includes(entry.autoload)) throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent rate guard could not be verified safely.");
    parseCanonicalRateCounter(entry.value);
    if (previousRateName !== null && previousRateName >= entry.name) throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent rate guard could not be verified safely.");
    previousRateName = entry.name;
  }
  validateEntries(value.other_factory_options, false);
  return value;
}

function assertAgentRepairDelta(before, after, expected, projectSlug) {
  assertAgentRepairSurface(before, projectSlug);
  assertAgentRepairSurface(after, projectSlug);
  if (!expected || expected.method !== "GET" || expected.route !== "/factory/v1/agent/health"
    || expected.project_slug !== projectSlug || typeof expected.key_id !== "string" || typeof expected.request_id !== "string"
    || !Number.isInteger(expected.expires_at)) throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent replay guard could not be verified safely.");
  const expectedName = replayOptionName(expected.key_id, expected.request_id);
  const pre = new Map(before.replays.map((entry) => [entry.name, entry]));
  const post = new Map(after.replays.map((entry) => [entry.name, entry]));
  if (pre.has(expectedName) || post.size !== pre.size + 1 || !post.has(expectedName)
    || String(post.get(expectedName).value) !== String(expected.expires_at) || !["no", "off"].includes(post.get(expectedName).autoload)
    || !equal(before.credential, after.credential) || !equal(before.other_factory_options, after.other_factory_options)) {
    throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent repair surface changed unexpectedly.");
  }
  for (const [name, entry] of pre) {
    if (!post.has(name) || !equal(entry, post.get(name))) throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent replay guards changed unexpectedly.");
  }
  const beforeRates = new Map(before.rates.map((entry) => [entry.name, entry]));
  const afterRates = new Map(after.rates.map((entry) => [entry.name, entry]));
  const changedRates = Array.from(afterRates).filter(([name, entry]) => !beforeRates.has(name) || !equal(beforeRates.get(name), entry));
  if (changedRates.length !== 1 || afterRates.size < beforeRates.size) throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent rate guard changed unexpectedly.");
  for (const [name, entry] of beforeRates) if (!afterRates.has(name) || (!changedRates.some(([changed]) => changed === name) && !equal(entry, afterRates.get(name)))) throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent rate guards changed unexpectedly.");
  const [rateName, rate] = changedRates[0];
  const priorRate = beforeRates.get(rateName);
  if (!new RegExp("^" + AGENT_RATE_PREFIX + "[a-f0-9]{64}$").test(rateName) || !["no", "off"].includes(rate.autoload)) throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent rate guard changed unexpectedly.");
  const rateValue = parseCanonicalRateCounter(rate.value);
  const priorRateValue = priorRate ? parseCanonicalRateCounter(priorRate.value) : null;
  if ((priorRateValue && rateValue !== priorRateValue + 1n) || (!priorRateValue && rateValue !== 1n)) throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent rate guard changed unexpectedly.");
  return { runtime_authority_mode: "same_project_runtime_authority_v1", correlated_replay_guard: true, correlated_rate_guard: true };
}

async function readAgentRepairSurface(projectState, options) {
  if (options && typeof options.readAgentRepairSurface === "function") return assertAgentRepairSurface(await options.readAgentRepairSurface(projectState), projectState.project.slug);
  const script = "$c=get_option('factory_agent_signed_auth_credentials',null);if(!is_array($c)){echo '{}';return;}$f=['contract_version','key_id','status','created_at','revoked_at','capabilities','project_slug'];$m=[];foreach($c as $r){if(!is_array($r)){echo '{}';return;}$x=[];foreach($f as $k){if(!array_key_exists($k,$r)){echo '{}';return;}$x[$k]=$r[$k];}$m[]=$x;}global $wpdb;$rows=$wpdb->get_results(\"SELECT option_name,option_value,autoload FROM {$wpdb->options} WHERE option_name LIKE 'factory_agent_%'\",ARRAY_A);$re=[];$other=[];foreach($rows as $r){if($r['option_name']==='factory_agent_signed_auth_credentials'){continue;}if(strpos($r['option_name'],'factory_agent_replay_')===0){$re[]=['name'=>$r['option_name'],'value'=>(string)$r['option_value'],'autoload'=>(string)$r['autoload']];}else{$other[]=['name'=>$r['option_name'],'value_sha256'=>hash('sha256',(string)$r['option_value']),'autoload'=>(string)$r['autoload']];}}echo wp_json_encode(['credential'=>['option_name'=>'factory_agent_signed_auth_credentials','credentials'=>$m],'replays'=>$re,'other_factory_options'=>$other]);";
  const result = await runCommand("docker", ["compose", "run", "--rm", "-T", "--entrypoint", "php", "wpcli", "/usr/local/bin/wp", "eval", script, "--path=/var/www/html", "--allow-root"], { cwd: projectState.runtimePath, logPath: path.join(projectState.runtimePath, "logs", "viewing-date-restore-agent-surface.log"), timeoutMs: 120000 });
  try { return assertAgentRepairSurface(JSON.parse(String(result.stdout || "").trim()), projectState.project.slug); } catch (_) { throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent repair surface could not be verified safely."); }
}

function assertVerifyExistingObservation(observation, projectSlug) {
  if (!observation || typeof observation !== "object" || Array.isArray(observation) || Object.keys(observation).sort().join(",") !== "application_passwords,credential_hmac,surface") {
    throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent observation was incomplete.");
  }
  assertAgentRepairSurface(observation.surface, projectSlug);
  assertApplicationPasswordIdentity(observation.application_passwords);
  if (!Array.isArray(observation.credential_hmac) || observation.credential_hmac.length !== 1 || !observation.credential_hmac.every((value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value))) throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent observation was incomplete.");
  return observation;
}

async function readVerifyExistingSurface(projectState, options, nonce) {
  if (!Buffer.isBuffer(nonce) || nonce.length < 32) throw fail("viewing_date_restore_agent_secret_mismatch", "Factory Agent credential could not be verified safely.");
  if (options && typeof options.readVerifyExistingSurface === "function") return assertVerifyExistingObservation(await options.readVerifyExistingSurface(projectState, nonce), projectState.project.slug);
  const nonceHex = nonce.toString("hex");
  const helperPath = path.join(__dirname, "viewing-date-verify-existing-observer.php");
  const runtimeHelperPath = "/tmp/csf-viewing-date-verify-existing-observer.php";
  const commandRunner = options && typeof options.runVerifyExistingCommand === "function" ? options.runVerifyExistingCommand : runCommand;
  const result = await commandRunner("docker", ["compose", "run", "--rm", "-T", "-e", "CSF_VIEWING_DATE_OBSERVATION_NONCE=" + nonceHex, "-e", "CSF_VIEWING_DATE_ADMIN_LOGIN=" + String(projectState.env && projectState.env.WP_ADMIN_USER || ""), "-v", helperPath + ":" + runtimeHelperPath + ":ro", "wpcli", "/usr/local/bin/wp", "eval-file", runtimeHelperPath, "--path=/var/www/html", "--allow-root"], { cwd: projectState.runtimePath, logPath: path.join(projectState.runtimePath, "logs", "viewing-date-restore-verify-existing-read.log"), timeoutMs: 120000, sensitiveOutput: true, sensitiveCategory: "verify-existing-observer", outputLimitBytes: 131072 });
  if (Buffer.byteLength(result.stdout || "", "utf8") > 131072) throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent observation was incomplete.");
  try {
    const observation = JSON.parse(String(result.stdout || "").trim());
    return assertVerifyExistingObservation(observation, projectState.project.slug);
  } catch (error) {
    if (error && error.code) throw error;
    throw fail("viewing_date_restore_agent_allowlist_drift", "Factory Agent observation was incomplete.");
  }
}

function exactRecords(records, expected, code) {
  if (!records || records.count !== expected.count || records.fingerprint !== expected.fingerprint) {
    throw fail(code, "Request Viewing records no longer match the accepted state.");
  }
}

function findExactOperation(projectsRoot, slug, operationId) {
  return listOperations({ projectsRoot, slug, includeRaw: true })
    .find((entry) => entry.operation_id === operationId) || null;
}

function assertAcceptedApply(projectsRoot, slug) {
  const operation = findExactOperation(projectsRoot, slug, APPLY_OPERATION_ID);
  const raw = operation && operation.raw;
  if (!operation || operation.operation_type !== "viewing_date_apply" || operation.status !== "succeeded"
    || !raw || !raw.metadata || raw.metadata.plan_id !== PLAN_ID || !raw.result_summary
    || raw.result_summary.status !== "applied" || raw.result_summary.mutation_performed !== true) {
    throw fail("viewing_date_restore_apply_missing", "Viewing-date Restore requires the accepted Apply operation.");
  }
}

function restoreIdentity(projectSlug) {
  return {
    schema: RESTORE_IDENTITY_SCHEMA,
    version: RESTORE_IDENTITY_VERSION,
    project_slug: projectSlug,
    plan_id: PLAN_ID,
    profile_id: "add_optional_viewing_date",
    profile_version: 1,
    apply_operation_id: APPLY_OPERATION_ID,
    recovery_result_schema: "csf_viewing_date_recovery_result",
    recovery_result_version: 3,
    recovery_status: "prepared",
    snapshot_id: SNAPSHOT_ID,
    post_apply: { form_sha256: AFTER_FORM_SHA256, records: AFTER_RECORDS },
    restored_baseline: { form_sha256: BASELINE_FORM_SHA256, records: BASELINE_RECORDS },
    preservation_mode: "same_project_structural_restore",
    preservation_version: 1,
    runtime_authority_mode: "same_project_runtime_authority_v1",
    correlated_replay_guard: true,
    mutation_performed: true,
    post_verification_completed: true,
    status: "restored"
  };
}

function isExactRestoreSuccess(entry, slug) {
  const raw = entry && entry.raw;
  return Boolean(entry && entry.operation_type === "viewing_date_restore" && entry.status === "succeeded"
    && raw && raw.project_slug === slug && raw.metadata && raw.metadata.viewing_date_plan_id === PLAN_ID
    && raw.result_summary && equal(raw.result_summary.viewing_date_restore, restoreIdentity(slug)));
}

async function resolveRestoreTerminal(options, authority) {
  const operations = listOperations({ projectsRoot: options.projectsRoot, slug: authority.projectState.project.slug, includeRaw: true })
    .filter((entry) => entry.operation_type === "viewing_date_restore");
  if (operations.some((entry) => entry.status === "failed" || entry.status === "interrupted" || entry.status === "running" || entry.status === "requested")) {
    throw fail("viewing_date_restore_prior_attempt_terminal", "Viewing-date Restore requires independent review after an earlier incomplete attempt.");
  }
  const succeeded = operations.filter((entry) => entry.status === "succeeded");
  if (succeeded.length) {
    if (succeeded.length !== 1 || !isExactRestoreSuccess(succeeded[0], authority.projectState.project.slug)) {
      throw fail("viewing_date_restore_prior_attempt_terminal", "Viewing-date Restore requires independent review after an earlier incomplete attempt.");
    }
    const restored = await (options.readNative || nativeRead)(authority.projectState, { mode: "read" });
    assertRestoredBaseline(restored, authority.authority.plan);
    return { status: "handled", result: { status: "already_restored", mutation_performed: false } };
  }
  const current = await (options.readNative || nativeRead)(authority.projectState, { mode: "read" });
  assertPostApply(current, authority.authority.plan);
  return { status: "continue" };
}

function assertPostApply(observation, plan) {
  const after = assertAfter(observation, plan, null);
  if (after.form_sha256 !== AFTER_FORM_SHA256) {
    throw fail("viewing_date_restore_after_state_drift", "The approved Preferred date state no longer matches.");
  }
  exactRecords(after.records, AFTER_RECORDS, "viewing_date_restore_records_drift");
  return after;
}

function assertRestoredBaseline(observation, plan) {
  assertBaseline(observation, plan);
  if (observation.form_sha256 !== BASELINE_FORM_SHA256) {
    throw fail("viewing_date_restore_baseline_drift", "The Request Viewing baseline was not restored exactly.");
  }
  exactRecords(observation.records, BASELINE_RECORDS, "viewing_date_restore_records_baseline_drift");
  return { form_sha256: observation.form_sha256, records: observation.records };
}

function snapshotMetadata(projectState) {
  const project = projectState.project;
  return {
    schema: "factory_structural_snapshot_metadata",
    version: 1,
    project_slug: project.slug,
    project_id: project.project_id || null,
    site_name: project.site_name || null,
    wp_port: project.wp_port || null,
    runtime_status: project.runtime && project.runtime.status || null,
    agent_status: project.agent && project.agent.status || null,
    agent_version: project.agent && project.agent.version || null,
    binding: deriveProjectBinding(project)
  };
}

function assertSnapshotMetadata(source, projectState) {
  const artifact = source && source.artifacts && source.artifacts.metadata;
  if (!artifact || typeof artifact.path !== "string") throw fail("viewing_date_restore_metadata_missing", "Restore metadata could not be verified.");
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(artifact.path, "utf8")); } catch (_) { throw fail("viewing_date_restore_metadata_invalid", "Restore metadata could not be verified."); }
  const expected = snapshotMetadata(projectState);
  const actual = Object.assign({}, parsed);
  delete actual.created_at;
  if (!equal(actual, expected)) throw fail("viewing_date_restore_metadata_drift", "Project metadata does not match the verified Recovery Point.");
}

function digestFile(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(64 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}

function treeIndex(root, ignore) {
  const index = new Map();
  function walk(current, relative) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw fail("viewing_date_restore_filesystem_unsafe", "Restored filesystem could not be verified.");
    if (relative && ignore.has(relative)) return;
    if (stat.isFile()) {
      index.set(relative, { type: "file", sha256: digestFile(current), size: stat.size });
      return;
    }
    if (relative) index.set(relative, { type: "directory" });
    for (const entry of fs.readdirSync(current).sort()) walk(path.join(current, entry), relative ? relative + "/" + entry : entry);
  }
  walk(root, "");
  return index;
}

function assertSameTree(expected, actual) {
  if (expected.size !== actual.size) throw fail("viewing_date_restore_filesystem_drift", "Restored filesystem does not match the verified Recovery Point.");
  for (const [name, entry] of expected) {
    if (!actual.has(name) || !equal(entry, actual.get(name))) throw fail("viewing_date_restore_filesystem_drift", "Restored filesystem does not match the verified Recovery Point.");
  }
}

function verifyRestoredFilesystem(options) {
  const compareRoot = path.join(options.workRoot, "viewing-date-restore-compare");
  try {
    const extracted = (options.extractArchive || extractTarArchive)({ archivePath: options.source.artifacts.filesystem.path, stagingRoot: compareRoot, requireAgentPlugin: options.projectState.project.agent && options.projectState.project.agent.status === "installed" });
    const expected = treeIndex(extracted.stagedWordPressRoot, new Set());
    const actual = treeIndex(options.liveWordPressRoot, new Set(["wp-config.php"]));
    assertSameTree(expected, actual);
  } finally {
    fs.rmSync(compareRoot, { recursive: true, force: true });
  }
}

async function discoverRestoreSurfaces(projectState) {
  const script = "$_a=get_post(6);$_b=get_post(7);$_c=get_page_by_path('fixture-contact');"
    + "if(!$_a||!$_b||!$_c||$_a->post_type!=='property'||$_b->post_type!=='property'||$_a->post_status!=='publish'||$_b->post_status!=='publish'){echo '{}';return;}"
    + "echo wp_json_encode(['property_a'=>get_permalink($_a),'property_b'=>get_permalink($_b),'contact'=>add_query_arg('factory_property_id',6,get_permalink($_c))]);";
  const result = await runCommand("docker", ["compose", "run", "--rm", "-T", "--entrypoint", "php", "wpcli", "/usr/local/bin/wp", "eval", script, "--path=/var/www/html", "--allow-root"], {
    cwd: projectState.runtimePath,
    logPath: path.join(projectState.runtimePath, "logs", "viewing-date-restore-surface-read.log"),
    timeoutMs: 120000
  });
  try {
    const value = JSON.parse(String(result.stdout || "").trim());
    if (!value || ![value.property_a, value.property_b, value.contact].every((url) => typeof url === "string" && /^http:\/\/127\.0\.0\.1:\d+\//.test(url))) throw new Error("invalid");
    return value;
  } catch (_) { throw fail("viewing_date_restore_surface_unavailable", "Restored Request Viewing surfaces could not be verified."); }
}

async function verifyFunctionalSurfaces(projectState, options) {
  const urls = await (options && options.discoverSurfaces || discoverRestoreSurfaces)(projectState);
  const fetcher = options && options.fetcher || fetch;
  const propertyA = await fetcher(urls.property_a);
  const propertyB = await fetcher(urls.property_b);
  const contact = await fetcher(urls.contact);
  if (!propertyA || !propertyB || !contact || propertyA.status !== 200 || propertyB.status !== 200 || contact.status !== 200) throw fail("viewing_date_restore_surface_unavailable", "Restored Request Viewing surfaces could not be verified.");
  const [aHtml, bHtml, contactHtml] = await Promise.all([propertyA.text(), propertyB.text(), contact.text()]);
  if (!aHtml.includes("factory-request-viewing-cta") || !bHtml.includes("factory-request-viewing-cta")
    || !contactHtml.includes("name=\"name\"") || !contactHtml.includes("name=\"property_id\"") || contactHtml.includes("name=\"preferred_date\"")) {
    throw fail("viewing_date_restore_surface_drift", "Restored Request Viewing surfaces could not be verified.");
  }
}

async function prepareViewingDateRestore(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const slug = validateExplicitSlug(options && options.slug);
  if (slug !== PROJECT_SLUG) throw fail("viewing_date_restore_project_not_allowed", "Viewing-date Restore is unavailable for this project.", 404);
  if (String(options && options.planId || PLAN_ID) !== PLAN_ID) throw fail("viewing_date_restore_plan_mismatch", "Viewing-date Restore requires the accepted Preview.");
  const projectState = readProjectBySlug(slug, projectsRoot);
  const authority = await prepareViewingDateAuthority(Object.assign({}, options, { projectsRoot, slug, planId: PLAN_ID }));
  if (authority.authority.recovery.snapshot_id !== SNAPSHOT_ID) throw fail("viewing_date_restore_snapshot_mismatch", "Viewing-date Restore requires the verified Recovery Point.");
  assertAcceptedApply(projectsRoot, slug);
  const observation = await (options.readNative || nativeRead)(projectState, { mode: "read" });
  assertPostApply(observation, authority.authority.plan);
  return { projectsRoot, projectState, authority, observation };
}

async function prepareViewingDateRestoreAuthority(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const slug = validateExplicitSlug(options && options.slug);
  if (slug !== PROJECT_SLUG) throw fail("viewing_date_restore_project_not_allowed", "Viewing-date Restore is unavailable for this project.", 404);
  if (String(options && options.planId || PLAN_ID) !== PLAN_ID) throw fail("viewing_date_restore_plan_mismatch", "Viewing-date Restore requires the accepted Preview.");
  const authority = await prepareViewingDateAuthority(Object.assign({}, options, { projectsRoot, slug, planId: PLAN_ID }));
  if (authority.authority.recovery.snapshot_id !== SNAPSHOT_ID) throw fail("viewing_date_restore_snapshot_mismatch", "Viewing-date Restore requires the verified Recovery Point.");
  assertAcceptedApply(projectsRoot, slug);
  return { projectsRoot, projectState: authority.projectState, authority };
}

async function restoreViewingDate(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const slug = validateExplicitSlug(options && options.slug);
  if (slug !== PROJECT_SLUG) throw fail("viewing_date_restore_project_not_allowed", "Viewing-date Restore is unavailable for this project.", 404);
  const prepared = await prepareViewingDateRestoreAuthority(options || {});
  let agentBefore = null;
  let appPasswordsBefore = null;
  let businessBefore = null;
  let signedHealth = null;
  const observationNonce = crypto.randomBytes(32);
  const expectedAgentSecret = options.expectedAgentSecret || requireAgentSigningCredential(prepared.projectState).signing_secret;
  const envBeforeRestore = fileIdentity(prepared.projectState.envPath);
  const wpConfigPath = path.join(prepared.projectState.runtimePath, "wordpress", "wp-config.php");
  const wpConfigBeforeRestore = digestFile(wpConfigPath);
  const planner = options.createRestorePlan || createRestorePlan;
  const planned = await planner({ projectsRoot: prepared.projectsRoot, slug: PROJECT_SLUG, snapshotId: SNAPSHOT_ID, idempotencyKey: options.idempotencyKey });
  if (!planned || !planned.plan || planned.plan.snapshot_id !== SNAPSHOT_ID) throw fail("viewing_date_restore_snapshot_mismatch", "Viewing-date Restore requires the verified Recovery Point.");
  const executor = options.executeRestore || executeManagedWebsiteRestore;
  const execution = await executor({
    projectsRoot: prepared.projectsRoot,
    projectSlug: PROJECT_SLUG,
    planId: planned.plan.plan_id,
    exactConfirmation: planned.plan.confirmation && planned.plan.confirmation.phrase,
    idempotencyKey: options.idempotencyKey,
    operationType: "viewing_date_restore",
    agentAuthorityMode: "verify_existing",
    operationMetadata: { viewing_date_plan_id: PLAN_ID, viewing_date_snapshot_id: SNAPSHOT_ID, viewing_date_apply_operation_id: APPLY_OPERATION_ID },
    deferIdempotencyUntilPostLock: true,
    postLockTerminalResolver: async () => resolveRestoreTerminal(Object.assign({}, options, { projectsRoot: prepared.projectsRoot }), prepared.authority),
    preRestoreVerifier: async () => {
      await prepareViewingDateRestore(options || {});
    },
    beforeSignedHealthObserver: async () => {
      const restored = await (options.readNative || nativeRead)(prepared.projectState, { mode: "read" });
      assertRestoredBaseline(restored, prepared.authority.authority.plan);
      assertStableEnv(envBeforeRestore, fileIdentity(prepared.projectState.envPath));
      if (digestFile(wpConfigPath) !== wpConfigBeforeRestore) throw fail("viewing_date_restore_wp_config_changed", "Current wp-config.php was not preserved.");
      const checkpoint = await readVerifyExistingSurface(prepared.projectState, options, observationNonce);
      assertAgentRepairSurface(checkpoint.surface, prepared.projectState.project.slug);
      assertApplicationPasswordIdentity(checkpoint.application_passwords);
      if (!Array.isArray(checkpoint.credential_hmac) || checkpoint.credential_hmac.length !== 1) throw fail("viewing_date_restore_agent_secret_mismatch", "Factory Agent credential could not be verified safely.");
      verifyCredentialChallenge(expectedAgentSecret, observationNonce, checkpoint.credential_hmac[0]);
      businessBefore = restored;
      agentBefore = checkpoint.surface;
      appPasswordsBefore = checkpoint.application_passwords;
    },
    signedHealthObserver: async (observation) => {
      if (signedHealth !== null) throw fail("viewing_date_restore_agent_health_ambiguous", "Factory Agent health could not be verified safely.");
      signedHealth = Object.assign({}, observation);
    },
    postRestoreVerifier: async (context) => {
      const restored = await (options.readNative || nativeRead)(context.projectState, { mode: "read" });
      assertRestoredBaseline(restored, prepared.authority.authority.plan);
      if (!businessBefore || !equal(businessBefore, restored)) throw fail("viewing_date_restore_baseline_drift", "Restored Request Viewing baseline changed during verification.");
      assertStableEnv(envBeforeRestore, fileIdentity(context.projectState.envPath));
      const wpConfigAfterRestore = digestFile(path.join(context.liveWordPressRoot, "wp-config.php"));
      if (context.wpConfigSha256 !== wpConfigBeforeRestore || wpConfigAfterRestore !== wpConfigBeforeRestore) throw fail("viewing_date_restore_wp_config_changed", "Current wp-config.php was not preserved.");
      await (options.verifySnapshotMetadata || assertSnapshotMetadata)(context.source, context.projectState);
      await (options.verifyRestoredFilesystem || verifyRestoredFilesystem)(context);
      if (!context.agent || context.agent.successful !== true || !context.health || context.health.signed_agent !== "ok") throw fail("viewing_date_restore_agent_binding_invalid", "Factory Agent binding could not be verified.");
      const checkpoint = await readVerifyExistingSurface(context.projectState, options, observationNonce);
      if (!appPasswordsBefore) throw fail("viewing_date_restore_application_password_drift", "Application Password state changed during Agent verification.");
      assertUnchangedApplicationPasswordIdentity(appPasswordsBefore, checkpoint.application_passwords);
      if (!Array.isArray(checkpoint.credential_hmac) || checkpoint.credential_hmac.length !== 1) throw fail("viewing_date_restore_agent_secret_mismatch", "Factory Agent credential could not be verified safely.");
      verifyCredentialChallenge(expectedAgentSecret, observationNonce, checkpoint.credential_hmac[0]);
      const agentAfter = checkpoint.surface;
      const authorityPreservation = assertAgentRepairDelta(agentBefore, agentAfter, signedHealth, context.projectState.project.slug);
      await (options.verifySurfaces || verifyFunctionalSurfaces)(context.projectState);
      return { viewing_date_restore: Object.assign(restoreIdentity(context.projectState.project.slug), authorityPreservation) };
    },
    verifyIdempotentReplay: async () => {
      const restored = await (options.readNative || nativeRead)(prepared.projectState, { mode: "read" });
      assertRestoredBaseline(restored, prepared.authority.authority.plan);
      return { status: "already_restored", mutation_performed: false };
    }
  });
  if (execution && (execution.idempotentReplay || execution.terminalHandled)) return { status: "already_restored", mutation_performed: false };
  if (!execution || !execution.operation || execution.operation.status !== "succeeded") throw fail("viewing_date_restore_execution_failed", "Viewing-date Restore did not complete safely.");
  return { status: "restored", mutation_performed: true };
}

module.exports = { PROJECT_SLUG, PLAN_ID, SNAPSHOT_ID, APPLY_OPERATION_ID, RESTORE_HANDLE, AFTER_FORM_SHA256, BASELINE_FORM_SHA256, AFTER_RECORDS, BASELINE_RECORDS, RESTORE_IDENTITY_SCHEMA, RESTORE_IDENTITY_VERSION, AGENT_CREDENTIAL_OPTION, AGENT_CREDENTIAL_FIELDS, AGENT_REPLAY_PREFIX, assertAgentCredentialObservation, assertAgentRepairDelta, assertAgentRepairSurface, assertApplicationPasswordIdentity, assertPostApply, assertRestoredBaseline, assertSnapshotMetadata, assertStableEnv, assertUnchangedApplicationPasswordIdentity, assertVerifyExistingObservation, fileIdentity, isExactRestoreSuccess, parseCanonicalRateCounter, prepareViewingDateRestore, readAgentRepairSurface, readVerifyExistingSurface, replayOptionName, restoreViewingDate, restoreIdentity, resolveRestoreTerminal, verifyCredentialChallenge, verifyFunctionalSurfaces, verifyRestoredFilesystem };
