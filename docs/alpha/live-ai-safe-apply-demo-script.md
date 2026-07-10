# Live AI Safe Apply Demo Script

This script is for evaluating the current Launcher-first alpha without adding new risky behavior.

It separates safe read-only review from the earlier mutating smoke that already produced the proof chain.

## A. Start Launcher

```powershell
node launcher/src/cli.js start --port 3847
```

Open:

- [http://127.0.0.1:3847](http://127.0.0.1:3847)

## B. Show The Proven Project

Project:

- `alpha-e2e-smoke-1`

Explain:

- this is a Launcher-owned disposable runtime
- this is the reviewed alpha proof project
- the demo below is read-only unless you intentionally rerun the old mutation smoke

## C. Generate The Read-only Proof Pack

```powershell
node launcher/src/cli.js proof-pack --slug alpha-e2e-smoke-1
```

Expected:

- JSON proof pack written under `proofs/`
- Markdown proof pack written under `proofs/`
- no apply
- no rollback
- no generate
- no live AI

## D. Show Current Managed State

```powershell
node launcher/src/cli.js state --slug alpha-e2e-smoke-1 refresh
node launcher/src/cli.js state --slug alpha-e2e-smoke-1 status
```

Expected:

- latest effective mutation reflects rollback-aware reporting
- protected fields include `hero_title`
- `hero_title` is protected and render-present
- non-protected effective fields reflect restored Mykolaiv values
- pages `6`
- properties `30`
- attachments `22`

## E. Show Current Site Status

```powershell
node launcher/src/cli.js site --slug alpha-e2e-smoke-1 status
```

Expected:

- WordPress URL: [http://127.0.0.1:8134](http://127.0.0.1:8134)
- Home / Properties / Contact URLs present
- Home / Properties / Contact status `200`
- Frontend Edit URL present
- Frontend Edit login handoff present

## F. Open The Site

Open:

- Home: [http://127.0.0.1:8134/](http://127.0.0.1:8134/)
- Properties: [http://127.0.0.1:8134/properties/](http://127.0.0.1:8134/properties/)
- Contact: [http://127.0.0.1:8134/contact/](http://127.0.0.1:8134/contact/)

Expected:

- generated Real Estate site still loads
- restored Mykolaiv values are the active state after rollback
- no fallback title replaced the protected hero title

## G. Walk The Proof Chain

Use these exact artifacts:

- generate proof:
  - [generate-2026-07-08T17-57-53-496Z-31550f.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/generate-2026-07-08T17-57-53-496Z-31550f.json)
- live AI candidate proof:
  - [ai-candidate-2026-07-10T10-46-35-411Z-fc799c.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/ai-candidate-2026-07-10T10-46-35-411Z-fc799c.json)
- live AI plan proof:
  - [state-plan-2026-07-10T10-46-39-196Z-393f89.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/state-plan-2026-07-10T10-46-39-196Z-393f89.json)
- safe apply proof:
  - [state-apply-2026-07-10T10-54-46-648Z.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/state-apply-2026-07-10T10-54-46-648Z.json)
- rollback proof:
  - [state-rollback-2026-07-10T10-58-50-743Z.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/state-rollback-2026-07-10T10-58-50-743Z.json)
- rollback reporting fix proof:
  - [rollback-effective-state-fix-2026-07-10T12-15-30-000Z.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/rollback-effective-state-fix-2026-07-10T12-15-30-000Z.json)

## H. Explain The Security Story

Call out:

- live AI is used only for desired-state planning
- apply is still a Launcher-controlled state apply
- no raw OpenAI key is stored on disk for `--key-env`
- `C:\sf-factory-projects\alpha-e2e-smoke-1\secrets\ai.env` must be absent
- direct AI WordPress mutation is not allowed

## I. Optional Historical Mutation Smoke

Only show this if someone specifically wants to understand how the earlier proofs were produced.

These commands are intentionally mutating and are **not** part of the read-only evaluator flow:

```powershell
node launcher/src/cli.js ai --slug alpha-e2e-smoke-1 estimate --prompt "<prompt>"
node launcher/src/cli.js ai --slug alpha-e2e-smoke-1 enable-live
node launcher/src/cli.js state --slug alpha-e2e-smoke-1 plan --prompt "<prompt>" --ai live --confirm-live --estimate latest
node launcher/src/cli.js state --slug alpha-e2e-smoke-1 apply --plan latest
node launcher/src/cli.js state --slug alpha-e2e-smoke-1 rollback --apply latest
```

Say clearly that those commands are not required to review the alpha proof pack.
