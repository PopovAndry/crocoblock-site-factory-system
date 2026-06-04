# Ownership Placeholder Contract

The Core Engine can describe desired-state changes, but it cannot determine whether existing WordPress runtime objects are safe to update. Ownership checks require the WordPress plugin runtime because ownership evidence lives in WordPress data, Crocoblock entities, generated object markers, and adapter-specific state.

This document defines the placeholder contract used in Core preview responses until a real plugin ownership bridge exists.

## Why Core Cannot Check Runtime Ownership

Core is intentionally pure and blueprint-first. It must not:

- read WordPress posts, terms, users, options, or post meta;
- call WordPress functions;
- call Crocoblock APIs;
- inspect JetEngine, JetSmartFilters, JetFormBuilder, or other runtime storage directly;
- execute plugin adapters;
- mutate runtime state.

That boundary keeps future AI-assisted changes safe: AI can propose `BlueprintPatch` or `BlueprintCandidate` data, but runtime safety remains a plugin responsibility before anything is applied.

## Current Placeholder Shape

```json
{
  "available": false,
  "status": "not_checked",
  "source": "plugin_runtime",
  "message": "Ownership checks require plugin runtime and were not executed.",
  "requires_runtime": true,
  "next_required_step": "ownership_check",
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

The placeholder is produced by `Crocoblock\SiteFactory\Core\Bridge\OwnershipPlaceholder`.

## Future Runtime Ownership Shape

A future plugin runtime bridge should replace the placeholder with the same envelope:

```json
{
  "available": true,
  "status": "ok|warning|error",
  "source": "plugin_runtime",
  "message": "Ownership check completed.",
  "requires_runtime": true,
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

The envelope should stay stable so Core review, plugin dry-run, ownership checks, and final apply confirmation can be displayed together without reshaping the preview response.

## Future Ownership Item Shape

Ownership items should identify the affected runtime entity and explain whether it is safe to change:

```json
{
  "status": "safe|user_modified|locked|conflict|warning|error",
  "entity_type": "post|term|user|option|product|template|listing|form|filter|unknown",
  "entity": "human-readable entity",
  "entity_id": null,
  "blueprint_path": "/optional/blueprint/path",
  "field": "optional field key",
  "ownership": "blueprint_managed|user_managed|mixed|locked|unknown",
  "message": "Human-readable ownership result",
  "details": {}
}
```

## Core Candidate Review Versus Plugin Ownership Check

Core candidate review answers:

> What does this blueprint candidate or patch intend to change?

Plugin ownership check answers:

> Are the existing runtime objects safe to update, skip, or require user confirmation?

Both are required before safe apply. Core can explain intent, but only the plugin can determine runtime ownership.

## Relationship To Core Ownership Policy

`core-ownership-policy.md` defines the product safety model:

- Factory-managed objects may be updated when still in sync.
- User-modified objects should not be overwritten by default.
- Locked or unknown ownership should block or warn before apply.
- User confirmation protects work that happened after generation.

This placeholder is the Core preview response slot where future plugin ownership evidence will appear.

## Relationship To The Crocoblock Adapter Roadmap

`crocoblock-adapter-roadmap.md` states that runtime adapters must report validation and ownership evidence before mutation. Future Crocoblock adapters should feed ownership results into this envelope for pages, listings, filters, forms, queries, templates, products, and other runtime entities.

## What Must Not Happen In Core

- Core must not read or write WordPress ownership markers.
- Core must not infer runtime ownership from blueprint data alone.
- Core must not mark entities safe without plugin evidence.
- Core must not decide WordPress object IDs.
- Core must not apply, repair, reset, or generate runtime objects.
- AI must not bypass ownership checks.

## Safe Future Flow

```text
Prompt
-> BlueprintPatch or BlueprintCandidate
-> Core validation
-> Core preview plan
-> Plugin dry-run
-> Plugin ownership check
-> User confirmation
-> Plugin apply
-> Runtime validation
-> Manifest / proof
```

Until the plugin bridge exists, the ownership section should remain a clear "requires runtime" state, not an error.
