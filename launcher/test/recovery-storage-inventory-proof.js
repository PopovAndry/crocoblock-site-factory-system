"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const {
  evaluateRecoveryStorageGovernance
} = require("../src/recovery-storage-governance");
const {
  resolveSnapshotDirectory
} = require("../src/structural-snapshot-store");

const DEFAULT_MAX_ENTRIES = 100000;
const DEFAULT_DEADLINE_MS = 120000;

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function safeRootIdentity(rootPath) {
  return sha256Text(path.resolve(rootPath).toLowerCase()).slice(0, 16);
}

function now(options) {
  return options.clock ? Number(options.clock()) : Date.now();
}

function makeBlocker(code, relativePath, operation, extras) {
  return Object.assign({
    code,
    relative_path: relativePath || ".",
    operation: operation || "inventory"
  }, extras || {});
}

function isReparseOrSymlink(stat) {
  if (stat.isSymbolicLink && stat.isSymbolicLink()) {
    return true;
  }
  return typeof stat.reparsePointTag === "number" && stat.reparsePointTag !== 0;
}

function getEntryType(stat) {
  if (stat.isDirectory()) {
    return "directory";
  }
  if (stat.isFile()) {
    return "file";
  }
  if (stat.isSymbolicLink && stat.isSymbolicLink()) {
    return "symlink";
  }
  return "other";
}

function fileIdentity(stat) {
  if (Number.isFinite(stat.dev) && Number.isFinite(stat.ino)) {
    return String(stat.dev) + ":" + String(stat.ino);
  }
  return null;
}

function checkDeadline(state, options, relativePath, operation) {
  if (now(options) > state.deadlineAt) {
    const blocker = makeBlocker("inventory_deadline_exceeded", relativePath, operation, {
      deadline_ms: state.deadlineMs
    });
    state.blockers.push(blocker);
    return blocker;
  }
  return null;
}

function pushEntryCount(state, options, relativePath) {
  state.entryCount += 1;
  if (state.entryCount > state.maxEntries) {
    const blocker = makeBlocker("inventory_entry_limit_exceeded", relativePath, "entry_count", {
      max_entries: state.maxEntries
    });
    state.blockers.push(blocker);
    return blocker;
  }
  return null;
}

async function hashFileStreaming(filePath, relativePath, state, options) {
  const deadlineBlocker = checkDeadline(state, options, relativePath, "hash_file");
  if (deadlineBlocker) {
    return { digest: null, blocker: deadlineBlocker };
  }
  const hash = crypto.createHash("sha256");
  const streamFactory = options.streamFactory || ((target) => fs.createReadStream(target));
  let stream;
  try {
    stream = streamFactory(filePath, { highWaterMark: options.highWaterMark || 1024 * 1024 });
  } catch (error) {
    const blocker = makeBlocker("inventory_file_read_failed", relativePath, "hash_file", {
      error_code: error && error.code || "read_failed"
    });
    state.blockers.push(blocker);
    return { digest: null, blocker };
  }
  let settled = false;
  let blocker = null;
  stream.on("data", (chunk) => {
    if (blocker) {
      return;
    }
    const currentBlocker = checkDeadline(state, options, relativePath, "hash_file");
    if (currentBlocker) {
      blocker = currentBlocker;
      stream.destroy();
      return;
    }
    hash.update(chunk);
  });
  stream.on("error", (error) => {
    if (!blocker) {
      blocker = makeBlocker("inventory_file_read_failed", relativePath, "hash_file", {
        error_code: error && error.code || "read_failed"
      });
      state.blockers.push(blocker);
    }
    settled = true;
  });
  stream.on("end", () => {
    settled = true;
  });
  if (!settled) {
    await Promise.race([
      once(stream, "end"),
      once(stream, "error").catch(() => null),
      once(stream, "close")
    ]);
  }
  if (blocker) {
    return { digest: null, blocker };
  }
  return { digest: hash.digest("hex"), blocker: null };
}

function normalizedInventoryHash(records) {
  const normalized = records
    .slice()
    .sort((left, right) => left.relative_path.localeCompare(right.relative_path))
    .map((record) => [
      record.relative_path,
      record.entry_type,
      record.size_bytes,
      record.mtime_ms,
      record.reparse_or_symlink_status,
      record.content_sha256 || ""
    ].join("\t"))
    .join("\n");
  return sha256Text(normalized);
}

