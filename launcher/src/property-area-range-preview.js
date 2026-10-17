"use strict";

// This internal service is intentionally the second and last trusted change
// profile.  It owns only Property Area Range observations and its option
// projection; snapshot capture and inspection remain the established V3 flow.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { runCommand } = require("./runtime-tools");
const { readProjectBySlug, readStrictProjectInventory, resolveProjectsRoot, validateExplicitSlug, ensureDirectory } = require("./project-store");
const { assertReadyRuntimeBinding } = require("./runtime-binding");
const { deriveProjectBinding } = require("./structural-snapshot-store");
const { createFullStructuralSnapshot } = require("./structural-snapshot-capture");
const {
  PROPERTY_AREA_RANGE_ARCHIVE_PATHS,
  inspectSnapshotSinglePass,
  exactCoverageForPlan,
  coverageFingerprintForPlan,
  baselineFingerprint,
  proposedChangeFingerprint
} = require("./viewing-date-preview");
const { CONTRACT_PATH, loadRealEstateContract } = require("./real-estate-contract");

const PROFILE = "property_area_range@1";
const PROFILE_ID = "property_area_range";
const PROFILE_VERSION = 1;
const PLAN_ROOT = "property-area-range-preview-v1";
const OPTION_NAME = "factory_property_area_range_v1";
const PLAN_SCHEMA = "csf_property_area_range_preview";
const RECOVERY_SCHEMA = "csf_property_area_range_recovery_result";
const RECOVERY_VERSION = 3;
const DECIMAL_GRAMMAR = /^(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,2})?$/;
const BROWSER_SUMMARY_SCHEMA_VERSION = 1;

function fail(code, message, statusCode) {
  const error = new Error(message || "Property Area Range cannot proceed safely.");
  error.code = code;
  error.statusCode = statusCode || 409;
  return error;
}

function hash(value) {
  return crypto.createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
}

function exactKeys(value, keys) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === keys.slice().sort().join(","));
}

function planDirectory(projectState) {
  return path.join(projectState.runtimePath, "proofs", PLAN_ROOT);
}

function planPath(projectState, planId) {
  if (typeof planId !== "string" || !/^property-area-range-plan-[0-9a-f-]{36}$/.test(planId)) {
    throw fail("property_area_range_plan_invalid", "Property Area Range requires the prepared Preview.", 400);
  }
  return path.join(planDirectory(projectState), "plans", planId + ".json");
}

function recoveryPath(projectState, planId) {
  return path.join(planDirectory(projectState), "recovery-results", planId + ".json");
}

function assertPropertyAreaRangeCoverageReadiness(projectState) {
  const wordpressRoot = path.resolve(projectState.runtimePath, "wordpress");
  let rootReal;
  try {
    const rootStat = fs.lstatSync(wordpressRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("unsafe_root");
    rootReal = fs.realpathSync(wordpressRoot);
  } catch (_) {
    throw fail("property_area_range_recovery_coverage_unready", "Property Area Range Recovery cannot verify its required archive coverage.");
  }
  for (const archivePath of PROPERTY_AREA_RANGE_ARCHIVE_PATHS) {
    const relative = archivePath.split("/").slice(1);
    const target = path.join(wordpressRoot, ...relative);
    try {
      const targetStat = fs.lstatSync(target);
      const targetReal = fs.realpathSync(target);
      if (!targetStat.isFile() || targetStat.isSymbolicLink()
        || (targetReal !== rootReal && !targetReal.startsWith(rootReal + path.sep))) throw new Error("unsafe_target");
    } catch (_) {
      throw fail("property_area_range_recovery_coverage_unready", "Property Area Range Recovery cannot verify its required archive coverage.");
    }
  }
  return { required_archive_paths: PROPERTY_AREA_RANGE_ARCHIVE_PATHS.slice() };
}

function atomicJson(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
}

function readJson(filePath, code) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (_) { throw fail(code, "Property Area Range authority could not be read safely."); }
}

