"use strict";

// This is deliberately profile-local evidence, not a generic receipt layer.
// It records only server-observed query identities and numeric business facts.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { runCommand } = require("./runtime-tools");
const { ensureDirectory } = require("./project-store");
const { normalizePropertyAreas } = require("./property-area-range-preview");

const EVIDENCE_SCHEMA = "csf_property_area_range_business_evidence";
const EVIDENCE_VERSION = 1;

function fail(code, message) { const error = new Error(message || "Property Area Range business evidence could not be verified safely."); error.code = code; error.statusCode = 409; return error; }
function hash(value) { return crypto.createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex"); }
function keys(value, expected) { return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === expected.slice().sort().join(",")); }
function decimalParts(value) { const [whole, fraction = ""] = value.split("."); return [whole.padStart(10, "0"), fraction.padEnd(2, "0")]; }
function compare(left, right) { const a = decimalParts(left); const b = decimalParts(right); return a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]); }
function sameIds(left, right) { return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]); }
function canonicalAreas(value) {
  if (Array.isArray(value) && value.every((entry) => keys(entry, ["post_id", "property_size"]))) {
    return normalizePropertyAreas(value.map((entry) => ({ post_id: entry.post_id, values: entry.property_size === null ? [] : [entry.property_size] })));
  }
  return normalizePropertyAreas(value);
}

function evidenceDirectory(projectState) { return path.join(projectState.runtimePath, "proofs", "property-area-range-preview-v1", "business-evidence"); }
function evidencePath(projectState, planId) {
  if (typeof planId !== "string" || !/^property-area-range-plan-[0-9a-f-]{36}$/.test(planId)) throw fail("property_area_range_business_evidence_invalid");
  return path.join(evidenceDirectory(projectState), planId + ".json");
}

function selectBounds(propertyAreas) {
  const values = propertyAreas.filter((entry) => entry.property_size !== null).map((entry) => entry.property_size).sort(compare);
  if (values.length < 2 || compare(values[0], values[values.length - 1]) === 0) throw fail("property_area_range_business_evidence_insufficient", "Property Area Range needs an in-range and an out-of-range Property to prove its business result.");
  return { area_min: values[0], area_max: values[0] };
}

function expectedRangeIds(propertyAreas, bounds) {
  return propertyAreas.filter((entry) => entry.property_size !== null && compare(entry.property_size, bounds.area_min) >= 0 && compare(entry.property_size, bounds.area_max) <= 0).map((entry) => entry.post_id).sort((a, b) => a - b);
}

function exactQueryObservation(value) {
  if (!keys(value, ["range_result_ids", "unfiltered_result_ids"]) || ![value.range_result_ids, value.unfiltered_result_ids].every(Array.isArray)
    || ![value.range_result_ids, value.unfiltered_result_ids].every((ids) => ids.every((id) => Number.isSafeInteger(id) && id > 0))) {
    throw fail("property_area_range_business_evidence_invalid");
  }
  return value;
}

function buildEvidence(prepared, propertyAreas, observation) {
  const plan = prepared.authority.plan;
  const areas = canonicalAreas(propertyAreas);
  if (areas.length === 0) throw fail("property_area_range_business_evidence_insufficient");
  const bounds = selectBounds(areas);
  const query = exactQueryObservation(observation);
  const unfiltered = areas.map((entry) => entry.post_id).sort((a, b) => a - b);
  const ranged = expectedRangeIds(areas, bounds);
  if (!sameIds(query.unfiltered_result_ids.slice().sort((a, b) => a - b), unfiltered) || !sameIds(query.range_result_ids.slice().sort((a, b) => a - b), ranged)) {
    throw fail("property_area_range_business_evidence_drift", "Property Area Range query results do not match the server-owned numeric facts.");
  }
  return {
    schema: EVIDENCE_SCHEMA, version: EVIDENCE_VERSION,
    project_slug: prepared.projectState.project.slug, project_id: prepared.projectState.project.project_id,
    project_binding_fingerprint: plan.baseline.project_binding.fingerprint,
    plan_id: plan.plan_id, snapshot_id: prepared.authority.recovery.snapshot_id, apply_operation_id: prepared.apply.operation_id,
    property_areas: areas, property_areas_sha256: hash(areas),
    bounds, unfiltered: { result_ids: unfiltered, result_count: unfiltered.length },
    range: { result_ids: ranged, result_count: ranged.length }
  };
}

