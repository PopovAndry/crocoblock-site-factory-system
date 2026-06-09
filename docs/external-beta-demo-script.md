# External Beta Demo Script — Crocoblock Site Factory

## Purpose

This script is used to demonstrate the current Crocoblock Site Factory beta to a technical reviewer, teammate, or early tester.

The current beta focuses on one supported vertical:

```text
Real Estate
```

The demo should show that Site Factory can generate a structured WordPress/Crocoblock real estate website through a guided dashboard flow, with validation, proof, safe editing expectations, and AI-ready boundaries.

## Current beta checkpoint

Current source checkpoint:

```text
Repository: C:\crocoblock-site-factory-system
Branch: main
Latest documented package checkpoint: ad47c6f / 49175cc
Package: crocoblock-site-factory-v0.2-beta-system-ad47c6f.zip
```

The plugin ZIP was confirmed installable in a clean WordPress runtime.

## Core product message

Crocoblock Site Factory is not a generic AI website builder.

It is an AI-assisted deterministic WordPress/Crocoblock site factory.

Core idea:

```text
Prompt
→ Plan
→ Safe variables
→ Preview
→ Generate
→ Validate
→ Proof
→ Manage
```

AI suggests.
The user confirms.
Factory generates.
Doctor validates.
Proof explains what happened.

## What this beta can show

The current Real Estate beta can demonstrate:

* guided dashboard flow
* Real Estate vertical selection
* requirements visibility
* safe business/preset variables
* prompt capture
* local AI-safe prompt interpretation
* local AI usage estimate
* future live AI confirmation state
* deterministic Real Estate generation
* generated Home page
* generated Properties catalog
* generated Contact page
* generated single property pages
* property images and gallery/lightbox
* catalog filters
* Request Viewing / Contact Agency flow
* Manage Properties in WordPress
* validation proof
* Doctor OK
* developer proof under Advanced

## What this beta should not promise yet

Do not promise:

* full visual page editing
* arbitrary layout generation
* arbitrary AI-generated HTML/CSS
* AI image generation
* AI-generated property data
* multi-vertical generation
* hosted SaaS deployment
* central multi-site management
* automatic live OpenAI generation
* billing enforcement
* full Elementor/Divi-style editing

The current AI mode is safe/local/preparatory unless live provider integration is explicitly implemented later.

## Demo prerequisites

For a full Real Estate generation demo, use the prepared playable runtime:

```text
C:\sf-playable-beta
```

Required active components:

* WordPress
* Kava theme
* JetEngine
* Crocoblock Site Factory plugin

Optional components:

* JetSmartFilters
* JetFormBuilder

The clean ZIP smoke runtime at:

```text
C:\sf-zip-smoke
```

is useful for install/activation smoke only. It does not include the full Real Estate generation dependencies.

## Demo flow

### 1. Open Site Factory dashboard

Open:

```text
http://localhost:8098/wp-admin/admin.php?page=factory-control-panel
```

Explain:

Site Factory guides the user through a controlled generation flow instead of applying AI changes directly.

### 2. Show site status

Point out:

* Site generated
* Validation OK
* Doctor OK

Explain:

The system is not only generating pages, it also validates the generated runtime state.

### 3. Step 1 — Choose Site Type

Show:

```text
Real Estate
```

Explain:

Real Estate is the active beta vertical. Other verticals are intentionally marked as future/coming soon.

### 4. Step 2 — Requirements

Show the requirements area.

Explain:

The system is dependency-aware. It expects the correct WordPress/Crocoblock environment before generation.

### 5. Step 3 — Describe Business

Show the prompt field.

Example prompt:

```text
Create a premium real estate website for an agency in London
```

Show:

* Estimated AI usage
* Local estimate only
* No provider call
* No token spend
* Current AI mode: Local safe suggestions
* Future live AI confirmation

Explain:

The product is designed so the user can see token/cost expectations before future live AI calls. No hidden token spend should happen.

### 6. Analyze Prompt

Click:

```text
Analyze Prompt
```

Show that suggestions are produced locally/safely.

Explain:

AI suggestions do not modify the site automatically. They only propose safe variables and unsupported requests.

### 7. Apply safe suggestions

If useful, apply safe copy suggestions.

Explain:

Applying suggestions only updates dashboard state. It does not generate the site yet.

### 8. Business Info / Safe Variables