function pluginDirectory() {
  return path.resolve(__dirname, "../../wordpress-plugin");
}

function pluginIdentityRecord(relativePath, sha256) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.startsWith("/")
    || relativePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw fail("property_area_range_plugin_identity_invalid", "The reviewed Factory plugin could not be identified.");
  }
  return String(Buffer.byteLength(relativePath, "utf8")) + ":" + relativePath + ":" + sha256;
}

function pluginIdentityDigest(records) {
  if (!Array.isArray(records) || records.some((record) => typeof record !== "string" || !record)) {
    throw fail("property_area_range_plugin_identity_invalid", "The reviewed Factory plugin could not be identified.");
  }
  return hash(Buffer.from(records.join("\n") + "\n", "utf8"));
}

function directoryIdentity(directory) {
  try {
    const root = path.resolve(directory);
    const rootStat = fs.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw fail("property_area_range_plugin_identity_invalid", "The reviewed Factory plugin could not be identified.");
    const files = [];
    const visit = (current) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const target = path.join(current, entry.name);
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw fail("property_area_range_plugin_identity_invalid", "The reviewed Factory plugin could not be identified.");
        if (stat.isDirectory()) visit(target);
        else {
          const relative = path.relative(root, target).split(path.sep).join("/");
          files.push(pluginIdentityRecord(relative, hash(fs.readFileSync(target))));
        }
      }
    };
    visit(root);
    files.sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
    return pluginIdentityDigest(files);
  } catch (error) {
    if (error && error.code === "property_area_range_plugin_identity_invalid") throw error;
    throw fail("property_area_range_plugin_identity_invalid", "The reviewed Factory plugin could not be identified.");
  }
}

function nativePluginIdentityPhp(rootExpression) {
  return "$factory_plugin_identity_root=" + rootExpression + ";"
    + "$factory_plugin_identity_files=[];$factory_plugin_identity_valid=is_dir($factory_plugin_identity_root)&&!is_link($factory_plugin_identity_root);"
    + "if($factory_plugin_identity_valid){$factory_plugin_identity_iterator=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($factory_plugin_identity_root,FilesystemIterator::SKIP_DOTS));foreach($factory_plugin_identity_iterator as $factory_plugin_identity_file){if($factory_plugin_identity_file->isLink()||!$factory_plugin_identity_file->isFile()){$factory_plugin_identity_valid=false;break;}$factory_plugin_identity_relative=str_replace('\\\\','/',substr($factory_plugin_identity_file->getPathname(),strlen($factory_plugin_identity_root)+1));$factory_plugin_identity_hash=hash_file('sha256',$factory_plugin_identity_file->getPathname());if($factory_plugin_identity_relative===''||str_starts_with($factory_plugin_identity_relative,'/')||preg_match('#(?:^|/)\\.\\.?(/|$)#',$factory_plugin_identity_relative)||$factory_plugin_identity_hash===false||!preg_match('/^[a-f0-9]{64}$/',$factory_plugin_identity_hash)){$factory_plugin_identity_valid=false;break;}$factory_plugin_identity_files[]=strlen($factory_plugin_identity_relative).':'.$factory_plugin_identity_relative.':'.$factory_plugin_identity_hash;}}"
    + "sort($factory_plugin_identity_files,SORT_STRING);$factory_plugin_identity_sha256=$factory_plugin_identity_valid?hash('sha256',implode(\"\\n\",$factory_plugin_identity_files).\"\\n\"):null;";
}

