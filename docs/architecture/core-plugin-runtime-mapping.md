# Core to Plugin Runtime Mapping

This document describes how the current `wordpress-plugin/` runtime concepts map
to the new Core Engine contract skeletons. It is documentation only: Core is not
wired into the plugin yet, and the working Real Estate beta remains unchanged.

## Current Plugin Runtime Concepts

The WordPress plugin is the runtime cockpit and product shell. It owns REST
routes, the admin wizard, WP-CLI commands, WordPress/Crocoblock adapters,
capability checks, runtime mutation, validation against the live site, and run
manifest persistence.

The current preview flow is implemented by
`wordpress-plugin/includes/api/rest.php::factory_rest_beta_real_estate_plan()`.
It loads `presets/real-estate.json`, applies safe prompt variables, style tokens,
and image context overlays, then builds a dry-run plan through
`factory_rest_build_plan()`.

The current apply flow is implemented by
`factory_rest_beta_real_estate_apply()`. It applies the same deterministic
blueprint overlay, checks requirements, runs `factory_apply_blueprint()`,
builds a post-apply plan, validates runtime state with
`factory_validate_blueprint_state()`, and saves a run manifest with
`factory_save_run_manifest()`.

Plan items currently come from adapter `plan()` methods or from validation
fallbacks in `Factory_Dry_Run_Command`. Each normalized item includes adapter
identity, action, type, entity, message, and optional diff.

Execution items are produced by runtime adapters during `apply()` and collected
through `get_execution_results()`. They describe what actually happened at
runtime, such as create/update/skip/error for content, media, listings, filters,
queries, render pages, forms, and templates.

Validation checks come from adapter `validate()` methods through
`factory_validate_blueprint_state()`. The plugin aggregates checks into a report
with timestamp, status, and checks. Current status rules are mostly runtime
rules: any error makes the report `error`; warnings may be preserved in manifest
summary.

Run manifests are persisted by
`wordpress-plugin/includes/utils/run-manifest.php::factory_save_run_manifest()`.
They store prompt, preset, status, blueprint, plan, validation, result summary,
execution items, and optional prompt/style/image contexts.

The run registry is managed by
`wordpress-plugin/includes/utils/run-registry.php::factory_update_run_registry()`.
It stores compact rows for latest run screens and run history.

Doctor output is exposed by `factory_rest_doctor()` and WP-CLI doctor commands.
It reads the latest manifest, validates the current site against the stored
blueprint, and reports non-ok issues.

User-editing safety currently lives in runtime helpers and adapters:
`wordpress-plugin/includes/utils/ownership.php` hashes generated state and
marks posts/terms with Factory ownership metadata. Content planning and
validation can warn when generated content was manually edited and should be
preserved.

## Target Core Contract Concepts

Core contracts are portable shapes. They must not call WordPress, run adapters,
or store files.

- `BlueprintDocument`: desired site state plus metadata.
- `BlueprintPatch`: safe proposed change operations against a blueprint.
- `BlueprintCandidate`: full proposed blueprint that must not be applied
  directly.
- `Plan`: preview plan before runtime apply.
- `PlanItem`: one planned create/update/delete/skip/warning/error item.
- `PlanSummary`: action counts for a plan.
- `ValidationResult`: validation output and resolved status.
- `ValidationCheck`: one validation check with status, scope, message, context.
- `RunManifest`: portable proof structure for a system run.
- `RepairPlan`: future repair/fix intent, not execution.
- `PromptInterpretation`: structured user intent and suggestions only.

## Mapping Table

