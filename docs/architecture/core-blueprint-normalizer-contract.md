# Core Blueprint Normalizer Contract

## Purpose

This document defines the future Core Blueprint Normalizer.

The goal is to normalize blueprint documents in pure Core code before they reach the WordPress plugin runtime.

The normalizer must be WordPress-agnostic.

It must not call WordPress functions, Crocoblock APIs, adapters, REST endpoints, or plugin runtime helpers.

## Product context

Crocoblock Site Factory is a blueprint-first WordPress/Crocoblock site generation system.

The target pipeline is:

Prompt / user input
→ BlueprintPatch or BlueprintCandidate
→ Core normalization
→ Core validation
→ Core Preview Plan
→ Plugin Dry-run
→ User confirmation
→ Plugin Apply
→ Runtime Validation
→ Manifest / Proof

## Why a Core normalizer is needed

The old R&D and current plugin normalizers are useful as reference, but they are not suitable as canonical Core logic.

Known limitations of the old/plugin normalizer:

* It uses WordPress sanitizers such as `sanitize_key()` and `sanitize_title()`.
* It is old-section oriented.
* It does not fully understand newer blueprint sections.
* It belongs to plugin/runtime context, not pure Core.
* It should not be copied directly into Core.

Core needs a pure PHP normalizer that understands the current desired-state blueprint shape.

## Responsibility split

### Core normalizer owns

* Canonical blueprint shape.
* Safe defaults.
* Stable array/list normalization.
* Slug/key normalization without WordPress functions.
* Section presence normalization.
* Forward-compatible handling of known and unknown sections.
* Normalization warnings for suspicious but non-fatal input.

### Plugin runtime owns

* WordPress-specific sanitization.
* WordPress object existence checks.
* Crocoblock runtime checks.
* Adapter-specific transformations.
* Apply-time mutation safety.
* Runtime validation.

## Supported v0.2+ blueprint sections

The Core normalizer should support these root sections:

* `version`
* `site`
* `theme`
* `plugins`
* `pages`
* `cpt`
* `taxonomies`
* `terms`
* `content`
* `queries`
* `filters`
* `forms`
* `listings`
* `render`
* `single`
* `design`
* `style`
* `image_context`
* `assets`

Unknown root sections should not hard-fail by default.

They should produce a warning unless a strict mode is enabled.

## Normalization principles

### 1. Pure PHP only

The normalizer must not use:

* `sanitize_key()`
* `sanitize_title()`
* `wp_parse_args()`
* `wp_json_encode()`
* `get_option()`
* `update_option()`
* WordPress filesystem helpers
* Crocoblock APIs

### 2. No runtime mutation

The normalizer must not:

* create posts;
* create pages;
* create taxonomies;
* install plugins;
* call adapters;
* write files;
* update database state.

### 3. Preserve intent

The normalizer should clean structure but not erase meaningful user intent.

For example:

* trim strings;
* normalize empty lists to arrays;
* normalize boolean-like values carefully;
* keep unknown sections with warnings;
* do not silently drop candidate design/profile data.

### 4. Deterministic output

The same input should always produce the same normalized blueprint.

This is important for:

* preview;
* hashing;
* ownership safety;
* run manifests;
* AI patch review.

## Suggested Core API shape

Future class:

```php
Crocoblock\SiteFactory\Core\Blueprint\BlueprintNormalizer
```

Suggested method:

```php
public function normalize(array $blueprint, array $options = []): BlueprintNormalizationResult
```

Suggested result object:

```php
BlueprintNormalizationResult {
    array $blueprint;
    ValidationResult $validation;
    array $warnings;
}
```

The normalizer should return the normalized blueprint and warnings/checks, not throw for ordinary recoverable shape issues.

## Required behavior by section

### `version`

* Ensure version exists.
* Default missing version only in non-strict mode.
* Preserve string or numeric version as canonical string.

### `site`

Normalize known keys:

* `name`
* `language`
* `permalink`
* `style`
* `assets`

Do not validate runtime availability here.

### `theme`

Normalize:

* `slug`
* `path`
* `activate`

Do not check filesystem existence in Core.

### `plugins`

Normalize plugin items to a list.

Known keys:

* `slug`
* `path`
* `activate`

Do not install or activate plugins.

### `cpt`

Normalize CPT definitions to a list.

Known keys:

* `slug`
* `label`
* `singular`
* `supports`
* `meta`

Do not register post types in Core.

### `taxonomies`

Normalize taxonomy definitions to a list.

