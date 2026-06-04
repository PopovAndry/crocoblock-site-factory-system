# Plugin Adapter Capability Report

## Purpose

This document defines a future read-only capability report for the WordPress plugin runtime.

The goal is to let Core or system-level tooling understand what the plugin runtime can do without allowing Core to instantiate adapters, call WordPress functions, or perform Crocoblock mutations.

## Product context

Crocoblock Site Factory is a blueprint-first WordPress/Crocoblock site generation system.

The main pipeline is:

Prompt / user input
→ Core BlueprintPatch / Candidate Blueprint
→ Core Preview Plan
→ Plugin Dry-run
→ User confirmation
→ Plugin Apply
→ Runtime Validation
→ Manifest / Proof
→ Doctor / Fix

## Responsibility split

### Core owns

* Blueprint contracts
* Desired-state validation
* BlueprintPatch validation
* Candidate blueprint generation in memory
* Human-readable preview plan
* AI-safe patch/candidate model
* Future contract schemas

### Plugin owns

* Adapter registry
* Adapter dependency order
* WordPress runtime mutations
* Crocoblock runtime calls
* Dry-run / plan execution
* Apply execution
* Runtime validation
* Manifest persistence
* Doctor / Fix
* REST and dashboard UI

## Why a capability report is needed

The plugin registry is the runtime source of truth.

Core should not duplicate:

* adapter registration;
* adapter dependency order;
* adapter execution;
* WordPress/Crocoblock runtime checks.

However, Core/system tooling may need to know what the plugin runtime supports.

A serialized capability report solves this:

* Core can understand available runtime capabilities.
* Plugin remains the only layer that executes adapters.
* The system avoids duplicated adapter registries.
* Future AI flows can validate whether a proposed BlueprintPatch is supported by the installed runtime.

## Future report shape

Example:

```json
{
  "version": 1,
  "runtime": "wordpress-plugin",
  "adapters": [
    {
      "key": "queries",
      "class": "Factory_JetEngine_Query_Builder_Adapter",
      "has_register": true,
      "has_plan": true,
      "has_apply": true,
      "has_validate": true,
      "contract_ready": false,
      "dependencies": [
        "meta"
      ],
      "runtime_notes": [
        "Requires JetEngine Query Builder runtime support",
        "Creates and validates query definitions inside WordPress"
      ]
    }
  ]
}
```

## Adapter fields

| Field            | Meaning                                                        |
| ---------------- | -------------------------------------------------------------- |
| `key`            | Stable adapter key used by the plugin registry                 |
| `class`          | PHP class name of the runtime adapter                          |
| `has_register`   | Adapter can register required WordPress hooks/types or setup   |
| `has_plan`       | Adapter can produce dry-run plan items                         |
| `has_apply`      | Adapter can mutate WordPress/Crocoblock runtime state          |
| `has_validate`   | Adapter can validate real runtime state                        |
| `contract_ready` | Adapter follows the expected adapter contract/interface        |
| `dependencies`   | Adapter keys that should run before this adapter               |
| `runtime_notes`  | Human-readable notes about runtime requirements or limitations |

## Current known plugin runtime adapters

Current plugin registry should remain the source of truth. At the time of this document, the expected adapter categories are:

* `plugins`
* `theme`
* `taxonomy`
* `core`
* `meta`
* `queries`
* `listings`
* `filters`
* `render`
* `single`
* `content`

Newer plugin-side runtime adapters include:

* JetEngine Query Builder adapter
* JetSmartFilters adapter

These must remain plugin-side because they depend on WordPress/Crocoblock runtime APIs.

## Relationship to Core Preview Plan

Core Preview Plan answers:

> What will change in the desired blueprint?

Plugin Dry-run answers:

> What will the WordPress/Crocoblock runtime adapters create, update, skip, warn, or fail?

The capability report helps Core/system tooling understand whether the plugin runtime has the adapters needed to execute a candidate blueprint later.

It does not execute anything.

## What this report must not do

The capability report must not:

* instantiate adapters in Core;
* execute adapter methods from Core;
* expose write operations directly to AI;
* replace plugin dry-run;
* replace plugin runtime validation;
* duplicate the plugin registry;
* hardcode stale adapter lists outside the plugin registry.

## Future usage

Possible future usage:

1. Plugin exposes `/factory/v1/adapters` or a normalized capability endpoint.
2. Core/system tooling reads the serialized report.
3. AI proposes a BlueprintPatch.
4. Core validates the patch and candidate blueprint.
5. System checks whether plugin runtime capabilities support the candidate.
6. Plugin dry-run produces the runtime plan.
7. User confirms.
8. Plugin applies and validates.

## Important architectural rule

Core may consume a serialized adapter capability report.

Core must not own or execute the adapter registry.

The WordPress plugin remains the runtime source of truth.
