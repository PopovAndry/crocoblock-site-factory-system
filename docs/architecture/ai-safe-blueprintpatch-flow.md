# AI-safe BlueprintPatch Flow

## Purpose

This document defines the future AI-safe flow for Crocoblock Site Factory.

The goal is to let AI help users create and modify sites without allowing AI to directly mutate WordPress, execute adapters, or apply arbitrary full blueprints.

AI must propose changes.

Core must validate and preview them.

The plugin must dry-run, ask for confirmation, apply, validate, and store proof.

## Product pipeline

Prompt / user input
→ PromptInterpretation
→ BlueprintPatch or BlueprintCandidate
→ Core normalization
→ Core validation
→ Core Preview Plan
→ Plugin Dry-run
→ Ownership check
→ User confirmation
→ Plugin Apply
→ Runtime Validation
→ Manifest / Proof
→ Doctor / Fix if needed

## Main rule

AI must never directly apply changes.

AI output is always a proposal until it passes:

1. Core validation.
2. Core preview.
3. Plugin dry-run.
4. Ownership safety checks.
5. User confirmation.

## Why this is needed

The old R&D AI flow had useful ideas, but unsafe product boundaries.

Useful ideas:

* prompt cleanup;
* preset detection;
* JSON extraction;
* response parsing;
* caching concepts;
* last response debugging;
* local/mock interpretation;
* product profile defaults.

Unsafe ideas:

* AI generating arbitrary full blueprints;
* AI merging arbitrary sections into existing blueprints;
* AI output moving too close to runtime apply;
* raw AI response logging without redaction policy;
* outdated schema assumptions;
* direct AI-to-apply path.

The new flow must reuse safe concepts, not copy unsafe behavior.

## Responsibility split

### AI may do

* interpret user intent;
* detect business vertical;
* suggest preset;
* propose safe variables;
* propose BlueprintPatch operations;
* propose DesignProfile selection;
* propose content tone;
* propose image context;
* explain intent in human language.

### AI must not do

* call WordPress functions;
* execute adapters;
* write files;
* mutate database state;
* call plugin apply;
* bypass dry-run;
* bypass ownership checks;
* generate arbitrary PHP;
* generate arbitrary JavaScript;
* generate arbitrary CSS;
* generate unsupported blueprint sections.

### Core owns

* PromptInterpretation contracts;
* BlueprintPatch validation;
* BlueprintCandidate validation;
* Core normalization;
* Core Preview Plan;
* AI-safe schema rules;
* rejection of unsafe patch operations.

### Plugin owns

* runtime dry-run;
* WordPress/Crocoblock apply;
* runtime validation;
* ownership checks;
* manifest/proof storage;
* dashboard confirmation;
* REST permissions and nonces.

## Preferred MVP flow

The first AI MVP should generate `BlueprintPatch`, not full blueprints.

Recommended flow:

```text
User prompt:
"Make the real estate site more premium and change agency name to Prime Kyiv Realty"

AI interpretation:
- intent: modify existing Real Estate site
- target: site identity and design
- safe variables:
  - site.name = Prime Kyiv Realty
  - design.profile = premium_agency

BlueprintPatch proposal:
- replace /site/name
- replace /design/profile
- replace /design/components/hero
- replace /design/components/property_card
```

Then:

```text
Core validates patch
→ Core applies patch in memory
→ Core builds preview plan
→ Plugin dry-run shows runtime changes
→ User confirms
→ Plugin applies later
```

## PromptInterpretation shape

Suggested future shape:

```json
{
  "version": 1,
  "status": "proposal",
  "intent": "modify_site",
  "vertical": "real_estate",
  "confidence": 0.82,
  "summary": "User wants a more premium real estate agency site.",
  "safe_variables": {
    "site_name": "Prime Kyiv Realty",
    "design_profile": "premium_agency"
  },
  "warnings": [],
  "requires_user_review": true
}
```

## BlueprintPatch proposal shape

