# Alpha Evaluator Script

This script is the final reviewer walkthrough for the Launcher-first alpha.

It is intentionally read-only.

## Goal Of The Alpha

The evaluator should be able to confirm that the standalone Launcher is now the review surface for a Terraform-like alpha flow that has already proven:

- generated Real Estate site creation
- frontend safe edit proof
- managed state and protected overrides
- live AI desired-state planning
- field-only safe apply
- rollback
- rollback-aware state reporting
- env-only AI key handling

The evaluator path below does not rerun the historical mutation proofs.

## What The Evaluator Should See

Expected reference values:

- Project: `alpha-e2e-smoke-1`
- WordPress URL: [http://127.0.0.1:8134](http://127.0.0.1:8134)
- Launcher URL: [http://127.0.0.1:3847](http://127.0.0.1:3847), unless the Launcher reports another port
- Pages / Properties / Attachments: `6 / 30 / 22`
- Latest effective mutation: `state_apply_rollback_v1`
- Protected field: `hero_title`

Important:

- this is a read-only demo path
- historical mutating smoke was already proven and is not rerun here
- do not paste API keys
- do not run live AI unless intentionally repeating a separate live smoke

## Step 1: Start Launcher

```powershell
node launcher/src/cli.js start --port 3847
```

Open:

- [http://127.0.0.1:3847](http://127.0.0.1:3847)

## Step 2: Open Alpha Project

In the Launcher UI, review project:

- `alpha-e2e-smoke-1`

Expected:

- Launcher loads
- project card exists
- generated site section exists
- managed state section exists
- `Alpha Proof Pack` section exists

## Step 3: Review Generated Site Links

Check the generated site links in the Launcher UI or with status output:

```powershell
node launcher/src/cli.js site --slug alpha-e2e-smoke-1 status
```

Expected:

- WordPress URL: [http://127.0.0.1:8134](http://127.0.0.1:8134)
- Home URL present
- Properties URL present
- Contact URL present
- Home / Properties / Contact status `200`

## Step 4: Review Managed State

Run:

```powershell
node launcher/src/cli.js state --slug alpha-e2e-smoke-1 refresh
node launcher/src/cli.js state --slug alpha-e2e-smoke-1 status
```

Expected:

- latest effective mutation = `state_apply_rollback_v1`
- protected fields include `hero_title`
- effective safe fields are present
- pages = `6`
- properties = `30`
- attachments = `22`

## Step 5: Generate Proof Pack From UI

In the `Alpha Proof Pack` panel, click:

- `Generate Proof Pack`

Expected:

- success message appears
- new JSON proof-pack path appears
- new Markdown proof-pack path appears
- no apply
- no rollback
- no generate
- no live AI

## Step 6: Open And Read Proof Pack Files

CLI equivalent:

```powershell
node launcher/src/cli.js proof-pack --slug alpha-e2e-smoke-1
```

Expected proof output:

- `C:\sf-factory-projects\alpha-e2e-smoke-1\proofs\alpha-proof-pack-<timestamp>.json`
- `C:\sf-factory-projects\alpha-e2e-smoke-1\proofs\alpha-proof-pack-<timestamp>.md`

Review for:

- readiness = `ready_for_alpha_evaluation`
- latest effective mutation = `state_apply_rollback_v1`
- protected field = `hero_title`
- counts = `6 / 30 / 22`
- safety claims include:
  - live AI planning only
  - field-only safe apply proven
  - rollback proven
  - no raw key persistence
  - `secrets/ai.env` absent

## Step 7: Verify Known Limitations

The evaluator should confirm the alpha is still intentionally limited:

- no live AI mutation of WordPress
- no broad apply path in the evaluator flow
- no rerun of generate during apply or rollback
- no new verticals
- no dashboard or embedded-console product surface
- rollback is still safe-field rollback v1, not full-site restore

## Step 8: Final Evaluator Verdict

Mark alpha ready if all of these are true:

- proof-pack readiness is green
- Launcher UI proof surface is present and understandable
- managed state is rollback-aware
- site health is green
- secret posture is clean
- evaluator path stayed read-only

Mark alpha blocked if any of these happen:

- proof-pack panel missing
- readiness is not green
- effective state is stale or contradictory
- site endpoints fail
- `secrets/ai.env` exists
- evaluator had to run apply / rollback / generate / live AI
