# Crocoblock Site Factory: Architecture Checkpoint

## Current Checkpoint

- Code checkpoint: `004deba`
- Original execution coverage checkpoint: `23f4a0c`
- Working tree: clean
- Execution coverage: complete for the current MVP blueprint
- Execution-aware fix v1: implemented and verified
- Failed-run/status alignment v1: implemented
- REST `/runs` lightweight summary enrichment v1: implemented

## What It Is

Crocoblock Site Factory is an infrastructure-style automation engine for WordPress/Crocoblock.
The direction is Infrastructure as Code for WordPress sites: a blueprint describes the desired state, and the engine applies, verifies, records, and exposes the result.

## Current Pipeline

```text
Blueprint
  -> Apply
  -> Execution trace
  -> Dry-run convergence plan
  -> Validation proof
  -> Manifest
  -> Run inspection
  -> REST visibility
  -> Doctor / Health
```

## Execution-Aware Fix

`wp factory fix` now has a repair manifest flow:

```text
Drift
  -> Doctor
  -> Fix
  -> Execution trace
  -> Post-fix convergence plan
  -> Validation proof
  -> Manifest
  -> REST
```

The current v1 writes a manifest only after an actual repair. No-op and `--dry-run` runs do not write manifests.

The fix manifest includes:

- `prompt`: `Fix active blueprint`;
- `execution` items from adapters that actually ran;
- post-fix `plan`;
- full `validation`;
- validation-derived `results`;
- visibility through `wp factory latest` and REST `/run/latest`.

Verified scenario: the generated `Backend Developer` job post was deleted, `doctor` detected drift, `dry-run` showed a content item create action, `fix` restored the post through `Factory_Content_Adapter`, the latest run had `execution.count = 2`, the post-fix plan was `0 create / 0 update / 16 skip`, validation had `28 checks`, and `doctor` was green afterward.

## Run Status Alignment

New run manifests derive top-level `status` from validation checks. The manifest writer no longer trusts caller-provided status.

Status rules:

- any validation error => `error`;
- any warning without errors => `warning`;
- all checks ok => `ok`;
- missing checks => `error`;
- empty checks => `warning`;
- malformed checks or unknown check status => `warning`.

The run registry inherits status from the manifest. `/runs?failed=1` is therefore more accurate for newly written runs. Old manifests and old registry rows are not migrated.

## Manual Apply Flow

`wp factory apply /path/to/blueprint.json`:

1. Reads the blueprint.
2. Applies it through adapters.
3. Collects `execution`.
4. Builds a post-apply convergence plan.
5. Runs validation.
6. Saves a run manifest.
7. Exposes the result through CLI and REST.

## AI Flow

`wp factory ai ...`:

1. Detects the preset.
2. Generates or enhances the blueprint through AI.
3. Runs contract validation.
4. Creates a snapshot.
5. Applies the blueprint.
6. Runs dry-run.
7. Runs validation.
8. Saves the manifest.
9. Rolls back on validation failure.

## MVP Blueprint Coverage

The current MVP blueprint covers:

- theme;
- plugin;
- CPT;
- meta;
- taxonomy;
- terms;
- content;
- JetEngine meta box;
- listing;
- render/archive page;
- single template.

## Adapter Architecture

Current adapters:

- Plugin;
- Theme;
- Taxonomy;
- WP Core;
- JetEngine Meta;
- JetEngine Listing;
- Render;
- Single;
- Content.

## Execution Coverage

The expected execution trace for the current job-board MVP contains 16 items:

```text
= skip plugin jet-engine - Plugin already active: jet-engine
= skip theme kava - Theme already active: kava
= skip taxonomy job_type - Taxonomy up-to-date: job_type
= skip term job_type -> Full-time - Term exists: job_type -> Full-time
= skip term job_type -> Part-time - Term exists: job_type -> Part-time
= skip term job_type -> Remote - Term exists: job_type -> Remote
= skip cpt job - CPT up-to-date: job
= skip meta job.salary - Meta declared: job.salary
= skip meta job.location - Meta declared: job.location
= skip meta job.wellness_budget - Meta declared: job.wellness_budget
= skip jetengine factory_job - JetEngine meta box up-to-date: factory_job
= skip listing Job Card - Listing up-to-date: Job Card
= skip render jobs - Render page up-to-date: jobs
= skip single job - Single template registered for: job
= skip content job -> Frontend Developer - Post skipped: Frontend Developer
= skip content job -> Backend Developer - Post skipped: Backend Developer
```

Coverage groups:

- plugin;
- theme;
- taxonomy;
- terms;
- CPT;
- meta;
- JetEngine;
- listing;
- render;
- single;
- content.

## Manifest Model

A run manifest currently contains:

- `blueprint`;
- `plan`;
- `execution`;
- `validation`;
- `results`;
- `status`;
- `prompt`;
- `preset`;
- `timestamp`.

## CLI Commands

Primary commands:

```text
wp factory apply
wp factory latest
wp factory dry-run
wp factory validate
wp factory doctor
wp factory health
```

## REST Visibility

Control-plane endpoints:

```text
/wp-json/factory/v1/runs
/wp-json/factory/v1/run/latest
/wp-json/factory/v1/run/{file}
```

- `/runs` is lightweight registry-only run history with summary fields.
- `/run/latest` returns full latest run details.
- `/run/{file}` returns full historical run details.

`/runs` does not load full manifests and does not expose `blueprint`. New registry rows include:

- `plan_summary`;
- `execution_count`;
- `validation_count`;
- `results_summary`.

Old rows use safe defaults. `wp factory runs --format=json` includes the enriched fields; table output remains unchanged.

## Known Non-Blocking Issues

- The Codex checkout does not include a full WordPress core, so runtime WP-CLI checks fail before Factory bootstrap there.
- Runtime verification is done locally in the full WordPress/Docker environment.
- In PowerShell, `curl` can be an alias; use `curl.exe` for real curl or `Invoke-RestMethod` for REST demos.
- Command strings that appear in terminal output can be paste artifacts, not Factory output.

## What Not To Build Yet

Do not add these yet:

- event bus;
- async queue;
- retry engine;
- execution DB;
- strict interface enforcement;
- large adapter refactor.

## Progress Estimate

- Core engine foundation: ~85%
- Execution observability: ~85-90%
- Manifest/run observability: ~80-85%
- REST/control plane: ~55-60%
- AI layer: ~35-40%
- Production platform: ~45%

## Recommended Next Steps

1. REST/control-plane polish where UI needs it.
2. Optional README integration.
3. AI quality layer.
4. Additional presets.
5. Repair/fix polish only when real cases require it.
