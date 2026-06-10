# External Beta Install Guide — Crocoblock Site Factory

## Purpose

This guide explains how to install and test the current Crocoblock Site Factory beta package.

The current beta focuses on one supported vertical:

```text
Real Estate
```

This is not a finished consumer-grade AI website builder yet. It is an installable WordPress plugin beta that demonstrates deterministic Real Estate site generation, safe AI-ready flow, validation, proof, and managed generated content.

## Current package checkpoint

```text
Repository: the project repository
Branch: main
Current docs checkpoint: 011492f
ZIP source checkpoint: ad47c6f
Package: crocoblock-site-factory-v0.2-beta-system-ad47c6f.zip
```

Use the provided beta ZIP package from the release or from the project maintainer.

Confirmed package output:

```text
Source tree: wordpress-plugin/
Archive root: crocoblock-site-factory/
Commit: ad47c6f
Size: 19.93 MB
```

## Installation modes

There are two different test modes.

### 1. ZIP install smoke

Use this mode to confirm that the plugin installs and activates in a clean WordPress site.

This mode does not require Kava or JetEngine.

It verifies:

* WordPress can install the ZIP.
* The plugin activates successfully.
* Site Factory admin menu appears.
* REST routes are registered.
* The frontend remains reachable.

### 2. Full Real Estate generation demo

Use this mode to test the actual Real Estate generation flow.

This mode requires:

* WordPress
* Kava theme
* JetEngine
* Crocoblock Site Factory
* Optional: JetSmartFilters
* Optional: JetFormBuilder

The prepared local runtime for full demo testing is:

```text
your prepared full Real Estate demo WordPress site
```

The clean ZIP smoke runtime is:

```text
your clean WordPress install smoke site
```

## Clean ZIP install smoke

### Step 1 — Create clean WordPress runtime

Create a clean Docker runtime, for example:

```text
your clean WordPress install smoke site
```

The runtime should expose WordPress at:

```text
your clean install smoke site URL
```

### Step 2 — Install WordPress

Example credentials:

```text
Username: admin
Password: admin
Email: admin@example.test
```

### Step 3 — Install plugin ZIP

Install the package:

```powershell
wp plugin install /build/crocoblock-site-factory-v0.2-beta-system-ad47c6f.zip --activate
```

Expected result:

```text
Plugin installed successfully.
Plugin 'crocoblock-site-factory' activated.
```

### Step 4 — Confirm plugin is active

Expected plugin list entry:

```text
crocoblock-site-factory | active | 0.1.0-beta
```

### Step 5 — Confirm live AI stub route

Expected route:

```text
/factory/v1/ai/interpret-live
```

Expected response meaning:

```text
status=disabled
code=live_ai_not_implemented
applies_changes=false
provider_called=false
```

This confirms the live AI endpoint boundary exists but does not call any provider yet.

### Step 6 — Confirm frontend is reachable

Expected:

```text
your clean install smoke site URL
StatusCode: 200
```

## Full Real Estate demo requirements

For the full generation demo, the site must have:

### Required

* WordPress
* Kava theme active
* JetEngine active
* Crocoblock Site Factory active

### Optional

* JetSmartFilters
* JetFormBuilder

If optional plugins are missing, the beta should use safe fallbacks where available.

## Full Real Estate demo flow

Open:

```text
/wp-admin/admin.php?page=factory-control-panel
```

Then follow the guided wizard:

1. Choose Site Type
2. Requirements
3. Describe Business
4. Business Info
5. Style & Colors
6. Images
7. Preview Plan
8. Generate / Proof

## Expected generated site

The Real Estate beta should generate:

* Home page
* Properties catalog
* Contact page
* property CPT
* 30 demo properties
* image pools
* featured images
* single property pages
* property cards
* gallery/lightbox
* catalog filters or fallback
* Request Viewing / Contact Agency flow
* validation proof
* Doctor OK state

## Safe AI status

Current AI behavior is safe and preparatory.

Available now:

* local/mock prompt interpretation
* safe variables only
* local token estimate
* future live AI confirmation UI
* disabled live AI stub endpoint

Not implemented yet:

* real OpenAI provider call
* actual token usage capture
* live provider usage log
* AI image generation
* arbitrary blueprint generation
* AI-generated HTML/CSS
* auto-apply

## Editing model

Current beta editing model:

### Safe to edit

* property posts
* property title/content
* property meta
* property terms
* featured images
* safe setup fields in Site Factory

### Not the normal editing path

* raw generated Home page markup
* raw generated Contact page markup
* generated catalog/filter layout
* generated shortcodes

Recommended user-facing wording:

```text
Generated pages use managed layout markup. Edit site copy in Site Factory setup fields. Property content can be edited in WordPress.
```

## What to show in an external beta demo

Show:

* guided dashboard flow
* Real Estate vertical
* local AI usage estimate
* safe AI confirmation state
* Preview Plan
* Generate / Proof
* Home page
* Properties catalog
* single property page
* Manage Properties
* Doctor OK
* Developer Proof only for technical users

Do not over-focus on:

* raw JSON
* adapters
* internal manifests
* full validation check list
* legacy AI commands

## What not to promise

Do not promise:

* full visual editing
* arbitrary design generation
* arbitrary AI-generated layouts
* AI-generated images
* production SaaS deployment
* central multi-site control panel
* multi-vertical generation
* automatic live OpenAI generation
* exact billing/cost enforcement

## Current known limitations

* Real Estate is the only active beta vertical.
* Full visual editing is not implemented yet.
* Home and Contact are managed generated pages.
* Live OpenAI provider service is not implemented yet.
* The live AI endpoint is intentionally disabled.
* Design profiles are still limited.
* External tester documentation is still early.
* Full generation requires a prepared WordPress/Crocoblock environment.

## Recommended next steps

1. Implement OpenAI Safe Provider Service v1.
2. Keep provider output restricted to `safe_variables_only`.
3. Do not allow AI output to bypass safe variables.
4. Wire dashboard live confirmation to `/ai/interpret-live`.
5. Capture provider usage metadata.
6. Run full AI-assisted Real Estate demo smoke.
7. Improve user-facing proof summary.
8. Add design profiles after the live AI flow is stable.

## Result expectation

A successful external beta install/demo should prove:

```text
The plugin can be installed as a normal WordPress ZIP.
The Real Estate beta can generate a structured Crocoblock/WordPress site.
AI is handled through safe suggestions, not uncontrolled mutation.
The generated site can be opened, validated, and managed.
```
