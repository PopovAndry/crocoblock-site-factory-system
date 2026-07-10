# Alpha v0.1 Release Notes

## Summary

This is an alpha evaluator release for the Launcher-first Crocoblock Site Factory flow.

It packages the currently proven path into a reviewable proof surface without adding new risky behavior.

## What Is Included

- standalone Launcher as the primary control surface
- generated Real Estate alpha runtime proof
- frontend safe-edit proof history
- managed state and protected override reporting
- live AI desired-state planning proof
- env-only AI key handling
- `field_only_safe_apply` proof
- rollback proof
- rollback-aware effective-state reporting
- proof-pack CLI command
- Launcher UI `Alpha Proof Pack` panel

## What Is Intentionally Excluded

- production release claims
- new generation behavior
- new AI mutation behavior
- new safe fields
- new verticals
- dashboard productization
- embedded-console productization
- dependency install as part of the evaluator path
- rerunning live AI, apply, rollback, or generate in the evaluator path

## Proven Safety Guarantees

- live AI is limited to desired-state planning only
- AI does not mutate WordPress directly
- evaluator path is read-only
- `field_only_safe_apply` was proven separately and is not triggered by proof-pack review
- rollback was proven separately and is not triggered by proof-pack review
- `--key-env` handling is env-only
- raw OpenAI key is not persisted to `secrets/ai.env`
- proof-pack readiness is now split so a fresh generated-only project is not mislabeled as broken when it simply lacks AI safe-apply history

## Known Limitations

- this is still an alpha, not a production system
- rollback is safe-field rollback v1, not full-site snapshot restore
- drift detection is still incomplete
- live AI remains gated and is not part of the evaluator path
- proof-pack summarizes existing proof history; it does not replace the underlying proofs
- a generated-only runtime can be `generated_site_ready` while still being only `partial` for full alpha evaluation

## How To Verify

Read-only commands:

```powershell
node launcher/src/cli.js start --port 3847
node launcher/src/cli.js proof-pack --slug alpha-e2e-smoke-1
node launcher/src/cli.js state --slug alpha-e2e-smoke-1 refresh
node launcher/src/cli.js state --slug alpha-e2e-smoke-1 status
node launcher/src/cli.js site --slug alpha-e2e-smoke-1 status
```

Expected:

- readiness = `ready_for_alpha_evaluation`
- latest effective mutation = `state_apply_rollback_v1`
- protected field = `hero_title`
- counts = `6 / 30 / 22`
- Home / Properties / Contact = `200`
- `secrets/ai.env` absent

## Current Proof Pack Command

```powershell
node launcher/src/cli.js proof-pack --slug alpha-e2e-smoke-1
```

## Current Proof Pack UI

Launcher UI now includes a read-only `Alpha Proof Pack` panel that shows:

- readiness
- proof-pack file paths
- current effective mutation
- latest rollback proof
- protected fields
- counts
- URL health
- safety summary

## Recommended Next Phase After Alpha

The next practical step after this evaluator release is to keep narrowing the desired-state/apply model rather than broadening UI polish first.

Recommended order:

1. field-scoped plan/apply hardening where needed
2. stronger drift detection
3. stronger rollback/snapshot model
4. clearer release gating around live AI planning
5. UX polish after the mutation and recovery model is more mature
