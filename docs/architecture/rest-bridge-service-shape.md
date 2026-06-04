# REST Bridge Service Shape

## Purpose

This document defines the future REST bridge shape between Core preview logic and the WordPress plugin runtime.

The goal is to avoid making `wordpress-plugin/includes/api/rest.php` larger and more complex.

The bridge must stay thin, read-only at first, and must not mutate WordPress state.

## Product pipeline

Prompt / user input
→ Core BlueprintPatch / Candidate Blueprint
→ Core Preview Plan
→ Plugin Dry-run
→ User confirmation
→ Plugin Apply
→ Runtime Validation
→ Manifest / Proof

## Current problem

`rest.php` is currently a large controller-style file.

It handles:

* route registration;
* Real Estate beta plan/apply;
* safe variables;
* style token derivation;
* image context;
* requirements;
* product plan;
* doctor/latest/run enrichment;
* helper logic.

Adding Core preview logic directly into `rest.php` would deepen the monolith.

## Bridge responsibility

A future bridge service should:

* load or receive base blueprint;
* receive safe user variables or BlueprintPatch;
* call Core preview logic;
* call plugin dry-run logic;
* merge results into a product-friendly read-only response;
* return data to dashboard;
* not apply anything.

## What the bridge must not do

The bridge must not:

* apply blueprints;
* call adapter `apply()` methods;
* write manifests;
* call AI providers directly;
* mutate WordPress;
* hide ownership warnings;
* bypass plugin dry-run;
* bypass user confirmation.

## Suggested future service

Possible plugin-side service file:

```text
wordpress-plugin/includes/engine-bridge/core-preview-bridge.php
```

Possible function/class responsibility:

```text
CorePreviewBridge
```

Responsibilities:

* check whether Core is available;
* normalize/validate input through Core;
* build Core Preview Plan;
* call existing plugin dry-run;
* return read-only combined preview result.

## Suggested endpoint options

Option A:

```text
/factory/v1/core/preview
```

General-purpose future endpoint.

Option B:

```text
/factory/v1/beta/real-estate/core-preview
```

Safer beta-scoped endpoint for the first implementation.

Recommended first implementation:

```text
/factory/v1/beta/real-estate/core-preview
```

Reason:

* lower risk;
* scoped to current Real Estate beta;
* avoids pretending the bridge supports all verticals;
* easier to test.

## Suggested response shape

```json
{
  "status": "ok",
  "mode": "read_only",
  "core_available": true,
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
  },
  "plugin_dry_run": {
    "summary": {
      "create": 0,
      "update": 0,
      "skip": 20,
      "warning": 0,
      "error": 0
    },
    "items": []
  },
  "ownership": {
    "status": "not_checked",
    "items": []
  },
  "message": "Read-only preview generated. Nothing was applied."
}
```

## Dashboard presentation

The dashboard should show:

### Core Preview

Answers:

```text
What will change in the desired blueprint?
```

### Plugin Dry-run

Answers:

```text
What will WordPress/Crocoblock runtime adapters do?
```

### Ownership warnings

Answers:

```text
Is it safe to update existing generated objects?
```

### Advanced details

Raw adapter traces, validation checks, manifests, and JSON should stay in Advanced/Debug.

## First implementation scope

The first bridge implementation should be read-only.

It may support only:

* current Real Estate preset;
* safe variables;
* deterministic BlueprintPatch;
* Core Preview Plan;
* Plugin Dry-run Plan.

It must not support:

* AI provider calls;
* arbitrary BlueprintPatch from user input;
* direct apply;
* destructive changes;
* ownership override.

## Future flow

1. User changes safe business/design fields.
2. Core creates or receives BlueprintPatch.
3. Core builds Preview Plan.
4. Plugin builds Dry-run Plan.
5. Dashboard shows both.
6. User confirms.
7. Plugin applies later in a separate explicit step.

## Final rule

REST should expose the bridge.

REST should not become the bridge.
