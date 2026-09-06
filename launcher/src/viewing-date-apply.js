"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { runCommand } = require("./runtime-tools");
const { readProjectBySlug, resolveProjectsRoot, validateExplicitSlug } = require("./project-store");
const { runProjectOperation } = require("./project-operation-coordinator");
const { listOperations } = require("./project-operation-store");
const { buildPatch, matchingPreparedRecovery, nativeFactsFromObservation } = require("./viewing-date-preview");
const { classifyAddOptionalViewingDateChange } = require("./real-estate-contract");
const { deriveProjectBinding } = require("./structural-snapshot-store");

const PROJECT_SLUG = "csf-st-viewing-before-v1";
const PROFILE = "add_optional_viewing_date@1";
const PROFILE_ID = "add_optional_viewing_date";
const FORM_OWNER = "request_viewing_before_v1";
const FORM_OWNER_META = "_factory_request_viewing_before_v1_owner";
const BINDING_OPTION = "factory_request_viewing_before_v1_binding";
const PLAN_ROOT = "viewing-date-preview-v1";
const RECOVERY_SCHEMA = "csf_viewing_date_recovery_result";
const RECOVERY_VERSION = 3;

function fail(code, message, statusCode) {
  const value = new Error(message || "Preferred date Apply cannot proceed safely.");
  value.code = code;
  value.statusCode = statusCode || 409;
  return value;
}

function hash(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function readJson(filePath, code) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (_) { throw fail(code, "Preferred date Apply cannot proceed safely."); }
}

function planPaths(projectState, planId) {
  if (typeof planId !== "string" || !/^viewing-date-plan-[0-9a-f-]{36}$/.test(planId)) throw fail("viewing_date_apply_plan_invalid", "Preferred date Apply requires the prepared Preview.", 400);
  const root = path.join(projectState.runtimePath, "proofs", PLAN_ROOT);
  return {
    plan: path.join(root, "plans", planId + ".json"),
    recovery: path.join(root, "recovery-results", planId + ".json")
  };
}

function assertPlan(plan, projectState, planId) {
  const baseline = plan && plan.baseline;
  const baselineKeys = ["actions_sha256", "binding_sha256", "facts_sha256", "form_id", "form_sha256", "policy_sha256", "project_binding"];
  if (!plan || typeof plan !== "object" || plan.schema !== "csf_viewing_date_preview" || plan.version !== 1
    || plan.plan_id !== planId || plan.project_slug !== projectState.project.slug || plan.profile !== PROFILE
    || plan.profile_id !== PROFILE_ID || plan.profile_version !== 1 || !baseline || typeof baseline !== "object"
    || Object.keys(baseline).sort().join("\n") !== baselineKeys.join("\n") || !Number.isInteger(baseline.form_id) || baseline.form_id <= 0
    || ![baseline.form_sha256, baseline.actions_sha256, baseline.binding_sha256, baseline.policy_sha256, baseline.facts_sha256].every((value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value))
    || !plan.expected || typeof plan.expected.form_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(plan.expected.form_sha256)
    || JSON.stringify(baseline.project_binding) !== JSON.stringify(deriveProjectBinding(projectState.project))
    || !plan.proposed_delta || !plan.proposed_delta.add_optional_date_field || typeof plan.proposed_delta.add_optional_date_field.native_block !== "string") {
    throw fail("viewing_date_apply_plan_mismatch", "Preferred date Apply requires the accepted Preview.");
  }
}

function assertPreparedResult(result, plan) {
  if (!result || typeof result !== "object" || result.schema !== RECOVERY_SCHEMA || result.version !== RECOVERY_VERSION
    || result.status !== "prepared" || result.plan_id !== plan.plan_id || result.project_slug !== plan.project_slug
    || result.profile_id !== plan.profile_id || result.profile_version !== plan.profile_version
    || typeof result.snapshot_id !== "string" || !result.snapshot_id) {
    throw fail("viewing_date_apply_recovery_missing", "Preferred date Apply requires the verified Recovery Point.");
  }
}

function normalizeTarget(observation) {
  if (!observation || typeof observation !== "object" || !Array.isArray(observation.candidate_ids) || observation.candidate_ids.length !== 1
    || !Number.isInteger(observation.resolved_form_id) || observation.resolved_form_id !== observation.candidate_ids[0]
    || observation.form_id !== observation.resolved_form_id || observation.owner !== FORM_OWNER
    || observation.post_type !== "jet-form-builder" || observation.post_status !== "publish") {
    throw fail("viewing_date_apply_target_ambiguous", "The Factory Request Viewing form could not be resolved safely.");
  }
  return observation;
}

