"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectScaffold, readProjectBySlug } = require("../src/project-store");
const { listOperations } = require("../src/project-operation-store");
const { deriveProjectBinding } = require("../src/structural-snapshot-store");
const { DATE_BLOCK, buildPatch, nativeFactsFromObservation } = require("../src/viewing-date-preview");
const { applyViewingDate, assertBaseline, assertAfter, normalizeTarget, nativeScript, nativeRead, nativeCommand, createNativeWriteSpawnJournal, nativeWriteJournalPath } = require("../src/viewing-date-apply");

function digest(value) { return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function observation(content, formId) {
  const id = formId === undefined ? 12 : formId;
  const fields = [
    ["property_id", "jet-forms/hidden-field", "hidden", true, { field_value: "query_var", query_var_key: "factory_property_id", name: "property_id", required: true }],
    ["name", "jet-forms/text-field", "text", true, { label: "Name", name: "name", required: true }],
    ["email", "jet-forms/text-field", "email", false, { field_type: "email", label: "Email", name: "email" }],
    ["phone", "jet-forms/text-field", "tel", false, { field_type: "tel", label: "Phone", name: "phone" }],
    ["message", "jet-forms/textarea-field", "textarea", false, { label: "Message", name: "message" }],
    ["_factory_policy_guard", "jet-forms/text-field", "hidden", true, { field_type: "hidden", default: "request_viewing_before_v1", name: "_factory_policy_guard", required: true, validation: { rules: [{ type: "ssr", value: "factory_request_viewing_before_v1_validate_contacts" }, { type: "ssr", value: "factory_request_viewing_before_v1_validate_property" }] } }]
  ].map(([name, block, type, required, attrs]) => ({ name, block, type, required, label: attrs.label || null, attrs }));
  if (content.includes("preferred_date")) fields.splice(5, 0, { name: "preferred_date", block: "jet-forms/date-field", type: "date", required: false, label: "Preferred date", attrs: { label: "Preferred date", name: "preferred_date", blockID: "factory-request-viewing-preferred-date-v1" } });
  const formSha = digest(content);
  return { candidate_ids: [id], resolved_form_id: id, form_id: id, post_exists: true, post_type: "jet-form-builder", post_status: "publish", post_parent: 0, owner: "request_viewing_before_v1", form_content: content, form_sha256: formSha, fields, actions: [{ type: "save_record" }], binding: { form_id: id, form_sha256: formSha, email_field: "email", phone_field: "phone", property_field: "property_id", guard_field: "_factory_policy_guard", guard_value: "request_viewing_before_v1" }, records: { count: 7, fingerprint: "a".repeat(64) }, plugin_version: "3.6.5.1", policy_sha256: "541167d3a80c45095ef9396741fb99dca90752e7f5d7edecadb991d01d188e14" };
}

function fixture(slug, formId) {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "factory-viewing-date-apply-"));
  const projectSlug = slug || "csf-st-viewing-before-v1";
  createProjectScaffold({ name: "CSF ST Viewing Before v1", slug: projectSlug, port: 32001, projectsRoot });
  const state = readProjectBySlug(projectSlug, projectsRoot);
  const beforeContent = '<!-- wp:jet-forms/hidden-field {"field_value":"query_var","query_var_key":"factory_property_id","name":"property_id","required":true} /-->\n\n<!-- wp:jet-forms/text-field {"label":"Name","name":"name","required":true} /-->\n\n<!-- wp:jet-forms/text-field {"field_type":"email","label":"Email","name":"email"} /-->\n\n<!-- wp:jet-forms/text-field {"field_type":"tel","label":"Phone","name":"phone"} /-->\n\n<!-- wp:jet-forms/textarea-field {"label":"Message","name":"message"} /-->\n\n<!-- wp:jet-forms/text-field {"field_type":"hidden","default":"request_viewing_before_v1","name":"_factory_policy_guard","required":true,"validation":{"rules":[{"type":"ssr","value":"factory_request_viewing_before_v1_validate_contacts"},{"type":"ssr","value":"factory_request_viewing_before_v1_validate_property"}]}} /-->\n\n<!-- wp:jet-forms/submit-field {"label":"Request viewing"} /-->';
  const before = observation(beforeContent, formId);
  const patch = buildPatch(beforeContent);
  const planId = "viewing-date-plan-11111111-1111-4111-8111-111111111111";
  const plan = { schema: "csf_viewing_date_preview", version: 1, plan_id: planId, project_slug: state.project.slug, project_id: state.project.project_id, profile: "add_optional_viewing_date@1", profile_id: "add_optional_viewing_date", profile_version: 1, baseline: { project_binding: deriveProjectBinding(state.project), form_id: before.form_id, form_sha256: before.form_sha256, actions_sha256: digest(before.actions), binding_sha256: digest(before.binding), policy_sha256: before.policy_sha256, facts_sha256: digest(nativeFactsFromObservation(before)), records: before.records }, proposed_delta: { add_optional_date_field: { native_block: patch.native_block } }, expected: { form_sha256: patch.expected_form_sha256 } };
  const root = path.join(state.runtimePath, "proofs", "viewing-date-preview-v1");
  fs.mkdirSync(path.join(root, "plans"), { recursive: true });
  fs.mkdirSync(path.join(root, "recovery-results"), { recursive: true });
  fs.writeFileSync(path.join(root, "plans", planId + ".json"), JSON.stringify(plan));
  fs.writeFileSync(path.join(root, "recovery-results", planId + ".json"), JSON.stringify({ schema: "csf_viewing_date_recovery_result", version: 3, status: "prepared", plan_id: planId, project_slug: state.project.slug, project_id: state.project.project_id, profile_id: "add_optional_viewing_date", profile_version: 1, snapshot_id: "snapshot-test" }));
  return { projectsRoot, state, planId, before, after: observation(patch.next_content, before.form_id), patch, verifyPrepared: async () => ({ status: "prepared", snapshot_id: "snapshot-test" }) };
}

