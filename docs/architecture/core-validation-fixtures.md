# Core Validation Fixtures

Core validation fixtures document expected contract behavior before any runtime
layer touches WordPress. They make the validation draft safer by proving both
positive and negative examples.

These fixtures are Core-only. They do not affect the WordPress plugin, REST
routes, dashboard, adapters, AI settings, or generated Real Estate beta.

## Valid Fixtures

The valid examples under `core/examples/` are expected to return `ok`:

- `blueprint-patch.example.json`
- `plan.example.json`
- `validation-result.example.json`
- `run-manifest.example.json`
- `real-estate-blueprint.example.json`

`real-estate-blueprint.example.json` is copied from the current plugin preset as
a desired-state reference input. The plugin preset remains the source of truth
for runtime generation.

## Invalid And Warning Fixtures

The invalid fixtures live under `core/examples/invalid/`.

| Fixture | Expected | Purpose |
|---|---:|---|
| `blueprint.missing-version.invalid.json` | `error` | Verifies Blueprint documents require a version. |
| `blueprint.invalid-cpt.invalid.json` | `error` | Verifies object-shaped Blueprint sections fail when provided as lists. |
| `blueprint.unknown-root-warning.invalid.json` | `warning` | Verifies unknown root sections warn rather than hard-fail. |
| `blueprint-patch.missing-operations.invalid.json` | `error` | Verifies BlueprintPatch requires an operations array. |
| `blueprint-patch.unsafe-direct-apply.invalid.json` | `error` | Verifies BlueprintPatch cannot declare direct apply behavior. |
| `blueprint-patch.real-estate-unsafe.invalid.json` | `error` | Verifies BlueprintPatch cannot declare direct WordPress mutation behavior. |
| `plan.invalid-item-action.invalid.json` | `error` | Verifies unsupported plan item actions fail. |
| `validation-result.invalid-status.invalid.json` | `error` | Verifies unsupported validation statuses fail. |
| `run-manifest.missing-validation.invalid.json` | `error` | Verifies RunManifest requires validation output. |

## Why Unknown Blueprint Roots Warn

Blueprints are expected to evolve as new product verticals, Crocoblock
integrations, design controls, and provisioning layers are added. Core v1 should
not reject a forward-compatible document only because it contains an optional
section the draft validator does not understand yet.

Unknown roots therefore produce `warning`, not `error`. Required structural
fields and invalid known-section shapes still produce hard failures.

## How To Run

From the integrated repository root:

```powershell
C:\OSPanel\modules\php\PHP_8.1\php.exe core\tools\validate-examples.php
```

The runner prints each fixture status and expected status. It exits with a
non-zero code only when an example returns an unexpected status, a file is
missing, or JSON cannot be decoded.

## What This Does Not Test

The fixtures do not validate:

- WordPress runtime state.
- Crocoblock plugin availability.
- Adapter behavior.
- Generated pages, posts, terms, menus, forms, filters, or Query Builder rows.
- AI provider calls.
- BlueprintPatch application.
- Repair/fix execution.

Those remain separate runtime responsibilities.
