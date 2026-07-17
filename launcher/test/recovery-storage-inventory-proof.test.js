"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  compareInventories,
  inventoryRecoveryTree
} = require("./recovery-storage-inventory-proof");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-recovery-inventory-proof-"));
}

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, content) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

function listTree(rootPath) {
  const entries = [];
  function visit(current) {
    const stat = fs.lstatSync(current);
    entries.push({
      relative: path.relative(rootPath, current).replace(/\\/g, "/") || ".",
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs),
      isSymbolicLink: stat.isSymbolicLink()
    });
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const name of fs.readdirSync(current).sort()) {
        visit(path.join(current, name));
      }
    }
  }
  visit(rootPath);
  return entries;
}

function fixTreeTimes(rootPath) {
  const fixed = new Date("2026-07-17T00:00:00.000Z");
  function visit(current) {
    const stat = fs.lstatSync(current);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const name of fs.readdirSync(current)) {
        visit(path.join(current, name));
      }
    }
    fs.utimesSync(current, fixed, fixed);
  }
  visit(rootPath);
}

test("inventory records are sorted deterministically", async () => {
  const root = tempRoot();
  writeFile(path.join(root, "z", "two.txt"), "two");
  writeFile(path.join(root, "a", "one.txt"), "one");
  const inventory = await inventoryRecoveryTree(root);
  assert.equal(inventory.completed, true);
  assert.deepEqual(
    inventory.records.map((record) => record.relative_path),
    [".", "a", "a/one.txt", "z", "z/two.txt"]
  );
});

test("identical trees produce identical inventory hashes", async () => {
  const left = tempRoot();
  const right = tempRoot();
  writeFile(path.join(left, "nested", "file.txt"), "same");
  writeFile(path.join(right, "nested", "file.txt"), "same");
  fixTreeTimes(left);
  fixTreeTimes(right);
  const leftInventory = await inventoryRecoveryTree(left);
  const rightInventory = await inventoryRecoveryTree(right);
  assert.equal(leftInventory.completed, true);
  assert.equal(rightInventory.completed, true);
  assert.equal(leftInventory.inventory_sha256, rightInventory.inventory_sha256);
});

test("changed file content is detected", async () => {
  const root = tempRoot();
  const filePath = path.join(root, "file.txt");
  writeFile(filePath, "before");
  const before = await inventoryRecoveryTree(root);
  writeFile(filePath, "after!");
  const after = await inventoryRecoveryTree(root);
  const comparison = compareInventories(before, after);
  assert.equal(comparison.equal, false);
  assert.deepEqual(comparison.content_changed.map((entry) => entry.relative_path), ["file.txt"]);
});

test("changed file size is detected", async () => {
  const root = tempRoot();
  const filePath = path.join(root, "file.txt");
  writeFile(filePath, "small");
  const before = await inventoryRecoveryTree(root);
  writeFile(filePath, "larger content");
  const after = await inventoryRecoveryTree(root);
  const comparison = compareInventories(before, after);
  assert.equal(comparison.equal, false);
  assert.ok(comparison.metadata_changed.some((entry) => entry.relative_path === "file.txt" && entry.fields.includes("size_bytes")));
});

test("added file is detected", async () => {
  const root = tempRoot();
  writeFile(path.join(root, "one.txt"), "one");
  const before = await inventoryRecoveryTree(root);
  writeFile(path.join(root, "two.txt"), "two");
  const after = await inventoryRecoveryTree(root);
  const comparison = compareInventories(before, after);
  assert.deepEqual(comparison.added, ["two.txt"]);
});

test("removed file is detected", async () => {
  const root = tempRoot();
  writeFile(path.join(root, "one.txt"), "one");
  writeFile(path.join(root, "two.txt"), "two");
  const before = await inventoryRecoveryTree(root);
  fs.unlinkSync(path.join(root, "two.txt"));
  const after = await inventoryRecoveryTree(root);
  const comparison = compareInventories(before, after);
  assert.deepEqual(comparison.removed, ["two.txt"]);
});

test("directory timestamp noise is metadata-only and not content change", async () => {
  const root = tempRoot();
  const dir = path.join(root, "nested");
  writeFile(path.join(dir, "file.txt"), "same");
  const before = await inventoryRecoveryTree(root);
  const future = new Date(Date.now() + 60000);
  fs.utimesSync(dir, future, future);
  const after = await inventoryRecoveryTree(root);
  const comparison = compareInventories(before, after);
  assert.equal(comparison.equal, false);
  assert.deepEqual(comparison.content_changed, []);
  assert.ok(comparison.metadata_changed.some((entry) => entry.relative_path === "nested" && entry.fields.includes("mtime_ms")));
});

