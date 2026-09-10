"use strict";

// This is deliberately a one-profile service.  It reads the managed runtime,
// builds a proposal, and prepares a recovery association; it does not apply it.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { runCommand } = require("./runtime-tools");
const { readProjectBySlug, resolveProjectsRoot, validateExplicitSlug, ensureDirectory } = require("./project-store");
const { classifyAddOptionalViewingDateChange } = require("./real-estate-contract");
const { deriveProjectBinding, isRestorable, resolveSnapshotDirectory, validateManifest } = require("./structural-snapshot-store");
const { createFullStructuralSnapshot } = require("./structural-snapshot-capture");

const PROFILE_ID = "add_optional_viewing_date";
const PROFILE_VERSION = 1;
const FORM_ID = 13;
const DATE_BLOCK = '<!-- wp:jet-forms/date-field {"label":"Preferred date","name":"preferred_date","blockID":"factory-request-viewing-preferred-date-v1"} /-->';
const PLAN_ROOT = "viewing-date-preview-v1";
const TRUSTED_POLICY_SHA256 = "541167d3a80c45095ef9396741fb99dca90752e7f5d7edecadb991d01d188e14";
const RECOVERY_RESULT_SCHEMA = "csf_viewing_date_recovery_result";
const RECOVERY_RESULT_VERSION = 3;
const RECOVERY_COVERAGE_SCHEMA = "csf_viewing_date_recovery_scope_coverage";
const RECOVERY_COVERAGE_VERSION = 1;
const REQUIRED_ARTIFACT_TYPES = ["database_dump", "wordpress_filesystem", "project_metadata"];
const POLICY_ARCHIVE_PATH = "wordpress/wp-content/mu-plugins/factory-request-viewing-before-v1-policy.php";
const DATABASE_RESOURCE_SCOPE = ["request_viewing_form_post", "request_viewing_form_meta_actions_ownership", "request_viewing_policy_binding_option"];
const REQUIRED_DATABASE_CAPTURE_CHECKS = ["file_exists", "size_positive", "sha256_valid", "sql_create_table_markers", "wordpress_options_table", "wordpress_posts_table", "wordpress_postmeta_table"];

function error(code, message, statusCode) {
  const value = new Error(message || "Viewing-date preview is unavailable.");
  value.code = code;
  value.statusCode = statusCode || 409;
  return value;
}

function hash(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function safeJson(value) {
  try { return JSON.parse(value); } catch (caught) { throw error("viewing_date_runtime_malformed", "The managed form could not be read safely."); }
}

function planDirectory(projectState) {
  return path.join(projectState.runtimePath, "proofs", PLAN_ROOT);
}

function atomicJson(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
}

function profileMatches(plan) {
  return plan && plan.profile === "add_optional_viewing_date@1"
    && plan.profile_id === PROFILE_ID
    && plan.profile_version === PROFILE_VERSION;
}

function exactRecords(records) {
  return records && typeof records === "object" && !Array.isArray(records)
    && Object.keys(records).sort().join(",") === "count,fingerprint"
    && Number.isInteger(records.count) && records.count >= 0
    && typeof records.fingerprint === "string" && /^[a-f0-9]{64}$/.test(records.fingerprint);
}

function exactPlanAuthority(plan, projectState, planId) {
  const project = projectState && projectState.project;
  const baseline = plan && plan.baseline;
  const baselineKeys = ["actions_sha256", "binding_sha256", "facts_sha256", "form_id", "form_sha256", "policy_sha256", "project_binding", "records"];
  if (!project || !plan || typeof plan !== "object" || Array.isArray(plan)
    || plan.schema !== "csf_viewing_date_preview" || plan.version !== 1
    || plan.plan_id !== planId || plan.project_slug !== project.slug || plan.project_id !== project.project_id
    || !profileMatches(plan) || !baseline || typeof baseline !== "object" || Array.isArray(baseline)
    || Object.keys(baseline).sort().join(",") !== baselineKeys.join(",")
    || !Number.isInteger(baseline.form_id) || baseline.form_id <= 0
    || ![baseline.form_sha256, baseline.actions_sha256, baseline.binding_sha256, baseline.policy_sha256, baseline.facts_sha256].every((value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value))
    || !exactRecords(baseline.records)
    || JSON.stringify(baseline.project_binding) !== JSON.stringify(deriveProjectBinding(project))
    || !plan.proposed_delta || !plan.proposed_delta.add_optional_date_field || typeof plan.proposed_delta.add_optional_date_field.native_block !== "string"
    || !plan.expected || typeof plan.expected.form_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(plan.expected.form_sha256)
    || plan.recovery_result_version !== RECOVERY_RESULT_VERSION || plan.recovery_coverage_schema !== RECOVERY_COVERAGE_SCHEMA
    || plan.recovery_coverage_version !== RECOVERY_COVERAGE_VERSION) return false;
  return true;
}

function rejectCallerSuppliedProjectAuthority(options) {
  for (const key of ["projectId", "project_id"]) {
    if (options && Object.hasOwn(options, key)) {
      throw error("viewing_date_preview_authority_injected", "Viewing-date Preview derives project authority from the server-owned project record only.", 400);
    }
  }
}

function proposedChangeFingerprint(plan) {
  return hash({ proposed_delta: plan.proposed_delta, expected: plan.expected });
}

function baselineFingerprint(plan) {
  return hash(plan.baseline);
}

function exactCoverage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  const required = ["database", "project_metadata", "schema", "version", "wordpress_filesystem"];
  if (keys.length !== required.length || keys.some((key, index) => key !== required[index])) return null;
  const exactObject = (candidate, expected) => candidate && typeof candidate === "object" && !Array.isArray(candidate)
    && Object.keys(candidate).sort().join("\n") === Object.keys(expected).sort().join("\n")
    && Object.entries(expected).every(([key, expectedValue]) => Array.isArray(expectedValue)
      ? Array.isArray(candidate[key]) && candidate[key].length === expectedValue.length && candidate[key].every((item, index) => item === expectedValue[index])
      : candidate[key] === expectedValue);
  if (value.schema !== RECOVERY_COVERAGE_SCHEMA || value.version !== RECOVERY_COVERAGE_VERSION
    || !exactObject(value.database, {
      scope: "full_database", capture_authority: true, artifact_bytes_verified: true,
      affected_resources: DATABASE_RESOURCE_SCOPE, row_level_inspection: false, restore_verification_required: true
    })
    || !exactObject(value.wordpress_filesystem, {
      scope: "wordpress_filesystem_archive", artifact_bytes_verified: true, policy_file_verified: true
    })
    || !exactObject(value.project_metadata, {
      scope: "project_metadata", artifact_bytes_verified: true, project_identity_verified: true
    })) return null;
  return {
    schema: RECOVERY_COVERAGE_SCHEMA,
    version: RECOVERY_COVERAGE_VERSION,
    database: {
      scope: "full_database", capture_authority: true, artifact_bytes_verified: true,
      affected_resources: DATABASE_RESOURCE_SCOPE.slice(), row_level_inspection: false, restore_verification_required: true
    },
    wordpress_filesystem: { scope: "wordpress_filesystem_archive", artifact_bytes_verified: true, policy_file_verified: true },
    project_metadata: { scope: "project_metadata", artifact_bytes_verified: true, project_identity_verified: true }
  };
}

