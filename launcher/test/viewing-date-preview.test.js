"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");
const vm = require("node:vm");
const {
  DATE_BLOCK,
  buildPatch,
  browserSummary,
  createViewingDatePreview,
  matchingPreparedRecovery,
  nativeFactsFromObservation,
  prepareViewingDateRecovery,
  canonicalTarEntryInventory,
  baselineFingerprint,
  coverageFingerprint,
  proposedChangeFingerprint,
  streamSha256Artifact,
  inspectSnapshotSinglePass
} = require("../src/viewing-date-preview");
const { classifyAddOptionalViewingDateChange } = require("../src/real-estate-contract");
const { createProjectScaffold, readProjectBySlug } = require("../src/project-store");
const { createManifestRecord, deriveProjectBinding, resolveSnapshotDirectory, transitionManifestStatus } = require("../src/structural-snapshot-store");
const { MYSQLDUMP_SCRIPT } = require("../src/structural-snapshot-db-capture");

function observation(overrides) {
  return Object.assign({
    form_id: 13,
    plugin_version: "3.6.5.1",
    owner: "request_viewing_before_v1",
    form_sha256: "a".repeat(64),
    form_content: '<!-- wp:jet-forms/text-field {"label":"Name","name":"name","required":true} /-->\n\n<!-- wp:jet-forms/submit-field {"label":"Request viewing"} /-->',
    fields: [
      { name: "property_id", block: "jet-forms/hidden-field", type: "hidden", required: true, attrs: { field_value: "query_var", query_var_key: "factory_property_id", name: "property_id", required: true } },
      { name: "name", block: "jet-forms/text-field", type: "text", required: true, attrs: { label: "Name", name: "name", required: true } },
      { name: "email", block: "jet-forms/text-field", type: "email", required: false, attrs: { field_type: "email", label: "Email", name: "email" } },
      { name: "phone", block: "jet-forms/text-field", type: "tel", required: false, attrs: { field_type: "tel", label: "Phone", name: "phone" } },
      { name: "message", block: "jet-forms/textarea-field", type: "textarea", required: false, attrs: { label: "Message", name: "message" } },
      { name: "_factory_policy_guard", block: "jet-forms/text-field", type: "hidden", required: true, attrs: { field_type: "hidden", default: "request_viewing_before_v1", name: "_factory_policy_guard", required: true, validation: { rules: [{ type: "ssr", value: "factory_request_viewing_before_v1_validate_contacts" }, { type: "ssr", value: "factory_request_viewing_before_v1_validate_property" }] } } }
    ],
    actions: [{ type: "save_record" }],
    binding: { form_id: 13, form_sha256: "a".repeat(64), email_field: "email", phone_field: "phone", property_field: "property_id", guard_field: "_factory_policy_guard", guard_value: "request_viewing_before_v1" },
    policy_sha256: "541167d3a80c45095ef9396741fb99dca90752e7f5d7edecadb991d01d188e14"
  }, overrides || {});
}

test("actual-observation facts classify the accepted no-date before-state as applicable", () => {
  const facts = nativeFactsFromObservation(observation());
  assert.deepEqual(classifyAddOptionalViewingDateChange(facts), { classification: "applicable" });
  assert.equal(Object.hasOwn(facts, "patch"), false);
});

test("canonical database capture source declares one full managed database without selective dump flags", () => {
  assert.match(MYSQLDUMP_SCRIPT, /mysqldump/);
  assert.match(MYSQLDUMP_SCRIPT, /"\$MYSQL_DATABASE"/);
  assert.doesNotMatch(MYSQLDUMP_SCRIPT, /--(?:tables|where|ignore-table|ignore-table-data)\b/i);
});

test("equivalent native optional date is no-op and conflicting or ambiguous observations fail closed", () => {
  const noOp = observation();
  noOp.fields.push({ name: "preferred_date", block: "jet-forms/date-field", type: "date", label: "Preferred date", required: false });
  assert.deepEqual(classifyAddOptionalViewingDateChange(nativeFactsFromObservation(noOp)), { classification: "no_op" });
  const conflict = observation({ actions: [{ type: "save_record" }, { type: "email" }] });
  assert.throws(() => nativeFactsFromObservation(conflict), { code: "viewing_date_runtime_malformed" });
  const duplicate = observation();
  duplicate.fields.push(Object.assign({}, duplicate.fields[1]));
  assert.throws(() => nativeFactsFromObservation(duplicate), { code: "viewing_date_runtime_ambiguous" });
});

test("strict observation rejects policy, binding, field, context, and guard counterexamples", () => {
  const cases = [
    ["missing policy", (value) => { delete value.policy_sha256; }],
    ["unexpected policy", (value) => { value.policy_sha256 = "0".repeat(64); }],
    ["extra binding key", (value) => { value.binding.extra = true; }],
    ["binding hash mismatch", (value) => { value.binding.form_sha256 = "0".repeat(64); }],
    ["unknown field", (value) => { value.fields.push({ name: "delivery", block: "jet-forms/text-field", type: "text", required: false, attrs: { name: "delivery" } }); }],
    ["name optional", (value) => { value.fields.find((field) => field.name === "name").required = false; }],
    ["wrong phone native type", (value) => { value.fields.find((field) => field.name === "phone").type = "text"; }],
    ["malformed property context", (value) => { value.fields.find((field) => field.name === "property_id").attrs.query_var_key = "other"; }],
    ["missing approved guard callback", (value) => { value.fields.find((field) => field.name === "_factory_policy_guard").attrs.validation.rules.pop(); }],
    ["delivery action", (value) => { value.actions.push({ type: "email" }); }]
  ];
  for (const [label, mutate] of cases) {
    const value = clone(observation());
    mutate(value);
    assert.throws(() => nativeFactsFromObservation(value), undefined, label);
  }
});