function exactAreaContractIdentity() {
  const contract = loadRealEstateContract(CONTRACT_PATH);
  const expected = {
    id: "property_area_range", query_id: "property_catalog", field_id: "property_size", label: "Area", unit: "sq_m",
    selection_mode: "optional_range", comparison: "inclusive", decimal_type: "decimal_12_2", accepted_value_grammar: "nonnegative_decimal_12_2",
    activation: "server_owned_transaction_only", unactivated_behavior: "base_catalog", invalid_input_behavior: "empty_state",
    missing_value_behavior: "exclude_when_active", reset_behavior: "clear_area_bounds_only"
  };
  if (!Array.isArray(contract.property_area_ranges) || contract.property_area_ranges.length !== 1
    || JSON.stringify(contract.property_area_ranges[0]) !== JSON.stringify(expected)) {
    throw fail("property_area_range_contract_invalid", "Property Area Range contract could not be verified safely.");
  }
  try { return hash(fs.readFileSync(CONTRACT_PATH)); } catch (_) { throw fail("property_area_range_contract_invalid", "Property Area Range contract could not be verified safely."); }
}

function nativeCommand(input) {
  return {
    command: "docker",
    args: ["compose", "run", "--rm", "-T", "--entrypoint", "php", "wpcli", "-d", "memory_limit=512M", "/usr/local/bin/wp", "eval", nativeScript(input || {}), "--path=/var/www/html", "--allow-root"]
  };
}

function nativeScript(input) {
  const encoded = Buffer.from(JSON.stringify(input), "utf8").toString("base64");
  return "$_=json_decode(base64_decode('" + encoded + "'),true);"
    + "$binding=function_exists('factory_runtime_binding_v1_read')?factory_runtime_binding_v1_read():['ok'=>false];"
    + nativePluginIdentityPhp("WP_PLUGIN_DIR.'/crocoblock-site-factory'")
    + "$ids=get_posts(['post_type'=>'property','post_status'=>'publish','fields'=>'ids','numberposts'=>-1,'orderby'=>'ID','order'=>'ASC']);$areas=[];foreach($ids as $id){$v=get_post_meta((int)$id,'property_size',false);$areas[]=['post_id'=>(int)$id,'values'=>array_values($v)];}"
    + "$sentinel=new stdClass();$option=get_option('" + OPTION_NAME + "',$sentinel);$option_present=$option!==$sentinel;"
    + "if(($_['mode']??'read')==='write'){$expected=$_['activation']??null;if(!$option_present&&is_array($expected)&&add_option('" + OPTION_NAME + "',$expected,'',false)){$option=get_option('" + OPTION_NAME + "',$sentinel);$option_present=$option!==$sentinel;}}"
    + "echo wp_json_encode(['runtime_binding'=>$binding,'plugin_identity_sha256'=>$factory_plugin_identity_sha256,'property_areas'=>$areas,'option_present'=>$option_present,'option_value'=>$option_present?$option:null]);";
}

async function observeAreaRuntime(projectState, options) {
  const runner = options && options.commandRunner || runCommand;
  const command = nativeCommand({ mode: "read" });
  const result = await runner(command.command, command.args, { cwd: projectState.runtimePath, logPath: path.join(projectState.runtimePath, "logs", "property-area-range-native-read.log"), timeoutMs: 120000, sensitiveOutput: true, sensitiveCategory: "property-area-range-native-read" });
  try { return JSON.parse(String(result.stdout || "").trim()); } catch (_) { throw fail("property_area_range_runtime_malformed", "Property Area Range could not read the managed archive safely."); }
}

async function writeAreaActivation(projectState, activation, options) {
  const runner = options && options.commandRunner || runCommand;
  const command = nativeCommand({ mode: "write", activation });
  const result = await runner(command.command, command.args, { cwd: projectState.runtimePath, logPath: path.join(projectState.runtimePath, "logs", "property-area-range-native-write.log"), timeoutMs: 120000, sensitiveOutput: true, sensitiveCategory: "property-area-range-native-write" });
  try { return JSON.parse(String(result.stdout || "").trim()); } catch (_) { throw fail("property_area_range_runtime_malformed", "Property Area Range could not verify the managed archive safely."); }
}