Show editable safe fields, such as:

* agency name
* hero title
* hero subtitle
* hero CTA
* contact title
* contact intro
* phone
* email

Explain:

Generated pages use managed layout markup. Site copy should be changed through Site Factory setup fields, not by editing raw HTML in the WordPress page editor.

### 9. Style and Images

Show:

* style/colors
* bundled demo image pools
* Kyiv hero image
* apartment/house/commercial pools

Explain:

The current beta uses deterministic bundled assets. AI image generation and upload flows are future scope.

### 10. Preview Plan

Click:

```text
Preview Plan
```

Explain:

The preview step is a human-readable safety gate before generation. It should describe what will be created and what is protected.

### 11. Generate / Proof

Click Generate only in the prepared runtime if the system is ready.

After generation, show:

* Your site is ready
* Open Home
* Open Properties
* Open Contact
* Manage Properties
* Edit site copy in setup
* Show developer proof

Explain:

The normal dashboard focuses on user-friendly actions. Technical proof is available under Advanced.

### 12. Open Home

Open the generated Home page.

Show:

* Kyiv hero
* clear real estate headline
* CTA
* Latest Properties section

Explain:

This is generated from the deterministic Real Estate preset and safe variables.

### 13. Open Properties catalog

Open:

```text
/properties/
```

Show:

* property cards
* images
* filters
* catalog layout

Explain:

The catalog is system-managed and query-driven.

### 14. Open single property

Open a sample property.

Show:

* property title
* price/details
* gallery
* clickable lightbox
* Request Viewing / Contact Agency

Explain:

Properties are real WordPress CPT items and can be managed through the Properties admin section.

### 15. Manage Properties

Open WordPress admin Properties.

Explain:

Property content is the main user-editable content area in the current beta.

The user can edit:

* title
* content
* meta
* terms
* featured image

### 16. Explain editing model

Use this wording:

Generated pages use managed layout markup. Site copy should be edited in Site Factory setup fields. Property content can be edited in WordPress.

Do not present Home/Contact page editor as the normal editing path.

### 17. Show Developer Proof

Open developer proof only if the audience is technical.

Show:

* validation summary
* latest run
* proof details
* runtime evidence if relevant

Explain:

Proof is available for trust and debugging, but normal users should not need to read raw technical details.

## Live AI status

Current live AI state:

* `/factory/v1/ai/interpret-live` endpoint exists
* it returns disabled status
* no provider call is made
* no API key is used
* no site changes are applied

Current response meaning:

```text
status=disabled
code=live_ai_not_implemented
applies_changes=false
provider_called=false
```

This confirms that the live AI boundary exists but is safely disabled until the real OpenAI Safe Provider Service is implemented.

## Suggested demo message

Use this short product explanation:

```text
Crocoblock Site Factory turns a vertical-specific blueprint into a real WordPress/Crocoblock site. AI is used only as a controlled assistant: it suggests safe variables, shows estimated usage, and waits for confirmation. The deterministic Factory pipeline applies, validates, and proves the result.
```

## Current strengths

* real installable WordPress plugin ZIP
* deterministic Real Estate generation
* structured CPT/content generation
* validation/doctor/proof loop
* safe variables
* AI-safe contract foundation
* token estimate and confirmation UX
* no hidden provider calls
* managed editing expectations
* proof-oriented developer trust

## Current limitations

* only Real Estate vertical is active
* live OpenAI provider service is not implemented yet
* no full visual editor
* Home/Contact are managed generated markup
* AI image generation is not implemented
* uploaded image flows are not implemented
* no central multi-site admin yet
* no external usage/billing dashboard yet

## Recommended next product steps

1. Implement OpenAI Safe Provider Service v1.
2. Keep provider output restricted to `safe_variables_only`.
3. Do not reuse legacy AI blueprint generator paths.
4. Wire dashboard live confirmation to `/ai/interpret-live`.
5. Capture actual provider usage metadata.
6. Run AI-assisted Real Estate demo smoke.
7. Prepare clean external beta install guide.
8. Add 3–5 design profiles after live AI flow is stable.

## Demo conclusion

The current beta is suitable for a technical demo of the core concept:

```text
AI-assisted deterministic WordPress/Crocoblock site generation with proof and safe regeneration boundaries.
```

It is not yet a finished consumer-grade AI website builder, but it is a strong foundation for a focused Real Estate beta.
