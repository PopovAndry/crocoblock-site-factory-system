"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
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

const OPERATION_TYPE = "structural_snapshot_create";
const DB_SERVICE = "mysql";
const DB_ARTIFACT_FILENAME = "database.sql";
const DUMP_TIMEOUT_MS = 120000;
const STDERR_LIMIT = 4096;
const MYSQLDUMP_SCRIPT = [
  "set -eu;",
  // MySQL 8-compatible WordPress logical dump. Credentials expand only inside the DB container.
  "mysqldump",
  "--single-transaction",
  "--quick",
  "--skip-lock-tables",
  "--routines",
  "--triggers",
  "--events",
  "--hex-blob",
  "--default-character-set=utf8mb4",
  "--no-tablespaces",
  "--set-gtid-purged=OFF",
  "-u\"$MYSQL_USER\"",
  "-p\"$MYSQL_PASSWORD\"",
  "\"$MYSQL_DATABASE\""
].join(" ");

function nowIso() {
  return new Date().toISOString();
}

function timestampCompact(date) {
  return (date || new Date()).toISOString().replace(/[:.]/g, "-");
}

function createCaptureError(code, message, statusCode, extras) {
  const error = new Error(message || "Database snapshot capture failed.");
  error.code = code;
  error.statusCode = statusCode || 500;
  if (extras && typeof extras === "object") {
    Object.assign(error, extras);
  }
  return error;
}

function tailText(text, maxLength) {
  const value = String(text || "");
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(value.length - maxLength);
}