test("a new server-created project accepts only its persisted Preview plan for Apply", async () => {
  const value = fixture("csf-st-viewing-fresh-authority-v1");
  let writes = 0;
  const result = await applyViewingDate({ projectsRoot: value.projectsRoot, slug: value.state.project.slug, planId: value.planId, idempotencyKey: "fresh-authority-apply-key", verifyPrepared: value.verifyPrepared, readNative: async () => clone(value.before), writeNative: async () => { writes += 1; return clone(value.after); } });
  assert.equal(result.status, "applied");
  assert.equal(writes, 1);
});

test("Apply resolver fails closed for duplicate, retargeted, or baseline-drifted form observations", () => {
  const value = fixture();
  assert.equal(normalizeTarget(value.before).form_id, 12);
  const duplicate = clone(value.before); duplicate.candidate_ids.push(14);
  assert.throws(() => normalizeTarget(duplicate), { code: "viewing_date_apply_target_ambiguous" });
  const retargeted = clone(value.before); retargeted.owner = "another_form";
  assert.throws(() => normalizeTarget(retargeted), { code: "viewing_date_apply_target_ambiguous" });
  const drift = clone(value.before); drift.form_content += "\n"; drift.form_sha256 = digest(drift.form_content); drift.binding.form_sha256 = drift.form_sha256;
  assert.throws(() => assertBaseline(drift, JSON.parse(fs.readFileSync(path.join(value.projectsRoot, "csf-st-viewing-before-v1", "proofs", "viewing-date-preview-v1", "plans", value.planId + ".json"), "utf8"))), { code: "viewing_date_apply_baseline_drift" });
  const unavailableRecords = clone(value.before); unavailableRecords.records = null;
  assert.throws(() => assertBaseline(unavailableRecords, JSON.parse(fs.readFileSync(path.join(value.projectsRoot, "csf-st-viewing-before-v1", "proofs", "viewing-date-preview-v1", "plans", value.planId + ".json"), "utf8"))), { code: "viewing_date_apply_records_unavailable" });
});

test("Apply production serialization derives post identity and blocks invalid bound posts", () => {
  const script = nativeScript("read", {});
  assert.match(script, /'post_exists'=>!!\$p/);
  assert.match(script, /'post_parent'=>\$p\?\(int\)\$p->post_parent:null/);
  assert.doesNotMatch(script, /'post_parent'=>0/);
  const value = fixture();
  const plan = JSON.parse(fs.readFileSync(path.join(value.projectsRoot, "csf-st-viewing-before-v1", "proofs", "viewing-date-preview-v1", "plans", value.planId + ".json"), "utf8"));
  assert.doesNotThrow(() => assertBaseline(clone(value.before), plan));
  const cases = [
    ["revision", (current) => { current.post_type = "revision"; current.post_parent = current.form_id; }],
    ["missing post", (current) => { current.post_exists = false; }],
    ["non-canonical parent", (current) => { current.post_parent = 44; }]
  ];
  for (const [label, mutate] of cases) {
    const current = clone(value.before);
    mutate(current);
    assert.throws(() => assertBaseline(current, plan), undefined, label);
  }
});

