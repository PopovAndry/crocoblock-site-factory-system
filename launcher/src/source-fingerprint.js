"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const FINGERPRINT_SCHEMA = "factory_runtime_source_fingerprint";
const FINGERPRINT_VERSION = 1;

function getRepositoryRoot() {
  return path.resolve(__dirname, "..", "..");
}

function runGit(args, repositoryRoot) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: null,
    stdio: ["ignore", "pipe", "ignore"]
  });
}

function readGitText(args, repositoryRoot) {
  return runGit(args, repositoryRoot).toString("utf8").trim();
}

function isPathWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

function listUntrackedFiles(repositoryRoot) {
  return runGit(["ls-files", "--others", "--exclude-standard", "-z"], repositoryRoot)
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
}

function updateChunk(hash, label, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(String(label), "utf8");
  hash.update(Buffer.from([0]));
  hash.update(length);
  hash.update(bytes);
}

function computeDirtyStateHash(repositoryRoot, stagedDiff, unstagedDiff, untrackedFiles) {
  const hash = crypto.createHash("sha256");
  updateChunk(hash, "schema", "factory_runtime_dirty_state_v1");
  updateChunk(hash, "component", "staged_index_vs_head");
  updateChunk(hash, "staged_diff", stagedDiff);
  updateChunk(hash, "component", "unstaged_worktree_vs_index");
  updateChunk(hash, "unstaged_diff", unstagedDiff);
  updateChunk(hash, "component", "untracked_worktree_content");
  for (const relativePath of untrackedFiles) {
    const absolutePath = path.resolve(repositoryRoot, relativePath);
    if (!isPathWithin(absolutePath, repositoryRoot)) {
      throw new Error("Untracked source file escaped repository root.");
    }
    updateChunk(hash, "untracked_path", relativePath);
    updateChunk(hash, "untracked_content", fs.readFileSync(absolutePath));
  }
  return hash.digest("hex");
}

function collectRuntimeSourceFingerprint(options) {
  const repositoryRoot = path.resolve(options && options.repositoryRoot || getRepositoryRoot());
  try {
    const head = readGitText(["rev-parse", "HEAD"], repositoryRoot);
    const branch = readGitText(["rev-parse", "--abbrev-ref", "HEAD"], repositoryRoot);
    const stagedDiff = runGit(["diff", "--cached", "--binary", "--no-ext-diff", "HEAD", "--"], repositoryRoot);
    const unstagedDiff = runGit(["diff", "--binary", "--no-ext-diff", "--"], repositoryRoot);
    const untrackedFiles = listUntrackedFiles(repositoryRoot);
    return {
      schema: FINGERPRINT_SCHEMA,
      version: FINGERPRINT_VERSION,
      available: true,
      head,
      branch,
      dirty: stagedDiff.length > 0 || unstagedDiff.length > 0 || untrackedFiles.length > 0,
      dirty_state_sha256: computeDirtyStateHash(repositoryRoot, stagedDiff, unstagedDiff, untrackedFiles)
    };
  } catch (error) {
    return {
      schema: FINGERPRINT_SCHEMA,
      version: FINGERPRINT_VERSION,
      available: false,
      head: null,
      branch: null,
      dirty: false,
      dirty_state_sha256: null
    };
  }
}

module.exports = {
  FINGERPRINT_SCHEMA,
  FINGERPRINT_VERSION,
  collectRuntimeSourceFingerprint,
  computeDirtyStateHash
};