function coverageFingerprint(coverage) {
  const exact = exactCoverage(coverage);
  return exact ? hash(exact) : null;
}

function hasExactMembers(values, required) {
  return Array.isArray(values) && required.every((value) => values.includes(value));
}

function fullDatabaseCaptureAuthority(manifest) {
  return manifest && manifest.consistency_mode === "coordinated_maintenance_db_filesystem_capture"
    && hasExactMembers(manifest.captured_components, ["database", "logical_database_dump"])
    && manifest.software && manifest.software.capture_service === "structural_snapshot_capture_20a3b"
    && manifest.provenance && manifest.provenance.source === "launcher_structural_snapshot_capture_20a3b"
    && manifest.provenance.capture_scope === "database_and_wordpress_filesystem"
    && manifest.verification && manifest.verification.successful === true
    && hasExactMembers(manifest.verification.checks, REQUIRED_DATABASE_CAPTURE_CHECKS);
}

function exactProjectMetadata(value, projectState, binding) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !projectState || !projectState.project) return false;
  const project = projectState.project;
  const keys = ["agent_status", "agent_version", "binding", "created_at", "project_id", "project_slug", "runtime_status", "schema", "site_name", "version", "wp_port"];
  if (Object.keys(value).sort().join("\n") !== keys.join("\n")
    || value.schema !== "factory_structural_snapshot_metadata" || value.version !== 1
    || value.project_slug !== project.slug || value.project_id !== project.project_id
    || value.site_name !== project.site_name || value.wp_port !== project.wp_port
    || value.runtime_status !== (project.runtime && project.runtime.status || null)
    || value.agent_status !== (project.agent && project.agent.status || null)
    || value.agent_version !== (project.agent && project.agent.version || null)
    || value.binding !== binding || typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at))) return false;
  return Object.values(value).every((entry) => entry == null || typeof entry === "string" || typeof entry === "number");
}

function isSnapshotId(value) {
  return typeof value === "string" && /^snapshot-[a-z0-9-]+$/.test(value);
}

function snapshotIdentity(manifest, projectState, projectsRoot, manifestSha256) {
  if (!manifest || !isSnapshotId(manifest.snapshot_id) || manifest.project_slug !== projectState.project.slug
    || typeof manifest.project_identity_fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(manifest.project_identity_fingerprint)
    || !Array.isArray(manifest.artifacts)) return null;
  let context;
  try {
    context = resolveSnapshotDirectory({ projectsRoot, slug: projectState.project.slug, snapshotId: manifest.snapshot_id });
  } catch (caught) {
    return null;
  }
  if (typeof manifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifestSha256)) return null;
  const artifacts = manifest.artifacts.map((artifact) => artifact && ({
    type: artifact.type,
    relative_filename: artifact.relative_filename,
    digest_algorithm: artifact.digest_algorithm,
    digest: artifact.digest,
    size_bytes: artifact.size_bytes,
    capture_status: artifact.capture_status
  }));
  if (artifacts.some((artifact) => !artifact || typeof artifact.type !== "string" || typeof artifact.relative_filename !== "string"
    || artifact.digest_algorithm !== "sha256" || !/^[a-f0-9]{64}$/.test(artifact.digest)
    || !Number.isSafeInteger(artifact.size_bytes) || artifact.size_bytes < 0 || artifact.capture_status !== "verified")) return null;
  return {
    snapshot_id: manifest.snapshot_id,
    project_slug: manifest.project_slug,
    project_identity_fingerprint: manifest.project_identity_fingerprint,
    manifest_sha256: manifestSha256,
    artifacts_sha256: hash(artifacts)
  };
}

function sameSnapshotIdentity(left, right) {
  const keys = ["snapshot_id", "project_slug", "project_identity_fingerprint", "manifest_sha256", "artifacts_sha256"];
  return left && right && Object.keys(left).length === keys.length && Object.keys(right).length === keys.length
    && keys.every((key) => typeof left[key] === "string" && left[key] === right[key]);
}

function requiredArtifacts(manifest) {
  if (!manifest || !Array.isArray(manifest.artifacts)) return null;
  const byType = new Map();
  for (const artifact of manifest.artifacts) {
    if (!artifact || typeof artifact.type !== "string" || byType.has(artifact.type)) return null;
    byType.set(artifact.type, artifact);
  }
  const selected = REQUIRED_ARTIFACT_TYPES.map((type) => byType.get(type));
  if (selected.some((artifact) => !artifact || artifact.digest_algorithm !== "sha256" || !/^[a-f0-9]{64}$/.test(artifact.digest)
    || !Number.isSafeInteger(artifact.size_bytes) || artifact.size_bytes < 0 || artifact.capture_status !== "verified"
    || typeof artifact.relative_filename !== "string" || !artifact.relative_filename)) return null;
  return selected;
}

function resolveTrustedArtifactPath(directory, artifact) {
  const root = path.resolve(directory);
  const target = path.resolve(root, artifact.relative_filename);
  if (target === root || !target.startsWith(root + path.sep)) return null;
  return target;
}

