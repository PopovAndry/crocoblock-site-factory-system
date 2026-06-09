# External Beta Tester Checklist — Crocoblock Site Factory

## Purpose

Use this checklist to test the current Crocoblock Site Factory beta package.

The current beta focuses on one active vertical:

```text
Real Estate
```

This checklist is for early technical testers. It is intended to verify installation, dashboard flow, generated site behavior, safe AI boundaries, and known limitations.

## Current beta status

Expected current state:

```text
Plugin installs as a normal WordPress ZIP.
Real Estate is the only active beta vertical.
AI live provider is not implemented yet.
AI suggestions are safe/local unless explicitly changed later.
Generated pages use managed layout markup.
Property content can be edited in WordPress.
```

## Test environments

### ZIP install smoke environment

Use this environment to verify plugin installation and activation:

```text
C:\sf-zip-smoke
http://localhost:8099
```

Expected:

* WordPress installs successfully.
* Plugin ZIP installs successfully.
* Plugin activates successfully.
* Site Factory admin menu appears.
* Frontend returns HTTP 200.
* `/factory/v1/ai/interpret-live` route exists and returns disabled/safe response.

### Full Real Estate demo environment

Use this environment to test generation:

```text
C:\sf-playable-beta
http://localhost:8098
```

Expected required dependencies:

* WordPress
* Kava theme
* JetEngine
* Crocoblock Site Factory

Optional:

* JetSmartFilters
* JetFormBuilder

## 1. Plugin installation checklist

PASS if:

* ZIP installs without fatal error.
* Plugin activates.
* Plugin appears as active:

```text
crocoblock-site-factory | active
```

* WordPress admin remains accessible.
* Frontend returns HTTP 200.
* No PHP fatal error appears after activation.

FAIL if:

* ZIP cannot be installed.
* Plugin cannot be activated.
* Admin crashes after activation.
* Frontend crashes after activation.

## 2. REST route checklist

Check:

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

PASS if:

* Route exists.
* Response HTTP status is 200.
* `applies_changes=false`.
* `provider_called=false`.

FAIL if:

* Route is missing.
* Route returns fatal error.
* Route calls a provider.
* Route applies changes.
* Route requires unexpected setup in clean ZIP smoke.

## 3. Dashboard checklist

Open:

```text
/wp-admin/admin.php?page=factory-control-panel
```

PASS if the dashboard shows:

* Generation Wizard
* Real Estate Beta Demo
* Choose Site Type
* Requirements
* Describe Business
* Business Info
* Style & Colors
* Images
* Preview Plan
* Generate / Proof

PASS if:

* Real Estate is the active available vertical.
* Other verticals are shown as future/coming soon or disabled.
* Dashboard stays usable and not overloaded.
* Advanced/developer proof is not forced into the normal user flow.

FAIL if:

* Dashboard does not load.
* Main wizard steps are missing.
* User-facing flow is confusing or blocked before Preview.
* Technical proof dominates the normal dashboard.

## 4. AI-safe prompt checklist

In the Describe Business step, enter a prompt such as:

```text
Create a premium real estate website for an agency in London
```

Expected:

* Estimated AI usage appears.
* It says local estimate only.
* It says no provider call.
* It says no token spend.
* Current AI mode is local safe suggestions.
* Future live AI confirmation exists but live provider is not implemented.

PASS if:

* Analyze Prompt works.
* Suggestions are shown safely.
* Suggestions do not change the site automatically.
* Applying suggestions only updates dashboard fields.
* Preview becomes stale after applying suggestions.

FAIL if:

* AI call happens without confirmation.
* OpenAI/provider is called unexpectedly.
* Suggestions auto-generate the site.
* Suggestions write directly to WordPress.
* Arbitrary HTML/CSS appears as AI output.

## 5. Safe variables checklist

Check that safe editable fields exist for:

* agency name
* hero title
* hero subtitle
* hero CTA text
* contact title
* contact intro
* phone
* email

PASS if:

* Fields can be edited in dashboard.
* Preview reflects safe field changes.
* Generate uses the deterministic pipeline.
* No raw page HTML editing is presented as the normal user path.

FAIL if:

* User is sent to edit Home/Contact as raw HTML as the main editing path.
* Unsupported fields are presented as editable.
* Property schema/filter/schema changes are exposed as casual safe variables.