test("Apply requires the exact Preview bound form-ID lineage", async () => {
  const value = fixture();
  let writes = 0;
  const differentBoundForm = observation(value.before.form_content, 17);
  await assert.rejects(() => applyViewingDate({
    projectsRoot: value.projectsRoot,
    slug: value.state.project.slug,
    planId: value.planId,
    idempotencyKey: "viewing-date-form-lineage-key",
    verifyPrepared: value.verifyPrepared,
    readNative: async () => clone(differentBoundForm),
    writeNative: async () => { writes += 1; return clone(differentBoundForm); }
  }), { code: "viewing_date_apply_target_changed" });
  assert.equal(writes, 0);
});

test("Apply writes one reviewed date delta once and exact replay is write-free", async () => {
  const value = fixture();
  let current = clone(value.before);
  let writes = 0;
  const options = { projectsRoot: value.projectsRoot, slug: "csf-st-viewing-before-v1", planId: value.planId, idempotencyKey: "viewing-date-apply-test-key", verifyPrepared: value.verifyPrepared, readNative: async () => clone(current), writeNative: async (_state, input) => { writes += 1; assert.equal(input.before, value.before.form_sha256); assert.equal(input.after, value.patch.next_content); current = clone(value.after); return clone(current); } };
  const first = await applyViewingDate(options);
  assert.equal(first.status, "applied");
  assert.equal(first.mutation_performed, true);
  const replay = await applyViewingDate(options);
  assert.equal(replay.status, "already_applied");
  assert.equal(replay.mutation_performed, false);
  assert.equal(writes, 1);
});

test("concurrent Apply calls for one accepted plan allow one native write and reject the in-progress duplicate", async () => {
  const value = fixture();
  let current = clone(value.before);
  let writes = 0;
  let enterWriter;
  let releaseWriter;
  let writerReleased = false;
  let firstSettled = false;
  const writerEntered = new Promise((resolve) => { enterWriter = resolve; });
  const writerRelease = new Promise((resolve) => { releaseWriter = resolve; });
  const releaseBarrier = () => {
    if (!writerReleased) {
      writerReleased = true;
      releaseWriter();
    }
  };
  const firstOptions = {
    projectsRoot: value.projectsRoot,
    slug: "csf-st-viewing-before-v1",
    planId: value.planId,
    idempotencyKey: "viewing-date-concurrent-first-key",
    verifyPrepared: value.verifyPrepared,
    readNative: async () => clone(current),
    writeNative: async (_state, input) => {
      writes += 1;
      assert.equal(writes, 1);
      assert.equal(input.before, value.before.form_sha256);
      assert.equal(input.after, value.patch.next_content);
      enterWriter();
      await writerRelease;
      current = clone(value.after);
      return clone(current);
    }
  };
  const originalPlan = fs.readFileSync(path.join(value.projectsRoot, "csf-st-viewing-before-v1", "proofs", "viewing-date-preview-v1", "plans", value.planId + ".json"), "utf8");
  let first;
  let firstPromise;
  try {
    firstPromise = applyViewingDate(firstOptions).then((result) => { firstSettled = true; return result; });
    await Promise.race([
      writerEntered,
      firstPromise.then(() => { throw new Error("first Apply completed before entering the native-write barrier"); })
    ]);
    const running = listOperations({ slug: firstOptions.slug, projectsRoot: value.projectsRoot, includeRaw: true })
      .filter((operation) => operation.operation_type === "viewing_date_apply");
    assert.equal(running.length, 1);
    assert.equal(running[0].status, "running");
    assert.equal(firstSettled, false);

    let duplicateError;
    try {
      await applyViewingDate(Object.assign({}, firstOptions, { idempotencyKey: "viewing-date-concurrent-second-key" }));
    } catch (caught) {
      duplicateError = caught;
    }
    assert.equal(duplicateError && duplicateError.code, "project_operation_in_progress");
    assert.equal(writes, 1);
    assert.equal(firstSettled, false);
    const afterDuplicate = listOperations({ slug: firstOptions.slug, projectsRoot: value.projectsRoot, includeRaw: true })
      .filter((operation) => operation.operation_type === "viewing_date_apply");
    assert.equal(afterDuplicate.length, 1);
    assert.equal(afterDuplicate[0].operation_id, running[0].operation_id);
    assert.equal(afterDuplicate[0].status, "running");

    releaseBarrier();
    first = await firstPromise;
    assert.equal(first.status, "applied");
    assert.equal(first.mutation_performed, true);
    assert.equal(writes, 1);
    assert.equal(current.fields.filter((field) => field.name === "preferred_date").length, 1);
    const completed = listOperations({ slug: firstOptions.slug, projectsRoot: value.projectsRoot, includeRaw: true })
      .filter((operation) => operation.operation_type === "viewing_date_apply");
    assert.equal(completed.length, 1);
    assert.equal(completed.filter((operation) => operation.status === "succeeded").length, 1);
    assert.equal(fs.readFileSync(path.join(value.projectsRoot, "csf-st-viewing-before-v1", "proofs", "viewing-date-preview-v1", "plans", value.planId + ".json"), "utf8"), originalPlan);

    const replay = await applyViewingDate(firstOptions);
    assert.equal(replay.status, "already_applied");
    assert.equal(replay.mutation_performed, false);
    assert.equal(writes, 1);
  } finally {
    if (releaseWriter) releaseBarrier();
    if (firstPromise) await firstPromise.catch(() => {});
  }
});

