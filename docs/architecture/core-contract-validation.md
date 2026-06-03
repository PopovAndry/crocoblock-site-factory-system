# Core Contract Validation

Core contract validation is the first guardrail before any runtime layer applies
changes to WordPress. It checks that portable system artifacts have the expected
shape before they are handed to planning, review, apply, proof, or future repair
flows.

This validation is intentionally small and pure. It does not call WordPress,
inspect a live site, execute adapters, call AI providers, or mutate data.

## Contracts Validated Now

The draft validators currently cover the existing Core examples:

- `BlueprintPatchValidator`
  - Validates patch operation shape.
  - Allows `set`, `add`, and `replace`.
  - Requires JSON-pointer-like paths.
  - Requires values for all supported operations.
  - Rejects direct apply, WordPress mutation, PHP code, callbacks, delete, and
    remove operations.

- `PlanValidator`
  - Validates plan summary and item structure.
  - Checks supported actions: `create`, `update`, `delete`, `skip`, `warning`,
    and `error`.
  - Checks item message/entity/adapter fields when present.

- `ValidationResultValidator`
  - Validates validation status and checks.
  - Checks known statuses: `ok`, `warning`, and `error`.
  - Requires validation check messages.

- `RunManifestValidator`
  - Validates manifest identity, timestamp, status, blueprint, plan, validation,
    context, and execution shape.
  - Delegates nested plan and validation checks to the draft validators.

- `BlueprintValidator`
  - Validates desired-state Blueprint shape.
  - Accepts the current Real Estate preset shape, including newer roots such as
    `queries`, `filters`, `site.forms`, style, assets, and native proof data.
  - Warns on unknown optional roots instead of rejecting them.

## Example Runner

`core/tools/validate-examples.php` validates:

- `core/examples/blueprint-patch.example.json`
- `core/examples/plan.example.json`
- `core/examples/validation-result.example.json`
- `core/examples/run-manifest.example.json`
- `core/examples/real-estate-blueprint.example.json`

The runner is local-only and uses a tiny PSR-4-style autoloader for Core classes.
It is not wired into Composer, the WordPress plugin, REST, WP-CLI, or CI yet.

## What This Does Not Do Yet

This is not plugin runtime validation. It does not verify that pages, posts,
terms, Query Builder rows, JetSmartFilters, JetFormBuilder forms, menus, images,
or generated templates exist in WordPress.

This is not AI integration. It does not call OpenAI or any provider, interpret a
prompt, generate patches, or apply patches.

This is not apply/fix behavior. It does not change a blueprint, mutate a site,
execute adapters, or repair drift.

## Why It Matters

The system direction is:

```text
Desired site state / Blueprint
-> Plan
-> Apply
-> Validate
-> Manifest / Proof
-> Doctor / Fix
-> BlueprintPatch for safe future modifications
```

Core contract validation lets the system reject malformed portable artifacts
before they reach runtime layers. That keeps the WordPress plugin focused on
runtime work while Core owns the shape and safety language.

## Next Step

The next safe step is to add a small Core contract test harness or Composer
script for validating examples, still without wiring Core into
`wordpress-plugin/`.
