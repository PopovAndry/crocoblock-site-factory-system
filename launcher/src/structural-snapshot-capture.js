"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  assertSafeRuntimePath,
  ensureDirectory,
  readProjectBySlug,
  resolveProjectsRoot,
  validateExplicitSlug,
  writeJsonFile
} = require("./project-store");
const {
  createManifestRecord,
  readManifest,
  resolveSnapshotDirectory,
  toBrowserSafeSummary,
  transitionManifestStatus
} = require("./structural-snapshot-store");
const {
  computeRequestFingerprint,
  runProjectOperation
} = require("./project-operation-coordinator");
const {
  captureDatabaseArtifact,
  sanitizeDiagnosticText
} = require("./structural-snapshot-db-capture");

const OPERATION_TYPE = "structural_snapshot_create";
const WORDPRESS_ARTIFACT_FILENAME = "wordpress.tar";
const METADATA_ARTIFACT_FILENAME = "project-metadata.json";
const MAINTENANCE_FILENAME = ".maintenance";
const ARCHIVE_ROOT = "wordpress";
const MIN_FREE_SPACE_BYTES = 64 * 1024 * 1024;
const DISK_SPACE_MULTIPLIER = 4;
const EXCLUSION_CODES = [
  "wp_config",
  "maintenance_marker",
  "debug_log",
  "cache",
  "upgrade",
  "temporary_files",
  "unsafe_links"
];
const REQUIRED_ARCHIVE_ENTRIES = [
  "wordpress/index.php",
  "wordpress/wp-admin/",
  "wordpress/wp-includes/",
  "wordpress/wp-content/",
  "wordpress/wp-content/plugins/",
  "wordpress/wp-content/themes/"
];

function nowIso() {
  return new Date().toISOString();
}

function timestampCompact(date) {
  return (date || new Date()).toISOString().replace(/[:.]/g, "-");
}

function createFullCaptureError(code, message, statusCode, extras) {
  const error = new Error(message || "Structural snapshot capture failed.");
  error.code = code;
  error.statusCode = statusCode || 500;
  if (extras && typeof extras === "object") {
    Object.assign(error, extras);
  }
  return error;
}

function safeErrorPayload(error, stage) {
  return {
    code: error && error.code ? String(error.code) : "snapshot_full_capture_failed",
    stage: stage || "full_capture",
    message: "Structural snapshot capture did not complete."
  };
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  return child === parent || child.startsWith(parent + path.sep);
}

function toArchivePath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function normalizeRelativeEntry(relativePath) {
  const normalized = toArchivePath(relativePath);
  if (!normalized || normalized.startsWith("/") || normalized.includes("\\") || normalized.includes("\0")) {
    throw createFullCaptureError("snapshot_fs_unsafe_entry", "WordPress filesystem entry is unsafe.", 422);
  }
  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw createFullCaptureError("snapshot_fs_unsafe_entry", "WordPress filesystem entry is unsafe.", 422);
  }
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    throw createFullCaptureError("snapshot_fs_unsafe_entry", "WordPress filesystem entry is unsafe.", 422);
  }
  return normalized;
}

function excludedReason(relativePath, stat) {
  const normalized = toArchivePath(relativePath).toLowerCase();
  if (normalized === "wp-config.php") {
    return "wp_config";
  }
  if (normalized === ".maintenance") {
    return "maintenance_marker";
  }
  if (normalized === "wp-content/debug.log") {
    return "debug_log";
  }
  if (normalized === "wp-content/cache" || normalized.startsWith("wp-content/cache/")) {
    return "cache";
  }
  if (normalized === "wp-content/upgrade" || normalized.startsWith("wp-content/upgrade/")) {
    return "upgrade";
  }
  if (/(^|\/)(?:\.tmp|tmp|temp)(?:\/|$)/.test(normalized) || /\.(?:tmp|temp|swp|bak)$/i.test(normalized)) {
    return "temporary_files";
  }
  if (stat && stat.isSymbolicLink && stat.isSymbolicLink()) {
    return "unsafe_links";
  }
  return null;
}