function normalizePropertyAreas(value) {
  if (!Array.isArray(value)) throw fail("property_area_range_data_malformed", "Property Area Range data could not be verified safely.");
  const seen = new Set();
  const normalized = value.map((entry) => {
    if (!exactKeys(entry, ["post_id", "values"]) || !Number.isSafeInteger(entry.post_id) || entry.post_id <= 0 || seen.has(entry.post_id) || !Array.isArray(entry.values)) {
      throw fail("property_area_range_data_malformed", "Property Area Range data could not be verified safely.");
    }
    seen.add(entry.post_id);
    if (entry.values.length === 0) return { post_id: entry.post_id, property_size: null };
    if (entry.values.length !== 1 || typeof entry.values[0] !== "string" || !DECIMAL_GRAMMAR.test(entry.values[0])) {
      throw fail("property_area_range_data_malformed", "Property Area Range data could not be verified safely.");
    }
    return { post_id: entry.post_id, property_size: entry.values[0] };
  });
  normalized.sort((left, right) => left.post_id - right.post_id);
  return normalized;
}

function exactActivation(value, project, planId, snapshotId, operationId) {
  return exactKeys(value, ["operation_id", "plan_id", "project_id", "schema_version", "snapshot_id", "state"])
    && value.schema_version === 1 && value.state === "enabled"
    && value.project_id === project.project_id && value.plan_id === planId
    && value.snapshot_id === snapshotId && value.operation_id === operationId;
}

function assertObservation(observation, projectState, expectedPluginIdentity) {
  const binding = observation && observation.runtime_binding;
  if (!exactKeys(observation, ["option_present", "option_value", "plugin_identity_sha256", "property_areas", "runtime_binding"])
    || typeof observation.option_present !== "boolean" || (!observation.option_present && observation.option_value !== null)
    || !exactKeys(binding, ["binding", "ok"]) || binding.ok !== true || !exactKeys(binding.binding, ["binding_kind", "project_id", "project_slug", "schema_version"])
    || binding.binding.schema_version !== 1 || binding.binding.binding_kind !== "server_owned_runtime_binding"
    || binding.binding.project_id !== projectState.project.project_id || binding.binding.project_slug !== projectState.project.slug
    || typeof observation.plugin_identity_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(observation.plugin_identity_sha256)
    || observation.plugin_identity_sha256 !== expectedPluginIdentity) {
    throw fail("property_area_range_runtime_identity_drift", "Property Area Range runtime identity changed.");
  }
  return { property_areas: normalizePropertyAreas(observation.property_areas), option_present: observation.option_present === true, option_value: observation.option_value };
}

function assertPlan(plan, projectState, planId) {
  const baselineKeys = ["contract_sha256", "plugin_identity_sha256", "project_binding", "property_areas_sha256", "property_count"];
  if (!plan || !exactKeys(plan, ["baseline", "created_at", "expected", "plan_id", "profile", "profile_id", "profile_version", "project_id", "project_slug", "proposed_delta", "recovery_coverage_version", "recovery_result_version", "schema", "version"])
    || plan.schema !== PLAN_SCHEMA || plan.version !== 1 || plan.plan_id !== planId || plan.project_slug !== projectState.project.slug || plan.project_id !== projectState.project.project_id
    || plan.profile !== PROFILE || plan.profile_id !== PROFILE_ID || plan.profile_version !== PROFILE_VERSION
    || !exactKeys(plan.baseline, baselineKeys) || plan.baseline.project_binding.fingerprint !== deriveProjectBinding(projectState.project).fingerprint
    || ![plan.baseline.contract_sha256, plan.baseline.plugin_identity_sha256, plan.baseline.property_areas_sha256].every((entry) => typeof entry === "string" && /^[a-f0-9]{64}$/.test(entry))
    || !Number.isInteger(plan.baseline.property_count) || plan.baseline.property_count < 0
    || !exactKeys(plan.proposed_delta, ["add_option"]) || !exactKeys(plan.proposed_delta.add_option, ["key", "schema_version", "state"])
    || plan.proposed_delta.add_option.key !== OPTION_NAME || plan.proposed_delta.add_option.schema_version !== 1 || plan.proposed_delta.add_option.state !== "enabled"
    || !exactKeys(plan.expected, ["activation_option", "option_absent_before_apply"])
    || plan.expected.activation_option !== OPTION_NAME || plan.expected.option_absent_before_apply !== true
    || plan.recovery_result_version !== RECOVERY_VERSION || plan.recovery_coverage_version !== 1) {
    throw fail("property_area_range_plan_mismatch", "Property Area Range requires the accepted Preview.");
  }
  return plan;
}

