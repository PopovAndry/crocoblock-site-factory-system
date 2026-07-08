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

This alpha does **not** prove:

- live AI provider calls
- production readiness
- full rollback of a WordPress site or database
- field-scoped apply
- overwrite confirmation UX
- full drift detection
- multi-vertical generation
- Elementor or WooCommerce generation

Use honest names when presenting this alpha:

- `Terraform-like alpha`
- `local deterministic prompt personalization`
- `State Apply rollback v1`

Do not describe it as a full AI website generator or a production-ready system.

## Proven Project

The current alpha demo was proven on:

- Project root: `C:\sf-factory-projects\alpha-e2e-smoke-1`
- WordPress URL: [http://127.0.0.1:8134](http://127.0.0.1:8134)
- Launcher URL: [http://127.0.0.1:3847](http://127.0.0.1:3847)

Current checkpoint:

- `4a882be` `Ensure generated hero title has safe edit marker`

## Proof Artifacts

Primary proof artifacts live under:

- `C:\sf-factory-projects\alpha-e2e-smoke-1\proofs\`
- `C:\sf-factory-projects\alpha-e2e-smoke-1\state\`
- `C:\sf-factory-projects\alpha-e2e-smoke-1\wordpress\wp-content\uploads\crocoblock-site-factory\runs\`

Start with:

- [demo-script.md](demo-script.md)
- [proof-pack.md](proof-pack.md)
- [known-limitations.md](known-limitations.md)
- [next-steps.md](next-steps.md)

## How To Read This Folder

1. Read [demo-script.md](demo-script.md) for the human walkthrough.
2. Read [proof-pack.md](proof-pack.md) for exact artifacts and expected values.
3. Read [known-limitations.md](known-limitations.md) to understand what is still intentionally incomplete.
4. Read [next-steps.md](next-steps.md) for the recommended sequence after this alpha.