function resolveWordPressRoot(projectState, projectsRoot) {
  const safeRuntimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const wordpressRoot = path.join(safeRuntimePath, "wordpress");
  if (!isPathInside(safeRuntimePath, wordpressRoot) || !fs.existsSync(wordpressRoot)) {
    throw createFullCaptureError("snapshot_fs_root_missing", "WordPress filesystem root is unavailable.", 404);
  }
  const stat = fs.lstatSync(wordpressRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw createFullCaptureError("snapshot_fs_root_unsafe", "WordPress filesystem root is unsafe.", 422);
  }
  return wordpressRoot;
}

function pushDirectoryEntry(entries, seen, archivePath) {
  const normalized = archivePath.endsWith("/") ? archivePath : archivePath + "/";
  if (!seen.has(normalized)) {
    seen.add(normalized);
    entries.push({
      kind: "directory",
      archivePath: normalized,
      size: 0,
      sourcePath: null
    });
  }
}

function walkWordPressFilesystem(options) {
  const wordpressRoot = options.wordpressRoot;
  const rootReal = fs.realpathSync(wordpressRoot);
  const entries = [];
  const seen = new Set();
  const exclusions = new Set(EXCLUSION_CODES);
  let totalBytes = 0;
  let fileCount = 0;
  let directoryCount = 0;

  pushDirectoryEntry(entries, seen, ARCHIVE_ROOT + "/");

  function visit(absPath, relativePath) {
    const stat = fs.lstatSync(absPath);
    const reason = excludedReason(relativePath, stat);
    if (reason) {
      exclusions.add(reason);
      return;
    }
    if (stat.isSymbolicLink()) {
      throw createFullCaptureError("snapshot_fs_symlink_rejected", "WordPress filesystem contains an unsafe link.", 422);
    }
    const real = fs.realpathSync(absPath);
    if (!isPathInside(rootReal, real)) {
      throw createFullCaptureError("snapshot_fs_reparse_escape", "WordPress filesystem entry escapes its root.", 422);
    }
    const archiveRelative = normalizeRelativeEntry(relativePath);
    const archivePath = ARCHIVE_ROOT + "/" + archiveRelative;

    if (stat.isDirectory()) {
      directoryCount += 1;
      pushDirectoryEntry(entries, seen, archivePath + "/");
      for (const name of fs.readdirSync(absPath).sort()) {
        visit(path.join(absPath, name), path.join(relativePath, name));
      }
      return;
    }
    if (!stat.isFile()) {
      throw createFullCaptureError("snapshot_fs_special_file_rejected", "WordPress filesystem contains an unsupported special file.", 422);
    }

    fileCount += 1;
    totalBytes += stat.size;
    entries.push({
      kind: "file",
      archivePath,
      sourcePath: absPath,
      size: stat.size,
      mode: stat.mode
    });
  }

  for (const name of fs.readdirSync(wordpressRoot).sort()) {
    visit(path.join(wordpressRoot, name), name);
  }

  const archivePaths = new Set(entries.map((entry) => entry.archivePath));
  for (const required of REQUIRED_ARCHIVE_ENTRIES) {
    if (!archivePaths.has(required)) {
      throw createFullCaptureError("snapshot_fs_required_entry_missing", "WordPress filesystem is missing a required structural entry.", 422, {
        required_entry: required
      });
    }
  }
  const uploadsPath = "wordpress/wp-content/uploads/";
  if (!archivePaths.has(uploadsPath)) {
    exclusions.add("uploads_empty_or_absent");
  }
  if (options.requireAgentPlugin === true && !archivePaths.has("wordpress/wp-content/plugins/crocoblock-site-factory/")) {
    throw createFullCaptureError("snapshot_fs_agent_plugin_missing", "Site Factory Agent plugin files are missing.", 422);
  }

  return {
    entries,
    fileCount,
    directoryCount,
    totalBytes,
    exclusions: Array.from(exclusions).sort()
  };
}

function writeOctal(buffer, value, offset, length) {
  const octal = Math.max(0, Number(value || 0)).toString(8);
  const text = octal.padStart(length - 1, "0").slice(-(length - 1)) + "\0";
  buffer.write(text, offset, length, "ascii");
}