test("planned native delta is deterministic and only inserts the JFB optional date before submit", () => {
  const first = buildPatch(observation().form_content);
  const second = buildPatch(observation().form_content);
  assert.deepEqual(first, second);
  assert.match(first.next_content, /jet-forms\/date-field/);
  assert.equal(first.next_content.indexOf(DATE_BLOCK) < first.next_content.indexOf("jet-forms/submit-field"), true);
  assert.throws(() => buildPatch(first.next_content), { code: "viewing_date_patch_unsafe" });
});

test("prepared browser summary states the V3 Recovery boundary without disclosing internals", () => {
  const summary = browserSummary({ classification: { classification: "applicable" }, recovery: { status: "prepared", native_path: "C:\\secret", snapshot_id: "snapshot-internal", coverage: { raw_sql: "SELECT * FROM wp_posts" } } });
  const serialized = JSON.stringify(summary);
  assert.deepEqual(summary.recovery, {
    status: "prepared",
    byte_verification_notice: "The Recovery Point is prepared and byte-verified.",
    coverage_notice: "It covers the project's full database, WordPress filesystem, and project metadata.",
    row_inspection_notice: "Individual database rows were not inspected.",
    restore_notice: "Restore has not been run, so restoration of this form and its settings is not yet proven."
  });
  assert.doesNotMatch(serialized, /plan_id|snapshot_id|native_path|C:\\secret|form_id|blocker|wp_posts|wp_postmeta|raw_sql|SELECT/i);
});

class PreviewElement {
  constructor() {
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.dataset = {};
    this.elements = {};
  }

  addEventListener() {}
  setAttribute() {}
  getAttribute() { return null; }
  querySelector() { return null; }
  closest() { return null; }
}

function createPreviewRenderHarness() {
  const elements = new Map();
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, new PreviewElement());
    return elements.get(id);
  };
  getElementById("create-project-form").elements = {
    name: new PreviewElement(), slug: new PreviewElement(), port: new PreviewElement()
  };
  const window = {
    FactoryLauncherConfig: { testMode: true, skipInitialLoad: true },
    FactoryLauncherTestHooks: {},
    FactoryProjectSummaryCounts: null,
    location: { origin: "http://127.0.0.1:3847" },
    localStorage: { getItem: () => null, setItem: () => {} },
    matchMedia: () => ({ matches: false }),
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000000" },
    setTimeout,
    clearTimeout
  };
  window.window = window;
  const context = {
    window,
    document: { documentElement: { dataset: {} }, getElementById, querySelectorAll: () => [] },
    console,
    fetch: async () => { throw new Error("unexpected fetch"); },
    AbortController,
    Headers,
    FormData: class FormData {},
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../src/ui/app.js"), "utf8"), context, { filename: "launcher/src/ui/app.js" });
  return { hooks: window.FactoryLauncherTestHooks.viewingDatePreview, result: getElementById("viewing-date-preview-result") };
}