function assertRecordsObservation(records) {
  if (!records || typeof records !== "object" || !Number.isInteger(records.count) || records.count < 0
    || typeof records.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(records.fingerprint)) {
    throw fail("viewing_date_apply_records_unavailable", "Existing Form Records could not be preserved safely.");
  }
  return records;
}

function assertBaseline(observation, plan) {
  normalizeTarget(observation);
  assertRecordsObservation(observation.records);
  if (observation.form_id !== plan.baseline.form_id) {
    throw fail("viewing_date_apply_target_changed", "The Request Viewing form no longer matches the accepted Preview.");
  }
  const facts = nativeFactsFromObservation(observation);
  if (classifyAddOptionalViewingDateChange(facts).classification !== "applicable"
    || observation.form_sha256 !== plan.baseline.form_sha256
    || hash(observation.actions) !== plan.baseline.actions_sha256
    || hash(observation.binding) !== plan.baseline.binding_sha256
    || observation.policy_sha256 !== plan.baseline.policy_sha256
    || hash(facts) !== plan.baseline.facts_sha256) {
    throw fail("viewing_date_apply_baseline_drift", "The Request Viewing form changed after the prepared Preview.");
  }
  const patch = buildPatch(observation.form_content);
  if (patch.expected_form_sha256 !== plan.expected.form_sha256 || patch.native_block !== plan.proposed_delta.add_optional_date_field.native_block) {
    throw fail("viewing_date_apply_delta_mismatch", "Preferred date Apply does not match the accepted Preview.");
  }
  return patch;
}

function assertAfter(observation, plan, patch, recordsBefore) {
  normalizeTarget(observation);
  const records = assertRecordsObservation(observation.records);
  if (observation.form_id !== plan.baseline.form_id) {
    throw fail("viewing_date_apply_target_changed", "The Request Viewing form no longer matches the accepted Preview.");
  }
  if (recordsBefore && (records.count !== recordsBefore.count || records.fingerprint !== recordsBefore.fingerprint)) {
    throw fail("viewing_date_apply_records_changed", "Existing Form Records changed during Preferred date Apply.");
  }
  const facts = nativeFactsFromObservation(observation);
  if (classifyAddOptionalViewingDateChange(facts).classification !== "no_op"
    || (patch && observation.form_content !== patch.next_content) || observation.form_sha256 !== plan.expected.form_sha256
    || hash(observation.actions) !== plan.baseline.actions_sha256
    || hash(observation.binding) !== hash(Object.assign({}, observation.binding, { form_sha256: plan.expected.form_sha256 }))
    || observation.binding.form_sha256 !== plan.expected.form_sha256
    || observation.policy_sha256 !== plan.baseline.policy_sha256) {
    throw fail("viewing_date_apply_after_state_drift", "The Request Viewing form does not match the approved Preferred date result.");
  }
  return {
    form_id: observation.form_id,
    form_sha256: observation.form_sha256,
    actions_sha256: hash(observation.actions),
    binding_sha256: hash(observation.binding),
    policy_sha256: observation.policy_sha256,
    records: { count: records.count, fingerprint: records.fingerprint }
  };
}

async function readAuthority(options, projectState) {
  const paths = planPaths(projectState, options.planId);
  if (!fs.existsSync(paths.plan) || !fs.existsSync(paths.recovery)) throw fail("viewing_date_apply_recovery_missing", "Preferred date Apply requires the verified Recovery Point.");
  const plan = readJson(paths.plan, "viewing_date_apply_plan_mismatch");
  const recovery = readJson(paths.recovery, "viewing_date_apply_recovery_missing");
  assertPlan(plan, projectState, options.planId);
  assertPreparedResult(recovery, plan);
  const prepared = options.verifyPrepared
    ? await options.verifyPrepared({ projectState, plan, recovery })
    : await matchingPreparedRecovery(projectState, plan, options.projectsRoot);
  if (!prepared || prepared.status !== "prepared" || prepared.snapshot_id !== recovery.snapshot_id) {
    throw fail("viewing_date_apply_recovery_stale", "The verified Recovery Point no longer matches this Preview.");
  }
  return { plan, recovery, prepared };
}