function splitTarName(name) {
  const value = String(name || "");
  if (Buffer.byteLength(value, "utf8") <= 100) {
    return { name: value, prefix: "" };
  }
  const parts = value.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const prefix = parts.slice(0, index).join("/");
    const base = parts.slice(index).join("/");
    if (Buffer.byteLength(prefix, "utf8") <= 155 && Buffer.byteLength(base, "utf8") <= 100) {
      return { name: base, prefix };
    }
  }
  throw createFullCaptureError("snapshot_archive_entry_too_long", "Archive entry name is too long.", 422);
}

function createTarHeader(entry) {
  const header = Buffer.alloc(512, 0);
  const names = splitTarName(entry.archivePath);
  header.write(names.name, 0, 100, "utf8");
  writeOctal(header, entry.kind === "directory" ? 0o755 : 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, entry.kind === "file" ? entry.size : 0, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(" ", 148, 156);
  header.write(entry.kind === "directory" ? "5" : "0", 156, 1, "ascii");
  header.write("ustar", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  if (names.prefix) {
    header.write(names.prefix, 345, 155, "utf8");
  }
  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  const checksumText = checksum.toString(8).padStart(6, "0") + "\0 ";
  header.write(checksumText, 148, 8, "ascii");
  return header;
}

function writeStreamChunk(stream, hash, chunk) {
  return new Promise((resolve, reject) => {
    hash.update(chunk);
    stream.write(chunk, (error) => error ? reject(error) : resolve());
  });
}

function closeWriteStream(stream) {
  return new Promise((resolve, reject) => {
    stream.end((error) => error ? reject(error) : resolve());
  });
}

async function appendFileToTar(stream, hash, sourcePath, size) {
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(sourcePath);
    input.on("data", (chunk) => {
      input.pause();
      writeStreamChunk(stream, hash, chunk).then(() => input.resume(), reject);
    });
    input.on("error", reject);
    input.on("end", resolve);
  });
  const remainder = size % 512;
  if (remainder !== 0) {
    await writeStreamChunk(stream, hash, Buffer.alloc(512 - remainder, 0));
  }
}