test("symlink is not followed and becomes an explicit blocker", async () => {
  const root = tempRoot();
  writeFile(path.join(root, "target", "secret.txt"), "do not follow");
  const linkPath = path.join(root, "link");
  try {
    fs.symlinkSync(path.join(root, "target"), linkPath, "dir");
  } catch (error) {
    fs.symlinkSync(path.join(root, "target"), linkPath, "junction");
  }
  const inventory = await inventoryRecoveryTree(root);
  assert.equal(inventory.completed, false);
  assert.equal(inventory.blockers[0].code, "inventory_reparse_point_blocked");
  assert.equal(inventory.blockers[0].child_traversal_attempted, false);
  assert.equal(inventory.records.some((record) => record.relative_path === "link/secret.txt"), false);
});

test("junction or reparse point is blocked on Windows where testable", async () => {
  const root = tempRoot();
  writeFile(path.join(root, "target", "file.txt"), "target");
  const junctionPath = path.join(root, "junction");
  try {
    fs.symlinkSync(path.join(root, "target"), junctionPath, "junction");
  } catch (error) {
    assert.ok(true);
    return;
  }
  const inventory = await inventoryRecoveryTree(root);
  assert.equal(inventory.completed, false);
  assert.equal(inventory.blockers[0].code, "inventory_reparse_point_blocked");
  assert.equal(inventory.records.some((record) => record.relative_path === "junction/file.txt"), false);
});

test("unreadable file hash becomes a blocker where testable", async () => {
  const root = tempRoot();
  writeFile(path.join(root, "blocked.txt"), "content");
  const inventory = await inventoryRecoveryTree(root, {
    streamFactory() {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    }
  });
  assert.equal(inventory.completed, false);
  assert.equal(inventory.blockers[0].code, "inventory_file_read_failed");
  assert.equal(inventory.blockers[0].error_code, "EACCES");
});

test("entry-count limit terminates cleanly", async () => {
  const root = tempRoot();
  writeFile(path.join(root, "one.txt"), "one");
  const inventory = await inventoryRecoveryTree(root, { maxEntries: 1 });
  assert.equal(inventory.completed, false);
  assert.equal(inventory.blockers[0].code, "inventory_entry_limit_exceeded");
});

test("deadline terminates cleanly", async () => {
  const root = tempRoot();
  writeFile(path.join(root, "one.txt"), "one");
  let time = 0;
  const inventory = await inventoryRecoveryTree(root, {
    deadlineMs: 1,
    clock() {
      time += 10;
      return time;
    }
  });
  assert.equal(inventory.completed, false);
  assert.equal(inventory.blockers[0].code, "inventory_deadline_exceeded");
});

test("large file hashing is streamed", async () => {
  const root = tempRoot();
  const filePath = path.join(root, "large.bin");
  writeFile(filePath, Buffer.alloc(1024 * 1024, "x"));
  let chunks = 0;
  const inventory = await inventoryRecoveryTree(root, {
    streamFactory(target) {
      const stream = fs.createReadStream(target, { highWaterMark: 64 * 1024 });
      stream.on("data", () => {
        chunks += 1;
      });
      return stream;
    }
  });
  assert.equal(inventory.completed, true);
  assert.ok(chunks > 1);
  assert.equal(inventory.records.find((record) => record.relative_path === "large.bin").content_sha256.length, 64);
});

test("helper exits without hanging", async () => {
  const root = tempRoot();
  writeFile(path.join(root, "file.txt"), "content");
  const result = await Promise.race([
    inventoryRecoveryTree(root),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 2000))
  ]);
  assert.notEqual(result, "timeout");
  assert.equal(result.completed, true);
});

test("inventory does not write inside the target tree", async () => {
  const root = tempRoot();
  writeFile(path.join(root, "file.txt"), "content");
  const beforeTree = listTree(root);
  const inventory = await inventoryRecoveryTree(root);
  const afterTree = listTree(root);
  assert.equal(inventory.completed, true);
  assert.deepEqual(afterTree, beforeTree);
});
