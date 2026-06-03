# Core BlueprintPatch Preview Plan

The BlueprintPatch Preview Plan is the product-facing explanation layer between
an in-memory candidate Blueprint and any future WordPress runtime apply.

It turns patch operations into readable plan items that a user can review before
confirming changes.

## Why Preview Plan Is A Core Concept

Site Factory is blueprint-first. A requested change should become a
`BlueprintPatch`, then a candidate Blueprint, then a Preview Plan. The user
reviews that plan before the WordPress plugin performs any runtime mutation.

This keeps Core responsible for desired-state safety and product language, while
the plugin remains responsible for WordPress runtime work.

## Difference From Plugin Runtime Apply

Core preview planning:

- Reads original and candidate Blueprint arrays.
- Reads validated patch operations.
- Produces human-readable `PlanItem` objects.
- Does not call WordPress.
- Does not execute adapters.
- Does not write files.
- Does not prove that runtime state changed.

Plugin runtime apply later:

- Creates or updates WordPress/Crocoblock objects.
- Runs adapters.
- Validates live WordPress state.
- Writes manifests and proof.

## Supported v1 Preview Operations

The v1 preview builder supports the same conservative patch model:

- `set`
- `add`
- `replace`

Preview behavior:

- Existing scalar path changes become `update` items with before/after values.
- `add` operations become `create` items.
- Unknown or structured object values are described as `structured value`
  instead of deep-diffed.

## Not Implemented Yet

The preview builder does not yet include:

- Recursive object diffs.
- Domain-specific grouping by page, form, query, filter, or listing.
- Runtime adapter prediction.
- Ownership/user-editing policy.
- Delete/remove planning.
- AI integration.
- Plugin dashboard wiring.

## Runner

From the integrated repository root:

```powershell
C:\OSPanel\modules\php\PHP_8.1\php.exe core\tools\preview-blueprint-patch-plan-example.php
```

The runner loads:

- `core/examples/real-estate-blueprint.example.json`
- `core/examples/blueprint-patch.real-estate-safe.example.json`

It applies the patch in memory, builds a human-readable preview plan, validates
the resulting `Plan`, and prints readable preview items.

## Future Plugin Preview UI

Later, the WordPress plugin can use a bridge to display this Core preview plan
inside the dashboard before apply. That future bridge should remain read-only
until the user confirms generation or modification.