async function writeTarArchive(options) {
  const stream = fs.createWriteStream(options.tmpPath, { flags: "wx" });
  const hash = crypto.createHash("sha256");
  let sizeBytes = 0;
  async function writeChunk(chunk) {
    sizeBytes += chunk.length;
    await writeStreamChunk(stream, hash, chunk);
  }

  try {
    for (const entry of options.entries) {
      await writeChunk(createTarHeader(entry));
      if (entry.kind === "file") {
        await appendFileToTar(stream, hash, entry.sourcePath, entry.size);
        sizeBytes += entry.size + ((512 - entry.size % 512) % 512);
      }
    }
    await writeChunk(Buffer.alloc(1024, 0));
    await closeWriteStream(stream);
    return {
      digest: hash.digest("hex"),
      size_bytes: sizeBytes
    };
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

function parseTarString(buffer, start, length) {
  const slice = buffer.slice(start, start + length);
  const end = slice.indexOf(0);
  return slice.slice(0, end === -1 ? slice.length : end).toString("utf8");
}

function parseTarOctal(buffer, start, length) {
  const text = parseTarString(buffer, start, length).trim();
  return text ? parseInt(text, 8) : 0;
}

function listTarEntries(filePath) {
  const fd = fs.openSync(filePath, "r");
  const entries = [];
  try {
    let offset = 0;
    const header = Buffer.alloc(512);
    while (true) {
      const bytes = fs.readSync(fd, header, 0, 512, offset);
      if (bytes !== 512) {
        throw createFullCaptureError("snapshot_archive_invalid", "Archive header is incomplete.", 422);
      }
      if (header.every((byte) => byte === 0)) {
        break;
      }
      const name = parseTarString(header, 0, 100);
      const prefix = parseTarString(header, 345, 155);
      const fullName = prefix ? prefix + "/" + name : name;
      const size = parseTarOctal(header, 124, 12);
      const type = parseTarString(header, 156, 1) || "0";
      entries.push({ name: fullName, size, type });
      offset += 512 + Math.ceil(size / 512) * 512;
    }
  } finally {
    fs.closeSync(fd);
  }
  return entries;
}

function validateArchiveEntries(entries, options) {
  const names = new Set(entries.map((entry) => entry.name));
  for (const entry of entries) {
    if (entry.name.startsWith("/") || entry.name.includes("\\") || entry.name.includes("..")) {
      throw createFullCaptureError("snapshot_archive_invalid_entry", "Archive contains an unsafe entry.", 422);
    }
    if (!entry.name.startsWith(ARCHIVE_ROOT + "/")) {
      throw createFullCaptureError("snapshot_archive_invalid_entry", "Archive entry is outside the expected root.", 422);
    }
    const lower = entry.name.toLowerCase().replace(/\/$/u, "");
    if (lower === "wordpress/wp-config.php" || lower === "wordpress/.maintenance" || lower === "wordpress/wp-content/debug.log") {
      throw createFullCaptureError("snapshot_archive_forbidden_entry", "Archive contains a forbidden entry.", 422);
    }
  }
  for (const required of REQUIRED_ARCHIVE_ENTRIES) {
    if (!names.has(required)) {
      throw createFullCaptureError("snapshot_archive_required_entry_missing", "Archive is missing a required entry.", 422, {
        required_entry: required
      });
    }
  }
  if (options.requireAgentPlugin === true && !names.has("wordpress/wp-content/plugins/crocoblock-site-factory/")) {
    throw createFullCaptureError("snapshot_archive_agent_plugin_missing", "Archive is missing Site Factory Agent plugin files.", 422);
  }
  return {
    successful: true,
    checks: [
      "archive_exists",
      "size_positive",
      "sha256_valid",
      "tar_readable",
      "entries_confined",
      "required_wordpress_entries",
      "forbidden_entries_absent"
    ],
    entry_count: entries.length
  };
}

async function captureWordPressFilesystemArtifact(options) {
  const finalPath = path.join(options.snapshotDirectory, WORDPRESS_ARTIFACT_FILENAME);
  const tmpPath = path.join(
    options.snapshotDirectory,
    WORDPRESS_ARTIFACT_FILENAME + ".tmp-" + process.pid + "-" + crypto.randomBytes(4).toString("hex")
  );
  if (fs.existsSync(finalPath)) {
    throw createFullCaptureError("snapshot_fs_artifact_conflict", "WordPress filesystem artifact already exists.", 409);
  }
  try {
    const archive = await writeTarArchive({
      tmpPath,
      entries: options.walk.entries
    });
    if (archive.size_bytes <= 0 || !/^[a-f0-9]{64}$/.test(archive.digest)) {
      throw createFullCaptureError("snapshot_archive_invalid", "WordPress filesystem archive metadata is invalid.", 422);
    }
    const verification = validateArchiveEntries(listTarEntries(tmpPath), {
      requireAgentPlugin: options.requireAgentPlugin
    });
    fs.linkSync(tmpPath, finalPath);
    fs.rmSync(tmpPath, { force: true });
    return {
      type: "wordpress_filesystem",
      relative_filename: WORDPRESS_ARTIFACT_FILENAME,
      digest_algorithm: "sha256",
      digest: archive.digest,
      size_bytes: archive.size_bytes,
      capture_status: "verified",
      verification,
      safe_file_count: options.walk.fileCount,
      safe_entry_count: verification.entry_count,
      exclusions: options.walk.exclusions
    };
  } catch (error) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.rmSync(tmpPath, { force: true });
      }
      if (fs.existsSync(finalPath)) {
        fs.rmSync(finalPath, { force: true });
      }
    } catch (cleanupError) {
      throw createFullCaptureError("snapshot_fs_cleanup_failed", "WordPress filesystem artifact cleanup failed.", 500);
    }
    throw error;
  }
}