function browserSummary(plan) {
  const propertyCount = plan && plan.baseline && plan.baseline.property_count;
  if (!Number.isSafeInteger(propertyCount) || propertyCount < 0) {
    throw fail("property_area_range_preview_summary_invalid", "Property Area Range Preview could not be presented safely.");
  }
  return {
    schema_version: BROWSER_SUMMARY_SCHEMA_VERSION,
    change: {
      title: "Add an optional Property area range",
      archive: "/properties/",
      unit: "sq m",
      behavior: "Inclusive minimum and maximum bounds."
    },
    observed: {
      published_property_count: propertyCount
    },
    preservation: [
      "Property data is not changed.",
      "Existing archive filters, sorting, pagination, cards, count, and default results stay unchanged until a later transaction."
    ],
    boundary: "This Preview has not applied the change and does not verify Recovery, Restore, or Proof Gate."
  };
}

function assertBrowserSummary(summary) {
  const change = summary && summary.change;
  const observed = summary && summary.observed;
  if (!exactKeys(summary, ["boundary", "change", "observed", "preservation", "schema_version"])
    || summary.schema_version !== BROWSER_SUMMARY_SCHEMA_VERSION
    || !exactKeys(change, ["archive", "behavior", "title", "unit"])
    || change.title !== "Add an optional Property area range"
    || change.archive !== "/properties/"
    || change.unit !== "sq m"
    || change.behavior !== "Inclusive minimum and maximum bounds."
    || !exactKeys(observed, ["published_property_count"])
    || !Number.isSafeInteger(observed.published_property_count) || observed.published_property_count < 0
    || !Array.isArray(summary.preservation) || summary.preservation.length !== 2
    || summary.preservation[0] !== "Property data is not changed."
    || summary.preservation[1] !== "Existing archive filters, sorting, pagination, cards, count, and default results stay unchanged until a later transaction."
    || summary.boundary !== "This Preview has not applied the change and does not verify Recovery, Restore, or Proof Gate.") {
    throw fail("property_area_range_preview_summary_invalid", "Property Area Range Preview could not be presented safely.");
  }
  return {
    schema_version: summary.schema_version,
    change: Object.assign({}, change),
    observed: Object.assign({}, observed),
    preservation: summary.preservation.slice(),
    boundary: summary.boundary
  };
}

function assertCurrentContract(plan) {
  const current = exactAreaContractIdentity();
  if (!plan || !plan.baseline || plan.baseline.contract_sha256 !== current) {
    throw fail("property_area_range_contract_drift", "Property Area Range contract changed after the prepared Preview.");
  }
  return current;
}

function readPlan(projectState, planId) {
  return readJson(planPath(projectState, planId), "property_area_range_plan_missing");
}

function hasPersistedPropertyAreaRangePlan(options) {
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
  } catch (_) {
    return true;
  }
}

function exactRecovery(result, plan, projectState) {
  return Boolean(result && exactKeys(result, ["baseline_sha256", "coverage", "coverage_sha256", "coverage_version", "created_at", "plan_id", "profile_id", "profile_version", "project_id", "project_identity_fingerprint", "project_slug", "proposed_change_sha256", "schema", "snapshot_id", "snapshot_identity", "status", "version"])
    && result.schema === RECOVERY_SCHEMA && result.version === RECOVERY_VERSION && result.status === "prepared"
    && result.plan_id === plan.plan_id && result.project_id === projectState.project.project_id && result.project_slug === projectState.project.slug
    && result.project_identity_fingerprint === plan.baseline.project_binding.fingerprint && result.profile_id === PROFILE_ID && result.profile_version === PROFILE_VERSION
    && result.baseline_sha256 === baselineFingerprint(plan) && result.proposed_change_sha256 === proposedChangeFingerprint(plan)
    && result.coverage_version === 1 && exactCoverageForPlan(result.coverage, plan) && result.coverage_sha256 === coverageFingerprintForPlan(result.coverage, plan)
    && typeof result.snapshot_id === "string" && /^snapshot-[a-z0-9-]+$/.test(result.snapshot_id));
}