async function inventoryRecoveryTree(rootPath, options) {
  const safeOptions = options || {};
  const state = {
    blockers: [],
    warnings: [],
    entryCount: 0,
    maxEntries: Number(safeOptions.maxEntries || DEFAULT_MAX_ENTRIES),
    deadlineMs: Number(safeOptions.deadlineMs || DEFAULT_DEADLINE_MS),
    deadlineAt: now(safeOptions) + Number(safeOptions.deadlineMs || DEFAULT_DEADLINE_MS)
  };
  const root = path.resolve(rootPath);
  const records = [];
  const stack = [{ absolutePath: root, relativePath: "." }];
  while (stack.length > 0 && state.blockers.length === 0) {
    const item = stack.pop();
    const deadlineBlocker = checkDeadline(state, safeOptions, item.relativePath, "lstat");
    if (deadlineBlocker) {
      break;
    }
    let stat;
    try {
      stat = fs.lstatSync(item.absolutePath);
    } catch (error) {
      state.blockers.push(makeBlocker("inventory_lstat_failed", item.relativePath, "lstat", {
        error_code: error && error.code || "lstat_failed"
      }));
      break;
    }
    const countBlocker = pushEntryCount(state, safeOptions, item.relativePath);
    if (countBlocker) {
      break;
    }
    const reparse = isReparseOrSymlink(stat);
    const entryType = getEntryType(stat);
    const record = {
      relative_path: item.relativePath,
      entry_type: entryType,
      size_bytes: entryType === "file" ? Number(stat.size || 0) : 0,
      mtime_ms: Math.trunc(Number(stat.mtimeMs || 0)),
      reparse_or_symlink_status: reparse ? "blocked" : "none",
      content_sha256: null,
      file_identity: fileIdentity(stat)
    };
    records.push(record);
    if (reparse) {
      state.blockers.push(makeBlocker("inventory_reparse_point_blocked", item.relativePath, "lstat", {
        entry_type: entryType,
        child_traversal_attempted: false
      }));
      break;
    }
    if (stat.isDirectory()) {
      let children;
      try {
        children = fs.readdirSync(item.absolutePath, { withFileTypes: true });
      } catch (error) {
        state.blockers.push(makeBlocker("inventory_readdir_failed", item.relativePath, "readdir", {
          error_code: error && error.code || "readdir_failed"
        }));
        break;
      }
      for (const child of children.sort((left, right) => right.name.localeCompare(left.name))) {
        const childRelative = item.relativePath === "."
          ? normalizeRelativePath(child.name)
          : normalizeRelativePath(path.join(item.relativePath, child.name));
        stack.push({
          absolutePath: path.join(item.absolutePath, child.name),
          relativePath: childRelative
        });
      }
    } else if (stat.isFile()) {
      const hashResult = await hashFileStreaming(item.absolutePath, item.relativePath, state, safeOptions);
      if (hashResult.blocker) {
        break;
      }
      record.content_sha256 = hashResult.digest;
    }
  }
  records.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
  const completed = state.blockers.length === 0;
  return {
    completed,
    root_identity: safeRootIdentity(root),
    entry_count: records.length,
    file_count: records.filter((record) => record.entry_type === "file").length,
    directory_count: records.filter((record) => record.entry_type === "directory").length,
    total_regular_file_bytes: records.reduce((total, record) => total + (record.entry_type === "file" ? record.size_bytes : 0), 0),
    inventory_sha256: completed ? normalizedInventoryHash(records) : null,
    records,
    warnings: state.warnings,
    blockers: state.blockers
  };
}

function indexRecords(records) {
  const map = new Map();
  for (const record of records || []) {
    map.set(record.relative_path, record);
  }
  return map;
}

function compareInventories(before, after, governanceMutation) {
  const beforeMap = indexRecords(before.records);
  const afterMap = indexRecords(after.records);
  const added = [];
  const removed = [];
  const metadataChanged = [];
  const contentChanged = [];
  const changed = [];
  for (const [relativePath, afterRecord] of afterMap) {
    if (!beforeMap.has(relativePath)) {
      added.push(relativePath);
      continue;
    }
    const beforeRecord = beforeMap.get(relativePath);
    const metadataFields = ["entry_type", "size_bytes", "mtime_ms", "reparse_or_symlink_status", "file_identity"];
    const changedFields = metadataFields.filter((field) => beforeRecord[field] !== afterRecord[field]);
    if (beforeRecord.content_sha256 !== afterRecord.content_sha256) {
      changedFields.push("content_sha256");
      contentChanged.push({
        relative_path: relativePath,
        fields: ["content_sha256"]
      });
    }
    if (changedFields.some((field) => field !== "content_sha256")) {
      metadataChanged.push({
        relative_path: relativePath,
        fields: changedFields.filter((field) => field !== "content_sha256")
      });
    }
    if (changedFields.length > 0) {
      changed.push({
        relative_path: relativePath,
        fields: changedFields
      });
    }
  }
  for (const [relativePath] of beforeMap) {
    if (!afterMap.has(relativePath)) {
      removed.push(relativePath);
    }
  }
  added.sort();
  removed.sort();
  changed.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
  metadataChanged.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
  contentChanged.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
  return {
    equal: before.completed === true &&
      after.completed === true &&
      before.inventory_sha256 === after.inventory_sha256 &&
      added.length === 0 &&
      removed.length === 0 &&
      changed.length === 0 &&
      (!governanceMutation || (
        governanceMutation.performed === false &&
        governanceMutation.deletion_performed === false &&
        governanceMutation.cleanup_performed === false
      )),
    before_inventory_sha256: before.inventory_sha256,
    after_inventory_sha256: after.inventory_sha256,
    before_entry_count: before.entry_count,
    after_entry_count: after.entry_count,
    added,
    removed,
    changed,
    metadata_changed: metadataChanged,
    content_changed: contentChanged,
    governance_mutation: governanceMutation || null
  };
}