function sameFileIdentity(before, after) {
  if (!before || !after || before.size !== after.size || before.mtimeMs !== after.mtimeMs) return false;
  if (typeof before.dev === "number" && typeof after.dev === "number" && before.dev !== after.dev) return false;
  if (typeof before.ino === "number" && typeof after.ino === "number" && before.ino !== after.ino) return false;
  return true;
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isRegularNonReparse(stat) {
  return Boolean(stat && typeof stat.isFile === "function" && typeof stat.isSymbolicLink === "function"
    && stat.isFile() && !stat.isSymbolicLink());
}

function isDirectoryNonReparse(stat) {
  return Boolean(stat && typeof stat.isDirectory === "function" && typeof stat.isSymbolicLink === "function"
    && stat.isDirectory() && !stat.isSymbolicLink());
}

function guardedStat(fileSystem, target, directory) {
  let stat;
  try { stat = fileSystem.lstatSync(target); } catch (caught) { return null; }
  return directory ? (isDirectoryNonReparse(stat) ? stat : null) : (isRegularNonReparse(stat) ? stat : null);
}

function pathComponents(base, target) {
  const root = path.resolve(base);
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  if (relative.startsWith(".." + path.sep) || relative === ".." || path.isAbsolute(relative)) return null;
  return relative ? relative.split(path.sep) : [];
}

function guardDirectoryChain(fileSystem, base, target) {
  if (!guardedStat(fileSystem, base, true)) return false;
  const components = pathComponents(base, target);
  if (!components) return false;
  let current = path.resolve(base);
  for (const component of components) {
    current = path.join(current, component);
    if (!guardedStat(fileSystem, current, true)) return false;
  }
  return true;
}

function guardSnapshotContext(fileSystem, context) {
  if (!context || !context.snapshotDirectory || !context.manifestPath) return false;
  return guardDirectoryChain(fileSystem, context.projectsRoot, context.recoveryRoot)
    && guardDirectoryChain(fileSystem, context.recoveryRoot, context.projectDirectory)
    && guardDirectoryChain(fileSystem, context.projectDirectory, context.snapshotDirectory)
    && path.dirname(context.manifestPath) === context.snapshotDirectory;
}

function guardArtifactPath(fileSystem, context, artifact) {
  const target = resolveTrustedArtifactPath(context.snapshotDirectory, artifact);
  if (!target || !guardSnapshotContext(fileSystem, context)) return null;
  const parent = path.dirname(target);
  if (!guardDirectoryChain(fileSystem, context.snapshotDirectory, parent) || !guardedStat(fileSystem, target, false)) return null;
  return target;
}

function readGuardedManifest(fileSystem, context) {
  const before = guardedStat(fileSystem, context.manifestPath, false);
  if (!before || typeof fileSystem.openSync !== "function" || typeof fileSystem.readSync !== "function" || typeof fileSystem.fstatSync !== "function") return null;
  let fd = null;
  try {
    fd = fileSystem.openSync(context.manifestPath, "r");
    const handle = fileSystem.fstatSync(fd);
    if (!isRegularNonReparse(handle) || !sameFileIdentity(before, handle)) return null;
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = fileSystem.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!Number.isSafeInteger(read) || read <= 0) return null;
      offset += read;
    }
    const after = guardedStat(fileSystem, context.manifestPath, false);
    if (!after || !sameFileIdentity(before, after) || !guardSnapshotContext(fileSystem, context)) return null;
    try { fileSystem.closeSync(fd); } catch (caught) { return null; }
    fd = null;
    return bytes;
  } catch (caught) { return null; } finally {
    if (fd !== null) try { fileSystem.closeSync(fd); } catch (caught) { /* fail closed before using bytes */ }
  }
}

function tarString(header, start, length) {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString("utf8");
}

function tarOctal(header, start, length) {
  const value = tarString(header, start, length).trim();
  return value && /^[0-7]+$/.test(value) ? parseInt(value, 8) : (value ? null : 0);
}

function createTarInventoryParser() {
  let pending = Buffer.alloc(0);
  let skipped = 0;
  let ended = false;
  const entries = [];
  function consume() {
    while (true) {
      if (skipped) {
        const count = Math.min(skipped, pending.length);
        pending = pending.subarray(count);
        skipped -= count;
        if (skipped) return;
      }
      if (pending.length < 512) return;
      const header = pending.subarray(0, 512);
      pending = pending.subarray(512);
      if (header.every((byte) => byte === 0)) { ended = true; continue; }
      if (ended) throw error("viewing_date_recovery_coverage_missing", "Recovery Point preparation could not verify the required coverage.");
      const size = tarOctal(header, 124, 12);
      const name = tarString(header, 0, 100);
      const prefix = tarString(header, 345, 155);
      const type = tarString(header, 156, 1) || "0";
      if (!name || size === null || !Number.isSafeInteger(size) || size < 0) throw error("viewing_date_recovery_coverage_missing", "Recovery Point preparation could not verify the required coverage.");
      entries.push({ name: prefix ? prefix + "/" + name : name, size, type });
      skipped = Math.ceil(size / 512) * 512;
    }
  }
  return {
    push(chunk) { pending = Buffer.concat([pending, Buffer.from(chunk)]); consume(); },
    finish() {
      if (skipped || pending.length || !ended) return null;
      return canonicalTarEntryInventory(entries);
    }
  };
}

