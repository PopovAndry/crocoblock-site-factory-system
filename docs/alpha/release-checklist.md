# Alpha Release Checklist

This checklist is for the Launcher-first alpha evaluator release only. It is intentionally read-only.

Do not use this checklist to rerun historical mutation smoke unless you are explicitly repeating an older proof path on purpose.

## A. Preflight

Pass all of these before starting an evaluator session:

| Check | Expected | Pass/Fail |
| --- | --- | --- |
| Repo status | Clean enough to understand the release scope |  |
| Docker/runtime services | Running |  |
| Launcher startup | `node launcher/src/cli.js start` works |  |
| Alpha project exists | `alpha-e2e-smoke-1` exists under `C:\sf-factory-projects\` |  |
| WordPress reachable | [http://127.0.0.1:8134](http://127.0.0.1:8134) loads |  |
| Launcher reachable | [http://127.0.0.1:3847](http://127.0.0.1:3847) loads, unless another port is reported |  |
| Agent/site proof surface reachable | `state status` and `site status` succeed |  |
| AI disk secret absent | `C:\sf-factory-projects\alpha-e2e-smoke-1\secrets\ai.env` is absent |  |

## B. Read-only Evaluator Path

Run only these commands:

```powershell
node launcher/src/cli.js start --port 3847
node launcher/src/cli.js proof-pack --slug alpha-e2e-smoke-1
node launcher/src/cli.js state --slug alpha-e2e-smoke-1 refresh
node launcher/src/cli.js state --slug alpha-e2e-smoke-1 status
node launcher/src/cli.js site --slug alpha-e2e-smoke-1 status
```

This evaluator path must not:

- run live AI
- run apply
- run rollback
- run generate
- run dependency install
- mutate WordPress

## C. Expected Green State

The current evaluator-ready runtime should show:

| Signal | Expected |
| --- | --- |
| Proof-pack readiness | `ready_for_alpha_evaluation` |
| Latest effective mutation | `state_apply_rollback_v1` |
| Protected fields | includes `hero_title` |
| Pages | `6` |
| Properties | `30` |
| Attachments | `22` |
| Home status | `200` |
| Properties status | `200` |
| Contact status | `200` |
| `secrets/ai.env` | absent |

## D. UI Checklist

Open [http://127.0.0.1:3847](http://127.0.0.1:3847) and verify:

- project `alpha-e2e-smoke-1` is visible
- generated site section is visible
- managed state section is visible
- `Alpha Proof Pack` panel is visible
- readiness is visible
- proof-pack JSON path is visible
- proof-pack Markdown path is visible
- latest effective mutation is visible
- latest rollback proof path is visible
- protected field `hero_title` is visible
- counts show `6 / 30 / 22`
- `Generate Proof Pack` button works
- no apply / rollback / generate / live-AI buttons exist inside the proof-pack panel

## E. Safety Checks

The evaluator path passes only if all of these remain true:

- no live AI call in the evaluator flow
- no apply
- no rollback
- no generate
- no dependency install
- no raw key on disk
- no WordPress mutation
- no shared runtime mutation

## F. Release Decision

Use this table for the final evaluator verdict:

| Category | Pass condition | Result |
| --- | --- | --- |
| Read-only proof-pack CLI | command succeeds and writes JSON/MD proof pack |  |
| Launcher UI proof surface | panel visible and readable |  |
| Rollback-aware state status | shows `state_apply_rollback_v1` and protected `hero_title` |  |
| Site health | Home / Properties / Contact return `200` |  |
| Secret posture | `secrets/ai.env` absent, no raw key on disk |  |
| Safety boundary | no mutation commands used |  |

### Blocker examples

- proof-pack readiness is not `ready_for_alpha_evaluation`
- `secrets/ai.env` exists
- current effective mutation is stale or contradictory
- proof-pack panel is missing from Launcher UI
- evaluator flow requires live AI, apply, rollback, or generate
- generated site URLs are not healthy

### Non-blocker warnings

- long Windows paths wrap awkwardly in the UI
- PowerShell output may still display some mojibake for Ukrainian prompt text in terminals
- proof-pack is comprehensive but still depends on underlying historical proof files