test("Preview UI renders only the public V3 Recovery boundary and preserves blocked wording", () => {
  const { hooks, result } = createPreviewRenderHarness();
  hooks.render(browserSummary({ classification: { classification: "applicable" }, recovery: { status: "prepared" } }));
  assert.match(result.innerHTML, /prepared and byte-verified/);
  assert.match(result.innerHTML, /full database, WordPress filesystem, and project metadata/);
  assert.match(result.innerHTML, /Individual database rows were not inspected/);
  assert.match(result.innerHTML, /Restore has not been run/);
  assert.match(result.innerHTML, /restoration of this form and its settings is not yet proven/);
  assert.doesNotMatch(result.innerHTML, /snapshot|plan_id|manifest|sha256|sql|wp_posts|binding/i);

  hooks.render(browserSummary({ classification: { classification: "applicable" }, recovery: { status: "not_prepared" } }));
  assert.match(result.innerHTML, /Recovery Point is not prepared\./);
  assert.doesNotMatch(result.innerHTML, /byte-verified|WordPress filesystem|project metadata/i);
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixtureProject() {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "factory-viewing-date-service-"));
  createProjectScaffold({ name: "CSF ST Viewing Before v1", slug: "csf-st-viewing-before-v1", port: 31001, projectsRoot });
  return projectsRoot;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function tarFixture(entries) {
  const chunks = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content || "");
    const header = Buffer.alloc(512);
    Buffer.from(entry.name).copy(header, 0);
    Buffer.from(content.length.toString(8).padStart(11, "0") + "\0").copy(header, 124);
    header[156] = (entry.type || "0").charCodeAt(0);
    chunks.push(header, content, Buffer.alloc((512 - (content.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function createSinglePassSnapshot(projectsRoot, options) {
  const slug = "csf-st-viewing-before-v1";
  const snapshotId = options && options.snapshotId || "snapshot-2026-09-04t07-33-05-548z-cc33fa13cbce";
  const projectState = readProjectBySlug(slug, projectsRoot);
  const binding = deriveProjectBinding(projectState.project);
  const db = Buffer.from(options && options.database || "INSERT INTO wp_posts VALUES (13,'form'); INSERT INTO wp_postmeta VALUES (13, '_jf_actions', 'save_record'); INSERT INTO wp_postmeta VALUES (13, '_factory_request_viewing_before_v1_owner', 'fixture'); INSERT INTO wp_options VALUES ('factory_request_viewing_before_v1_binding', 'fixture');");
  const tar = options && options.tar || tarFixture([{ name: "wordpress/wp-content/mu-plugins/factory-request-viewing-before-v1-policy.php", content: "<?php // policy" }]);
  const metadata = Buffer.from(options && options.metadata || JSON.stringify({
    schema: "factory_structural_snapshot_metadata", version: 1, project_slug: projectState.project.slug,
    project_id: projectState.project.project_id, site_name: projectState.project.site_name, wp_port: projectState.project.wp_port,
    runtime_status: projectState.project.runtime && projectState.project.runtime.status || null,
    agent_status: projectState.project.agent && projectState.project.agent.status || null,
    agent_version: projectState.project.agent && projectState.project.agent.version || null,
    binding: binding.basis, created_at: "2026-09-04T07:33:11.281Z"
  }));
  const artifacts = [
    ["database_dump", "database.sql", db],
    ["wordpress_filesystem", "wordpress.tar", tar],
    ["project_metadata", "project-metadata.json", metadata]
  ].map(([type, relative_filename, bytes]) => ({ type, relative_filename, digest_algorithm: "sha256", digest: sha256(bytes), size_bytes: bytes.length, capture_status: "verified" }));
  const created = createManifestRecord({
    projectsRoot,
    slug,
    snapshotId,
    manifest: {
      captured_components: ["database", "logical_database_dump", "wordpress_filesystem", "sanitized_project_metadata", "dependency_theme_plugin_identities", "agent_version_binding"],
      consistency_mode: "coordinated_maintenance_db_filesystem_capture",
      artifacts,
      software: { capture_service: "structural_snapshot_capture_20a3b", archive_format: "ustar" },
      verification: { status: "passed", successful: true, checks: ["fixture"] },
      restore_compatibility: { status: "compatible", blocking: false, blockers: [] },
      provenance: { source: "launcher_structural_snapshot_capture_20a3b", capture_scope: "database_and_wordpress_filesystem" }
    }
  });
  const context = resolveSnapshotDirectory({ projectsRoot, slug, snapshotId });
  for (const artifact of artifacts) fs.writeFileSync(path.join(context.snapshotDirectory, artifact.relative_filename), [db, tar, metadata][artifacts.indexOf(artifact)]);
  transitionManifestStatus({ projectsRoot, slug, snapshotId, status: "complete" });
  transitionManifestStatus({ projectsRoot, slug, snapshotId, status: "verified", patch: { verification: { status: "passed", successful: true, checks: ["file_exists", "size_positive", "sha256_valid", "sql_create_table_markers", "wordpress_options_table", "wordpress_posts_table", "wordpress_postmeta_table"] }, restore_compatibility: { status: "compatible", blocking: false, blockers: [] } } });
  return { projectState, context, manifest: created.manifest, plan: { baseline: { project_binding: { fingerprint: binding.fingerprint } } }, artifacts };
}

function countedFileSystem(counts, options) {
  const proxy = Object.create(fs);
  const names = options && options.names || {};
  proxy.openSync = (target, ...rest) => {
    if (path.basename(target) === "manifest.json") counts.manifest += 1;
    return fs.openSync(target, ...rest);
  };
  proxy.readFileSync = (target, ...rest) => {
    counts.manifest += 1;
    return fs.readFileSync(target, ...rest);
  };
  proxy.createReadStream = (target, ...rest) => {
    const label = names[path.basename(target)] || path.basename(target);
    counts[label] = (counts[label] || 0) + 1;
    return fs.createReadStream(target, ...(options && options.streamOptions ? [Object.assign({}, ...rest, options.streamOptions)] : rest));
  };
  return proxy;
}

async function preview(projectsRoot, observe) {
  return createViewingDatePreview({ projectsRoot, slug: "csf-st-viewing-before-v1", observe });
}

function resultPath(projectsRoot, planId) {
  return path.join(projectsRoot, "csf-st-viewing-before-v1", "proofs", "viewing-date-preview-v1", "recovery-results", planId + ".json");
}

function approvedCoverage(overrides) {
  return Object.assign({
    schema: "csf_viewing_date_recovery_scope_coverage", version: 1,
    database: { scope: "full_database", capture_authority: true, artifact_bytes_verified: true, affected_resources: ["request_viewing_form_post", "request_viewing_form_meta_actions_ownership", "request_viewing_policy_binding_option"], row_level_inspection: false, restore_verification_required: true },
    wordpress_filesystem: { scope: "wordpress_filesystem_archive", artifact_bytes_verified: true, policy_file_verified: true },
    project_metadata: { scope: "project_metadata", artifact_bytes_verified: true, project_identity_verified: true }
  }, overrides || {});
}

function approvedSnapshotIdentity(snapshotId, projectFingerprint) {
  return {
    snapshot_id: snapshotId || "snapshot-exact",
    project_slug: "csf-st-viewing-before-v1",
    project_identity_fingerprint: projectFingerprint || "b".repeat(64),
    manifest_sha256: "c".repeat(64),
    artifacts_sha256: "d".repeat(64)
  };
}

function approvedReattestation(plan, overrides) {
  const identity = approvedSnapshotIdentity("snapshot-exact", plan && plan.baseline.project_binding.fingerprint);
  return Object.assign({
    manifest: { snapshot_id: identity.snapshot_id },
    snapshot_identity: identity,
    coverage: approvedCoverage(),
    inspection: { artifact_verification: "single_pass", manifest_read_count: 1, artifact_stream_count: 3 },
    snapshot_reused: true,
    new_snapshot_created: false,
    capture_not_invoked: true
  }, overrides || {});
}

function approvedArtifactVerification(plan) {
  return { snapshot_identity: approvedSnapshotIdentity("snapshot-exact", plan && plan.baseline.project_binding.fingerprint) };
}

async function matching(projectsRoot, plan, snapshot) {
  const reattestation = snapshot || approvedReattestation(plan);
  return await matchingPreparedRecovery(
    { project: { slug: "csf-st-viewing-before-v1" }, runtimePath: path.join(projectsRoot, "csf-st-viewing-before-v1") },
    plan,
    projectsRoot,
    () => reattestation,
    () => ({ snapshot_identity: reattestation.snapshot_identity })
  );
}

test("capture failure is blocked, sanitized, and never automatically retries", async () => {
  const projectsRoot = fixtureProject();
  const observed = observation();
  const result = await preview(projectsRoot, async () => clone(observed));
  let reattestations = 0;
  const options = { projectsRoot, slug: "csf-st-viewing-before-v1", planId: result.plan_id, observe: async () => clone(observed), reattest: async () => { reattestations += 1; throw Object.assign(new Error("C:\\private\\failure"), { code: "capture_failed" }); } };
  await assert.rejects(() => prepareViewingDateRecovery(options), { code: "capture_failed" });
  await assert.rejects(() => prepareViewingDateRecovery(options), { code: "viewing_date_recovery_already_attempted" });
  assert.equal(reattestations, 1);
  const persisted = JSON.parse(fs.readFileSync(resultPath(projectsRoot, result.plan_id), "utf8"));
  assert.equal(persisted.status, "blocked");
  const publicSummary = browserSummary({ classification: { classification: "applicable" }, recovery: { status: persisted.status } });
  assert.equal(publicSummary.recovery.status, "not_prepared");
  assert.doesNotMatch(JSON.stringify(publicSummary), /private|failure/i);
});

test("baseline drift after capture blocks association and does not bless the created snapshot", async () => {
  const projectsRoot = fixtureProject();
  const before = observation();
  const after = observation({ form_sha256: "c".repeat(64), binding: { form_id: 13, form_sha256: "c".repeat(64), email_field: "email", phone_field: "phone", property_field: "property_id", guard_field: "_factory_policy_guard", guard_value: "request_viewing_before_v1" } });
  const result = await preview(projectsRoot, async () => clone(before));
  let reads = 0;
  let reattestations = 0;
  await assert.rejects(() => prepareViewingDateRecovery({ projectsRoot, slug: "csf-st-viewing-before-v1", planId: result.plan_id, observe: async () => clone(reads++ === 0 ? before : after), reattest: async ({ plan }) => { reattestations += 1; return approvedReattestation(plan); }, verifyArtifacts: async ({ plan }) => approvedArtifactVerification(plan) }), { code: "viewing_date_baseline_drift" });
  assert.equal(reattestations, 1);
  assert.equal(JSON.parse(fs.readFileSync(resultPath(projectsRoot, result.plan_id), "utf8")).status, "blocked");
});

test("missing or optimistic scope assertions block preparation", async () => {
  const cases = [
    ["missing restore verification", (coverage) => { coverage.database.restore_verification_required = false; }],
    ["row-level claim", (coverage) => { coverage.database.row_level_inspection = true; }],
    ["missing database authority", (coverage) => { coverage.database.capture_authority = false; }],
    ["missing filesystem policy", (coverage) => { coverage.wordpress_filesystem.policy_file_verified = false; }],
    ["missing metadata identity", (coverage) => { coverage.project_metadata.project_identity_verified = false; }]
  ];
  for (const [label, mutate] of cases) {
    const projectsRoot = fixtureProject();
    const observed = observation();
    const result = await preview(projectsRoot, async () => clone(observed));
    const coverage = clone(approvedCoverage());
    mutate(coverage);
    await assert.rejects(() => prepareViewingDateRecovery({ projectsRoot, slug: "csf-st-viewing-before-v1", planId: result.plan_id, observe: async () => clone(observed), reattest: async ({ plan }) => approvedReattestation(plan, { coverage }) }), { code: "viewing_date_recovery_coverage_missing" }, label);
    assert.equal(JSON.parse(fs.readFileSync(resultPath(projectsRoot, result.plan_id), "utf8")).status, "blocked", label);
  }
});

test("tar inventory accepts only safe canonical native entries", () => {
  const policyPath = "wordpress/wp-content/mu-plugins/factory-request-viewing-before-v1-policy.php";
  const cases = [
    ["actual native policy entry", [{ name: policyPath, size: 4795, type: "0" }], true],
    ["safe leading dot slash", [{ name: "./" + policyPath, size: 4795, type: "0" }], true],
    ["missing policy", [{ name: "wordpress/wp-content/mu-plugins/other.php", size: 1, type: "0" }], true],
    ["wrong root suffix", [{ name: "other/" + policyPath, size: 1, type: "0" }], true],
    ["absolute", [{ name: "/" + policyPath, size: 1, type: "0" }], false],
    ["drive", [{ name: "C:/" + policyPath, size: 1, type: "0" }], false],
    ["UNC", [{ name: "//server/share/file", size: 1, type: "0" }], false],
    ["traversal", [{ name: "wordpress/../unsafe", size: 1, type: "0" }], false],
    ["backslash", [{ name: "wordpress\\unsafe", size: 1, type: "0" }], false],
    ["control", [{ name: "wordpress/unsafe\u0000", size: 1, type: "0" }], false],
    ["malformed", [{ name: policyPath, type: "0" }], false],
    ["link", [{ name: policyPath, size: 1, type: "2" }], false],
    ["duplicate exact", [{ name: policyPath, size: 1, type: "0" }, { name: policyPath, size: 2, type: "0" }], false],
    ["duplicate canonical", [{ name: policyPath, size: 1, type: "0" }, { name: "./" + policyPath, size: 1, type: "0" }], false],
    ["file directory conflict", [{ name: "wordpress/wp-content", size: 1, type: "0" }, { name: "wordpress/wp-content/mu-plugins/", size: 0, type: "5" }], false],
    ["reverse file directory conflict", [{ name: "wordpress/wp-content/mu-plugins/", size: 0, type: "5" }, { name: "wordpress/wp-content", size: 1, type: "0" }], false],
    ["unsafe alongside policy", [{ name: policyPath, size: 4795, type: "0" }, { name: "../unsafe", size: 1, type: "0" }], false]
  ];
  for (const [label, entries, valid] of cases) {
    const inventory = canonicalTarEntryInventory(entries);
    assert.equal(Boolean(inventory), valid, label);
    if (valid && ["actual native policy entry", "safe leading dot slash"].includes(label)) assert.equal(inventory.has(policyPath), true, label);
  }
});

test("coverage accepts only explicit v3 scopes and never a row-level claim", () => {
  assert.match(coverageFingerprint(approvedCoverage()), /^[a-f0-9]{64}$/);
  for (const mutate of [
    (coverage) => { coverage.database.row_level_inspection = true; },
    (coverage) => { coverage.database.restore_verification_required = false; },
    (coverage) => { coverage.database.affected_resources.pop(); },
    (coverage) => { coverage.schema = "other"; },
    (coverage) => { coverage.unrelated = true; }
  ]) {
    const coverage = clone(approvedCoverage());
    mutate(coverage);
    assert.equal(coverageFingerprint(coverage), null);
  }
});

test("actual artifact bytes are verified by streaming hash before prepared selection", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "factory-viewing-date-artifacts-"));
  const artifacts = [
    ["database_dump", "database.sql", Buffer.from("database bytes")],
    ["wordpress_filesystem", "wordpress.tar", Buffer.from("tar bytes")],
    ["project_metadata", "project-metadata.json", Buffer.from("metadata bytes")]
  ];
  for (const [type, filename, bytes] of artifacts) {
    const filePath = path.join(root, filename);
    fs.writeFileSync(filePath, bytes);
    const artifact = { type, size_bytes: bytes.length, digest: crypto.createHash("sha256").update(bytes).digest("hex") };
    const valid = await streamSha256Artifact(filePath, artifact);
    assert.deepEqual({ type: valid.type, size_bytes: valid.size_bytes, sha256: valid.sha256 }, { type, size_bytes: bytes.length, sha256: artifact.digest });
    fs.writeFileSync(filePath, Buffer.from(bytes.toString() + " changed"));
    assert.equal(await streamSha256Artifact(filePath, artifact), null, type + " byte drift");
  }
  const artifact = { type: "database_dump", size_bytes: 4, digest: crypto.createHash("sha256").update("safe").digest("hex") };
  assert.equal(await streamSha256Artifact(path.join(root, "missing.sql"), artifact), null, "missing");
  const directory = path.join(root, "directory");
  fs.mkdirSync(directory);
  assert.equal(await streamSha256Artifact(directory, artifact), null, "directory");
  assert.equal(await streamSha256Artifact(path.join(root, "database.sql"), Object.assign({}, artifact, { size_bytes: 5 })), null, "size mismatch");
  const unreadableFs = { lstatSync: () => { throw new Error("unreadable"); }, createReadStream: () => { throw new Error("must not read"); } };
  assert.equal(await streamSha256Artifact("ignored", artifact, { fs: unreadableFs }), null, "unreadable");
  const before = { isFile: () => true, isSymbolicLink: () => false, size: 4, mtimeMs: 1, dev: 1, ino: 1 };
  const after = { isFile: () => true, isSymbolicLink: () => false, size: 4, mtimeMs: 2, dev: 1, ino: 1 };
  const changingFs = { lstatSync: (() => { let calls = 0; return () => calls++ === 0 ? before : after; })(), createReadStream: () => Readable.from([Buffer.from("safe")]) };
  assert.equal(await streamSha256Artifact("ignored", artifact, { fs: changingFs }), null, "changes during read");
  const linkFs = { lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => true, size: 4, mtimeMs: 1 }), createReadStream: () => { throw new Error("must not read link"); } };
  assert.equal(await streamSha256Artifact("ignored", artifact, { fs: linkFs }), null, "symlink or reparse");
  const streamErrorFs = { lstatSync: () => before, createReadStream: () => new Readable({ read() { this.destroy(new Error("stream failed")); } }) };
  assert.equal(await streamSha256Artifact("ignored", artifact, { fs: streamErrorFs }), null, "stream error");
});