Suggested shape:

```json
{
  "version": 1,
  "status": "proposal",
  "source": "ai",
  "operations": [
    {
      "op": "replace",
      "path": "/site/name",
      "value": "Prime Kyiv Realty"
    },
    {
      "op": "replace",
      "path": "/design/profile",
      "value": "premium_agency"
    }
  ]
}
```

## Allowed patch operations

Initial AI-safe operations:

* `set`
* `replace`
* `add`

Rejected operations:

* `delete`
* `remove`
* `direct_apply`
* `wordpress_mutation`
* `php_code`
* `callback`
* `sql`
* `shell`
* arbitrary runtime mutations

## Full BlueprintCandidate

AI may later propose a full `BlueprintCandidate`, but it must remain a review artifact.

It must not become an apply input until:

1. Core normalizes it.
2. Core validates it.
3. Core converts differences into a safe BlueprintPatch or safe plan.
4. Plugin dry-run confirms runtime feasibility.
5. User confirms.

## Design safety

AI may choose from controlled design profiles.

AI may not generate arbitrary CSS.

Allowed:

```json
{
  "design": {
    "profile": "premium_agency",
    "palette": "dark_gold",
    "components": {
      "hero": "premium_split",
      "property_card": "overlay_price"
    }
  }
}
```

Not allowed:

```json
{
  "raw_css": ".site * { position:absolute !important; }",
  "custom_js": "fetch('/wp-admin/...')"
}
```

## Ownership safety

Before apply, plugin dry-run must report whether affected runtime entities are safe to update.

Potential ownership states:

* `factory_managed`
* `in_sync`
* `user_modified`
* `locked`
* `requires_confirmation`
* `skip_runtime_apply`
* `unknown`

If an entity is user-modified, locked, or unknown, the AI change must remain a proposal unless the user explicitly confirms a safe override.

## REST boundary

AI endpoints may interpret prompts and produce proposals.

AI endpoints must not apply.

Allowed future endpoint categories:

```text
/factory/v1/ai/interpret-prompt
/factory/v1/core/preview
/factory/v1/beta/real-estate/core-preview
```

Apply must remain a separate explicit runtime endpoint with confirmation.

## Dashboard UX

The dashboard should show AI output as proposal, not action.

Suggested labels:

```text
AI understood:
"Make the site more premium and rename the agency."

Proposed changes:
~ Site name: Kyiv Turquoise Realty → Prime Kyiv Realty
~ Design profile: Minimal Urban → Premium Agency
~ Hero layout: Search First → Premium Split

Nothing is applied yet.
```

Then:

```text
Runtime dry-run:
~ update Home page sections
~ update archive style tokens
~ update property card template

Requires confirmation.
```

## Logging and privacy

AI logs must be safe.

Do not log:

* raw secrets;
* API keys;
* full provider auth payloads;
* sensitive user data;
* unredacted raw provider errors if they may contain secrets.

Allowed:

* sanitized prompt summary;
* provider name;
* request status;
* token estimate;
* generated patch after validation;
* validation errors;
* redacted response excerpt for debugging.

## What not to do

Do not:

* copy the old AI generator directly;
* let AI generate full blueprint and immediately apply it;
* let AI bypass Core validation;
* let AI bypass plugin dry-run;
* let AI bypass ownership checks;
* let AI generate arbitrary frontend code;
* expand `rest.php` with provider-specific AI logic;
* call providers from runtime apply flow.

## First implementation scope

Recommended v1 scope:

1. Keep deterministic Real Estate generation unchanged.
2. Add AI-safe contracts and fixtures first.
3. Use local/mock prompt interpreter before provider calls.
4. Generate simple BlueprintPatch proposals only.
5. Preview changes read-only.
6. Show plugin dry-run read-only.
7. Apply only later after explicit confirmation.

## Final rule

AI proposes.

Core validates and previews.

Plugin dry-runs, applies, validates, and stores proof.

User confirms.