Known keys:

* `slug`
* `label`
* `object_type`
* `terms`

Do not register taxonomies in Core.

### `terms`

Normalize term declarations.

Terms may exist inside taxonomies or as a separate root section.

The normalizer should support both patterns if current blueprints use both.

### `content`

Normalize content items to a list.

Known keys:

* `type`
* `title`
* `slug`
* `meta`
* `terms`
* `featured_image`
* `content`

Do not create posts in Core.

### `queries`

Normalize Query Builder definitions.

Known keys may include:

* `id`
* `name`
* `type`
* `source`
* `post_type`
* `args`

Do not call JetEngine.

### `filters`

Normalize filter definitions.

Known keys may include:

* `id`
* `name`
* `type`
* `source`
* `query`
* `provider`

Do not call JetSmartFilters.

### `forms`

Normalize form definitions.

Known keys may include:

* `id`
* `name`
* `fields`
* `actions`

Do not call JetFormBuilder.

### `listings`

Normalize listing definitions.

Known keys may include:

* `id`
* `name`
* `post_type`
* `template`
* `query`

Do not create listings in Core.

### `render`

Normalize render/page declarations.

Known keys may include:

* `page`
* `slug`
* `title`
* `template`
* `sections`

Do not create pages in Core.

### `single`

Normalize single template declarations.

Known keys may include:

* `post_type`
* `template`
* `sections`

Do not create templates in Core.

### `design`

Normalize controlled design profiles.

Known keys:

* `profile`
* `palette`
* `typography`
* `spacing`
* `radius`
* `components`

The normalizer should reject or warn on arbitrary CSS/code fields.

### `style`

Normalize style tokens if present.

Known keys may include:

* `primary`
* `accent`
* `background`
* `surface`
* `text`
* `muted`
* `border`
* `button`
* `button_text`
* `link`
* `heading`

### `image_context`

Normalize image generation/source context.

Known keys may include:

* `source`
* `mode`
* `pool`
* `topic`

Do not download or generate images in Core.

### `assets`

Normalize asset declarations.

Do not verify local file paths or import media in Core.

## Strict vs tolerant mode

The normalizer should support two future modes.

### Tolerant mode

Used for AI proposals and early previews.

Behavior:

* Preserve unknown root sections.
* Emit warnings.
* Normalize what is known.
* Avoid destructive cleanup.

### Strict mode

Used before plugin dry-run or apply.

Behavior:

* Known invalid structures become errors.
* Dangerous code-like fields are rejected.
* Unsupported mutation intent is rejected.

## Dangerous fields

The normalizer should warn or reject fields that imply unsafe execution, such as:

* `php_code`
* `callback`
* `eval`
* `sql`
* `shell`
* `wordpress_mutation`
* `direct_apply`
* `raw_css` if design profiles are expected instead

## Relationship to AI

AI should not generate arbitrary runtime mutations.

Future AI flow:

Prompt
→ PromptInterpretation
→ BlueprintPatch or BlueprintCandidate
→ Core normalization
→ Core validation
→ Core preview plan
→ Plugin dry-run
→ user confirmation
→ plugin apply

The normalizer is one safety layer in this flow.

## Relationship to plugin validation

Core normalization is not runtime validation.

Core normalization answers:

> Is the desired blueprint shaped consistently?

Plugin validation answers:

> Does the real WordPress/Crocoblock runtime match the desired blueprint?

Both are required.

## First implementation scope

The first implementation should be conservative.

Recommended v1 scope:

* Normalize root sections.
* Normalize list/object shapes.
* Normalize slugs/keys using pure PHP helpers.
* Preserve unknown sections with warnings.
* Support current Real Estate blueprint sections.
* Add examples and invalid fixtures.
* Do not modify plugin runtime.

## What not to do

Do not:

* copy the old normalizer directly;
* call WordPress functions;
* call adapters;
* write files;
* mutate WordPress;
* delete unknown sections silently;
* normalize design by accepting arbitrary CSS;
* treat normalized blueprint as runtime proof.

## Future examples

Recommended future fixtures:

* `core/examples/blueprint-normalizer.real-estate.input.json`
* `core/examples/blueprint-normalizer.real-estate.expected.json`
* `core/examples/invalid/blueprint-normalizer.unsafe-code.invalid.json`
* `core/examples/invalid/blueprint-normalizer.bad-list-shape.invalid.json`

## Final rule

Core normalizes desired state.

Plugin applies and validates runtime state.
