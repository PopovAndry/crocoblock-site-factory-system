# Alpha Proof Pack

This file inventories the proof artifacts for the current Terraform-like alpha.

## Current Alpha Summary Proof

- Path: [alpha-e2e-summary-2026-07-08T18-26-10-640Z.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/alpha-e2e-summary-2026-07-08T18-26-10-640Z.json)
- Purpose: one-file summary of the full alpha E2E demo
- Expected key values:
  - `project_slug = alpha-e2e-smoke-1`
  - `provider_called = false`
  - `no_openai = true`
  - frontend edit before/after values recorded
  - conflict plan proof path recorded
  - blocked apply proof path recorded
  - rollback result marked as skipped with reason
- Status: pass

## Prompt-Personalized Generate Proof

- Path: [generate-2026-07-08T17-57-53-496Z-31550f.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/generate-2026-07-08T17-57-53-496Z-31550f.json)
- Purpose: proves controlled generate ran with local deterministic prompt personalization
- Expected key values:
  - `controlled_generate_status = ok`
  - `provider_called = false`
  - `personalization.source = local_interpreter`
  - `agency_name = Alpha Prime Realty`
  - `city = Kyiv`
  - `hero_title` contains `Alpha Prime Realty`
  - `before_counts.pages = 2`
  - `after_counts.pages = 6`
  - `before_counts.properties = 0`
  - `after_counts.properties = 30`
  - `before_counts.attachments = 0`
  - `after_counts.attachments = 22`
- Status: pass

## Frontend Safe Edit Manifest

- Path: [run-20260708-181546.json](C:/sf-factory-projects/alpha-e2e-smoke-1/wordpress/wp-content/uploads/crocoblock-site-factory/runs/run-20260708-181546.json)
- Purpose: proves the frontend safe edit save produced an Agent-side manifest
- Expected key values:
  - save source is frontend safe edit
  - `hero_title` changed from generated title to `Alpha Prime Realty Frontend Edited`
  - save proof details present
- Status: pass

## State Refresh Proof

- Path: [state-refresh-2026-07-08T18-16-33-160Z-be061d.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/state-refresh-2026-07-08T18-16-33-160Z-be061d.json)
- Purpose: proves State v1 refreshed after frontend save
- Expected key values:
  - state summary present
  - user override count reflects the frontend edit
  - protected field list includes `hero_title`
- Status: pass

## Conflict State Plan Proof

- Path: [state-plan-2026-07-08T18-17-22-673Z-cd2ada.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/state-plan-2026-07-08T18-17-22-673Z-cd2ada.json)
- Purpose: proves state planning detects protected override conflicts
- Expected key values:
  - `provider_called = false`
  - `applies_changes = false`
  - conflict type `protected_user_override`
  - `field_key = hero_title`
  - `can_apply_without_confirmation = false`
- Status: pass

## Blocked Apply Proof

- Path: [state-apply-blocked-2026-07-08T18-17-22-757Z.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/state-apply-blocked-2026-07-08T18-17-22-757Z.json)
- Purpose: proves apply is blocked before mutation when a protected override would be overwritten
- Expected key values:
  - `status = blocked`
  - `code = state_plan_requires_confirmation`
  - `applies_changes = false`
  - `no_wp_mutation = true`
- Status: pass

## Earlier Rollback V1 Reference

- Path: [state-rollback-2026-07-05T20-19-21-372Z.json](C:/sf-factory-projects/personalized-generate-smoke-1/proofs/state-rollback-2026-07-05T20-19-21-372Z.json)
- Purpose: earlier proof that `State Apply rollback v1` can restore previous safe personalization fields
- Expected key values:
  - successful rollback status
  - restored previous personalization values
  - state refreshed after rollback
- Status: pass

Important:

- this is **rollback v1 proof from an earlier disposable project, not from `alpha-e2e-smoke-1`**

## Reading Order

1. alpha summary proof
2. generate proof
3. frontend safe edit manifest
4. state refresh proof
5. conflict plan proof
6. blocked apply proof
7. earlier rollback reference
