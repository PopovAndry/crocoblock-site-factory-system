# Core Blueprint Normalizer v1

## Purpose

The Core Blueprint normalizer prepares decoded blueprint arrays for Core validation and future planning. It is a desired-state normalization pass only. It does not call WordPress, Crocoblock plugins, adapters, AI providers, filesystem mutators, or deployment tooling.

The goal is to make future user and AI-assisted changes safer by giving the Core pipeline a predictable in-memory blueprint shape before validation and preview planning.

## What It Normalizes

Core v1 normalization is intentionally conservative:

- trims scalar strings;
- normalizes known slug/key/reference fields with pure PHP string rules;
- checks known root list sections such as `plugins`, `cpt`, `taxonomies`, `queries`, `filters`, `forms`, and `listings`;
- checks known object sections such as `site`, `theme`, `pages`, `terms`, `content`, `render`, `single`, `design`, `style`, `image_context`, and `assets`;
- preserves unknown root sections by default and emits warnings for forward compatibility;
- reports dangerous fields such as `php_code`, `callback`, `eval`, `sql`, `shell`, `wordpress_mutation`, `direct_apply`, `raw_css`, and `custom_js`.

## What It Does Not Do

The normalizer does not invent a full missing blueprint, infer WordPress runtime data, resolve assets, validate plugin availability, inspect the database, apply patches, or mutate WordPress. It is not a replacement for plugin runtime validation.

Strict mode may mark shape and dangerous-field findings as errors, but it still does not execute or apply anything.

## AI Safety

Future AI systems should produce `BlueprintPatch` or `BlueprintCandidate` data. That data should be normalized and validated in Core before any preview plan is shown. AI must never mutate WordPress directly.

The safe flow remains:

`Prompt -> BlueprintPatch / BlueprintCandidate -> Normalize -> Validate -> Preview Plan -> User Confirm -> Plugin Apply -> Runtime Validate -> Manifest`

## Fixtures

Valid normalization fixtures:

- `core/examples/blueprint-normalizer.real-estate.input.json`
- `core/examples/blueprint-normalizer.real-estate.expected.json`

Invalid/safety fixtures:

- `core/examples/invalid/blueprint-normalizer.unsafe-code.invalid.json`
- `core/examples/invalid/blueprint-normalizer.bad-list-shape.invalid.json`

The invalid fixtures document expected warnings/errors for unsafe fields and bad list shapes. They are not wired into WordPress or plugin runtime.

## Running Locally

From the integrated system repository root:

```powershell
C:\OSPanel\modules\php\PHP_8.1\php.exe core\tools\normalize-blueprint-example.php
```

The runner loads the input fixture, normalizes it, compares it to the expected fixture, validates the normalized result with `BlueprintValidator`, and exits non-zero on mismatch or validation error.

## Next Step

The next safe Core task is to add a read-only `BlueprintCandidate` normalization/validation runner that can normalize a full candidate blueprint proposed by a future AI layer, without applying it to WordPress.