async function streamVerifiedArtifact(filePath, artifact, options) {
  const fileSystem = options && options.fs || fs;
  const onChunk = options && options.onChunk;
  const before = guardedStat(fileSystem, filePath, false);
  if (!before || before.size !== artifact.size_bytes || typeof fileSystem.fstatSync !== "function") return null;
  const digest = crypto.createHash("sha256");
  let bytes = 0;
  let handleStat = null;
  const startedAt = Date.now();
  try {
    await new Promise((resolve, reject) => {
      const stream = fileSystem.createReadStream(filePath);
      stream.once("open", (fd) => {
        try {
          handleStat = fileSystem.fstatSync(fd);
          if (!isRegularNonReparse(handleStat) || !sameFileIdentity(before, handleStat)) stream.destroy(error("viewing_date_recovery_coverage_missing", "Recovery Point preparation could not verify the required coverage."));
        } catch (caught) { stream.destroy(caught); }
      });
      stream.on("data", (chunk) => {
        try { bytes += chunk.length; digest.update(chunk); if (onChunk) onChunk(chunk); } catch (caught) { stream.destroy(caught); }
      });
      stream.once("error", reject);
      stream.once("end", resolve);
    });
  } catch (caught) { return null; }
  const after = guardedStat(fileSystem, filePath, false);
  if (!after || !handleStat || !sameFileIdentity(before, handleStat) || !sameFileIdentity(before, after)
    || bytes !== artifact.size_bytes || digest.digest("hex") !== artifact.digest) return null;
  return { type: artifact.type, size_bytes: bytes, sha256: artifact.digest, elapsed_ms: Date.now() - startedAt };
}

async function streamSha256Artifact(filePath, artifact, options) {
  const fileSystem = options && options.fs || fs;
  let before;
  try {
    before = fileSystem.lstatSync(filePath);
  } catch (caught) {
    return null;
  }
  if (!isRegularNonReparse(before) || before.size !== artifact.size_bytes) return null;
  const startedAt = Date.now();
  const digest = crypto.createHash("sha256");
  let bytes = 0;
  try {
    await new Promise((resolve, reject) => {
      const stream = fileSystem.createReadStream(filePath);
      stream.on("data", (chunk) => { bytes += chunk.length; digest.update(chunk); });
      stream.once("error", reject);
      stream.once("end", resolve);
    });
  } catch (caught) {
    return null;
  }
  let after;
  try {
    after = fileSystem.lstatSync(filePath);
  } catch (caught) {
    return null;
  }
  if (!isRegularNonReparse(after) || !sameFileIdentity(before, after) || bytes !== artifact.size_bytes
    || digest.digest("hex") !== artifact.digest) return null;
  return { type: artifact.type, size_bytes: bytes, sha256: artifact.digest, elapsed_ms: Date.now() - startedAt };
}

async function inspectSnapshotSinglePass(options) {
  const fileSystem = options && options.fs || fs;
  const projectState = options && options.projectState;
  const plan = options && options.plan;
  const snapshotId = options && options.snapshotId;
  if (!isSnapshotId(snapshotId)) return null;
  if (!projectState || !plan || !isSnapshotId(snapshotId)) return null;
  let context;
  try { context = resolveSnapshotDirectory({ projectsRoot: options.projectsRoot, slug: projectState.project.slug, snapshotId }); } catch (caught) { return null; }
  if (!guardSnapshotContext(fileSystem, context)) return null;
  const manifestBytes = readGuardedManifest(fileSystem, context);
  if (!manifestBytes) return null;
  let manifest;
  try {
    manifest = validateManifest(JSON.parse(Buffer.from(manifestBytes).toString("utf8")), {
      expectedProjectSlug: context.binding.slug,
      expectedProjectIdentityFingerprint: context.binding.fingerprint
    });
  } catch (caught) { return null; }
  const manifestSha256 = sha256Bytes(manifestBytes);
  const identity = snapshotIdentity(manifest, projectState, options.projectsRoot, manifestSha256);
  const artifacts = requiredArtifacts(manifest);
  if (!identity || !artifacts || !isRestorable(manifest, { expectedProjectSlug: projectState.project.slug, expectedProjectIdentityFingerprint: plan.baseline.project_binding.fingerprint })
    || !fullDatabaseCaptureAuthority(manifest)) return null;
  const tarParser = createTarInventoryParser();
  const metadata = [];
  let metadataBytes = 0;
  const verified = [];
  for (const artifact of artifacts) {
    const artifactPath = guardArtifactPath(fileSystem, context, artifact);
    if (!artifactPath) return null;
    const record = await streamVerifiedArtifact(artifactPath, artifact, {
      fs: fileSystem,
      onChunk(chunk) {
        if (artifact.type === "wordpress_filesystem") tarParser.push(chunk);
        if (artifact.type === "project_metadata") {
          metadataBytes += chunk.length;
          if (metadataBytes > 1024 * 1024) throw error("viewing_date_recovery_coverage_missing", "Recovery Point preparation could not verify the required coverage.");
          metadata.push(Buffer.from(chunk));
        }
      }
    });
    if (!record) return null;
    if (!guardArtifactPath(fileSystem, context, artifact)) return null;
    verified.push(record);
  }
  let metadataValid;
  try { metadataValid = exactProjectMetadata(JSON.parse(Buffer.concat(metadata).toString("utf8")), projectState, context.binding.basis); } catch (caught) { metadataValid = false; }
  const inventory = tarParser.finish();
  if (!metadataValid) return null;
  const coverage = exactCoverage({
    schema: RECOVERY_COVERAGE_SCHEMA,
    version: RECOVERY_COVERAGE_VERSION,
    database: {
      scope: "full_database", capture_authority: true, artifact_bytes_verified: true,
      affected_resources: DATABASE_RESOURCE_SCOPE.slice(), row_level_inspection: false, restore_verification_required: true
    },
    wordpress_filesystem: {
      scope: "wordpress_filesystem_archive", artifact_bytes_verified: true,
      policy_file_verified: Boolean(inventory && inventory.get(POLICY_ARCHIVE_PATH)?.type === "0" && inventory.get(POLICY_ARCHIVE_PATH)?.size > 0)
    },
    project_metadata: { scope: "project_metadata", artifact_bytes_verified: true, project_identity_verified: true }
  });
  if (!coverage) return null;
  return {
    manifest,
    coverage,
    snapshot_identity: identity,
    artifacts: verified,
    artifacts_sha256: hash(verified.map(({ type, size_bytes, sha256 }) => ({ type, size_bytes, sha256 }))),
    inspection: { artifact_verification: "single_pass", manifest_read_count: 1, artifact_stream_count: verified.length },
    snapshot_reused: true,
    new_snapshot_created: false,
    capture_not_invoked: true
  };
}

