# Plugin Dry-Run Evidence Collector

The plugin dry-run evidence collector is the first plugin-side runtime helper for the future Plugin Preview Bridge.

It stays inside the WordPress plugin because only the plugin runtime can ask the current adapters what the live WordPress site would create, update, skip, warn about, or reject.

## Purpose

Core preview can describe intended blueprint changes, but it cannot inspect WordPress or Crocoblock runtime state. The collector converts the existing plugin dry-run plan output into the `plugin_dry_run` evidence envelope described by `plugin-dry-run-placeholder-contract.md`.

The collector is intentionally a wrapper. It does not create a new planning model and does not change the existing dry-run behavior.

## Read-Only Guarantee

The collector:

- calls `Factory_Dry_Run_Command::get_plan_items()`;
- normalizes plan items into a stable evidence shape;
- counts summary totals;
- derives envelope status from `warning` and `error` items.

The collector does not:

- call `factory_apply_blueprint()`;
- run apply, fix, reset, or generate commands;
- write run manifests;
- update options, posts, terms, metadata, files, or registry data;
- add REST endpoints;
- edit dashboard UI;
- collect ownership evidence;
- calculate an apply gate;
- call Core classes or require Core autoloading.

## Envelope Shape

The collector returns:

```json
{
  "available": true,
  "status": "ok",
  "source": "plugin_runtime",
  "message": "Plugin dry-run completed.",
  "summary": {
    "create": 0,
    "update": 0,
    "delete": 0,
    "skip": 0,
    "warning": 0,
    "error": 0
  },
  "items": [],
  "requires_runtime": true,
  "next_required_step": "ownership_check"
}
```

## Item Mapping

Existing plan items are mapped conservatively.

| Existing plan field | Evidence field |
| --- | --- |
| `action` | `action`, normalized to `create`, `update`, `delete`, `skip`, `warning`, or `error` |
| `adapter` | `adapter` |
| `type` | `details.plan_type` |
| `adapter_class` | `details.adapter_class` |
| `entity` | `entity` |
| `message` | `message` |
| `diff` | `details.diff` |
| `path` | `path`, when supplied |

Unknown or unsupported actions become `warning` so the future bridge cannot accidentally treat unknown adapter behavior as clean.

## Status Rules

- Any `error` item makes the envelope status `error`.
- Any `warning` item with no errors makes the envelope status `warning`.
- Otherwise the envelope status is `ok`.

## Relationship To Core

Core still owns the contract language and examples. The plugin collector mirrors that shape, but it does not import Core classes and does not require Core autoloading. This avoids coupling the installable plugin package to the integrated repository layout.

## What Is Not Included Yet

Ownership evidence is intentionally not part of this collector. The next safe task should add a separate read-only ownership evidence collector that reports Factory-managed, user-modified, locked, warning, and conflict states from existing WordPress markers.

Apply-gate policy is also intentionally excluded. A future bridge service can combine:

1. Core preview response.
2. Plugin dry-run evidence.
3. Ownership evidence.
4. User confirmation policy.

Only after those pieces exist should dashboard or REST bridge wiring be considered.