function sanitizeDiagnosticText(text) {
  return tailText(String(text || ""), STDERR_LIMIT)
    .replace(/-p(['"]?)[^\s'"]+\1/g, "-p[redacted]")
    .replace(/MYSQL_PASSWORD=[^\s]+/gi, "MYSQL_PASSWORD=[redacted]")
    .replace(/DB_PASSWORD=[^\s]+/gi, "DB_PASSWORD=[redacted]")
    .replace(/password[=:]\s*[^\s]+/gi, "password=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b[A-Fa-f0-9]{64}\b/g, "[digest]");
}

function safeErrorPayload(error, stage) {
  return {
    code: error && error.code ? String(error.code) : "snapshot_db_dump_failed",
    stage: stage || "capture_database",
    message: "Database snapshot capture did not complete."
  };
}

function safeProofRef(proofId) {
  return "proofs/" + proofId + ".json";
}

function ensureNoReparsePoint(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    throw createCaptureError("snapshot_db_artifact_conflict", "Snapshot artifact path is unsafe.", 409);
  }
}

function resolveArtifactPaths(snapshotDirectory) {
  const finalPath = path.join(snapshotDirectory, DB_ARTIFACT_FILENAME);
  const tmpPath = path.join(
    snapshotDirectory,
    DB_ARTIFACT_FILENAME + ".tmp-" + process.pid + "-" + crypto.randomBytes(4).toString("hex")
  );
  const relativeFinal = path.relative(snapshotDirectory, finalPath);
  const relativeTmp = path.relative(snapshotDirectory, tmpPath);
  if (relativeFinal !== DB_ARTIFACT_FILENAME || relativeTmp.startsWith("..") || path.isAbsolute(relativeTmp)) {
    throw createCaptureError("snapshot_db_artifact_conflict", "Snapshot artifact path escaped its directory.", 500);
  }
  ensureNoReparsePoint(snapshotDirectory);
  ensureNoReparsePoint(finalPath);
  if (fs.existsSync(finalPath)) {
    throw createCaptureError("snapshot_db_artifact_conflict", "Snapshot database artifact already exists.", 409);
  }
  return {
    finalPath,
    tmpPath,
    relativeFilename: DB_ARTIFACT_FILENAME
  };
}

function writeChunk(stream, chunk) {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function closeStream(stream) {
  return new Promise((resolve, reject) => {
    stream.end((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function spawnDockerComposeDump(options) {
  const timeoutMs = options.timeoutMs || DUMP_TIMEOUT_MS;
  const args = ["compose", "exec", "-T", DB_SERVICE, "sh", "-lc", MYSQLDUMP_SCRIPT];

  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      cwd: options.runtimePath,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    function finish(error, result) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }

    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        finish(createCaptureError("snapshot_db_runtime_unavailable", "Docker runtime is unavailable.", 503));
        return;
      }
      finish(createCaptureError("snapshot_db_runtime_unavailable", "Docker runtime failed to start.", 503));
    });

    child.stderr.on("data", (chunk) => {
      stderr = tailText(stderr + chunk.toString("utf8"), STDERR_LIMIT);
    });

    child.stdout.on("data", (chunk) => {
      child.stdout.pause();
      Promise.resolve(options.onStdoutChunk(chunk))
        .then(() => child.stdout.resume())
        .catch((error) => {
          child.kill("SIGTERM");
          finish(error);
        });
    });

    child.on("close", (code) => {
      if (timedOut) {
        finish(null, {
          code,
          timedOut: true,
          stderr: sanitizeDiagnosticText(stderr)
        });
        return;
      }
      finish(null, {
        code,
        timedOut: false,
        stderr: sanitizeDiagnosticText(stderr)
      });
    });
  });
}

async function captureProcessToTempFile(options) {
  const hash = crypto.createHash("sha256");
  let sizeBytes = 0;
  const stream = fs.createWriteStream(options.tmpPath, { flags: "wx" });
  let streamClosed = false;

  try {
    const result = await options.dumpRunner({
      runtimePath: options.runtimePath,
      dbService: DB_SERVICE,
      timeoutMs: options.timeoutMs || DUMP_TIMEOUT_MS,
      onStdoutChunk: async (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
        sizeBytes += buffer.length;
        hash.update(buffer);
        await writeChunk(stream, buffer);
      }
    });
    await closeStream(stream);
    streamClosed = true;
    return {
      process: result || { code: 0, timedOut: false, stderr: "" },
      digest: hash.digest("hex"),
      sizeBytes
    };
  } catch (error) {
    if (!streamClosed) {
      stream.destroy();
    }
    throw error;
  }
}

function scanSqlDump(filePath) {
  return new Promise((resolve, reject) => {
    const tables = new Set();
    const markers = {
      createTable: false,
      mysqlDump: false
    };
    let prefix = "";
    let carry = "";
    let rejected = null;
    const stream = fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: 8192 });

    stream.on("data", (chunk) => {
      if (prefix.length < 4096) {
        prefix = (prefix + chunk).slice(0, 4096);
        const trimmed = prefix.trimStart().toLowerCase();
        if (trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html") || trimmed.includes("<form") && trimmed.includes("login")) {
          rejected = createCaptureError("snapshot_db_dump_invalid", "Database dump output is not SQL.", 422);
          stream.destroy(rejected);
          return;
        }
      }

      const text = carry + chunk;
      if (/--\s*MySQL dump/i.test(text)) {
        markers.mysqlDump = true;
      }
      if (/\bCREATE\s+TABLE\b/i.test(text)) {
        markers.createTable = true;
      }
      const tableRegex = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([A-Za-z0-9_]+)[`"]?/gi;
      let match;
      while ((match = tableRegex.exec(text)) !== null) {
        tables.add(match[1]);
      }
      carry = text.slice(-256);
    });

    stream.on("error", (error) => {
      reject(rejected || error);
    });

    stream.on("end", () => {
      const prefixCandidates = [];
      for (const table of tables) {
        if (table.endsWith("options")) {
          prefixCandidates.push(table.slice(0, -"options".length));
        }
      }
      const prefixMatch = prefixCandidates.find((candidate) => {
        return tables.has(candidate + "options") &&
          tables.has(candidate + "posts") &&
          tables.has(candidate + "postmeta");
      });

      if (!markers.createTable || !prefixMatch) {
        reject(createCaptureError("snapshot_db_dump_invalid", "Database dump did not contain expected WordPress tables.", 422));
        return;
      }

      resolve({
        successful: true,
        checks: [
          "file_exists",
          "size_positive",
          "sha256_valid",
          "sql_create_table_markers",
          "wordpress_options_table",
          "wordpress_posts_table",
          "wordpress_postmeta_table"
        ],
        table_prefix_hint: prefixMatch,
        mysql_dump_marker: markers.mysqlDump
      });
    });
  });
}

async function verifyDumpArtifact(filePath, artifact) {
  if (!fs.existsSync(filePath)) {
    throw createCaptureError("snapshot_db_dump_invalid", "Database dump artifact is missing.", 422);
  }
  if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0) {
    throw createCaptureError("snapshot_db_dump_empty", "Database dump was empty.", 422);
  }
  if (!/^[a-f0-9]{64}$/.test(String(artifact.digest || ""))) {
    throw createCaptureError("snapshot_db_dump_invalid", "Database dump digest is invalid.", 422);
  }
  return scanSqlDump(filePath);
}

function promoteArtifact(tmpPath, finalPath) {
  if (fs.existsSync(finalPath)) {
    throw createCaptureError("snapshot_db_artifact_conflict", "Snapshot database artifact already exists.", 409);
  }
  fs.linkSync(tmpPath, finalPath);
  fs.rmSync(tmpPath, { force: true });
}

function cleanupFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  } catch (error) {
    const cleanupError = createCaptureError("snapshot_db_cleanup_failed", "Snapshot database artifact cleanup failed.", 500);
    cleanupError.cause = error;
    throw cleanupError;
  }
}

function writeDbCaptureProof(options) {
  const proofId = "snapshot-db-capture-" + timestampCompact() + "-" + crypto.randomBytes(3).toString("hex");
  const proof = {
    proof_id: proofId,
    project_slug: options.projectSlug,
    operation_id: options.operationId,
    snapshot_id: options.snapshotId,
    status: options.status,
    artifact: options.artifact || null,
    verification: options.verification || null,
    manifest_status: options.manifestStatus || null,
    restorable: options.restorable === true,
    compatibility: options.compatibility || null,
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

function buildInitialManifest(operationId) {
  return {
    snapshot_tier: "local_rescue",
    customer_label: "Recovery Point",
    source_operation_id: operationId,
    consistency_mode: "logical_database_single_transaction_db_only",
    captured_components: [],
    excluded_components: ["wordpress_filesystem"],
    artifacts: [],
    software: {
      database_capture_service: "structural_snapshot_db_capture_20a3a",
      db_service: DB_SERVICE
    },
    verification: {
      status: "not_verified",
      successful: false,
      checks: [],
      warnings: ["wordpress_filesystem_not_captured"]
    },
    restore_compatibility: {
      status: "blocked",
      blocking: true,
      blockers: ["wordpress_filesystem_required"]
    },
    provenance: {
      source: "launcher_structural_snapshot_db_capture_20a3a",
      capture_scope: "database_only"
    }
  };
}

function resultSummaryFromManifest(manifest) {
  const artifact = manifest.artifacts.find((entry) => entry.type === "database_dump") || null;
  const summary = toBrowserSafeSummary(manifest);
  return {
    snapshot_id: manifest.snapshot_id,
    manifest_status: manifest.status,
    restorable: summary.restorable,
    artifact_type: artifact ? artifact.type : null,
    artifact_size_bytes: artifact ? artifact.size_bytes : 0,
    artifact_digest_abbrev: artifact ? artifact.digest.slice(0, 12) : null,
    verification_status: manifest.verification.status,
    compatibility_blocking: manifest.restore_compatibility.blocking
  };
}

async function executeDatabaseCapture(context, options) {
  const startedAt = Date.now();
  const projectState = context.projectState;
  const safeRuntimePath = assertSafeRuntimePath(projectState.runtimePath, context.projectsRoot);
  const created = createManifestRecord({
    projectsRoot: context.projectsRoot,
    slug: projectState.project.slug,
    manifest: buildInitialManifest(context.operationId)
  });
  const snapshotId = created.manifest.snapshot_id;
  const snapshotContext = resolveSnapshotDirectory({
    projectsRoot: context.projectsRoot,
    slug: projectState.project.slug,
    snapshotId
  });
  const artifactPaths = resolveArtifactPaths(snapshotContext.snapshotDirectory);
  const dumpRunner = options.dumpRunner || spawnDockerComposeDump;
  let lastStage = "dumping_database";

  try {
    await context.setStage("dumping_database", {
      result_summary: {
        snapshot_id: snapshotId,
        manifest_status: "creating",
        restorable: false
      }
    });

    const captured = await captureProcessToTempFile({
      runtimePath: safeRuntimePath,
      tmpPath: artifactPaths.tmpPath,
      dumpRunner,
      timeoutMs: options.timeoutMs || DUMP_TIMEOUT_MS
    });

    if (captured.process.timedOut) {
      throw createCaptureError("snapshot_db_dump_timeout", "Database dump timed out.", 504);
    }
    if (Number(captured.process.code || 0) !== 0) {
      throw createCaptureError("snapshot_db_dump_failed", "Database dump process failed.", 502, {
        diagnostic: sanitizeDiagnosticText(captured.process.stderr || "")
      });
    }
    if (captured.sizeBytes <= 0) {
      throw createCaptureError("snapshot_db_dump_empty", "Database dump was empty.", 422);
    }

    lastStage = "verifying_database_dump";
    await context.setStage(lastStage);
    const verification = await verifyDumpArtifact(artifactPaths.tmpPath, {
      digest: captured.digest,
      sizeBytes: captured.sizeBytes
    });
    promoteArtifact(artifactPaths.tmpPath, artifactPaths.finalPath);

    lastStage = "updating_manifest";
    await context.setStage(lastStage);
    const completed = transitionManifestStatus({
      projectsRoot: context.projectsRoot,
      slug: projectState.project.slug,
      snapshotId,
      status: "complete",
      patch: {
        captured_components: ["database"],
        excluded_components: ["wordpress_filesystem"],
        artifacts: [{
          type: "database_dump",
          relative_filename: artifactPaths.relativeFilename,
          digest_algorithm: "sha256",
          digest: captured.digest,
          size_bytes: captured.sizeBytes,
          capture_status: "verified"
        }],
        verification: {
          status: "database_artifact_verified",
          successful: true,
          verified_at: nowIso(),
          checks: verification.checks,
          warnings: ["wordpress_filesystem_not_captured"]
        },
        restore_compatibility: {
          status: "blocked",
          blocking: true,
          blockers: ["wordpress_filesystem_required"],
          warnings: ["database_only_snapshot_not_restorable"]
        },
        provenance: {
          source: "launcher_structural_snapshot_db_capture_20a3a",
          capture_scope: "database_only",
          operation_id: context.operationId
        }
      }
    });
    const durationMs = Date.now() - startedAt;
    const summary = resultSummaryFromManifest(completed.manifest);
    const proofResult = writeDbCaptureProof({
      runtimePath: safeRuntimePath,
      projectSlug: projectState.project.slug,
      operationId: context.operationId,
      snapshotId,
      status: "succeeded",
      artifact: {
        type: "database_dump",
        size_bytes: captured.sizeBytes,
        digest_algorithm: "sha256",
        digest_abbrev: captured.digest.slice(0, 12)
      },
      verification: {
        status: completed.manifest.verification.status,
        successful: true,
        checks: completed.manifest.verification.checks
      },
      manifestStatus: completed.manifest.status,
      restorable: completed.summary.restorable,
      compatibility: completed.manifest.restore_compatibility,
      durationMs
    });

    return {
      result: {
        snapshot_id: snapshotId,
        manifest: completed.manifest,
        summary: completed.summary,
        proof: proofResult.proof,
        proof_ref: proofResult.proofRef,
        artifact: summary
      },
      proofRef: proofResult.proofRef,
      resultSummary: Object.assign(summary, {
        duration_ms: durationMs
      })
    };
  } catch (error) {
    try {
      cleanupFile(artifactPaths.tmpPath);
      cleanupFile(artifactPaths.finalPath);
    } catch (cleanupError) {
      error = cleanupError;
    }

    try {
      transitionManifestStatus({
        projectsRoot: context.projectsRoot,
        slug: projectState.project.slug,
        snapshotId,
        status: "incomplete",
        patch: {
          captured_components: [],
          excluded_components: ["wordpress_filesystem", "database"],
          verification: {
            status: "database_artifact_failed",
            successful: false,
            checks: [],
            warnings: ["database_capture_incomplete"]
          },
          restore_compatibility: {
            status: "blocked",
            blocking: true,
            blockers: ["database_artifact_incomplete", "wordpress_filesystem_required"]
          },
          provenance: {
            source: "launcher_structural_snapshot_db_capture_20a3a",
            capture_scope: "database_only",
            failure_code: error && error.code ? String(error.code) : "snapshot_db_dump_failed",
            failure_stage: lastStage
          }
        }
      });
    } catch (transitionError) {
      // Preserve the original capture failure; an incomplete manifest is best-effort.
    }

    writeDbCaptureProof({
      runtimePath: safeRuntimePath,
      projectSlug: projectState.project.slug,
      operationId: context.operationId,
      snapshotId,
      status: "failed",
      artifact: null,
      verification: {
        status: "database_artifact_failed",
        successful: false
      },
      manifestStatus: "incomplete",
      restorable: false,
      compatibility: {
        status: "blocked",
        blocking: true,
        blockers: ["database_artifact_incomplete", "wordpress_filesystem_required"]
      },
      durationMs: Date.now() - startedAt,
      error: safeErrorPayload(error, lastStage)
    });

    if (error && error.code) {
      throw error;
    }
    throw createCaptureError("snapshot_db_dump_failed", "Database dump failed.", 500);
  }
}

async function createDatabaseStructuralSnapshot(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const slug = validateExplicitSlug(options && options.slug);
  readProjectBySlug(slug, projectsRoot);
  const fingerprintInput = {
    capture: "logical_database_dump",
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
      capture_scope: "database_only",
      snapshot_tier: "local_rescue"
    },
    safety: {
      live_ai_used: false,
      apply_used: false,
      rollback_used: false,
      database_export_used: true,
      filesystem_capture_used: false,
      restore_used: false
    },
    execute: async (context) => executeDatabaseCapture(context, {
      dumpRunner: options && options.dumpRunner,
      timeoutMs: options && options.timeoutMs
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
  DB_ARTIFACT_FILENAME,
  DB_SERVICE,
  MYSQLDUMP_SCRIPT,
  OPERATION_TYPE,
  createDatabaseStructuralSnapshot,
  scanSqlDump,
  sanitizeDiagnosticText,
  spawnDockerComposeDump,
  verifyDumpArtifact
};
