# Plugin Preview Bridge Contract

The Plugin Preview Bridge is the future read-only handoff between Core preview and WordPress runtime evidence. It combines Core's desired-state review with plugin-side dry-run and ownership checks before any apply path can be enabled.

This document defines the input/output envelope only. It does not add a REST endpoint, dashboard behavior, adapter execution, WordPress calls, or Crocoblock runtime integration.

## Why This Contract Exists

Core can answer:

> What does this BlueprintCandidate or BlueprintPatch intend to change?

The WordPress plugin runtime must answer:

> What would the current site actually do if this desired state were applied, and is it safe to update existing runtime objects?

The bridge contract gives both layers a shared envelope without moving WordPress-specific logic into Core.

## Difference From Core Preview Response

`core-preview-response-contract.md` describes a Core-only response. It includes:

- blueprint normalization;
- Core validation;
- Core candidate review;
- placeholder plugin dry-run;
- placeholder ownership check.

The Plugin Preview Bridge response is the next-layer envelope. A future plugin-side read-only bridge can accept a Core preview response, replace placeholders with real plugin runtime evidence, calculate an apply gate, and still guarantee that nothing was applied.

## Input Shape

The bridge input receives a Core preview response plus explicit runtime check requests and constraints:

```json
{
  "version": 1,
  "mode": "read_only",
  "intent": "preview_before_apply",
  "applied": false,
  "runtime_mutation": false,
  "source": "core_preview_response",
  "core_preview": {},
  "requested_runtime_checks": {
    "plugin_dry_run": true,
    "ownership_check": true
  },
  "constraints": {
    "allow_apply": false,
    "allow_mutation": false,
    "require_user_confirmation": true,
    "respect_ownership": true
  }
}
```

Input safety rules:

- `mode` must be `read_only`.
- `applied` must be `false`.
- `runtime_mutation` must be `false`.
- `allow_apply` must be `false` for preview.
- `allow_mutation` must be `false` for preview.

## Response Shape

The bridge response combines Core preview, plugin dry-run, ownership, and apply gate status:

```json
{
  "version": 1,
  "mode": "read_only",
  "status": "ok|warning|error",
  "applied": false,
  "runtime_mutation": false,
  "title": "Plugin preview bridge response",
  "message": "Read-only plugin preview bridge response generated. Nothing was applied.",
  "core": {
    "preview": {}
  },
  "plugin": {
    "dry_run": {}
  },
  "ownership": {},
  "apply_gate": {
    "status": "blocked|ready|warning|error",
    "can_apply": false,
    "requires_user_confirmation": true,
    "blocking_reasons": [],
    "warnings": [],
    "next_required_step": "user_confirmation"
  }
}
```

Output safety rules:

- `mode` must remain `read_only`.
- `applied` must remain `false`.
- `runtime_mutation` must remain `false`.
- `plugin.dry_run` must match `plugin-dry-run-placeholder-contract.md` or its future real runtime equivalent.
- `ownership` must match `ownership-placeholder-contract.md` or its future real runtime equivalent.
- `apply_gate.can_apply` must remain `false` when placeholders are present or runtime checks were not executed.

## Core-Only Example Apply Gate

In the Core-only example, apply is blocked because no real runtime evidence exists:

```json
{
  "status": "blocked",
  "can_apply": false,
  "requires_user_confirmation": true,
  "blocking_reasons": [
    "Plugin dry-run has not been executed.",
    "Ownership check has not been executed.",
    "User confirmation has not been collected."
  ],
  "warnings": [
    "No runtime checks were executed by this Core-only example."
  ],
  "next_required_step": "plugin_dry_run"
}
```

After a future plugin bridge runs real dry-run and ownership checks successfully, `next_required_step` may become `user_confirmation`. Apply still must not happen from this preview response itself.

## Relationship To Placeholder Contracts

The bridge uses:

- `plugin-dry-run-placeholder-contract.md` for the plugin dry-run slot;
- `ownership-placeholder-contract.md` for the ownership slot.

A future plugin runtime bridge should replace those placeholders with real runtime data while preserving each envelope.

## Relationship To Crocoblock Adapter Roadmap

`crocoblock-adapter-roadmap.md` defines runtime adapter responsibilities: plan, dry-run, ownership, apply, validate, and manifest evidence. The Plugin Preview Bridge is where those runtime adapter dry-run and ownership reports can be surfaced to users before apply.

## What Must Not Happen In Core

Core must not:

- call WordPress functions;
- call Crocoblock APIs;
- execute plugin adapters;
- add REST endpoints;
- inspect runtime object IDs;
- write manifests or runtime files;
- apply, fix, reset, or generate WordPress state;
- let AI bypass preview, dry-run, ownership, and confirmation gates.

## Safe Future Flow

```text
Prompt
-> BlueprintPatch or BlueprintCandidate
-> Core validation
-> Core preview response
-> Plugin preview bridge
-> Plugin dry-run
-> Plugin ownership check
-> User confirmation
-> Plugin apply
-> Runtime validation
-> Manifest / proof
```

This task defines only the contract. It does not implement the bridge.