function nativeScript(mode, input) {
  const encoded = Buffer.from(JSON.stringify(input), "utf8").toString("base64");
  return "global $wpdb;$_=json_decode(base64_decode('" + encoded + "'),true);"
    + "$ids=get_posts(['post_type'=>'jet-form-builder','post_status'=>'any','meta_key'=>'" + FORM_OWNER_META + "','meta_value'=>'" + FORM_OWNER + "','fields'=>'ids','numberposts'=>-1,'orderby'=>'ID','order'=>'ASC']);"
    + "$id=count($ids)===1?(int)$ids[0]:0;$p=$id?get_post($id):null;$b=get_option('" + BINDING_OPTION + "',[]);"
    + "if('write'===$_['mode']&&$p&&hash('sha256',(string)$p->post_content)===$_['before']&&is_array($b)&&($b['form_id']??0)===$id&&($b['form_sha256']??'')===$_['before']){wp_update_post(['ID'=>$id,'post_content'=>$_['after']]);$b['form_sha256']=hash('sha256',$_['after']);update_option('" + BINDING_OPTION + "',$b,false);}$p=$id?get_post($id):null;"
    + "$blocks=$p?parse_blocks($p->post_content):[];$fields=[];foreach($blocks as $x){$a=$x['attrs']??[];if(isset($a['name']))$fields[]=['name'=>$a['name'],'block'=>$x['blockName'],'type'=>$a['field_type']??($x['blockName']==='jet-forms/textarea-field'?'textarea':'text'),'required'=>($a['required']??false)===true,'label'=>$a['label']??null,'attrs'=>$a];}"
    + "$actions=$id?get_post_meta($id,'_jf_actions',true):[];if(is_string($actions))$actions=json_decode($actions,true);$actions=is_array($actions)?$actions:[];$out=[];foreach($actions as $x)$out[]=['type'=>$x['type']??null];"
    + "$records=null;$tables=['records'=>$wpdb->prefix.'jet_fb_records','fields'=>$wpdb->prefix.'jet_fb_records_fields'];$available=true;foreach($tables as $table){if($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s',$table))!==$table){$available=false;break;}}if($available){$r='`'.str_replace('`','',$tables['records']).'`';$f='`'.str_replace('`','',$tables['fields']).'`';$record_rows=$wpdb->get_results($wpdb->prepare('SELECT id,form_id,user_id,from_content_id,from_content_type,status,ip_address,user_agent,referrer,submit_type,is_viewed,created_at,updated_at FROM '.$r.' WHERE form_id=%d ORDER BY id ASC',$id),ARRAY_A);$where=$wpdb->prepare(' WHERE record_id IN (SELECT id FROM '.$r.' WHERE form_id=%d) ORDER BY id ASC',$id);$field_rows=$wpdb->get_results('SELECT id,record_id,field_name,field_value,field_type,field_attrs FROM '.$f.$where,ARRAY_A);$records=['count'=>count($record_rows),'fingerprint'=>hash('sha256',wp_json_encode(['records'=>$record_rows,'fields'=>$field_rows]))];}"
    + "echo wp_json_encode(['candidate_ids'=>array_map('intval',$ids),'resolved_form_id'=>$id,'form_id'=>$id,'post_type'=>$p?$p->post_type:null,'post_status'=>$p?$p->post_status:null,'owner'=>$id?get_post_meta($id,'" + FORM_OWNER_META + "',true):null,'form_content'=>$p?(string)$p->post_content:null,'form_sha256'=>$p?hash('sha256',$p->post_content):null,'fields'=>$fields,'actions'=>$out,'binding'=>$b,'records'=>$records,'plugin_version'=>defined('JET_FORM_BUILDER_VERSION')?JET_FORM_BUILDER_VERSION:null,'policy_sha256'=>file_exists(WPMU_PLUGIN_DIR.'/factory-request-viewing-before-v1-policy.php')?hash_file('sha256',WPMU_PLUGIN_DIR.'/factory-request-viewing-before-v1-policy.php'):null]);";
}

async function nativeRead(projectState, input) {
  const result = await runCommand("docker", ["compose", "run", "--rm", "-T", "--entrypoint", "php", "wpcli", "-d", "memory_limit=512M", "/usr/local/bin/wp", "eval", nativeScript("read", input || {}), "--path=/var/www/html", "--allow-root"], { cwd: projectState.runtimePath, logPath: path.join(projectState.runtimePath, "logs", "viewing-date-apply-native.log"), timeoutMs: 120000 });
  try { return JSON.parse(String(result.stdout || "").trim()); } catch (_) { throw fail("viewing_date_apply_runtime_malformed", "The Request Viewing form could not be read safely."); }
}

async function nativeWrite(projectState, input) {
  return nativeRead(projectState, Object.assign({}, input, { mode: "write" }));
}