test("single-pass inspection derives full-database scope without interpreting SQL rows", async () => {
  const projectsRoot = fixtureProject();
  const snapshot = createSinglePassSnapshot(projectsRoot, { database: "-- comment mentions Form 13, _jf_actions, and a fake binding\nSELECT 'unrelated SQL content';" });
  const counts = { manifest: 0, "database.sql": 0, "wordpress.tar": 0, "project-metadata.json": 0 };
  const inspected = await inspectSnapshotSinglePass({ projectsRoot, projectState: snapshot.projectState, plan: snapshot.plan, fs: countedFileSystem(counts, { streamOptions: { highWaterMark: 7 } }) });
  assert.ok(inspected);
  assert.deepEqual(inspected.coverage, approvedCoverage());
  assert.equal(inspected.inspection.artifact_verification, "single_pass");
  assert.deepEqual(counts, { manifest: 1, "database.sql": 1, "wordpress.tar": 1, "project-metadata.json": 1 });
});

test("full-database capture authority and metadata identity fail closed", async () => {
  const authorityCases = [
    ["selective component scope", (manifest) => { manifest.captured_components = manifest.captured_components.filter((value) => value !== "database"); }],
    ["unknown capture authority", (manifest) => { manifest.provenance.capture_scope = "unknown"; }],
    ["missing generic database verification", (manifest) => { manifest.verification.checks = manifest.verification.checks.filter((value) => value !== "wordpress_postmeta_table"); }]
  ];
  for (const [label, mutate] of authorityCases) {
    const projectsRoot = fixtureProject();
    const snapshot = createSinglePassSnapshot(projectsRoot);
    const manifest = JSON.parse(fs.readFileSync(snapshot.context.manifestPath, "utf8"));
    mutate(manifest);
    fs.writeFileSync(snapshot.context.manifestPath, JSON.stringify(manifest));
    assert.equal(await inspectSnapshotSinglePass({ projectsRoot, projectState: snapshot.projectState, plan: snapshot.plan }), null, label);
  }
  for (const [label, metadata] of [
    ["null", "null"], ["scalar", "1"], ["array", "[]"], ["malformed", "{"],
    ["wrong project", JSON.stringify({ schema: "factory_structural_snapshot_metadata", version: 1, project_slug: "other", project_id: "other", site_name: "other", wp_port: 1, runtime_status: null, agent_status: null, agent_version: null, binding: "local_rescue_project_id_v1", created_at: "2026-09-04T07:33:11.281Z" })]
  ]) {
    const projectsRoot = fixtureProject();
    const snapshot = createSinglePassSnapshot(projectsRoot, { metadata });
    assert.equal(await inspectSnapshotSinglePass({ projectsRoot, projectState: snapshot.projectState, plan: snapshot.plan }), null, label);
  }
});