function writeMetadataArtifact(options) {
  const finalPath = path.join(options.snapshotDirectory, METADATA_ARTIFACT_FILENAME);
  const tmpPath = finalPath + ".tmp-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
  if (fs.existsSync(finalPath)) {
    throw createFullCaptureError("snapshot_metadata_artifact_conflict", "Snapshot metadata artifact already exists.", 409);
  }
  const payload = JSON.stringify({
    schema: "factory_structural_snapshot_metadata",
    version: 1,
    project_slug: options.project.project.slug,
    project_id: options.project.project.project_id || null,
    site_name: options.project.project.site_name || null,
    wp_port: options.project.project.wp_port || null,
    runtime_status: options.project.project.runtime && options.project.project.runtime.status || null,
    agent_status: options.project.project.agent && options.project.project.agent.status || null,
    agent_version: options.project.project.agent && options.project.project.agent.version || null,
    binding: options.binding,
    created_at: nowIso()
  }, null, 2) + "\n";
  const digest = crypto.createHash("sha256").update(payload, "utf8").digest("hex");
  fs.writeFileSync(tmpPath, payload, "utf8");
  fs.renameSync(tmpPath, finalPath);
  return {
    type: "project_metadata",
    relative_filename: METADATA_ARTIFACT_FILENAME,
    digest_algorithm: "sha256",
    digest,
    size_bytes: Buffer.byteLength(payload),
    capture_status: "verified"
  };
}

function enterMaintenanceMode(wordpressRoot, options) {
  const markerPath = path.join(wordpressRoot, MAINTENANCE_FILENAME);
  if (!isPathInside(wordpressRoot, markerPath)) {
    throw createFullCaptureError("snapshot_maintenance_path_escape", "Maintenance marker path is unsafe.", 500);
  }
  const existedBefore = fs.existsSync(markerPath);
  if (existedBefore) {
    return {
      existedBefore,
      created: false,
      cleanup() {
        return false;
      }
    };
  }
  const tmpPath = markerPath + ".tmp-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
  const now = Math.floor((options.now ? options.now() : Date.now()) / 1000);
  fs.writeFileSync(tmpPath, "<?php $upgrading = " + String(now) + "; ?>\n", "utf8");
  fs.renameSync(tmpPath, markerPath);
  return {
    existedBefore,
    created: true,
    cleanup() {
      if (fs.existsSync(markerPath)) {
        fs.rmSync(markerPath, { force: true });
        return true;
      }
      return false;
    }
  };
}

function probeFreeSpace(targetPath) {
  if (typeof fs.statfsSync === "function") {
    const stat = fs.statfsSync(targetPath);
    return Number(stat.bavail) * Number(stat.bsize);
  }
  return Number.MAX_SAFE_INTEGER;
}

function assertSufficientDiskSpace(options) {
  const available = options.freeSpaceProbe ? options.freeSpaceProbe(options.targetPath) : probeFreeSpace(options.targetPath);
  const required = Math.max(
    MIN_FREE_SPACE_BYTES,
    options.wordpressBytes * DISK_SPACE_MULTIPLIER + options.estimatedDbBytes * 2 + MIN_FREE_SPACE_BYTES
  );
  if (!Number.isFinite(available) || available < required) {
    throw createFullCaptureError("snapshot_disk_space_low", "Insufficient recovery storage space.", 507, {
      required_bytes: required,
      available_bytes: available
    });
  }
  return { required_bytes: required, available_bytes: available };
}

function cleanupSnapshotArtifacts(snapshotDirectory) {
  for (const name of [WORDPRESS_ARTIFACT_FILENAME, METADATA_ARTIFACT_FILENAME, "database.sql"]) {
    const filePath = path.join(snapshotDirectory, name);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  }
  if (fs.existsSync(snapshotDirectory)) {
    for (const entry of fs.readdirSync(snapshotDirectory)) {
      if (entry.includes(".tmp-")) {
        fs.rmSync(path.join(snapshotDirectory, entry), { force: true });
      }
    }
  }
}

function buildInitialManifest(operationId) {
  return {
    snapshot_tier: "local_rescue",
    customer_label: "Recovery Point",
    source_operation_id: operationId,
    consistency_mode: "coordinated_maintenance_db_filesystem_capture",
    captured_components: [],
    excluded_components: EXCLUSION_CODES,
    artifacts: [],
    software: {
      capture_service: "structural_snapshot_capture_20a3b",
      archive_format: "ustar"
    },
    verification: {
      status: "not_verified",
      successful: false,
      checks: [],
      warnings: []
    },
    restore_compatibility: {
      status: "not_evaluated",
      blocking: true,
      blockers: ["capture_incomplete"]
    },
    provenance: {
      source: "launcher_structural_snapshot_capture_20a3b",
      capture_scope: "database_and_wordpress_filesystem"
    }
  };
}