async function matchingPreparedRecovery(projectState, plan, projectsRoot, reattest) {
  const resultPath = recoveryPath(projectState, plan.plan_id);
  if (!fs.existsSync(resultPath)) return null;
  let result;
  try { result = readJson(resultPath, "property_area_range_recovery_missing"); } catch (_) { return null; }
  if (!exactRecovery(result, plan, projectState)) return null;
  const inspected = await (reattest || (async ({ snapshotId }) => inspectSnapshotSinglePass({ projectsRoot, plan, projectState, snapshotId })) )({ projectsRoot, plan, projectState, snapshotId: result.snapshot_id });
  if (!inspected || !inspected.inspection || inspected.inspection.artifact_verification !== "single_pass"
    || !inspected.snapshot_identity || inspected.snapshot_identity.snapshot_id !== result.snapshot_id
    || inspected.snapshot_identity.project_identity_fingerprint !== plan.baseline.project_binding.fingerprint
    || JSON.stringify(inspected.snapshot_identity) !== JSON.stringify(result.snapshot_identity)
    || coverageFingerprintForPlan(inspected.coverage, plan) !== result.coverage_sha256) return null;
  return { status: "prepared", snapshot_id: result.snapshot_id };
}

async function createPropertyAreaRangePreview(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const slug = validateExplicitSlug(options && options.slug);
  const projectState = readProjectBySlug(slug, projectsRoot);
  const contractSha256 = exactAreaContractIdentity();
  const verifyBinding = options && options.verifyRuntimeBinding || assertReadyRuntimeBinding;
  verifyBinding({ projectState, projectsRoot, readStrictProjectInventory });
  const expectedPluginIdentity = options && options.expectedPluginIdentity || directoryIdentity(pluginDirectory());
  const observation = await (options && options.observe ? options.observe({ projectState }) : observeAreaRuntime(projectState, options));
  const current = assertObservation(observation, projectState, expectedPluginIdentity);
  if (current.option_present) throw fail("property_area_range_option_present", "Property Area Range is already configured or its option is malformed.");
  const areas = current.property_areas;
  const planId = "property-area-range-plan-" + crypto.randomUUID();
  const plan = {
    schema: PLAN_SCHEMA, version: 1, plan_id: planId, project_slug: slug, project_id: projectState.project.project_id,
    profile: PROFILE, profile_id: PROFILE_ID, profile_version: PROFILE_VERSION, recovery_result_version: RECOVERY_VERSION, recovery_coverage_version: 1,
    baseline: { project_binding: deriveProjectBinding(projectState.project), contract_sha256: contractSha256, plugin_identity_sha256: expectedPluginIdentity, property_areas_sha256: hash(areas), property_count: areas.length },
    proposed_delta: { add_option: { key: OPTION_NAME, schema_version: 1, state: "enabled" } },
    expected: { activation_option: OPTION_NAME, option_absent_before_apply: true }, created_at: new Date().toISOString()
  };
  const summary = browserSummary(plan);
  atomicJson(planPath(projectState, planId), plan);
  return { ok: true, plan_id: planId, status: "prepared_for_recovery", browser_summary: summary };
}