async function verifySnapshotArtifacts(manifest, projectState, projectsRoot, options) {
  const plan = options && options.plan || {
    baseline: { project_binding: { fingerprint: deriveProjectBinding(projectState.project).fingerprint } }
  };
  return inspectSnapshotSinglePass(Object.assign({}, options || {}, { manifest, projectState, projectsRoot, plan, snapshotId: manifest && manifest.snapshot_id }));
}

async function matchingPreparedRecovery(projectState, plan, projectsRoot, reattest) {
  const directory = path.join(planDirectory(projectState), "recovery-results");
  const resultPath = path.join(directory, plan.plan_id + ".json");
  if (!fs.existsSync(resultPath) || !exactPlanAuthority(plan, projectState, plan.plan_id)) return null;
  const result = safeJson(fs.readFileSync(resultPath, "utf8"));
  const coverage = exactCoverage(result && result.coverage);
  if (!result || result.schema !== RECOVERY_RESULT_SCHEMA || result.version !== RECOVERY_RESULT_VERSION
    || result.plan_id !== plan.plan_id || result.status !== "prepared" || result.project_slug !== plan.project_slug || result.project_id !== plan.project_id
    || result.project_identity_fingerprint !== plan.baseline.project_binding.fingerprint
    || result.profile_id !== PROFILE_ID || result.profile_version !== PROFILE_VERSION
    || result.baseline_sha256 !== baselineFingerprint(plan)
    || result.proposed_change_sha256 !== proposedChangeFingerprint(plan)
    || plan.recovery_result_version !== RECOVERY_RESULT_VERSION || plan.recovery_coverage_schema !== RECOVERY_COVERAGE_SCHEMA
    || plan.recovery_coverage_version !== RECOVERY_COVERAGE_VERSION
    || result.coverage_schema !== RECOVERY_COVERAGE_SCHEMA || result.coverage_version !== RECOVERY_COVERAGE_VERSION
    || !isSnapshotId(result.snapshot_id) || !coverage || result.coverage_sha256 !== coverageFingerprint(coverage)
    || result.snapshot_reused !== false || result.new_snapshot_created !== true || result.capture_not_invoked !== false) return null;
  let verified;
  try {
    verified = await (reattest ? reattest({ projectsRoot, plan, projectState, snapshotId: result.snapshot_id }) : reattestExistingSnapshot({ projectsRoot, plan, projectState, snapshotId: result.snapshot_id }));
  } catch (caught) {
    return null;
  }
  if (!verified || !verified.inspection || verified.inspection.artifact_verification !== "single_pass"
    || verified.snapshot_identity.project_identity_fingerprint !== plan.baseline.project_binding.fingerprint
    || !sameSnapshotIdentity(result.snapshot_identity, verified.snapshot_identity)
    || !sameSnapshotIdentity(result.snapshot_identity, Object.assign({}, verified.snapshot_identity, { snapshot_id: result.snapshot_id }))
    || result.coverage_sha256 !== coverageFingerprint(verified.coverage)) return null;
  return { status: "prepared", snapshot_id: result.snapshot_id };
}

function nativeFactsFromObservation(observation) {
  if (!observation || observation.form_id !== FORM_ID || observation.plugin_version !== "3.6.5.1"
    || observation.policy_sha256 !== TRUSTED_POLICY_SHA256) {
    throw error("viewing_date_runtime_unsupported", "The managed form is not in the supported before-state.");
  }
  const fields = Array.isArray(observation.fields) ? observation.fields : null;
  const actions = Array.isArray(observation.actions) ? observation.actions : null;
  const binding = observation.binding && typeof observation.binding === "object" ? observation.binding : null;
  if (!fields || !actions || !binding || actions.length !== 1 || actions[0].type !== "save_record") {
    throw error("viewing_date_runtime_malformed", "The managed form could not be read safely.");
  }
  const byName = new Map();
  for (const field of fields) {
    if (!field || typeof field.name !== "string" || byName.has(field.name)) {
      throw error("viewing_date_runtime_ambiguous", "The managed form could not be read safely.");
    }
    byName.set(field.name, field);
  }
  const required = ["property_id", "name", "email", "phone", "message", "_factory_policy_guard"];
  const allowed = new Set(required.concat("preferred_date"));
  const bindingKeys = ["form_id", "form_sha256", "email_field", "phone_field", "property_field", "guard_field", "guard_value"];
  if (!required.every((name) => byName.has(name)) || fields.some((field) => !allowed.has(field.name))
    || Object.keys(binding).length !== bindingKeys.length || bindingKeys.some((key) => !Object.hasOwn(binding, key))
    || binding.form_id !== FORM_ID || binding.form_sha256 !== observation.form_sha256
    || binding.email_field !== "email" || binding.phone_field !== "phone" || binding.property_field !== "property_id"
    || binding.guard_field !== "_factory_policy_guard" || binding.guard_value !== "request_viewing_before_v1") {
    throw error("viewing_date_runtime_binding_conflict", "The managed form could not be read safely.");
  }
  const exactField = (name, block, type, requiredValue, label) => {
    const field = byName.get(name);
    const attrs = field && field.attrs;
    return field && field.block === block && field.type === type && field.required === requiredValue
      && (label == null ? !Object.hasOwn(attrs || {}, "label") : attrs && attrs.label === label);
  };
  if (!exactField("name", "jet-forms/text-field", "text", true, "Name")
    || !exactField("email", "jet-forms/text-field", "email", false, "Email")
    || !exactField("phone", "jet-forms/text-field", "tel", false, "Phone")
    || !exactField("message", "jet-forms/textarea-field", "textarea", false, "Message")) {
    throw error("viewing_date_runtime_fields_conflict", "The managed form could not be read safely.");
  }
  const property = byName.get("property_id");
  const guard = byName.get("_factory_policy_guard");
  const guardRules = guard && guard.attrs && guard.attrs.validation && guard.attrs.validation.rules;
  const validGuardRules = Array.isArray(guardRules) && guardRules.length === 2
    && new Set(guardRules.map((rule) => rule && rule.type + ":" + rule.value)).size === 2
    && ["ssr:factory_request_viewing_before_v1_validate_contacts", "ssr:factory_request_viewing_before_v1_validate_property"].every((value) => guardRules.some((rule) => rule && rule.type + ":" + rule.value === value));
  if (!property || property.block !== "jet-forms/hidden-field" || property.required !== true
    || !property.attrs || property.attrs.field_value !== "query_var" || property.attrs.query_var_key !== "factory_property_id"
    || !guard || guard.block !== "jet-forms/text-field" || guard.type !== "hidden" || guard.required !== true
    || !guard.attrs || guard.attrs.default !== binding.guard_value || !validGuardRules) {
    throw error("viewing_date_runtime_context_conflict", "The managed form could not be read safely.");
  }
  const date = byName.get("preferred_date");
  const optionalDate = !date || (date.block === "jet-forms/date-field" && date.required === false && date.label === "Preferred date");
  if (!optionalDate) {
    throw error("viewing_date_runtime_conflict", "The managed form could not be read safely.");
  }
  const fieldIdentity = {
    property_id: "selected_property_context",
    name: "request_viewing_name",
    email: "request_viewing_email",
    phone: "request_viewing_phone",
    message: "request_viewing_message",
    preferred_date: "request_viewing_preferred_date"
  };
  const typeIdentity = { property_id: "hidden", name: "text", email: "email", phone: "phone", message: "textarea", preferred_date: "date" };
  const semanticFields = fields
    .filter((field) => field.name !== "_factory_policy_guard" && field.name !== "property_id")
    .map((field) => ({ id: fieldIdentity[field.name] || field.name, form_id: "request_viewing_form", type: typeIdentity[field.name] || field.type, required: field.required }));
  return {
    profile_id: PROFILE_ID,
    profile_version: PROFILE_VERSION,
    ownership: {
      form: observation.owner === "request_viewing_before_v1" ? "factory_managed" : "unmanaged",
      context: binding.property_field === "property_id" ? "factory_managed" : "unmanaged",
      existing_fields: "factory_managed",
      protected_content: "preserved",
      user_content: "preserved"
    },
    journey: { id: "request_viewing", form_id: "request_viewing_form", context_id: "selected_property_context" },
    context: { id: "selected_property_context", field: "property_id", required: true },
    form: { id: "request_viewing_form", entity_id: "property", context_id: "selected_property_context", field_ids: semanticFields.map((field) => field.id), contact_rule: { type: "at_least_one", field_ids: ["request_viewing_email", "request_viewing_phone"] } },
    context: { id: "selected_property_context", entity_id: "property", source_surface_id: "property_single", target_surface_id: "contact", required: true, identity_source: "selected_entity" },
    fields: semanticFields
  };
}