function safeProofRef(proofId) {
  return "proofs/" + proofId + ".json";
}

function writeFullCaptureProof(options) {
  const proofId = "snapshot-full-capture-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
  const proof = {
    proof_id: proofId,
    project_slug: options.projectSlug,
    operation_id: options.operationId,
    snapshot_id: options.snapshotId,
    status: options.status,
    consistency_mode: "coordinated_maintenance_db_filesystem_capture",
    components: options.components || [],
    artifacts: options.artifacts || [],
    safe_file_count: options.safeFileCount || 0,
    verification: options.verification || null,
    manifest_status: options.manifestStatus || null,
    restorable: options.restorable === true,
    compatibility: options.compatibility || null,
    declared_exclusions: options.exclusions || [],
    maintenance: options.maintenance || null,
    route_health: options.routeHealth || null,
    duration_ms: options.durationMs,
    error: options.error || null,
    created_at: nowIso()
  };
  const proofPath = path.join(options.runtimePath, "proofs", proofId + ".json");
  writeJsonFile(proofPath, proof);
  return {
    proof,
    proofRef: safeProofRef(proofId)
  };
}

function publicArtifact(artifact) {
  return {
    type: artifact.type,
    size_bytes: artifact.size_bytes,
    digest_algorithm: artifact.digest_algorithm,
    digest_abbrev: artifact.digest ? artifact.digest.slice(0, 12) : null,
    capture_status: artifact.capture_status
  };
}

