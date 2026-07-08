# Alpha Demo Script

This script walks through the already-proven alpha flow. It does not require new generation or new runtime mutation.

## A. Start Launcher

Command:

```powershell
node launcher/src/cli.js start --port 3847
```

Open:

- [http://127.0.0.1:3847](http://127.0.0.1:3847)

## B. Show Generated Alpha Project

Project:

- `alpha-e2e-smoke-1`

Explain that this project is the proven disposable alpha runtime, not a shared environment.

## C. Open Generated Site

Open:

- [http://127.0.0.1:8134](http://127.0.0.1:8134)

Expected:

- the site visibly uses `Alpha Prime Realty`
- generated `Home`, `Properties`, and `Contact` pages work
- Real Estate content exists

Direct page links:

- Home: [http://127.0.0.1:8134/](http://127.0.0.1:8134/)
- Properties: [http://127.0.0.1:8134/properties/](http://127.0.0.1:8134/properties/)
- Contact: [http://127.0.0.1:8134/contact/](http://127.0.0.1:8134/contact/)

## D. Show Prompt-Personalized Generate Proof

Use:

- [generate-2026-07-08T17-57-53-496Z-31550f.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/generate-2026-07-08T17-57-53-496Z-31550f.json)

Expected proof values:

- `agency_name = Alpha Prime Realty`
- `city = Kyiv`
- `provider_called = false`
- `source = local_interpreter`
- `pages 2 -> 6`
- `properties 0 -> 30`
- `attachments 0 -> 22`

Call out that this is local deterministic prompt personalization, not live AI.

## E. Frontend Edit Demo

From Launcher, click:

- `Login to Edit`

After logging in as the project WordPress admin, expected:

- WP admin bar visible
- Safe Edit overlay visible
- supported safe fields visible:
  - `hero_title`
  - `hero_subtitle`
  - `hero_cta_text`
  - `agency_name`

Show the already-proven edit:

- `hero_title`
- before: `Alpha Prime Realty - Premium Real Estate in Kyiv`
- after: `Alpha Prime Realty Frontend Edited`

Expected:

- page refresh keeps the edited title
- Agent manifest exists at:
  - [run-20260708-181546.json](C:/sf-factory-projects/alpha-e2e-smoke-1/wordpress/wp-content/uploads/crocoblock-site-factory/runs/run-20260708-181546.json)

## F. Managed State Demo

Command:

```powershell
node launcher/src/cli.js state --slug alpha-e2e-smoke-1 status
```

Expected:

- `user_overrides.hero_title` exists
- `protected = true`
- `overwrite_policy = ask_before_overwrite`

State file:

- [current.json](C:/sf-factory-projects/alpha-e2e-smoke-1/state/current.json)

## G. Conflict Plan Demo

Prompt:

```text
Преміальний сайт нерухомості для Одеси, агентство Odesa Alpha Realty, квартири біля моря
```

Command:

```powershell
node launcher/src/cli.js state --slug alpha-e2e-smoke-1 plan --prompt "Преміальний сайт нерухомості для Одеси, агентство Odesa Alpha Realty, квартири біля моря"
```

Expected:

- `protected_user_override` conflict
- `field_key = hero_title`
- `current user value = Alpha Prime Realty Frontend Edited`
- `proposed value = Odesa Alpha Realty - Premium Real Estate in Odesa`
- `can_apply_without_confirmation = false`

Proof:

- [state-plan-2026-07-08T18-17-22-673Z-cd2ada.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/state-plan-2026-07-08T18-17-22-673Z-cd2ada.json)

## H. Blocked Apply Demo

Command:

```powershell
node launcher/src/cli.js state --slug alpha-e2e-smoke-1 apply --plan latest
```

Expected:

- `status = blocked`
- `code = state_plan_requires_confirmation`
- `no_wp_mutation = true`
- Home still contains `Alpha Prime Realty Frontend Edited`
- Home does not contain `Odesa Alpha Realty`

Proof:

- [state-apply-blocked-2026-07-08T18-17-22-757Z.json](C:/sf-factory-projects/alpha-e2e-smoke-1/proofs/state-apply-blocked-2026-07-08T18-17-22-757Z.json)

## I. Explain Rollback Status

Important:

- `State Apply rollback v1` exists and was previously proven on `personalized-generate-smoke-1`
- in the fresh `alpha-e2e-smoke-1` demo, rollback was skipped because no safe apply happened after the protected `hero_title` override

That is an honest product limitation, not a failed demo.