test("single-pass inspection fails closed before opens for reparse paths and outside artifacts", async () => {
  const cases = [
    ["recovery root", (snapshot, proxy) => { const original = proxy.lstatSync; proxy.lstatSync = (target) => target === snapshot.context.recoveryRoot ? Object.assign(Object.create(original(target)), { isSymbolicLink: () => true }) : original(target); }],
    ["project recovery ancestor", (snapshot, proxy) => { const original = proxy.lstatSync; proxy.lstatSync = (target) => target === snapshot.context.projectDirectory ? Object.assign(Object.create(original(target)), { isSymbolicLink: () => true }) : original(target); }],
    ["snapshot directory", (snapshot, proxy) => { const original = proxy.lstatSync; proxy.lstatSync = (target) => target === snapshot.context.snapshotDirectory ? Object.assign(Object.create(original(target)), { isSymbolicLink: () => true }) : original(target); }],
    ["manifest", (snapshot, proxy) => { const original = proxy.lstatSync; proxy.lstatSync = (target) => target === snapshot.context.manifestPath ? Object.assign(Object.create(original(target)), { isSymbolicLink: () => true }) : original(target); }],
    ["database artifact", (snapshot, proxy) => { const target = path.join(snapshot.context.snapshotDirectory, "database.sql"); const original = proxy.lstatSync; proxy.lstatSync = (value) => value === target ? Object.assign(Object.create(original(value)), { isSymbolicLink: () => true }) : original(value); }]
  ];
  for (const [label, mutate] of cases) {
    const projectsRoot = fixtureProject();
    const snapshot = createSinglePassSnapshot(projectsRoot);
    const counts = { manifest: 0, "database.sql": 0, "wordpress.tar": 0, "project-metadata.json": 0 };
    const proxy = countedFileSystem(counts);
    mutate(snapshot, proxy);
    assert.equal(await inspectSnapshotSinglePass({ projectsRoot, projectState: snapshot.projectState, plan: snapshot.plan, fs: proxy }), null, label);
    if (label !== "database artifact") assert.equal(counts.manifest, 0, label + " has no manifest open");
    assert.equal(counts["database.sql"] + counts["wordpress.tar"] + counts["project-metadata.json"], 0, label + " has no artifact opens");
  }
  const projectsRoot = fixtureProject();
  const snapshot = createSinglePassSnapshot(projectsRoot);
  const manifest = JSON.parse(fs.readFileSync(snapshot.context.manifestPath, "utf8"));
  manifest.artifacts.find((artifact) => artifact.type === "database_dump").relative_filename = "../outside.sql";
  fs.writeFileSync(snapshot.context.manifestPath, JSON.stringify(manifest));
  assert.equal(await inspectSnapshotSinglePass({ projectsRoot, projectState: snapshot.projectState, plan: snapshot.plan }), null, "artifact containment");
});

