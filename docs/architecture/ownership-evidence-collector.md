# Ownership Evidence Collector

The ownership evidence collector is a plugin-side read-only runtime helper for the future Plugin Preview Bridge.

It mirrors the Core ownership evidence envelope from `ownership-placeholder-contract.md`, but it does not import Core classes or require Core autoloading. The installable WordPress plugin remains able to run as its own package.

## Purpose

Core can explain intended blueprint changes, but only the WordPress runtime can inspect existing generated objects and decide whether they appear safe, user-modified, locked, unknown, or conflicting.

The collector reads existing Factory ownership markers and returns product-readable ownership evidence for future preview/confirmation flows.

## Read-Only Guarantee

The collector reads markers only.

It does not:

- update post meta;
- update term meta;
- update options;
- write files;
- write run manifests;
- call apply, fix, reset, or generate commands;
- add REST endpoints;
- edit dashboard UI;
- run plugin dry-run;
- calculate an apply gate;
- call Core classes.

## Envelope Shape

The collector returns:

```json
{
  "available": true,
  "status": "ok",
  "source": "plugin_runtime",
  "message": "Ownership check completed.",
  "requires_runtime": true,
  "next_required_step": "user_confirmation",
  "summary": {
    "checked": 0,
    "safe": 0,
    "user_modified": 0,
    "locked": 0,
    "conflict": 0,
    "warning": 0,
    "error": 0
  },
  "items": []
}
```

When no target entities are passed, the collector returns a valid empty check with status `ok` and a message explaining that no targets were provided.

## Supported Entity Types In V1

V1 supports:

- `post`
- `product`
- `template`
- `listing`
- `form`
- `filter`
- `term`

The post-backed types all read WordPress post meta. `term` reads term meta. Unsupported entity types return warning items with `ownership: unknown`.

## Marker Fields Read

Post-backed targets may read:

- `_factory_managed`
- `_factory_source`
- `_factory_entity_type`
- `_factory_lock`
- `_factory_source_key`
- `_factory_page_key`
- `_factory_last_generated_hash`
- `_factory_user_modified`
- `_factory_listing_key`
- `_factory_filter_key`
- `_factory_filter_provider`
- `_factory_form_key`
- `_factory_form_provider`
- `_factory_asset_hash`
- `_factory_asset_source`
- `_factory_asset_role`

Term targets may read:

- `_factory_managed`
- `_factory_source`
- `_factory_entity_type`
- `_factory_lock`
- `_factory_last_generated_hash`
- `_factory_user_modified`

## Marker-To-Ownership Mapping

The collector is conservative:

| Marker state | Item status | Ownership |
| --- | --- | --- |
| `_factory_managed` truthy and no user-modified/locked marker | `safe` | `blueprint_managed` |
| `_factory_user_modified` truthy or `_factory_lock = user_modified` | `user_modified` | `mixed` |
| `_factory_lock = locked`, `user_owned`, or `frozen` | `locked` | `locked` |
| Expected source differs from `_factory_source` | `conflict` | `mixed` |
| Missing Factory markers | `warning` | `unknown` |
| Unsupported entity type | `warning` | `unknown` |

The existing plugin also stores `_factory_lock = factory_managed` for normal generated objects. V1 treats that value as safe when `_factory_managed` is present because it means the object is still Factory-managed, not locked against Factory updates.

## Status Rules

- Any `error` item makes the envelope status `error`.
- Any `conflict`, `locked`, `user_modified`, or `warning` item makes the envelope status `warning`.
- Otherwise the envelope status is `ok`.

## Relationship To Plugin Dry-Run

This collector does not run dry-run planning and does not include plan items. Dry-run evidence is handled separately by `plugin-dry-run-evidence-collector.php`.

A future bridge service can combine:

1. Core preview response.
2. Plugin dry-run evidence.
3. Ownership evidence.
4. Apply-gate policy.

That bridge service is intentionally not implemented yet.

## Next Step

The next safe task is a read-only plugin preview bridge service that combines dry-run evidence and ownership evidence into the existing Core-compatible RuntimeEvidence shape without adding REST or dashboard wiring.