async function preparePropertyAreaRangeRecovery(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const slug = validateExplicitSlug(options && options.slug);
  const projectState = readProjectBySlug(slug, projectsRoot);
  const plan = assertPlan(readPlan(projectState, options && options.planId), projectState, options && options.planId);
  assertCurrentContract(plan);
  const attemptPath = path.join(planDirectory(projectState), "recovery-attempts", plan.plan_id + ".json");
  if (fs.existsSync(attemptPath)) throw fail("property_area_range_recovery_already_attempted", "Recovery Point preparation has already been attempted for this Preview.");
  const expectedPluginIdentity = plan.baseline.plugin_identity_sha256;
  const before = assertObservation(await (options && options.observe ? options.observe({ projectState }) : observeAreaRuntime(projectState, options)), projectState, expectedPluginIdentity);
  if (before.option_present || hash(before.property_areas) !== plan.baseline.property_areas_sha256 || before.property_areas.length !== plan.baseline.property_count) throw fail("property_area_range_baseline_drift", "Property Area Range changed before Recovery Point preparation.");
  const verifyCoverageReadiness = options && options.verifyCoverageReadiness || assertPropertyAreaRangeCoverageReadiness;
  verifyCoverageReadiness(projectState);
  atomicJson(attemptPath, { schema: "csf_property_area_range_recovery_attempt", version: 1, plan_id: plan.plan_id, project_slug: slug, started_at: new Date().toISOString() });
  try {
    const capture = options && options.captureSnapshot || createFullStructuralSnapshot;
    const captured = await capture({ projectsRoot, slug, idempotencyKey: options && options.idempotencyKey });
    const snapshotId = captured && captured.result && captured.result.snapshot_id;
    if (typeof snapshotId !== "string" || !/^snapshot-[a-z0-9-]+$/.test(snapshotId)) throw fail("property_area_range_recovery_capture_invalid", "Recovery Point preparation could not be verified.");
    const inspected = await (options && options.reattest ? options.reattest({ projectsRoot, projectState, plan, snapshotId }) : inspectSnapshotSinglePass({ projectsRoot, projectState, plan, snapshotId }));
    if (!inspected || !inspected.inspection || inspected.inspection.artifact_verification !== "single_pass" || !exactCoverageForPlan(inspected.coverage, plan) || !inspected.snapshot_identity) throw fail("property_area_range_recovery_missing", "Recovery Point preparation could not be verified.");
    const after = assertObservation(await (options && options.observe ? options.observe({ projectState }) : observeAreaRuntime(projectState, options)), projectState, expectedPluginIdentity);
    if (after.option_present || hash(after.property_areas) !== plan.baseline.property_areas_sha256 || after.property_areas.length !== plan.baseline.property_count) throw fail("property_area_range_baseline_drift", "Property Area Range changed during Recovery Point preparation.");
    atomicJson(recoveryPath(projectState, plan.plan_id), { schema: RECOVERY_SCHEMA, version: RECOVERY_VERSION, plan_id: plan.plan_id, project_slug: slug, project_id: projectState.project.project_id, project_identity_fingerprint: plan.baseline.project_binding.fingerprint, profile_id: PROFILE_ID, profile_version: PROFILE_VERSION, baseline_sha256: baselineFingerprint(plan), proposed_change_sha256: proposedChangeFingerprint(plan), status: "prepared", snapshot_id: snapshotId, snapshot_identity: inspected.snapshot_identity, coverage: exactCoverageForPlan(inspected.coverage, plan), coverage_sha256: coverageFingerprintForPlan(inspected.coverage, plan), coverage_version: 1, created_at: new Date().toISOString() });
    return { ok: true, status: "prepared", snapshot_id: snapshotId };
  } catch (caught) {
    throw caught;
  }
}

module.exports = { PROFILE, PROFILE_ID, PROFILE_VERSION, PLAN_ROOT, OPTION_NAME, DECIMAL_GRAMMAR, directoryIdentity, exactAreaContractIdentity, assertCurrentContract, nativeScript, observeAreaRuntime, writeAreaActivation, normalizePropertyAreas, exactActivation, assertObservation, assertPlan, browserSummary, assertBrowserSummary, readPlan, hasPersistedPropertyAreaRangePlan, matchingPreparedRecovery, createPropertyAreaRangePreview, preparePropertyAreaRangeRecovery, assertPropertyAreaRangeCoverageReadiness, planPath, recoveryPath };