test("single-pass inspection rejects directories, pre-open identity swaps, stream swaps, and hash or coverage failures without retries", async () => {
  const cases = [
    ["directory artifact", (snapshot) => { fs.rmSync(path.join(snapshot.context.snapshotDirectory, "database.sql")); fs.mkdirSync(path.join(snapshot.context.snapshotDirectory, "database.sql")); }],
    ["final metadata hash mismatch after valid DB and TAR coverage", (snapshot) => { const manifest = JSON.parse(fs.readFileSync(snapshot.context.manifestPath, "utf8")); manifest.artifacts.find((artifact) => artifact.type === "project_metadata").digest = "0".repeat(64); fs.writeFileSync(snapshot.context.manifestPath, JSON.stringify(manifest)); }],
    ["unrelated database bytes remain non-row-level scope", (snapshot) => { const bytes = Buffer.from("SELECT 'nothing about the viewing form';"); const file = path.join(snapshot.context.snapshotDirectory, "database.sql"); fs.writeFileSync(file, bytes); const manifest = JSON.parse(fs.readFileSync(snapshot.context.manifestPath, "utf8")); const artifact = manifest.artifacts.find((entry) => entry.type === "database_dump"); artifact.size_bytes = bytes.length; artifact.digest = sha256(bytes); fs.writeFileSync(snapshot.context.manifestPath, JSON.stringify(manifest)); }]
  ];
  for (const [label, mutate] of cases) {
    const projectsRoot = fixtureProject();
    const snapshot = createSinglePassSnapshot(projectsRoot);
    mutate(snapshot);
    const counts = { manifest: 0, "database.sql": 0, "wordpress.tar": 0, "project-metadata.json": 0 };
    const inspected = await inspectSnapshotSinglePass({ projectsRoot, projectState: snapshot.projectState, plan: snapshot.plan, fs: countedFileSystem(counts) });
    if (label.startsWith("unrelated database")) assert.deepEqual(inspected.coverage, approvedCoverage(), label);
    else assert.equal(inspected, null, label);
    assert.ok(counts.manifest <= 1 && counts["database.sql"] <= 1 && counts["wordpress.tar"] <= 1 && counts["project-metadata.json"] <= 1, label + " no retry");
    if (label.startsWith("final metadata")) assert.deepEqual(counts, { manifest: 1, "database.sql": 1, "wordpress.tar": 1, "project-metadata.json": 1 }, label);
  }
  const projectsRoot = fixtureProject();
  const snapshot = createSinglePassSnapshot(projectsRoot);
  const counts = { manifest: 0, "database.sql": 0, "wordpress.tar": 0, "project-metadata.json": 0 };
  const proxy = countedFileSystem(counts);
  const originalFstat = proxy.fstatSync;
  let fstats = 0;
  proxy.fstatSync = (fd) => {
    const stat = originalFstat(fd);
    fstats += 1;
    if (fstats === 2) return Object.assign(Object.create(stat), { ino: stat.ino + 1 });
    return stat;
  };
  assert.equal(await inspectSnapshotSinglePass({ projectsRoot, projectState: snapshot.projectState, plan: snapshot.plan, fs: proxy }), null, "handle identity differs after open");
  assert.equal(counts["database.sql"], 1, "one stream before fail");
});