test("Apply blocks verification when existing Form Records change", async () => {
  const value = fixture();
  let current = clone(value.before);
  const options = { projectsRoot: value.projectsRoot, slug: "csf-st-viewing-before-v1", planId: value.planId, idempotencyKey: "viewing-date-records-change-key", verifyPrepared: value.verifyPrepared, readNative: async () => clone(current), writeNative: async () => { current = clone(value.after); current.records = { count: 8, fingerprint: "b".repeat(64) }; return clone(current); } };
  await assert.rejects(() => applyViewingDate(options), { code: "viewing_date_apply_records_changed" });
});

test("Apply blocks an already-present date field without writing", async () => {
  const value = fixture();
  let writes = 0;
  await assert.rejects(() => applyViewingDate({
    projectsRoot: value.projectsRoot,
    slug: "csf-st-viewing-before-v1",
    planId: value.planId,
    idempotencyKey: "viewing-date-existing-date-key",
    verifyPrepared: value.verifyPrepared,
    readNative: async () => clone(value.after),
    writeNative: async () => { writes += 1; return clone(value.after); }
  }), { code: "viewing_date_apply_baseline_drift" });
  assert.equal(writes, 0);
});

test("Apply blocks post-write normalization outside the exact reviewed content", () => {
  const value = fixture();
  const normalized = clone(value.after);
  normalized.form_content += "\n";
  normalized.form_sha256 = digest(normalized.form_content);
  normalized.binding.form_sha256 = normalized.form_sha256;
  const plan = JSON.parse(fs.readFileSync(path.join(value.projectsRoot, "csf-st-viewing-before-v1", "proofs", "viewing-date-preview-v1", "plans", value.planId + ".json"), "utf8"));
  assert.throws(() => assertAfter(normalized, plan, value.patch, value.before.records), { code: "viewing_date_apply_after_state_drift" });
});

test("Apply blocks this Preview after a failed attempt instead of retrying it", async () => {
  const value = fixture();
  const options = {
    projectsRoot: value.projectsRoot,
    slug: "csf-st-viewing-before-v1",
    planId: value.planId,
    idempotencyKey: "viewing-date-failed-attempt-key",
    verifyPrepared: value.verifyPrepared,
    readNative: async () => clone(value.before),
    writeNative: async () => { throw Object.assign(new Error("native write failed"), { code: "native_write_failed" }); }
  };
  await assert.rejects(() => applyViewingDate(options), { code: "native_write_failed" });
  await assert.rejects(() => applyViewingDate(Object.assign({}, options, { idempotencyKey: "viewing-date-new-key-after-failure" })), { code: "viewing_date_apply_prior_attempt_terminal" });
});

function nativeWriteJournal(value) {
  const root = path.join(value.state.runtimePath, "runs", "operations");
  const files = fs.existsSync(root) ? fs.readdirSync(root).filter((name) => name.endsWith(".viewing-date-apply-native-write.jsonl")) : [];
  assert.equal(files.length, 1);
  return {
    path: path.join(root, files[0]),
    value: fs.readFileSync(path.join(root, files[0]), "utf8").trim().split("\n").map((line) => JSON.parse(line))
  };
}

