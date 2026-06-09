# Codex Prompt — OpenAI Safe Provider Service v1

## Task metadata

Task type: technical implementation prompt
Recommended model: GPT-5.3-Codex
Effort: high

## Repository

```text
C:\crocoblock-site-factory-system
```

## Runtime

```text
C:\sf-playable-beta
```

## Start condition

Start with:

```powershell
git status --short
git branch -vv
git log --oneline -8
```

If the repo is dirty, stop and report. Do not edit anything.

Expected current checkpoint:

```text
main = cd0de0b
origin/main = cd0de0b
working tree clean
```

Recent expected history:

```text
cd0de0b Add external beta tester checklist
aad112c Add external beta install guide
011492f Add external beta demo script
49175cc Document installable ZIP smoke
ad47c6f Add live AI interpretation stub endpoint
3c28a2b Remove duplicate plugin packaging script
d2e0906 Prepare live AI confirmation state
de874a5 Add local AI usage estimate preview
```

## Current architecture

Already implemented:

* Safe Variables v1
* AI-safe local/mock prompt interpretation
* local token estimate preview
* dashboard live AI confirmation state
* disabled `/factory/v1/ai/interpret-live` stub endpoint
* installable ZIP smoke
* external beta docs

Current safe variables:

```text
agency_name
hero_title
hero_subtitle
hero_cta_text
contact_title
contact_intro
phone
email
```

Current live endpoint:

```text
POST /wp-json/factory/v1/ai/interpret-live
```

Current endpoint behavior:

```text
status=disabled
code=live_ai_not_implemented
applies_changes=false
provider_called=false
```

## Goal

Implement OpenAI Safe Provider Service v1.

The live AI endpoint should be able to call OpenAI only for safe copy suggestions.

The flow must remain:

```text
Prompt
→ local estimate
→ explicit dashboard confirmation
→ /ai/interpret-live
→ OpenAI returns JSON
→ strict safe_variables_only validation
→ dashboard displays suggestions
→ user manually applies suggestions
→ Preview Plan
→ deterministic Generate
```

## Hard safety principles

Do not violate these:

* Do not generate full blueprints.
* Do not generate arbitrary HTML.
* Do not generate arbitrary CSS.
* Do not mutate WordPress from AI.
* Do not auto-apply suggestions.
* Do not call `factory_apply_blueprint`.
* Do not modify adapters.
* Do not modify presets.
* Do not modify manifests/proof writers.
* Do not modify ownership/user-edit protection.
* Do not reuse legacy unsafe AI blueprint generator.
* Do not write raw provider response to normal files.
* Do not expose API key to JS.
* Do not store raw prompt by default.
* Do not use AI output before validation.

## Unsafe legacy paths to quarantine

Do not reuse:

```text
Factory_AI_Blueprint_Generator
wp factory ai
wp factory build
wordpress-plugin/includes/ai/blueprint-generator.php
wordpress-plugin/includes/commands/ai.php
```

These legacy paths can call OpenAI, generate/merge/cache blueprints, write raw AI responses, or move toward mutation. They are not allowed for this beta dashboard live AI path.

## Allowed files

Prefer limiting changes to:

```text
wordpress-plugin/includes/api/ai-live-rest.php
wordpress-plugin/includes/ai/settings.php
wordpress-plugin/includes/ai/prompt-interpreter.php
```

If needed, add new files:

```text
wordpress-plugin/includes/ai/live-prompt-service.php
wordpress-plugin/includes/ai/openai-safe-provider.php
```

Optional dashboard wiring only if necessary and minimal:

```text
wordpress-plugin/admin/assets/dashboard.js
wordpress-plugin/admin/assets/dashboard.css
```

## Forbidden files

Do not modify:

```text
wordpress-plugin/includes/adapters/*
wordpress-plugin/presets/*
wordpress-plugin/includes/commands/*
wordpress-plugin/includes/ai/blueprint-generator.php
wordpress-plugin/includes/utils/ownership*
wordpress-plugin/includes/run*
wordpress-plugin/includes/manifest*
wordpress-plugin/includes/registry*
wordpress-plugin/includes/apply*
wordpress-plugin/includes/fix*
wordpress-plugin/includes/doctor*
core/*
```

If you believe any forbidden file must be changed, stop and report instead of editing it.

## Provider service requirements

Add a minimal provider/service layer.

Recommended structure:

```text
wordpress-plugin/includes/ai/openai-safe-provider.php
wordpress-plugin/includes/ai/live-prompt-service.php
```

The service must:

* resolve API key using existing safe settings/key resolver
* never expose the API key to JS
* build strict prompt for safe variables only
* call OpenAI only from the live endpoint path
* request JSON-only output
* parse provider response as JSON
* pass raw provider candidate through existing safe interpretation validator/normalizer
* return only normalized safe contract
* include usage metadata if available
* redact errors
* avoid file writes

## OpenAI request requirements

Use a conservative request.

Provider should be asked to return JSON only.

The system/developer instruction must include:

* mode is `safe_variables_only`
* supported vertical is `real_estate`
* supported preset is `real-estate`
* `applies_changes` must be `false`
* only 8 safe variables are allowed
* unsupported user requests must be listed
* do not output HTML
* do not output CSS
* do not output WordPress operations
* do not output blueprints
* do not output CPT/taxonomy/filter/form/query/listing schema
* do not claim the site was generated
* do not generate property data
* do not generate images

Allowed output contract:

```json
{
  "version": "1.0",
  "mode": "safe_variables_only",
  "applies_changes": false,
  "vertical": "real_estate",
  "recommended_preset": "real-estate",
  "preset_variables": {
    "agency_name": "",
    "hero_title": "",
    "hero_subtitle": "",
    "hero_cta_text": "",
    "contact_title": "",
    "contact_intro": "",
    "phone": "",
    "email": ""
  },
  "unsupported_requests": [],
  "warnings": [],
  "confidence": {
    "overall": 0,
    "fields": {}
  }
}
```