test("prepared matcher waits for the complete single-pass inspection and never returns early on a delayed mismatch", async () => {
  const projectsRoot = fixtureProject();
  const observed = observation();
  const previewResult = await preview(projectsRoot, async () => clone(observed));
  const plan = JSON.parse(fs.readFileSync(path.join(projectsRoot, "csf-st-viewing-before-v1", "proofs", "viewing-date-preview-v1", "plans", previewResult.plan_id + ".json"), "utf8"));
  const snapshot = approvedReattestation(plan);
  fs.mkdirSync(path.dirname(resultPath(projectsRoot, plan.plan_id)), { recursive: true });
  fs.writeFileSync(resultPath(projectsRoot, plan.plan_id), JSON.stringify({
    schema: "csf_viewing_date_recovery_result", version: 3, coverage_schema: "csf_viewing_date_recovery_scope_coverage", coverage_version: 1, plan_id: plan.plan_id, project_slug: plan.project_slug,
    project_identity_fingerprint: plan.baseline.project_binding.fingerprint, profile_id: "add_optional_viewing_date", profile_version: 1,
    baseline_sha256: baselineFingerprint(plan), proposed_change_sha256: proposedChangeFingerprint(plan), status: "prepared",
    snapshot_id: snapshot.snapshot_identity.snapshot_id, snapshot_identity: snapshot.snapshot_identity, snapshot_reused: true,
    new_snapshot_created: false, capture_not_invoked: true, coverage: snapshot.coverage,
    coverage_sha256: coverageFingerprint(snapshot.coverage)
  }));
  let release;
  const delayed = new Promise((resolve) => { release = resolve; });
  let settled = false;
  const pending = matchingPreparedRecovery(
    { project: { slug: "csf-st-viewing-before-v1" }, runtimePath: path.join(projectsRoot, "csf-st-viewing-before-v1") },
    plan,
    projectsRoot,
    async () => { await delayed; return approvedReattestation(plan, { snapshot_identity: Object.assign({}, snapshot.snapshot_identity, { artifacts_sha256: "0".repeat(64) }) }); }
  ).then((value) => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false, "matching cannot prepare before inspection resolves");
  release();
  assert.equal(await pending, null, "mismatched final single-pass identity cannot prepare");
});

test("wrong project is rejected before capture and prepared recovery belongs only to its exact immutable plan", async () => {
  const projectsRoot = fixtureProject();
  const observed = observation();
  const result = await preview(projectsRoot, async () => clone(observed));
  let reattestations = 0;
  await assert.rejects(() => prepareViewingDateRecovery({ projectsRoot, slug: "other-project", planId: result.plan_id, reattest: async () => { reattestations += 1; } }), { code: "viewing_date_project_not_allowed" });
  assert.equal(reattestations, 0);
  const options = { projectsRoot, slug: "csf-st-viewing-before-v1", planId: result.plan_id, observe: async () => clone(observed), reattest: async ({ plan }) => { reattestations += 1; return approvedReattestation(plan); }, verifyArtifacts: async ({ plan }) => approvedArtifactVerification(plan), idempotencyKey: "same-key" };
  await prepareViewingDateRecovery(options);
  await assert.rejects(() => prepareViewingDateRecovery(options), { code: "viewing_date_recovery_already_attempted" });
  assert.equal(reattestations, 1);
  const recovered = await preview(projectsRoot, async () => clone(observed));
  assert.equal(recovered.recovery.status, "not_prepared");
});