async function prepareViewingDateApply(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const slug = validateExplicitSlug(options && options.slug);
  if (slug !== PROJECT_SLUG) throw fail("viewing_date_apply_project_not_allowed", "Preferred date Apply is unavailable for this project.", 404);
  const projectState = readProjectBySlug(slug, projectsRoot);
  const authority = await readAuthority(Object.assign({}, options, { projectsRoot }), projectState);
  const observation = await (options.readNative || nativeRead)(projectState, { mode: "read" });
  const patch = assertBaseline(observation, authority.plan);
  return { projectState, authority, observation, patch, after_state_fingerprint: hash({ form_sha256: authority.plan.expected.form_sha256, actions_sha256: authority.plan.baseline.actions_sha256, binding: Object.assign({}, observation.binding, { form_sha256: authority.plan.expected.form_sha256 }), policy_sha256: authority.plan.baseline.policy_sha256 }) };
}

async function prepareViewingDateAuthority(options) {
  const projectsRoot = resolveProjectsRoot(options && options.projectsRoot);
  const slug = validateExplicitSlug(options && options.slug);
  if (slug !== PROJECT_SLUG) throw fail("viewing_date_apply_project_not_allowed", "Preferred date Apply is unavailable for this project.", 404);
  const projectState = readProjectBySlug(slug, projectsRoot);
  const authority = await readAuthority(Object.assign({}, options, { projectsRoot }), projectState);
  return { projectState, authority };
}

async function applyViewingDate(options) {
  const authority = await prepareViewingDateAuthority(options);
  const fingerprintInput = { plan_id: authority.authority.plan.plan_id, baseline_sha256: authority.authority.plan.baseline.form_sha256, expected_form_sha256: authority.authority.plan.expected.form_sha256 };
  const idempotencyKeyHash = options.idempotencyKey ? hash(String(options.idempotencyKey).trim()) : null;
  const prior = listOperations({ slug: authority.projectState.project.slug, projectsRoot: options.projectsRoot, includeRaw: true })
    .filter((operation) => operation.operation_type === "viewing_date_apply" && operation.raw && operation.raw.metadata && operation.raw.metadata.plan_id === authority.authority.plan.plan_id);
  if (prior.some((operation) => operation.status === "failed" || operation.status === "interrupted")) {
    throw fail("viewing_date_apply_prior_attempt_terminal", "Preferred date Apply requires a new reviewed Preview after an earlier attempt.");
  }
  if (prior.some((operation) => operation.status === "succeeded" && operation.raw.idempotency_key_hash !== idempotencyKeyHash)) {
    throw fail("viewing_date_apply_plan_consumed", "Preferred date Apply was already completed for this Preview.");
  }
  const operationResult = await runProjectOperation({
    slug: authority.projectState.project.slug, projectsRoot: options.projectsRoot, operationType: "viewing_date_apply", idempotencyKey: options.idempotencyKey,
    fingerprintInput, metadata: { plan_id: authority.authority.plan.plan_id, recovery_snapshot_id: authority.authority.recovery.snapshot_id }, safety: { apply_used: true },
    verifyIdempotentReplay: async ({ operation }) => {
      const current = await (options.readNative || nativeRead)(authority.projectState, { mode: "read" });
      const expectedRecords = operation && operation.result_summary && operation.result_summary.records_before;
      assertAfter(current, authority.authority.plan, null, expectedRecords);
      return { status: "already_applied", mutation_performed: false };
    },
    execute: async ({ setStage }) => {
      await setStage("validating");
      const fresh = await prepareViewingDateApply(options);
      await setStage("applying");
      const after = await (options.writeNative || nativeWrite)(fresh.projectState, { mode: "write", before: fresh.observation.form_sha256, after: fresh.patch.next_content });
      await setStage("verifying");
      const recordsBefore = assertRecordsObservation(fresh.observation.records);
      const afterState = assertAfter(after, fresh.authority.plan, fresh.patch, recordsBefore);
      return { result: { status: "applied", mutation_performed: true, after_state: afterState }, resultSummary: { status: "applied", mutation_performed: true, plan_id: fresh.authority.plan.plan_id, records_before: recordsBefore, after_state: afterState } };
    }
  });
  return operationResult.idempotentReplay
    ? { status: "already_applied", mutation_performed: false, operation: operationResult.operation, result: operationResult.result }
    : Object.assign({ operation: operationResult.operation }, operationResult.result);
}

module.exports = { applyViewingDate, prepareViewingDateApply, prepareViewingDateAuthority, assertBaseline, assertAfter, assertRecordsObservation, normalizeTarget, nativeRead, nativeWrite };