async function executeFullCapture(context, options) {
  const startedAt = Date.now();
  const projectState = context.projectState;
  const projectsRoot = context.projectsRoot;
  const safeRuntimePath = assertSafeRuntimePath(projectState.runtimePath, projectsRoot);
  const wordpressRoot = resolveWordPressRoot(projectState, projectsRoot);
  const requireAgentPlugin = (projectState.project.agent && projectState.project.agent.status) === "installed";
  let snapshotId = null;
  let stage = "preflight";
  let maintenance = null;
  let dbArtifact = null;
  let fsArtifact = null;

  try {
    await context.setStage("preflight");
    const walk = options.filesystemWalker
      ? options.filesystemWalker({ wordpressRoot, requireAgentPlugin })
      : walkWordPressFilesystem({ wordpressRoot, requireAgentPlugin });
    const snapshotContextPreview = resolveSnapshotDirectory({
      projectsRoot,
      slug: projectState.project.slug,
      snapshotId: options.snapshotId || undefined
    });
    const disk = assertSufficientDiskSpace({
      targetPath: snapshotContextPreview.projectsRoot,
      wordpressBytes: walk.totalBytes,
      estimatedDbBytes: options.estimatedDbBytes || 16 * 1024 * 1024,
      freeSpaceProbe: options.freeSpaceProbe
    });

    const created = createManifestRecord({
      projectsRoot,
      slug: projectState.project.slug,
      snapshotId: options.snapshotId,
      manifest: buildInitialManifest(context.operationId)
    });
    snapshotId = created.manifest.snapshot_id;
    const snapshotContext = resolveSnapshotDirectory({
      projectsRoot,
      slug: projectState.project.slug,
      snapshotId
    });

    stage = "maintenance";
    await context.setStage(stage, {
      result_summary: {
        snapshot_id: snapshotId,
        manifest_status: "creating",
        restorable: false
      }
    });
    maintenance = options.maintenanceController
      ? options.maintenanceController({ wordpressRoot, now: options.now })
      : enterMaintenanceMode(wordpressRoot, { now: options.now });

    stage = "capturing_database";
    await context.setStage(stage);
    dbArtifact = await captureDatabaseArtifact({
      projectsRoot,
      runtimePath: safeRuntimePath,
      snapshotDirectory: snapshotContext.snapshotDirectory,
      dumpRunner: options.dumpRunner,
      timeoutMs: options.dbTimeoutMs
    });

    stage = "capturing_filesystem";
    await context.setStage(stage);
    fsArtifact = options.archiveRunner
      ? await options.archiveRunner({ snapshotDirectory: snapshotContext.snapshotDirectory, walk, requireAgentPlugin })
      : await captureWordPressFilesystemArtifact({
        snapshotDirectory: snapshotContext.snapshotDirectory,
        walk,
        requireAgentPlugin
      });

    const metadataArtifact = writeMetadataArtifact({
      snapshotDirectory: snapshotContext.snapshotDirectory,
      project: projectState,
      binding: snapshotContext.binding.basis
    });

    stage = "manifest_complete";
    await context.setStage(stage);
    const capturedComponents = [
      "database",
      "logical_database_dump",
      "wordpress_filesystem",
      "sanitized_project_metadata",
      "dependency_theme_plugin_identities",
      "agent_version_binding"
    ];
    const allChecks = []
      .concat(dbArtifact.verification && dbArtifact.verification.checks || [])
      .concat(fsArtifact.verification && fsArtifact.verification.checks || [])
      .concat(["project_metadata_artifact"]);
    const completed = transitionManifestStatus({
      projectsRoot,
      slug: projectState.project.slug,
      snapshotId,
      status: "complete",
      patch: {
        captured_components: capturedComponents,
        excluded_components: walk.exclusions,
        artifacts: [dbArtifact, fsArtifact, metadataArtifact],
        verification: {
          status: "artifacts_verified",
          successful: true,
          verified_at: nowIso(),
          checks: allChecks,
          warnings: []
        },
        restore_compatibility: {
          status: "same_project_compatible",
          blocking: false,
          blockers: [],
          warnings: []
        },
        provenance: {
          source: "launcher_structural_snapshot_capture_20a3b",
          capture_scope: "database_and_wordpress_filesystem",
          operation_id: context.operationId
        }
      }
    });

    stage = "manifest_verified";
    await context.setStage(stage);
    const verified = transitionManifestStatus({
      projectsRoot,
      slug: projectState.project.slug,
      snapshotId,
      status: "verified"
    });

    stage = "maintenance_cleanup";
    await context.setStage(stage);
    const maintenanceCleanup = maintenance ? maintenance.cleanup() : false;
    const durationMs = Date.now() - startedAt;
    const proofResult = writeFullCaptureProof({
      runtimePath: safeRuntimePath,
      projectSlug: projectState.project.slug,
      operationId: context.operationId,
      snapshotId,
      status: "succeeded",
      components: ["database", "wordpress_filesystem"],
      artifacts: [publicArtifact(dbArtifact), publicArtifact(fsArtifact), publicArtifact(metadataArtifact)],
      safeFileCount: fsArtifact.safe_file_count || walk.fileCount,
      verification: {
        status: verified.manifest.verification.status,
        successful: true,
        checks: verified.manifest.verification.checks
      },
      manifestStatus: verified.manifest.status,
      restorable: verified.summary.restorable,
      compatibility: verified.manifest.restore_compatibility,
      exclusions: walk.exclusions,
      maintenance: {
        existed_before: maintenance ? maintenance.existedBefore === true : false,
        created_by_operation: maintenance ? maintenance.created === true : false,
        removed_by_operation: maintenanceCleanup === true
      },
      durationMs
    });

    return {
      result: {
        snapshot_id: snapshotId,
        manifest: verified.manifest,
        summary: verified.summary,
        proof: proofResult.proof,
        proof_ref: proofResult.proofRef,
        safe_file_count: fsArtifact.safe_file_count || walk.fileCount,
        disk
      },
      proofRef: proofResult.proofRef,
      resultSummary: {
        snapshot_id: snapshotId,
        manifest_status: verified.manifest.status,
        restorable: verified.summary.restorable,
        database_size_bytes: dbArtifact.size_bytes,
        database_digest_abbrev: dbArtifact.digest.slice(0, 12),
        filesystem_size_bytes: fsArtifact.size_bytes,
        filesystem_digest_abbrev: fsArtifact.digest.slice(0, 12),
        safe_file_count: fsArtifact.safe_file_count || walk.fileCount,
        verification_status: verified.manifest.verification.status,
        duration_ms: durationMs
      }
    };
  } catch (error) {
    if (maintenance && maintenance.created === true) {
      try {
        maintenance.cleanup();
      } catch (cleanupError) {
        error = createFullCaptureError("snapshot_maintenance_cleanup_failed", "Maintenance cleanup failed.", 500);
      }
    }
    if (snapshotId) {
      try {
        const snapshotContext = resolveSnapshotDirectory({
          projectsRoot,
          slug: projectState.project.slug,
          snapshotId
        });
        cleanupSnapshotArtifacts(snapshotContext.snapshotDirectory);
        transitionManifestStatus({
          projectsRoot,
          slug: projectState.project.slug,
          snapshotId,
          status: "incomplete",
          patch: {
            captured_components: [],
            excluded_components: ["database", "wordpress_filesystem"],
            verification: {
              status: "full_capture_failed",
              successful: false,
              checks: [],
              warnings: ["full_capture_incomplete"]
            },
            restore_compatibility: {
              status: "blocked",
              blocking: true,
              blockers: ["full_capture_incomplete"]
            },
            provenance: {
              source: "launcher_structural_snapshot_capture_20a3b",
              capture_scope: "database_and_wordpress_filesystem",
              failure_code: error && error.code ? String(error.code) : "snapshot_full_capture_failed",
              failure_stage: stage
            }
          }
        });
      } catch (transitionError) {
        // Preserve original failure.
      }
      writeFullCaptureProof({
        runtimePath: safeRuntimePath,
        projectSlug: projectState.project.slug,
        operationId: context.operationId,
        snapshotId,
        status: "failed",
        manifestStatus: "incomplete",
        restorable: false,
        error: safeErrorPayload(error, stage),
        durationMs: Date.now() - startedAt
      });
    }
    if (error && error.code) {
      throw error;
    }
    throw createFullCaptureError("snapshot_full_capture_failed", "Structural snapshot capture failed.", 500);
  }
}

