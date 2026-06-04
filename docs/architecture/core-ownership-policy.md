# Core Ownership Policy

## Purpose

This document defines a future Core-neutral ownership policy for Crocoblock Site Factory.

The goal is to protect user edits while still allowing the system to safely update Factory-managed site structures.

Ownership is critical before enabling safe BlueprintPatch apply, AI-assisted changes, design profile changes, or incremental site evolution.

## Product context

Crocoblock Site Factory should not overwrite user work blindly.

The desired future flow is:

Prompt / user input
→ BlueprintPatch or BlueprintCandidate
→ Core Preview Plan
→ Plugin Dry-run
→ Ownership check
→ User confirmation
→ Plugin Apply
→ Runtime Validation
→ Manifest / Proof

## Responsibility split

### Core owns

* Ownership policy concepts
* Ownership state vocabulary
* Preview warnings
* Patch safety intent
* User confirmation requirements

### Plugin owns

* WordPress meta markers
* Generated object hashes
* Runtime ownership checks
* Skip/update decisions during apply
* Detection of manually edited WordPress objects
* Writing ownership metadata to posts, terms, templates, forms, listings, filters, and media

## Why ownership policy is needed

The system must distinguish between:

* objects created by Site Factory;
* objects still matching generated state;
* objects manually edited by a user;
* objects locked from automatic changes;
* objects requiring explicit confirmation;
* objects that should be skipped.

Without this policy, AI or blueprint updates could overwrite real user work.

## Current plugin-side ownership markers

The plugin may use runtime markers such as:

* `_factory_managed`
* `_factory_source`
* `_factory_entity_type`
* `_factory_lock`
* `_factory_source_key`
* `_factory_page_key`
* `_factory_last_generated_hash`
* `_factory_user_modified`

These markers are WordPress-specific and must remain plugin-side.

Core should not depend directly on these meta keys.

## Core-neutral ownership states

Core should model ownership using neutral states:

| State                   | Meaning                                             |
| ----------------------- | --------------------------------------------------- |
| `factory_managed`       | Entity was created or is managed by Site Factory    |
| `in_sync`               | Runtime entity still matches generated state        |
| `user_modified`         | User changed the generated entity manually          |
| `locked`                | Entity must not be changed automatically            |
| `requires_confirmation` | Change is possible but needs explicit user approval |
| `skip_runtime_apply`    | Runtime apply should skip this entity               |
| `unknown`               | Ownership cannot be determined safely               |

## Future ownership report shape

The plugin can expose ownership information in a runtime-safe report.

Example:

```json
{
  "version": 1,
  "items": [
    {
      "entity_type": "page",
      "entity_key": "home",
      "runtime_id": 145,
      "ownership": "factory_managed",
      "state": "in_sync",
      "can_update": true,
      "requires_confirmation": false,
      "message": "Home page is Factory-managed and unchanged."
    },
    {
      "entity_type": "listing",
      "entity_key": "property-card",
      "runtime_id": 302,
      "ownership": "factory_managed",
      "state": "user_modified",
      "can_update": false,
      "requires_confirmation": true,
      "message": "Listing was manually edited and should not be overwritten without confirmation."
    }
  ]
}
```

## Relationship to Core Preview Plan

Core Preview Plan answers:

> What will change in the desired blueprint?

Ownership policy answers:

> Is it safe to apply those changes to the existing runtime objects?

Both are required before safe apply.

## Relationship to Plugin Dry-run

Plugin Dry-run should include ownership-sensitive actions:

* `create`
* `update`
* `skip`
* `warning`
* `error`
* `requires_confirmation`

Examples:

```text
~ Update Home page
! Listing property-card was user-modified and will be skipped
! Filter price-range requires confirmation before overwrite
```

## Safe apply rules

Before applying a BlueprintPatch, the system should verify:

1. Affected runtime entities are Factory-managed.
2. Affected entities are not user-modified.
3. Locked entities are skipped.
4. Unknown ownership becomes warning or error.
5. User-modified entities require explicit confirmation.
6. Apply results are stored in the run manifest.
7. Runtime validation confirms the final state.

## What Core must not do

Core must not:

* read WordPress post meta directly;
* write ownership markers;
* decide runtime object IDs;
* overwrite plugin ownership checks;
* treat blueprint state as proof of runtime ownership.

## What Plugin must do

Plugin must:

* write ownership markers when it creates generated objects;
* detect manual user edits through hashes or metadata;
* include ownership warnings in dry-run;
* skip unsafe updates by default;
* require confirmation for risky changes;
* include ownership results in manifests/proof reports.

## AI safety

AI must not bypass ownership.

Future AI flow:

Prompt
→ BlueprintPatch proposal
→ Core validation
→ Core Preview Plan
→ Plugin Dry-run
→ Ownership report
→ User confirmation
→ Plugin Apply

If ownership is unknown or user-modified, AI changes should remain proposals only.

## First implementation scope

Recommended v1 scope:

* document Core ownership states;
* map current plugin meta markers to neutral ownership states;
* expose ownership warnings through plugin dry-run later;
* do not change runtime behavior yet;
* do not wire AI to ownership-sensitive apply yet.

## Final rule

Core defines ownership language.

Plugin determines runtime ownership.

User confirmation protects user work.
