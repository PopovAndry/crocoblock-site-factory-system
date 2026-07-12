# Terraform-like Alpha

This document set describes the current Crocoblock Site Factory alpha as it exists today.

The alpha proves a Terraform-like flow across the Standalone Factory Launcher, the Site Factory Agent plugin, and Frontend Safe Edit:

- create and provision a Launcher-owned WordPress project
- install the Site Factory Agent
- install required local dependency ZIPs through the Launcher
- run local deterministic prompt personalization during controlled generate
- generate a Real Estate site with proof
- open the generated site
- log in and save a supported frontend safe-edit field
- refresh managed state
- plan a new prompt against current state
- block apply when a protected frontend override would be overwritten
- run live AI for desired-state planning only
- apply a desired-state plan through `field_only_safe_apply`
- roll back a safe apply
- repair rollback-aware effective state reporting
- keep AI key handling env-only without persisting raw keys to `secrets/ai.env`

This alpha does **not** prove:

- production readiness
- full rollback of a WordPress site or database
- full drift detection
- multi-vertical generation
- Elementor or WooCommerce generation
- AI-driven WordPress mutation outside the state plan/apply pipeline
- bundled premium dependency distribution

Readiness is now reported in separate dimensions so evaluators can distinguish:

- a healthy generated site
- a runtime with full live AI safe-apply and rollback history
- the overall alpha evaluator verdict

Use honest names when presenting this alpha:

- `Terraform-like alpha`
- `local deterministic prompt personalization`
- `live AI desired-state planning`
- `field_only_safe_apply`
- `State Apply rollback v1`

Do not describe it as a full AI website generator or a production-ready system.

## Proven Project

The current alpha demo was proven on:

- Project root: `C:\sf-factory-projects\alpha-e2e-smoke-1`
- WordPress URL: [http://127.0.0.1:8134](http://127.0.0.1:8134)
- Launcher URL: [http://127.0.0.1:3847](http://127.0.0.1:3847)

Current checkpoint:

- `dbd0a63` `Fix rollback effective state reporting`

## Proof Artifacts

Primary proof artifacts live under:

- `C:\sf-factory-projects\alpha-e2e-smoke-1\proofs\`
- `C:\sf-factory-projects\alpha-e2e-smoke-1\state\`
- `C:\sf-factory-projects\alpha-e2e-smoke-1\wordpress\wp-content\uploads\crocoblock-site-factory\runs\`

Start with:

- [start-here.md](start-here.md)
- [release-checklist.md](release-checklist.md)
- [evaluator-script.md](evaluator-script.md)
- [alpha-v0.1-release-notes.md](alpha-v0.1-release-notes.md)
- [live-ai-safe-apply-demo-script.md](live-ai-safe-apply-demo-script.md)
- [live-ai-safe-apply-proof-pack.md](live-ai-safe-apply-proof-pack.md)
- [demo-script.md](demo-script.md)
- [proof-pack.md](proof-pack.md)
- [known-limitations.md](known-limitations.md)
- [next-steps.md](next-steps.md)
- [../architecture/project-operation-coordinator.md](../architecture/project-operation-coordinator.md)

## How To Read This Folder

1. Read [release-checklist.md](release-checklist.md) for the release gate and pass/fail checklist.
2. Read [start-here.md](start-here.md) for the quickest local preflight + Launcher start path.
3. Read [evaluator-script.md](evaluator-script.md) for the final read-only evaluator walkthrough.
4. Read [alpha-v0.1-release-notes.md](alpha-v0.1-release-notes.md) for the alpha release summary and scope.
5. Read [live-ai-safe-apply-proof-pack.md](live-ai-safe-apply-proof-pack.md) for the current proof chain and reviewer notes.
6. Read [proof-pack.md](proof-pack.md) for the earlier alpha baseline artifacts.
7. Read [known-limitations.md](known-limitations.md) to understand what is still intentionally incomplete.
8. Read [next-steps.md](next-steps.md) for the recommended sequence after this alpha.
9. Read [project-operation-coordinator.md](../architecture/project-operation-coordinator.md) for the project-wide mutation lock and idempotency model.

## One-command Read-only Smoke

You can now run a read-only alpha smoke for any Launcher project:

```powershell
node launcher/src/cli.js alpha-smoke --slug alpha-v01-fresh-smoke-1
node launcher/src/cli.js alpha-smoke --slug alpha-e2e-smoke-1 --require full-alpha
```

Requirement modes:

- `generated-site`:
  pass when the generated site is healthy and secrets hygiene is clean
- `full-alpha`:
  pass only when the project also has the live AI safe-apply and rollback proof chain

This means a fresh generated-only project can pass `generated-site` smoke while still remaining partial for `full-alpha`.

## Convenience Scripts

These wrappers keep the evaluator path easy to remember:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\factory-preflight.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\start-launcher.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\alpha-smoke.ps1 -Slug alpha-v01-fresh-smoke-1
```

They are packaging helpers only. They do not run live AI, apply, rollback, generate, or dependency install.