function completeClassificationHistogram(result) {
  const observed = Object.assign({}, result.snapshot_counts_by_classification || {});
  for (const key of [
    "protected",
    "retained",
    "eligible_by_count",
    "eligible_by_age",
    "incomplete_cleanup_candidate",
    "corrupt_cleanup_candidate",
    "blocked_from_cleanup",
    "unknown_requires_review"
  ]) {
    if (!Object.prototype.hasOwnProperty.call(observed, key)) {
      observed[key] = 0;
    }
  }
  return observed;
}

async function runRuntimeProof(options) {
  const projectsRoot = options.projectsRoot;
  const slug = options.projectSlug;
  const context = resolveSnapshotDirectory({ projectsRoot, slug });
  const before = await inventoryRecoveryTree(context.projectDirectory, options.inventory || {});
  if (!before.completed) {
    return {
      completed: false,
      stage: "before_inventory",
      before,
      blockers: before.blockers
    };
  }
  const evaluation = evaluateRecoveryStorageGovernance({ projectsRoot, projectSlug: slug });
  const after = await inventoryRecoveryTree(context.projectDirectory, options.inventory || {});
  const comparison = compareInventories(before, after, evaluation.mutation);
  return {
    completed: after.completed && comparison.equal,
    stage: after.completed ? "comparison" : "after_inventory",
    before,
    governance: {
      policy_version: evaluation.recovery_storage_policy_version,
      profile: evaluation.policy.policy_profile_id,
      pressure_status: evaluation.pressure_status,
      snapshot_count: evaluation.snapshot_count,
      project_count: evaluation.project_count,
      usage: evaluation.recovery_usage_bytes,
      protected_count: evaluation.protected_count,
      retained_count: evaluation.retained_count,
      eligible_candidate_count: evaluation.eligible_candidate_count,
      incomplete_corrupt_candidate_count: evaluation.incomplete_corrupt_candidate_count,
      classification_histogram: completeClassificationHistogram(evaluation),
      unique_snapshot_count: evaluation.snapshot_count,
      mutation: evaluation.mutation,
      warnings: evaluation.warnings,
      blockers: evaluation.blockers
    },
    after,
    comparison,
    blockers: after.completed ? [] : after.blockers
  };
}

if (require.main === module) {
  const projectsRoot = process.argv[2] || "C:\\sf-factory-projects";
  const projectSlug = process.argv[3] || "rc-managed-deps-smoke";
  runRuntimeProof({
    projectsRoot,
    projectSlug,
    inventory: {
      maxEntries: Number(process.env.RECOVERY_PROOF_MAX_ENTRIES || DEFAULT_MAX_ENTRIES),
      deadlineMs: Number(process.env.RECOVERY_PROOF_DEADLINE_MS || DEFAULT_DEADLINE_MS)
    }
  }).then((result) => {
    const safeResult = JSON.parse(JSON.stringify(result));
    if (safeResult.before) {
      delete safeResult.before.records;
    }
    if (safeResult.after) {
      delete safeResult.after.records;
    }
    console.log(JSON.stringify(safeResult, null, 2));
    process.exitCode = result.completed ? 0 : 2;
  }).catch((error) => {
    console.log(JSON.stringify({
      completed: false,
      stage: "runtime_proof",
      blockers: [makeBlocker("runtime_proof_failed", ".", "runtime_proof", {
        error_code: error && error.code || "runtime_proof_failed"
      })]
    }, null, 2));
    process.exitCode = 2;
  });
}

module.exports = {
  compareInventories,
  inventoryRecoveryTree,
  runRuntimeProof
};