function testJournalWriter(filePath, event, create) {
  fs.writeFileSync(filePath, JSON.stringify(event) + "\n", { encoding: "utf8", flag: create ? "wx" : "a" });
}

test("production Apply persists a sanitized native-write lifecycle journal without sharing the read log", async () => {
  const value = fixture("csf-st-viewing-spawn-journal-v1");
  let current = clone(value.before);
  let writes = 0;
  const result = await applyViewingDate({
    projectsRoot: value.projectsRoot,
    slug: value.state.project.slug,
    planId: value.planId,
    idempotencyKey: "viewing-date-spawn-journal-key",
    verifyPrepared: value.verifyPrepared,
    readNative: async () => clone(current),
    commandRunner: async (_command, _args, options) => {
      writes += 1;
      const writeLogPath = options.logPath;
      options.childProcessObserver.onStartAcknowledged();
      current = clone(value.after);
      options.childProcessObserver.onExit({ code: 0, signal: null });
      assert.match(writeLogPath, /viewing-date-apply-native-write-op-/);
      return { stdout: JSON.stringify(current) };
    }
  });
  assert.equal(result.status, "applied");
  assert.equal(writes, 1);
  const journal = nativeWriteJournal(value);
  assert.deepEqual(journal.value.map((event) => event.event), ["intent", "started", "exit"]);
  assert.equal(journal.value.every((event) => event.schema === "csf_viewing_date_apply_native_write_spawn"), true);
  assert.equal(journal.value.every((event) => event.operation_id === result.operation.operation_id), true);
  assert.equal(journal.value.every((event) => event.project_id === value.state.project.project_id), true);
  assert.equal(journal.value.every((event) => event.stage === "native_write"), true);
  assert.equal(journal.value[2].exit.code, 0);
  const raw = fs.readFileSync(journal.path, "utf8");
  assert.equal(raw.includes(value.patch.next_content), false);
  assert.equal(raw.includes("/usr/local/bin/wp"), false);

  const retained = raw;
  let readLogPath = null;
  await nativeRead(value.state, { mode: "read" }, {
    commandRunner: async (_command, _args, options) => {
      readLogPath = options.logPath;
      return { stdout: JSON.stringify(current) };
    }
  });
  assert.equal(fs.readFileSync(journal.path, "utf8"), retained);
  assert.match(readLogPath, /viewing-date-apply-native-read\.log$/);
});

test("spawn refusal records sanitized start-not-established evidence and leaves Apply terminal", async () => {
  const value = fixture("csf-st-viewing-spawn-refusal-v1");
  const refusal = Object.assign(new Error("spawn refused"), { code: "EPERM", errno: -4048, syscall: "spawn" });
  const options = {
    projectsRoot: value.projectsRoot,
    slug: value.state.project.slug,
    planId: value.planId,
    idempotencyKey: "viewing-date-spawn-refusal-key",
    verifyPrepared: value.verifyPrepared,
    readNative: async () => clone(value.before),
    commandRunner: async (_command, _args, commandOptions) => {
      commandOptions.childProcessObserver.onStartNotEstablished(refusal);
      throw refusal;
    }
  };
  await assert.rejects(() => applyViewingDate(options), { code: "EPERM" });
  const journal = nativeWriteJournal(value).value;
  assert.deepEqual(journal.map((event) => event.event), ["intent", "start_not_established"]);
  assert.deepEqual(journal[1].error, { code: "EPERM", errno: "-4048", syscall: "spawn" });
  const failed = listOperations({ slug: value.state.project.slug, projectsRoot: value.projectsRoot, includeRaw: true })
    .find((operation) => operation.operation_type === "viewing_date_apply");
  assert.equal(failed.status, "failed");
  await assert.rejects(() => applyViewingDate(Object.assign({}, options, { idempotencyKey: "viewing-date-spawn-refusal-retry" })), { code: "viewing_date_apply_prior_attempt_terminal" });
});