## Validation requirements

Treat provider output as untrusted.

After provider response:

* parse JSON only
* reject or normalize non-object output
* force `version=1.0`
* force `mode=safe_variables_only`
* force `applies_changes=false`
* force `vertical=real_estate`
* force `recommended_preset=real-estate`
* whitelist only the 8 safe variables
* sanitize text fields
* sanitize textarea fields
* sanitize phone
* sanitize email
* invalid email becomes empty
* clamp field lengths
* normalize unsupported requests
* normalize warnings
* normalize confidence
* drop all unknown keys
* return safe contract only

If provider response is invalid or unsafe, return a safe error response and do not apply anything.

## Endpoint behavior

Update:

```text
POST /factory/v1/ai/interpret-live
```

Expected behavior:

### No API key

Return safe response:

```text
status=disabled or error
code=missing_api_key
applies_changes=false
provider_called=false
```

Do not fatal.

### API key exists but live mode disabled

If live mode flag is not implemented, keep disabled behavior.

If you add a minimal internal flag, default it to false.

Do not accidentally enable provider calls by default.

### Live enabled and API key exists

Only then:

* call OpenAI
* validate output
* return safe suggestions
* include usage metadata
* no WordPress mutation

## Usage metadata

Return usage metadata if available:

```json
{
  "usage": {
    "provider_called": true,
    "provider": "openai",
    "model": "...",
    "model_profile": "balanced",
    "input_tokens": 0,
    "output_tokens": 0,
    "total_tokens": 0,
    "cost": null,
    "cost_currency": "USD",
    "cost_is_estimated": true
  }
}
```

If provider returns no usage:

```text
input_tokens=null
output_tokens=null
total_tokens=null
```

Do not invent exact cost.

Do not add billing enforcement in this task.

## Error handling

Handle:

* missing API key
* invalid API key
* timeout
* rate limit
* provider unavailable
* invalid JSON
* unsafe output
* empty safe variables
* usage unavailable

Every error must guarantee:

```text
applies_changes=false
provider_called=true only if provider was actually called
no WordPress mutation
no auto-apply
```

Errors shown to user must be redacted and safe.

## Dashboard wiring

Do not overbuild dashboard in this task.

If implementing dashboard wiring, keep it minimal:

* enable live button only when key exists and live mode is enabled
* require existing confirmation card
* call `/ai/interpret-live` only after confirmation
* display returned suggestions in the same suggestion UI as local/mock
* apply suggestions manually only
* mark Preview stale after applying suggestions
* Generate remains separate

If this becomes too large, stop after backend provider service and endpoint smoke.

## Security requirements

* `manage_options` only
* REST nonce/auth pattern matching existing AI endpoints
* no API key in JS
* no raw provider response in normal dashboard
* no raw provider response in run manifests
* escape all returned strings in dashboard rendering
* prompt is sent to provider only after explicit confirmation
* do not store raw prompt in this task

## Verification

Run from repo root:

```powershell
git status --short
git diff --name-only
```

PHP lint all changed PHP files:

```powershell
C:\OSPanel\modules\php\PHP_8.1\php.exe -l wordpress-plugin\includes\api\ai-live-rest.php
C:\OSPanel\modules\php\PHP_8.1\php.exe -l wordpress-plugin\includes\ai\openai-safe-provider.php
C:\OSPanel\modules\php\PHP_8.1\php.exe -l wordpress-plugin\includes\ai\live-prompt-service.php
```

Only run lint for files that exist/changed.

If JS changed:

```powershell
node --check wordpress-plugin/admin/assets/dashboard.js
```

Core examples:

```powershell
C:\OSPanel\modules\php\PHP_8.1\php.exe core\tools\validate-examples.php
```

Whitespace:

```powershell
git diff --check
git diff --cached --check
```

Forbidden scope check:

```powershell
git diff --name-only | findstr /i "adapters presets blueprint-generator commands manifest registry ownership run-registry run-manifest content-adapter single-adapter render-adapter apply fix doctor"
```

If forbidden files changed, stop and explain.

## Runtime smoke

Sync changed plugin files into:

```text
C:\sf-playable-beta\wp-content\plugins\crocoblock-site-factory
```

Use safe WP-CLI/rest_do_request smoke.

Test cases:

### 1. No API key / disabled mode

Expected:

```text
provider_called=false
applies_changes=false
safe response
no fatal
```

### 2. If API key available and live mode explicitly enabled

Expected:

```text
provider_called=true
applies_changes=false
mode=safe_variables_only
safe variables only
unknown keys dropped
usage metadata present if returned
```

### 3. Runtime safety

Run:

```powershell
cd C:\sf-playable-beta

docker compose run --rm --user root wpcli wp factory doctor --allow-root
docker compose run --rm --user root wpcli wp post list --post_type=property --format=count --allow-root
docker compose run --rm --user root wpcli wp post list --post_type=attachment --format=count --allow-root
```

Expected:

```text
Doctor healthy
Properties remain 30
Attachments remain 22
```

## Return report

Return:

1. Pass/fail summary
2. Files changed
3. Provider service design implemented
4. Endpoint behavior
5. API key handling
6. Provider call behavior
7. Validation/normalization behavior
8. Usage metadata behavior
9. Error handling behavior
10. Confirmation no WordPress mutation occurs
11. Confirmation legacy AI generator was not reused
12. Runtime smoke result
13. Verification results
14. Risks/limitations
15. Final git status
16. Whether safe to commit

## Commit policy

Do not commit.

Return the report first.