test("prepared recovery requires exact plan baseline, coverage, and snapshot identity", async () => {
  async function preparedFixture() {
    const projectsRoot = fixtureProject();
    const observed = observation();
    const first = await preview(projectsRoot, async () => clone(observed));
    await prepareViewingDateRecovery({ projectsRoot, slug: "csf-st-viewing-before-v1", planId: first.plan_id, observe: async () => clone(observed), reattest: async ({ plan }) => approvedReattestation(plan), verifyArtifacts: async ({ plan }) => approvedArtifactVerification(plan) });
    const planFile = path.join(projectsRoot, "csf-st-viewing-before-v1", "proofs", "viewing-date-preview-v1", "plans", first.plan_id + ".json");
    const recoveryFile = resultPath(projectsRoot, first.plan_id);
    return {
      projectsRoot,
      observed,
      first,
      planFile,
      recoveryFile,
      plan: JSON.parse(fs.readFileSync(planFile, "utf8")),
      recovery: JSON.parse(fs.readFileSync(recoveryFile, "utf8"))
    };
  }

  const variants = [
    ["missing plan profile ID", (plan) => { delete plan.profile_id; }],
    ["mismatched plan profile ID", (plan) => { plan.profile_id = "other_profile"; }],
    ["missing plan version", (plan) => { delete plan.profile_version; }],
    ["string plan version", (plan) => { plan.profile_version = "1"; }],
    ["baseline changed under same plan ID", (plan) => { plan.baseline.form_sha256 = "0".repeat(64); }],
    ["missing result baseline", (_plan, result) => { delete result.baseline_sha256; }],
    ["wrong result baseline", (_plan, result) => { result.baseline_sha256 = "0".repeat(64); }],
    ["missing proposed fingerprint", (_plan, result) => { delete result.proposed_change_sha256; }],
    ["missing snapshot ID", (_plan, result) => { delete result.snapshot_id; }],
    ["wrong snapshot ID", (_plan, result) => { result.snapshot_id = "snapshot-other"; }],
    ["missing snapshot identity", (_plan, result) => { delete result.snapshot_identity; }],
    ["wrong manifest fingerprint", (_plan, result) => { result.snapshot_identity.manifest_sha256 = "0".repeat(64); }],
    ["wrong artifact fingerprint", (_plan, result) => { result.snapshot_identity.artifacts_sha256 = "0".repeat(64); }],
    ["result supplied artifact path", (_plan, result) => { result.snapshot_identity.artifact_path = "C:\\untrusted\\artifact"; }],
    ["missing coverage fingerprint", (_plan, result) => { delete result.coverage_sha256; }],
    ["wrong coverage fingerprint", (_plan, result) => { result.coverage_sha256 = "0".repeat(64); }],
    ["unrelated-only coverage", (_plan, result) => { result.coverage = { unrelated: true }; }],
    ["missing restore verification", (_plan, result) => { delete result.coverage.database.restore_verification_required; }],
    ["false restore verification", (_plan, result) => { result.coverage.database.restore_verification_required = false; }],
    ["optimistic row inspection", (_plan, result) => { result.coverage.database.row_level_inspection = true; }],
    ["missing coverage schema", (_plan, result) => { delete result.coverage_schema; }],
    ["wrong coverage schema", (_plan, result) => { result.coverage_schema = "other"; }],
    ["missing plan coverage version", (plan) => { delete plan.recovery_coverage_version; }],
    ["malformed coverage", (_plan, result) => { result.coverage = []; }],
    ["other plan", (_plan, result) => { result.plan_id = "viewing-date-plan-00000000-0000-0000-0000-000000000000"; }],
    ["other project", (_plan, result) => { result.project_slug = "other-project"; }],
    ["missing result profile ID", (_plan, result) => { delete result.profile_id; }],
    ["mismatched result profile ID", (_plan, result) => { result.profile_id = "other_profile"; }],
    ["missing result version", (_plan, result) => { delete result.profile_version; }],
    ["string result version", (_plan, result) => { result.profile_version = "1"; }],
    ["mismatched result version", (_plan, result) => { result.profile_version = 2; }],
    ["blocked result", (_plan, result) => { result.status = "blocked"; }],
    ["v2 result is non-authoritative", (_plan, result) => { result.version = 2; }],
    ["legacy result schema", (_plan, result) => { result.version = 1; }]
  ];
  for (const [label, mutate] of variants) {
    const fixture = await preparedFixture();
    mutate(fixture.plan, fixture.recovery);
    fs.writeFileSync(fixture.planFile, JSON.stringify(fixture.plan));
    fs.writeFileSync(fixture.recoveryFile, JSON.stringify(fixture.recovery));
    assert.equal(await matching(fixture.projectsRoot, fixture.plan), null, label);
  }

  for (const [label, mutate] of [
    ["manifest drift after result", (snapshot) => { snapshot.snapshot_identity.manifest_sha256 = "0".repeat(64); }],
    ["artifact drift after result", (snapshot) => { snapshot.snapshot_identity.artifacts_sha256 = "0".repeat(64); }]
  ]) {
    const fixture = await preparedFixture();
    const snapshot = approvedReattestation(fixture.plan);
    mutate(snapshot);
    assert.equal(await matching(fixture.projectsRoot, fixture.plan, snapshot), null, label);
  }

  const fixture = await preparedFixture();
  assert.equal(fixture.recovery.coverage_sha256, coverageFingerprint(fixture.recovery.coverage));
  assert.deepEqual(await matching(fixture.projectsRoot, fixture.plan), { status: "prepared", snapshot_id: "snapshot-exact" });
  assert.equal(await matchingPreparedRecovery(
    { project: { slug: "csf-st-viewing-before-v1" }, runtimePath: path.join(fixture.projectsRoot, "csf-st-viewing-before-v1") },
    fixture.plan,
    fixture.projectsRoot,
    () => approvedReattestation(fixture.plan, { inspection: null })
  ), null, "structural result without actual artifact verification");
  assert.equal(await matchingPreparedRecovery(
    { project: { slug: "csf-st-viewing-before-v1" }, runtimePath: path.join(fixture.projectsRoot, "csf-st-viewing-before-v1") },
    fixture.plan,
    fixture.projectsRoot,
    () => approvedReattestation(fixture.plan, { snapshot_identity: Object.assign({}, approvedArtifactVerification(fixture.plan).snapshot_identity, { artifacts_sha256: "0".repeat(64) }) })
  ), null, "single-pass artifact identity must match the persisted result");
  const next = await preview(fixture.projectsRoot, async () => clone(fixture.observed));
  assert.equal(next.recovery.status, "not_prepared");
});