test("native-write intent journal failure prevents dispatch and post-dispatch journal failure blocks success", async () => {
  const beforeDispatch = fixture("csf-st-viewing-spawn-before-failure-v1");
  let beforeDispatchCalls = 0;
  await assert.rejects(() => applyViewingDate({
    projectsRoot: beforeDispatch.projectsRoot,
    slug: beforeDispatch.state.project.slug,
    planId: beforeDispatch.planId,
    idempotencyKey: "viewing-date-spawn-before-failure-key",
    verifyPrepared: beforeDispatch.verifyPrepared,
    readNative: async () => clone(beforeDispatch.before),
    commandRunner: async () => { beforeDispatchCalls += 1; throw new Error("must not dispatch"); },
    writeJournal: () => { throw new Error("intent journal unavailable"); }
  }), { code: "viewing_date_apply_spawn_journal_unavailable" });
  assert.equal(beforeDispatchCalls, 0);

  const afterDispatch = fixture("csf-st-viewing-spawn-after-failure-v1");
  let journalWrites = 0;
  let dispatched = 0;
  const options = {
    projectsRoot: afterDispatch.projectsRoot,
    slug: afterDispatch.state.project.slug,
    planId: afterDispatch.planId,
    idempotencyKey: "viewing-date-spawn-after-failure-key",
    verifyPrepared: afterDispatch.verifyPrepared,
    readNative: async () => clone(afterDispatch.before),
    commandRunner: async (_command, _args, commandOptions) => {
      dispatched += 1;
      commandOptions.childProcessObserver.onStartAcknowledged();
      return { stdout: JSON.stringify(afterDispatch.after) };
    },
    writeJournal: (filePath, journal, create) => {
      journalWrites += 1;
      if (journalWrites > 1) throw new Error("post-dispatch journal unavailable");
      testJournalWriter(filePath, journal, create);
    }
  };
  await assert.rejects(() => applyViewingDate(options), { code: "viewing_date_apply_spawn_journal_unavailable" });
  assert.equal(dispatched, 1);
  const failed = listOperations({ slug: afterDispatch.state.project.slug, projectsRoot: afterDispatch.projectsRoot, includeRaw: true })
    .find((operation) => operation.operation_type === "viewing_date_apply");
  assert.equal(failed.status, "failed");
  await assert.rejects(() => applyViewingDate(Object.assign({}, options, { idempotencyKey: "viewing-date-spawn-after-failure-retry" })), { code: "viewing_date_apply_prior_attempt_terminal" });
});

test("native-write exit journal failure after an acknowledged start remains terminal", async () => {
  const value = fixture("csf-st-viewing-spawn-exit-failure-v1");
  let journalWrites = 0;
  let dispatched = 0;
  const options = {
    projectsRoot: value.projectsRoot,
    slug: value.state.project.slug,
    planId: value.planId,
    idempotencyKey: "viewing-date-spawn-exit-failure-key",
    verifyPrepared: value.verifyPrepared,
    readNative: async () => clone(value.before),
    commandRunner: async (_command, _args, commandOptions) => {
      dispatched += 1;
      commandOptions.childProcessObserver.onStartAcknowledged();
      commandOptions.childProcessObserver.onExit({ code: 0, signal: null });
      return { stdout: JSON.stringify(value.after) };
    },
    writeJournal: (filePath, journal, create) => {
      journalWrites += 1;
      if (journalWrites > 2) throw new Error("exit journal unavailable");
      testJournalWriter(filePath, journal, create);
    }
  };
  await assert.rejects(() => applyViewingDate(options), { code: "viewing_date_apply_spawn_journal_unavailable" });
  assert.equal(dispatched, 1);
  const journal = nativeWriteJournal(value).value;
  assert.deepEqual(journal.map((event) => event.event), ["intent", "started"]);
  const failed = listOperations({ slug: value.state.project.slug, projectsRoot: value.projectsRoot, includeRaw: true })
    .find((operation) => operation.operation_type === "viewing_date_apply");
  assert.equal(failed.status, "failed");
  await assert.rejects(() => applyViewingDate(Object.assign({}, options, { idempotencyKey: "viewing-date-spawn-exit-failure-retry" })), { code: "viewing_date_apply_prior_attempt_terminal" });
});

test("native-write telemetry cannot replace pre-existing operation evidence", () => {
  const value = fixture("csf-st-viewing-spawn-no-clobber-v1");
  const operationId = "op-2026-10-03T10-00-00-000Z-a1b2c3";
  const journalPath = nativeWriteJournalPath(value.state, operationId);
  const prior = "{\"preserved\":true}\n";
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  fs.writeFileSync(journalPath, prior, { encoding: "utf8", flag: "wx" });
  assert.throws(() => createNativeWriteSpawnJournal({
    projectState: value.state,
    operationId,
    command: nativeCommand({ mode: "write", before: value.before.form_sha256, after: value.patch.next_content })
  }), { code: "viewing_date_apply_spawn_journal_unavailable" });
  assert.equal(fs.readFileSync(journalPath, "utf8"), prior);
});
