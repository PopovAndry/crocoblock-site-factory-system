# Live AI Safe Apply Proof Pack

This document is the evaluator-facing map for the current Launcher-first proof chain.

It covers the proven path where live AI is used only to produce a desired-state candidate, that candidate is turned into a state plan, the plan is applied through `field_only_safe_apply`, and the result is rolled back without using generate during apply or rollback.

## Safe Review Entry Point

Read-only command:

```powershell
node launcher/src/cli.js proof-pack --slug alpha-e2e-smoke-1
```

Expected output files:

- `C:\sf-factory-projects\alpha-e2e-smoke-1\proofs\alpha-proof-pack-<timestamp>.json`
- `C:\sf-factory-projects\alpha-e2e-smoke-1\proofs\alpha-proof-pack-<timestamp>.md`

This command must not:

- call live AI
- call estimate
- enable live
- apply
- rollback
- generate
- mutate WordPress content

## Current Proven Project

- Project root: `C:\sf-factory-projects\alpha-e2e-smoke-1`
- WordPress URL: [http://127.0.0.1:8134](http://127.0.0.1:8134)
- Launcher URL: [http://127.0.0.1:3847](http://127.0.0.1:3847)
- Current checkpoint: `dbd0a63` `Fix rollback effective state reporting`

## Current Primary Proof Chain

### 1. Generate proof

- Path: [generate-2026-07-08T17-57-53-496Z-31550f.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/generate-2026-07-08T17-57-53-496Z-31550f.json)
- Purpose: proves Real Estate generate completed with local deterministic prompt personalization
- Expected:
  - `controlled_generate_status = ok`
  - `provider_called = false`
  - pages `2 -> 6`
  - properties `0 -> 30`
  - attachments `0 -> 22`

### 2. Live AI candidate proof

- Path: [ai-candidate-2026-07-10T10-46-35-411Z-fc799c.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/ai-candidate-2026-07-10T10-46-35-411Z-fc799c.json)
- Purpose: proves one real live AI call produced a desired-state candidate only
- Expected:
  - `provider_called = true`
  - schema `factory_ai_desired_state_candidate`
  - only safe fields present
  - no raw key persisted

### 3. Live AI state plan proof

- Path: [state-plan-2026-07-10T10-46-39-196Z-393f89.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/state-plan-2026-07-10T10-46-39-196Z-393f89.json)
- Purpose: proves live AI candidate flowed through normal plan/diff logic
- Expected:
  - `provider_called = true`
  - `applies_changes = false`
  - protected `hero_title` preserved by default
  - `field_scope` present

### 4. Safe field-only apply proof

- Path: [state-apply-2026-07-10T10-54-46-648Z.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/state-apply-2026-07-10T10-54-46-648Z.json)
- Purpose: proves apply used the narrow `field_only_safe_apply` path
- Expected:
  - `status = ok`
  - `apply_method = field_only_safe_apply`
  - `fallback_used = false`
  - protected `hero_title` not overwritten
  - no generate run during apply

### 5. Rollback proof

- Path: [state-rollback-2026-07-10T10-58-50-743Z.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/state-rollback-2026-07-10T10-58-50-743Z.json)
- Purpose: proves safe-field rollback restored previous values
- Expected:
  - `status = ok`
  - `code = state_rollback_applied`
  - rollback fields point back to Mykolaiv values
  - counts stable

### 6. Rollback reporting consistency fix proof

- Path: [rollback-effective-state-fix-2026-07-10T12-15-30-000Z.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/rollback-effective-state-fix-2026-07-10T12-15-30-000Z.json)
- Purpose: proves `effective_safe_fields` now track rollback-restored values instead of stale rolled-back apply values
- Expected:
  - latest effective mutation is rollback-aware
  - Mykolaiv restored values active
  - stale Uzhhorod values no longer active

## Current Read-only Validation

Use:

```powershell
node launcher/src/cli.js state --slug alpha-e2e-smoke-1 refresh
node launcher/src/cli.js state --slug alpha-e2e-smoke-1 status
node launcher/src/cli.js site --slug alpha-e2e-smoke-1 status
```

Expected:

- pages `6`
- properties `30`
- attachments `22`
- Home / Properties / Contact status `200`
- protected `hero_title` present
- latest effective mutation reflects rollback-aware state
- no `secrets/ai.env`

## Security Posture To Call Out

- AI key source is env-only for `--key-env FACTORY_OPENAI_API_KEY`
- raw key must not be written to:
  - `secrets/ai.env`
  - `factory-project.json`
  - proofs
  - logs
  - state plans
- live AI requires:
  - configure provider
  - estimate
  - `enable-live`
  - `--confirm-live`

## Honest Limits

- live AI in this alpha proposes desired state only
- apply is still limited to the safe allowlist
- rollback is safe-field rollback v1, not full-site rollback
- this proof pack is a review aid, not a new product surface
