"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const {
  FINGERPRINT_SCHEMA,
  FINGERPRINT_VERSION,
  collectRuntimeSourceFingerprint
} = require("../src/source-fingerprint");

function runGit(repositoryRoot, args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function createRepository(t) {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "factory-source-fingerprint-"));
  runGit(repositoryRoot, ["init", "--quiet"]);
  runGit(repositoryRoot, ["config", "user.email", "test@example.invalid"]);
  runGit(repositoryRoot, ["config", "user.name", "Factory Test"]);
  fs.writeFileSync(path.join(repositoryRoot, "tracked.txt"), "baseline\n", "utf8");
  runGit(repositoryRoot, ["add", "tracked.txt"]);
  runGit(repositoryRoot, ["commit", "--quiet", "-m", "initial"]);
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  return repositoryRoot;
}

function fingerprint(repositoryRoot) {
  return collectRuntimeSourceFingerprint({ repositoryRoot });
}

function writeTracked(repositoryRoot, content) {
  fs.writeFileSync(path.join(repositoryRoot, "tracked.txt"), content, "utf8");
}

test("clean repository fingerprint is available and not dirty", (t) => {
  const repositoryRoot = createRepository(t);
  const result = fingerprint(repositoryRoot);
  assert.equal(result.schema, FINGERPRINT_SCHEMA);
  assert.equal(result.version, FINGERPRINT_VERSION);
  assert.equal(result.available, true);
  assert.match(result.head, /^[a-f0-9]{40}$/);
  assert.equal(result.dirty, false);
  assert.match(result.dirty_state_sha256, /^[a-f0-9]{64}$/);
});

test("unstaged-only modification is dirty", (t) => {
  const repositoryRoot = createRepository(t);
  writeTracked(repositoryRoot, "unstaged\n");
  assert.equal(fingerprint(repositoryRoot).dirty, true);
});

test("staged-only modification is dirty", (t) => {
  const repositoryRoot = createRepository(t);
  writeTracked(repositoryRoot, "staged\n");
  runGit(repositoryRoot, ["add", "tracked.txt"]);
  assert.equal(fingerprint(repositoryRoot).dirty, true);
});

test("staged plus unstaged modification is dirty", (t) => {
  const repositoryRoot = createRepository(t);
  writeTracked(repositoryRoot, "staged\n");
  runGit(repositoryRoot, ["add", "tracked.txt"]);
  writeTracked(repositoryRoot, "unstaged-after-stage\n");
  assert.equal(fingerprint(repositoryRoot).dirty, true);
});

test("index-only change remains dirty when the worktree returns to HEAD", (t) => {
  const repositoryRoot = createRepository(t);
  writeTracked(repositoryRoot, "staged\n");
  runGit(repositoryRoot, ["add", "tracked.txt"]);
  writeTracked(repositoryRoot, "baseline\n");
  const result = fingerprint(repositoryRoot);
  assert.equal(result.dirty, true);
  assert.match(result.dirty_state_sha256, /^[a-f0-9]{64}$/);
});

test("untracked content is dirty", (t) => {
  const repositoryRoot = createRepository(t);
  fs.writeFileSync(path.join(repositoryRoot, "untracked.txt"), "first\n", "utf8");
  assert.equal(fingerprint(repositoryRoot).dirty, true);
});

test("the same dirty state has a deterministic fingerprint", (t) => {
  const repositoryRoot = createRepository(t);
  writeTracked(repositoryRoot, "unstaged\n");
  fs.writeFileSync(path.join(repositoryRoot, "untracked.txt"), "first\n", "utf8");
  assert.equal(fingerprint(repositoryRoot).dirty_state_sha256, fingerprint(repositoryRoot).dirty_state_sha256);
});

test("changed staged state changes the fingerprint", (t) => {
  const repositoryRoot = createRepository(t);
  writeTracked(repositoryRoot, "staged-one\n");
  runGit(repositoryRoot, ["add", "tracked.txt"]);
  const first = fingerprint(repositoryRoot);
  writeTracked(repositoryRoot, "staged-two\n");
  runGit(repositoryRoot, ["add", "tracked.txt"]);
  assert.notEqual(fingerprint(repositoryRoot).dirty_state_sha256, first.dirty_state_sha256);
});

test("changed unstaged state changes the fingerprint", (t) => {
  const repositoryRoot = createRepository(t);
  writeTracked(repositoryRoot, "unstaged-one\n");
  const first = fingerprint(repositoryRoot);
  writeTracked(repositoryRoot, "unstaged-two\n");
  assert.notEqual(fingerprint(repositoryRoot).dirty_state_sha256, first.dirty_state_sha256);
});

test("changed untracked content changes the fingerprint", (t) => {
  const repositoryRoot = createRepository(t);
  const untrackedPath = path.join(repositoryRoot, "untracked.txt");
  fs.writeFileSync(untrackedPath, "first\n", "utf8");
  const first = fingerprint(repositoryRoot);
  fs.writeFileSync(untrackedPath, "second\n", "utf8");
  assert.notEqual(fingerprint(repositoryRoot).dirty_state_sha256, first.dirty_state_sha256);
});

test("staged renames and deletions remain represented as dirty", (t) => {
  const repositoryRoot = createRepository(t);
  runGit(repositoryRoot, ["mv", "tracked.txt", "renamed.txt"]);
  const renamed = fingerprint(repositoryRoot);
  assert.equal(renamed.dirty, true);
  runGit(repositoryRoot, ["rm", "-f", "renamed.txt"]);
  const deleted = fingerprint(repositoryRoot);
  assert.equal(deleted.dirty, true);
  assert.notEqual(deleted.dirty_state_sha256, renamed.dirty_state_sha256);
});