function assertEvidence(value, prepared) {
  const plan = prepared.authority.plan;
  if (!keys(value, ["apply_operation_id", "bounds", "plan_id", "project_binding_fingerprint", "project_id", "project_slug", "property_areas", "property_areas_sha256", "range", "schema", "snapshot_id", "unfiltered", "version"])
    || value.schema !== EVIDENCE_SCHEMA || value.version !== EVIDENCE_VERSION
    || value.project_slug !== prepared.projectState.project.slug || value.project_id !== prepared.projectState.project.project_id
    || value.project_binding_fingerprint !== plan.baseline.project_binding.fingerprint || value.plan_id !== plan.plan_id
    || value.snapshot_id !== prepared.authority.recovery.snapshot_id || value.apply_operation_id !== prepared.apply.operation_id
    || !keys(value.bounds, ["area_max", "area_min"]) || !keys(value.unfiltered, ["result_count", "result_ids"]) || !keys(value.range, ["result_count", "result_ids"])) {
    throw fail("property_area_range_business_evidence_invalid");
  }
  const areas = canonicalAreas(value.property_areas);
  const bounds = selectBounds(areas);
  if (value.property_areas_sha256 !== hash(areas) || value.property_areas_sha256 !== plan.baseline.property_areas_sha256
    || value.bounds.area_min !== bounds.area_min || value.bounds.area_max !== bounds.area_max) throw fail("property_area_range_business_evidence_invalid");
  const unfiltered = areas.map((entry) => entry.post_id).sort((a, b) => a - b);
  const ranged = expectedRangeIds(areas, bounds);
  if (value.unfiltered.result_count !== unfiltered.length || value.range.result_count !== ranged.length
    || !sameIds(value.unfiltered.result_ids, unfiltered) || !sameIds(value.range.result_ids, ranged)) throw fail("property_area_range_business_evidence_invalid");
  return value;
}

function nativeQueryScript(bounds) {
  const encoded = Buffer.from(JSON.stringify(bounds), "utf8").toString("base64");
  return "$_=json_decode(base64_decode('" + encoded + "'),true);global $wpdb;$all=get_posts(['post_type'=>'property','post_status'=>'publish','fields'=>'ids','numberposts'=>-1,'orderby'=>'ID','order'=>'ASC']);$sql=$wpdb->prepare(\"SELECT DISTINCT p.ID FROM {$wpdb->posts} AS p INNER JOIN {$wpdb->postmeta} AS factory_area_meta ON factory_area_meta.post_id=p.ID WHERE p.post_type=%s AND p.post_status=%s AND factory_area_meta.meta_key=%s AND factory_area_meta.meta_value REGEXP '^(0|[1-9][0-9]{0,9})([.][0-9]{1,2})?$' AND CAST(factory_area_meta.meta_value AS DECIMAL(12,2)) BETWEEN CAST(%s AS DECIMAL(12,2)) AND CAST(%s AS DECIMAL(12,2)) ORDER BY p.ID ASC\",'property','publish','property_size',$_['area_min'],$_['area_max']);$range=array_map('intval',$wpdb->get_col($sql));echo wp_json_encode(['unfiltered_result_ids'=>array_map('intval',$all),'range_result_ids'=>$range]);";
}

async function observeQueryResults(projectState, bounds, options) {
  const runner = options && options.queryRunner || runCommand;
  const result = await runner("docker", ["compose", "run", "--rm", "-T", "--entrypoint", "php", "wpcli", "/usr/local/bin/wp", "eval", nativeQueryScript(bounds), "--path=/var/www/html", "--allow-root"], { cwd: projectState.runtimePath, logPath: path.join(projectState.runtimePath, "logs", "property-area-range-business-observation.log"), timeoutMs: 120000, sensitiveOutput: true, sensitiveCategory: "property-area-range-business-observation" });
  try { return exactQueryObservation(JSON.parse(String(result.stdout || "").trim())); } catch (_) { throw fail("property_area_range_business_evidence_invalid"); }
}

async function captureBusinessEvidence(prepared, options) {
  const areas = options && options.propertyAreas;
  if (!Array.isArray(areas)) throw fail("property_area_range_business_evidence_invalid");
  // The caller obtains these only from the trusted Preview authority; this
  // conversion prevents browser-provided bounds or result receipts.
  const bounds = selectBounds(canonicalAreas(areas));
  const observation = options && options.observeQueryResults ? await options.observeQueryResults(prepared.projectState, bounds) : await observeQueryResults(prepared.projectState, bounds, options);
  const evidence = buildEvidence(prepared, areas, observation);
  const directory = evidenceDirectory(prepared.projectState);
  ensureDirectory(directory);
  const target = evidencePath(prepared.projectState, prepared.authority.plan.plan_id);
  try { fs.writeFileSync(target, JSON.stringify(evidence, null, 2) + "\n", { encoding: "utf8", flag: "wx" }); } catch (_) { throw fail("property_area_range_business_evidence_write_failed"); }
  return { evidence, sha256: hash(fs.readFileSync(target)) };
}

function readBusinessEvidence(prepared) {
  try { return assertEvidence(JSON.parse(fs.readFileSync(evidencePath(prepared.projectState, prepared.authority.plan.plan_id), "utf8")), prepared); } catch (error) { if (error && error.code) throw error; throw fail("property_area_range_business_evidence_missing"); }
}

module.exports = { EVIDENCE_SCHEMA, EVIDENCE_VERSION, assertEvidence, buildEvidence, captureBusinessEvidence, evidencePath, nativeQueryScript, observeQueryResults, readBusinessEvidence, selectBounds };