function buildPatch(content) {
  const submit = /<!-- wp:jet-forms\/submit-field \{[^\n]*\} \/-->/g;
  const matches = content.match(submit) || [];
  if (matches.length !== 1 || content.includes("preferred_date")) {
    throw error("viewing_date_patch_unsafe", "The managed form could not be prepared safely.");
  }
  const next = content.replace(submit, DATE_BLOCK + "\n\n" + matches[0]);
  return { native_block: DATE_BLOCK, expected_form_sha256: hash(next), next_content: next };
}

async function observeNativeRuntime(options) {
  const projectState = options.projectState;
  const script = [
    "$p=get_post(13);", "if(!$p){echo '{}';return;}",
    "$blocks=parse_blocks($p->post_content); $fields=[]; foreach($blocks as $b){$a=$b['attrs']??[]; if(isset($a['name'])){$fields[]=['name'=>$a['name'],'block'=>$b['blockName'],'type'=>$a['field_type']??($b['blockName']==='jet-forms/textarea-field'?'textarea':'text'),'required'=>($a['required']??false)===true,'label'=>$a['label']??null,'attrs'=>$a];}}",
    "$actions=get_post_meta(13,'_jf_actions',true); if(is_string($actions)){$actions=json_decode($actions,true);} $actions=is_array($actions)?$actions:[]; $out=[]; foreach($actions as $a){$out[]=['type'=>$a['type']??null];}",
    "global $wpdb;$records=null;$tables=['records'=>$wpdb->prefix.'jet_fb_records','fields'=>$wpdb->prefix.'jet_fb_records_fields'];$available=true;foreach($tables as $table){if($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s',$table))!==$table){$available=false;break;}}if($available){$r='`'.str_replace('`','',$tables['records']).'`';$f='`'.str_replace('`','',$tables['fields']).'`';$record_rows=$wpdb->get_results($wpdb->prepare('SELECT id,form_id,user_id,from_content_id,from_content_type,status,ip_address,user_agent,referrer,submit_type,is_viewed,created_at,updated_at FROM '.$r.' WHERE form_id=%d ORDER BY id ASC',(int)$p->ID),ARRAY_A);$where=$wpdb->prepare(' WHERE record_id IN (SELECT id FROM '.$r.' WHERE form_id=%d) ORDER BY id ASC',(int)$p->ID);$field_rows=$wpdb->get_results('SELECT id,record_id,field_name,field_value,field_type,field_attrs FROM '.$f.$where,ARRAY_A);$records=['count'=>count($record_rows),'fingerprint'=>hash('sha256',wp_json_encode(['records'=>$record_rows,'fields'=>$field_rows]))];}",
    "$b=get_option('factory_request_viewing_before_v1_binding',[]);",
    "echo wp_json_encode(['form_id'=>(int)$p->ID,'owner'=>get_post_meta(13,'_factory_request_viewing_before_v1_owner',true),'form_content'=>$p->post_content,'form_sha256'=>hash('sha256',$p->post_content),'fields'=>$fields,'actions'=>$out,'binding'=>$b,'records'=>$records,'plugin_version'=>defined('JET_FORM_BUILDER_VERSION')?JET_FORM_BUILDER_VERSION:null,'policy_sha256'=>file_exists(WPMU_PLUGIN_DIR.'/factory-request-viewing-before-v1-policy.php')?hash_file('sha256',WPMU_PLUGIN_DIR.'/factory-request-viewing-before-v1-policy.php'):null]);"
  ].join("");
  const result = await runCommand("docker", ["compose", "run", "--rm", "-T", "--entrypoint", "php", "wpcli", "-d", "memory_limit=512M", "/usr/local/bin/wp", "eval", script, "--path=/var/www/html", "--allow-root"], {
    cwd: projectState.runtimePath,
    logPath: path.join(projectState.runtimePath, "logs", "viewing-date-preview-native-read.log"),
    timeoutMs: 120000
  });
  return safeJson(String(result.stdout || "").trim());
}