| Current plugin concept | Current source file/function | Future Core contract | Mapping notes | Migration risk |
|---|---|---|---|---|
| Preview plan | `includes/api/rest.php::factory_rest_build_plan()` and `includes/commands/dry-run.php::get_plan_items()` | `Plan`, `PlanItem`, `PlanSummary` | Plugin plan arrays map directly to Core plan objects. Plugin-specific `adapter_class` should become metadata/context, not required Core identity. | Medium: current items are adapter-shaped and may include WordPress-specific diffs. |
| Plan item | `Factory_Dry_Run_Command::normalize_plan_item()` | `PlanItem` | `adapter` -> adapter, `action` -> action, `entity` -> entity, `message` -> message, `diff` -> diff. Current `type` can become context or future scope. | Low: shape is already stable. |
| Execution item | Adapter `execution_item()` helpers and `factory_apply_blueprint()` | `RunManifest.execution` or future `ApplyResult` | Execution remains plugin-side because it records actual WordPress mutations. Core should define portable apply result shape later. | Medium: each adapter has slightly different details payloads. |
| Validation check | Adapter `validate()` methods | `ValidationCheck` | `status` maps directly. Current checks often only have `message`; future mapping should derive `scope` from adapter/type/entity when available. | Medium: existing checks are message-heavy and not always structured. |
| Validation summary/status | `factory_validate_blueprint_state()` and `factory_resolve_run_status_from_validation()` | `ValidationResult`, `ManifestStatus` | Status constants align: `ok`, `warning`, `error`. Core should own final status resolution rules once runtime checks are normalized. | Medium: plugin runtime currently treats some empty/no-run states as dashboard-friendly non-errors. |
| Run manifest | `utils/run-manifest.php::factory_save_run_manifest()` | `RunManifest` | Manifest maps well: id/file, timestamp, status, blueprint, plan, validation, context, execution. Storage path remains plugin-side. | Low: current manifest already has the right proof shape. |
| Run registry row | `utils/run-registry.php::factory_update_run_registry()` | Future `RunManifestSummary` or manifest metadata | Registry is an index optimized for UI/CLI. It should remain plugin storage until Core adds a summary contract. | Low: registry is derived data. |
| Doctor result | `api/rest.php::factory_rest_doctor()` and `commands/doctor.php` | `ValidationResult` plus future `DoctorResult` | Doctor is runtime validation against latest manifest blueprint. Core can define issue/status shape; plugin remains source of live site truth. | Medium: no dedicated Core `DoctorResult` exists yet. |
| Repair/fix result | `commands/fix.php` | `RepairPlan` and future `ApplyResult` | Current fix detects plan changes, expands adapter dependencies, applies affected adapters, re-plans, validates, and saves manifest. Core should define repair intent, not runtime execution. | High: dependency expansion is runtime-adapter specific. |
| User editing warning/skip | `utils/ownership.php`, `content-adapter.php::plan()`, `content-adapter.php::validate()` | Future ownership policy, `PlanItem` warning, `ValidationCheck` warning | Current warnings can map to `PlanItem::ACTION_WARNING` and warning checks. Ownership hashes/meta storage stay plugin-side. | Medium: Core lacks explicit ownership/lock contract today. |
| Real Estate safe variables | `api/rest.php` prompt context helpers and dashboard payload | `RealEstateProfile`, future Product profile contracts | `agency_name`, `hero_title`, `hero_subtitle`, `contact_title`, `contact_intro` match `RealEstateProfile` safe defaults. | Low: contract is intentionally narrow. |
| Style and image contexts | `api/rest.php` style/image context helpers | Product profile metadata and `RunManifest.context` | Contexts should stay non-schema overlays unless promoted to canonical Blueprint fields. | Medium: design tokens already affect blueprint `site.style`. |
| AI prompt interpretation placeholder | `api/ai-interpret-rest.php`, `ai/prompt-interpreter.php` | `PromptInterpretation`, `PromptInterpreterInterface` | Current local/mock output is richer than the Core skeleton. Future mapping should normalize into Core interpretation plus separate UI details. | Medium: current implementation uses WordPress sanitizers and cannot move directly to Core. |
| BlueprintPatch | Not wired in plugin yet | `BlueprintPatch`, `BlueprintCandidate` | This is the missing safe modification layer between AI/user changes and runtime apply. | High: must be added before any AI generation is connected. |

## What Should Remain Plugin-Side

The following must remain in `wordpress-plugin/` for now:

- Actual WordPress mutations.
- Runtime adapters and adapter registry implementation.
- Crocoblock-specific integration code.
- REST endpoints and admin dashboard UI.
- WP nonce and capability checks.
- WP option/meta/term/post storage.
- Local AI settings storage and encryption.
- Run manifest file persistence and registry files.
- Runtime health and doctor checks against the live WordPress site.
- User-editing detection through WordPress post/term meta.

## What Should Eventually Move To Core

The following should become Core-owned contracts or pure services:

- Data shape definitions for Blueprint, BlueprintPatch, Plan, ValidationResult,
  Manifest, RepairPlan, and PromptInterpretation.
- Status constants and status resolution rules.
- Plan summary rules.
- Validation result shape and severity rules.
- Manifest schema and proof conventions.
- Repair plan shape.
- BlueprintPatch validation.
- Product profile contracts for Real Estate and future verticals.
- Prompt interpretation shape independent of WordPress sanitizers.

## Migration Notes

The safest migration path is to add translators later, not to refactor the
plugin now. A future bridge can convert current plugin arrays into Core objects:

```text
plugin blueprint array -> BlueprintDocument
plugin plan array -> Plan
plugin validation report -> ValidationResult
plugin manifest array -> RunManifest
plugin fix plan -> RepairPlan
local prompt interpretation -> PromptInterpretation
```

Those translators should live outside runtime adapters at first. Once stable,
the plugin can return both current arrays and Core-shaped structures internally,
without changing REST response behavior.

## Near-Term Non-Goals

Do not yet:

- Wire Core into `wordpress-plugin/`.
- Move adapters into Core.
- Replace REST response shapes.
- Replace WP-CLI command internals.
- Restore old AI blueprint generation.
- Apply BlueprintPatch objects.
- Add provider calls.
- Change Real Estate generation behavior.