## 6. Preview Plan checklist

Click Preview Plan.

PASS if:

* Human-readable plan appears.
* Prompt context is captured.
* Safe variables are shown or summarized.
* Image/source context is shown.
* Safety/guardrail message is clear.
* Generate remains separate from Preview.

FAIL if:

* Preview applies changes.
* Preview is too technical for normal users.
* Preview hides important limitations.
* Generate can happen without a clear review step.

## 7. Generate / Proof checklist

In the prepared full demo runtime only, run Generate.

PASS if:

* Generation completes.
* Dashboard shows site ready state.
* Validation passes.
* Doctor reports OK.
* Normal result area includes:

  * Open Home
  * Open Properties
  * Open Contact
  * Manage Properties
  * Edit site copy in setup
* Developer proof remains accessible but not dominant.

FAIL if:

* Generation duplicates content unexpectedly.
* Dashboard does not show clear next actions.
* Doctor fails without a clear reason.
* Normal user is forced to parse raw validation lists.

## 8. Frontend checklist

Open Home.

PASS if:

* Hero appears.
* Real Estate copy appears.
* CTA appears.
* Latest Properties section appears.
* Layout looks presentable.

Open Properties catalog.

PASS if:

* Catalog page loads.
* Property cards appear.
* Images appear.
* Filters or fallback catalog behavior works.

Open single property page.

PASS if:

* Property title appears.
* Price/details appear.
* Gallery appears.
* Gallery lightbox opens on image click.
* Next/previous/close controls work.
* Request Viewing / Contact Agency CTA appears.

FAIL if:

* Home is visually broken.
* Catalog is empty.
* Single property crashes.
* Images are missing.
* Lightbox controls are unusable.

## 9. Editing checklist

Expected editing model:

```text
Generated pages use managed layout markup.
Edit site copy in Site Factory setup fields.
Property content can be edited in WordPress.
```

PASS if tester can edit:

* property title
* property content
* property meta
* property terms
* featured image
* safe dashboard copy fields

Known limitation:

* Home/Contact visual editing is not implemented yet.
* Raw generated page markup is not the normal editing path.

FAIL if:

* Dashboard promises full visual editing.
* Review/Edit links imply normal users should edit raw generated HTML.
* Manual editing expectations are unclear.

## 10. Safety checklist

PASS if:

* OpenAI is not called in current beta unless explicitly implemented later.
* `/ai/interpret-live` returns disabled status.
* No provider call happens from local prompt analysis.
* No API key is used in the disabled live endpoint.
* No WordPress mutation happens from AI suggestion UI alone.
* Generate remains a separate deterministic action.

FAIL if:

* AI suggestions directly mutate WordPress.
* AI output bypasses safe variables.
* Legacy AI blueprint generator is used from dashboard.
* Provider response is written into normal proof files.

## 11. Known limitations

These are known and should not be reported as blockers unless behavior is worse than described:

* Only Real Estate vertical is active.
* Live OpenAI provider is not implemented yet.
* Full visual page editing is not implemented yet.
* AI image generation is not implemented.
* Uploaded image flows are not implemented.
* Home and Contact pages are managed generated markup.
* Design profiles are limited.
* Clean ZIP smoke runtime does not include Kava/JetEngine for full generation.

## 12. Tester report format

When reporting results, include:

```text
Environment:
Commit/package:
Browser:
WordPress version:
PHP version:
Plugin version:
Test mode: ZIP smoke / Full Real Estate demo

PASS:
FAIL:
Screenshots:
Console errors:
PHP errors:
Unexpected behavior:
Suggestions:
```

## 13. Final pass criteria

External beta smoke is considered PASS when:

* ZIP installs and activates.
* Dashboard opens.
* AI live stub is safe and disabled.
* Full demo runtime can generate Real Estate site.
* Home/Properties/Contact open.
* At least one single property page works.
* Properties can be managed in WordPress.
* Doctor/validation proof is OK.
* Known limitations are documented clearly.

## 14. Product direction reminder

Crocoblock Site Factory should remain:

```text
AI-assisted deterministic WordPress/Crocoblock site generation
```

Core principle:

```text
AI suggests.
User confirms.
Factory generates.
Doctor validates.
Proof explains.
```