function browserSummary(result) {
  const status = result.classification.classification;
  const recoveryStatus = result.recovery && result.recovery.status === "prepared" ? "prepared" : "not_prepared";
  const recovery = recoveryStatus === "prepared"
    ? {
      status: recoveryStatus,
      byte_verification_notice: "The Recovery Point is prepared and byte-verified.",
      coverage_notice: "It covers the project's full database, WordPress filesystem, and project metadata.",
      row_inspection_notice: "Individual database rows were not inspected.",
      restore_notice: "Restore has not been run, so restoration of this form and its settings is not yet proven."
    }
    : { status: recoveryStatus };
  return {
    profile: "add_optional_viewing_date@1",
    status,
    preferred_date: status === "applicable" ? "An optional Preferred date will be added." : "Preferred date is already configured or cannot be prepared safely.",
    preservation: "Existing Request Viewing fields and rules will stay in place. The form has not changed.",
    recovery
  };
}

async function createViewingDatePreview(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const slug = validateExplicitSlug(options && options.slug);
  rejectCallerSuppliedProjectAuthority(options);
  const projectState = readProjectBySlug(slug, projectsRoot);
  const observation = await (options && options.observe ? options.observe({ projectState }) : observeNativeRuntime({ projectState }));
  const facts = nativeFactsFromObservation(observation);
  const classification = classifyAddOptionalViewingDateChange(facts);
  const result = { classification, recovery: { status: "not_prepared" } };
  if (classification.classification !== "applicable") return Object.assign({ ok: true }, browserSummary(result));
  const patch = buildPatch(observation.form_content);
  const binding = deriveProjectBinding(projectState.project);
  if (!exactRecords(observation.records)) throw error("viewing_date_runtime_records_unavailable", "The managed form records could not be read safely.");
  const baseline = {
    project_binding: binding,
    form_id: FORM_ID,
    form_sha256: observation.form_sha256,
    actions_sha256: hash(observation.actions),
    binding_sha256: hash(observation.binding),
    policy_sha256: observation.policy_sha256,
    facts_sha256: hash(facts),
    records: { count: observation.records.count, fingerprint: observation.records.fingerprint }
  };
  const planId = "viewing-date-plan-" + crypto.randomUUID();
  const plan = { schema: "csf_viewing_date_preview", version: 1, plan_id: planId, project_slug: slug, project_id: projectState.project.project_id, profile: "add_optional_viewing_date@1", profile_id: PROFILE_ID, profile_version: PROFILE_VERSION, recovery_result_version: RECOVERY_RESULT_VERSION, recovery_coverage_schema: RECOVERY_COVERAGE_SCHEMA, recovery_coverage_version: RECOVERY_COVERAGE_VERSION, baseline, classification, proposed_delta: { add_optional_date_field: { native_block: patch.native_block }, update_binding: ["form_sha256"] }, expected: { form_sha256: patch.expected_form_sha256 }, created_at: new Date().toISOString() };
  atomicJson(path.join(planDirectory(projectState), "plans", planId + ".json"), plan);
  result.plan = plan;
  result.recovery = await matchingPreparedRecovery(projectState, plan, projectsRoot) || result.recovery;
  return Object.assign({ ok: true }, browserSummary(result), { plan_id: planId });
}

function readPlan(projectState, planId) {
  if (typeof planId !== "string" || !/^viewing-date-plan-[0-9a-f-]{36}$/.test(planId)) throw error("viewing_date_plan_invalid", "The prepared preview is unavailable.", 400);
  const filePath = path.join(planDirectory(projectState), "plans", planId + ".json");
  if (!fs.existsSync(filePath)) throw error("viewing_date_plan_missing", "The prepared preview is unavailable.", 404);
  return safeJson(fs.readFileSync(filePath, "utf8"));
}

function hasPersistedViewingDatePlan(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const slug = validateExplicitSlug(options && options.slug);
  const projectState = readProjectBySlug(slug, projectsRoot);
  const directories = [
    projectState.runtimePath,
    path.join(projectState.runtimePath, "proofs"),
    planDirectory(projectState),
    path.join(planDirectory(projectState), "plans")
  ];
  try {
    for (let index = 0; index < directories.length; index += 1) {
      const directory = directories[index];
      if (!fs.existsSync(directory)) return index === 0;
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return true;
    }
    return fs.readdirSync(directories[directories.length - 1], { withFileTypes: true }).length > 0;
  } catch (caught) {
    return true;
  }
}

async function reattestExistingSnapshot(options) {
  if (!isSnapshotId(options && options.snapshotId)) throw error("viewing_date_recovery_snapshot_invalid", "Recovery Point preparation could not verify the required coverage.");
  const inspected = await inspectSnapshotSinglePass({
    projectsRoot: options.projectsRoot,
    plan: options.plan,
    projectState: options.projectState,
    snapshotId: options.snapshotId,
    fs: options && options.fs
  });
  if (!inspected || inspected.snapshot_identity.snapshot_id !== options.snapshotId
    || inspected.snapshot_identity.project_identity_fingerprint !== options.plan.baseline.project_binding.fingerprint) {
    throw error("viewing_date_recovery_coverage_missing", "Recovery Point preparation could not verify the required coverage.");
  }
  return inspected;
}

function canonicalTarEntryInventory(entries) {
  if (!Array.isArray(entries)) return null;
  const inventory = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).length !== 3
      || !Object.hasOwn(entry, "name") || !Object.hasOwn(entry, "size") || !Object.hasOwn(entry, "type")
      || typeof entry.name !== "string" || !Number.isSafeInteger(entry.size) || entry.size < 0
      || (entry.type !== "0" && entry.type !== "5")) return null;
    let name = entry.name;
    if (!name || /[\u0000-\u001f\u007f]/.test(name) || name.includes("\\") || name.startsWith("/")
      || name.startsWith("//") || /^[A-Za-z]:/.test(name)) return null;
    if (name.startsWith("./")) name = name.slice(2);
    if (!name || name.startsWith("./") || (entry.type === "0" && name.endsWith("/"))
      || (entry.type === "5" && (!name.endsWith("/") || entry.size !== 0))) return null;
    if (entry.type === "5") name = name.slice(0, -1);
    const segments = name.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
    const canonical = segments.join("/");
    if (inventory.has(canonical)) return null;
    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = inventory.get(segments.slice(0, index).join("/"));
      if (ancestor && ancestor.type === "0") return null;
    }
    if (entry.type === "0" && Array.from(inventory.keys()).some((key) => key.startsWith(canonical + "/"))) return null;
    inventory.set(canonical, { type: entry.type, size: entry.size });
  }
  return inventory;
}