async function createFullStructuralSnapshot(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const slug = validateExplicitSlug(options && options.slug);
  readProjectBySlug(slug, projectsRoot);
  const fingerprintInput = {
    capture: "full_structural_recovery_point",
    schema_version: 1,
    project_slug: slug
  };
  const operationResult = await runProjectOperation({
    projectsRoot,
    slug,
    operationType: OPERATION_TYPE,
    idempotencyKey: options && options.idempotencyKey,
    requestFingerprint: computeRequestFingerprint({
      project_slug: slug,
      operation_type: OPERATION_TYPE,
      input: fingerprintInput
    }),
    fingerprintInput,
    metadata: {
      capture_scope: "full_structural_recovery_point",
      snapshot_tier: "local_rescue"
    },
    safety: {
      live_ai_used: false,
      apply_used: false,
      rollback_used: false,
      database_export_used: true,
      filesystem_capture_used: true,
      restore_used: false
    },
    execute: async (context) => executeFullCapture(context, {
      dumpRunner: options && options.dumpRunner,
      archiveRunner: options && options.archiveRunner,
      maintenanceController: options && options.maintenanceController,
      freeSpaceProbe: options && options.freeSpaceProbe,
      filesystemWalker: options && options.filesystemWalker,
      estimatedDbBytes: options && options.estimatedDbBytes,
      snapshotId: options && options.snapshotId,
      now: options && options.now
    })
  });

  if (operationResult.idempotentReplay && operationResult.operation.result_summary) {
    const snapshotId = operationResult.operation.result_summary.snapshot_id;
    if (snapshotId) {
      const manifest = readManifest({ projectsRoot, slug, snapshotId });
      return Object.assign({}, operationResult, {
        result: {
          snapshot_id: snapshotId,
          manifest,
          summary: toBrowserSafeSummary(manifest),
          proof_ref: operationResult.operation.proof_ref || null
        }
      });
    }
  }

  return operationResult;
}

module.exports = {
  ARCHIVE_ROOT,
  EXCLUSION_CODES,
  METADATA_ARTIFACT_FILENAME,
  OPERATION_TYPE,
  REQUIRED_ARCHIVE_ENTRIES,
  WORDPRESS_ARTIFACT_FILENAME,
  captureWordPressFilesystemArtifact,
  executeFullCapture,
  createFullStructuralSnapshot,
  enterMaintenanceMode,
  listTarEntries,
  sanitizeDiagnosticText,
  validateArchiveEntries,
  walkWordPressFilesystem
};
