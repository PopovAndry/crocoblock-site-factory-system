# CorePreview → PluginDryRun → PluginApply Bridge Contract

## Purpose

This document defines the future bridge between the pure Core Engine and the WordPress plugin runtime.

The goal is to avoid rebuilding plugin runtime capabilities inside Core.

## Product pipeline

Prompt / user input
→ BlueprintPatch or BlueprintCandidate
→ Core Preview
→ Plugin Dry-run
→ User confirmation
→ Plugin Apply
→ Runtime Validation
→ Manifest / Proof
→ Doctor / Fix

## Responsibility split

### Core owns

- Blueprint contracts
- Pure blueprint validation
- Pure normalization later
- BlueprintPatch validation
- BlueprintPatch application in memory
- Candidate blueprint generation safety
- Human-readable preview plan
- AI-safe patch/candidate model
- Future contract schemas

### Plugin owns

- WordPress mutations
- Crocoblock adapters
- CPT/taxonomy/meta/content/media/menu/page operations
- JetEngine, JetFormBuilder, JetSmartFilters runtime calls
- Runtime validation against WordPress state
- Doctor / health / fix execution
- REST nonce and capability checks
- Admin dashboard / wizard
- WP option storage
- Run persistence and run registry

## Bridge phases

### Phase 1: Core Preview

Input:
- base Blueprint
- BlueprintPatch

Output:
- candidate Blueprint
- Core Preview Plan

Purpose:
Explain what will change in desired site state before touching WordPress.

No WordPress mutation.

### Phase 2: Plugin Dry-run

Input:
- candidate Blueprint

Output:
- Plugin runtime dry-run Plan

Purpose:
Explain what the WordPress/Crocoblock adapters will create, update, skip, warn, or fail.

This uses the existing plugin `Factory_Dry_Run_Command`.

### Phase 3: User confirmation

Input:
- Core Preview Plan
- Plugin Dry-run Plan
- dependency status
- guardrails

Output:
- explicit user approval

No implicit apply.

### Phase 4: Plugin Apply

Input:
- confirmed candidate Blueprint

Output:
- execution trace
- runtime validation result
- run manifest

This remains plugin-side.

## Important rule

Core Preview Plan is not runtime validation.

Core Preview Plan answers:

> What changes in the desired blueprint?

Plugin Dry-run answers:

> What will the WordPress runtime adapters do?

Runtime Validation answers:

> Did WordPress/Crocoblock state actually match the desired blueprint after apply?

## What must not happen

- Core must not call WordPress functions.
- Core must not execute adapters.
- Core must not save run manifests.
- Core must not replace plugin dry-run.
- Plugin must not apply AI output without Core validation and preview.
- The old AI generator must not be wired directly to apply.

## Future API shape draft

### Core preview response

```json
{
  "status": "ok",
  "candidate_blueprint": {},
  "core_preview_plan": {
    "summary": {
      "create": 0,
      "update": 3,
      "delete": 0,
      "skip": 0,
      "warning": 0,
      "error": 0
    },
    "items": []
  }
}