async function prepareViewingDateRecovery(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const slug = validateExplicitSlug(options && options.slug);
  const projectState = readProjectBySlug(slug, projectsRoot);
  const plan = readPlan(projectState, options && options.planId);
  if (!exactPlanAuthority(plan, projectState, options && options.planId)) throw error("viewing_date_plan_project_mismatch", "The prepared preview is unavailable.");
  const attemptPath = path.join(planDirectory(projectState), "recovery-attempts", plan.plan_id + ".json");
  if (fs.existsSync(attemptPath)) throw error("viewing_date_recovery_already_attempted", "Recovery Point preparation has already been attempted for this preview.");
  const observation = await (options && options.observe ? options.observe({ projectState }) : observeNativeRuntime({ projectState }));
  const facts = nativeFactsFromObservation(observation);
  if (hash(facts) !== plan.baseline.facts_sha256 || observation.form_sha256 !== plan.baseline.form_sha256 || hash(observation.actions) !== plan.baseline.actions_sha256 || hash(observation.binding) !== plan.baseline.binding_sha256 || observation.policy_sha256 !== plan.baseline.policy_sha256) throw error("viewing_date_baseline_drift", "The managed form changed before Recovery Point preparation.");
  atomicJson(attemptPath, { schema: "csf_viewing_date_recovery_attempt", version: 1, plan_id: plan.plan_id, project_slug: slug, started_at: new Date().toISOString() });
  try {
    const capture = options && options.captureSnapshot || createFullStructuralSnapshot;
    const captureResult = await capture({ projectsRoot, slug, idempotencyKey: options && options.idempotencyKey });
    const snapshotId = captureResult && captureResult.result && captureResult.result.snapshot_id;
    if (!isSnapshotId(snapshotId)) throw error("viewing_date_recovery_capture_invalid", "Recovery Point preparation could not verify the required coverage.");
    const reattestation = options && options.reattest
      ? await options.reattest({ projectsRoot, slug, plan, projectState, snapshotId })
      : await reattestExistingSnapshot({ projectsRoot, plan, projectState, snapshotId });
    const manifest = reattestation && reattestation.manifest;
    const coverage = exactCoverage(reattestation && reattestation.coverage);
    const identity = reattestation && reattestation.snapshot_identity;
    if (!manifest || !coverage || !identity || identity.snapshot_id !== snapshotId || !reattestation.inspection || reattestation.inspection.artifact_verification !== "single_pass") throw error("viewing_date_recovery_coverage_missing", "Recovery Point preparation could not verify the required coverage.");
    const after = await (options && options.observe ? options.observe({ projectState }) : observeNativeRuntime({ projectState }));
    if (after.form_sha256 !== plan.baseline.form_sha256 || hash(after.actions) !== plan.baseline.actions_sha256 || hash(after.binding) !== plan.baseline.binding_sha256 || after.policy_sha256 !== plan.baseline.policy_sha256) throw error("viewing_date_baseline_drift", "The managed form changed during Recovery Point preparation.");
    atomicJson(path.join(planDirectory(projectState), "recovery-results", plan.plan_id + ".json"), { schema: RECOVERY_RESULT_SCHEMA, version: RECOVERY_RESULT_VERSION, coverage_schema: RECOVERY_COVERAGE_SCHEMA, coverage_version: RECOVERY_COVERAGE_VERSION, plan_id: plan.plan_id, project_slug: slug, project_id: projectState.project.project_id, project_identity_fingerprint: plan.baseline.project_binding.fingerprint, profile_id: PROFILE_ID, profile_version: PROFILE_VERSION, baseline_sha256: baselineFingerprint(plan), proposed_change_sha256: proposedChangeFingerprint(plan), status: "prepared", snapshot_id: identity.snapshot_id, snapshot_identity: identity, snapshot_reused: false, new_snapshot_created: true, capture_not_invoked: false, coverage, coverage_sha256: coverageFingerprint(coverage), created_at: new Date().toISOString() });
    return { ok: true, status: "prepared", summary: browserSummary({ classification: plan.classification, recovery: { status: "prepared" } }) };
  } catch (caught) {
    atomicJson(path.join(planDirectory(projectState), "recovery-results", plan.plan_id + ".json"), { schema: RECOVERY_RESULT_SCHEMA, version: RECOVERY_RESULT_VERSION, coverage_schema: RECOVERY_COVERAGE_SCHEMA, coverage_version: RECOVERY_COVERAGE_VERSION, plan_id: plan.plan_id, project_slug: slug, project_identity_fingerprint: plan.baseline.project_binding.fingerprint, profile_id: PROFILE_ID, profile_version: PROFILE_VERSION, baseline_sha256: baselineFingerprint(plan), proposed_change_sha256: proposedChangeFingerprint(plan), status: "blocked", code: caught.code || "capture_failed", created_at: new Date().toISOString() });
    throw caught;
  }
}

module.exports = { PROFILE_ID, PROFILE_VERSION, DATE_BLOCK, nativeFactsFromObservation, buildPatch, observeNativeRuntime, createViewingDatePreview, prepareViewingDateRecovery, browserSummary, matchingPreparedRecovery, proposedChangeFingerprint, reattestExistingSnapshot, canonicalTarEntryInventory, exactCoverage, exactProjectMetadata, coverageFingerprint, baselineFingerprint, snapshotIdentity, streamSha256Artifact, verifySnapshotArtifacts, inspectSnapshotSinglePass, createTarInventoryParser, exactPlanAuthority, hasPersistedViewingDatePlan };
