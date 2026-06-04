# Core BlueprintCandidate Review Formatter

## Purpose

The BlueprintCandidate review formatter groups a Core review plan into product-facing sections for a future UI. It answers:

> How should this Core review plan be presented to a user?

It does not answer what WordPress adapters will do. Runtime dry-run behavior remains a future plugin responsibility.

## Builder vs Formatter

`BlueprintCandidateReviewPlanBuilder` compares a baseline blueprint and a normalized candidate blueprint. It creates a Core `Plan` using existing `Plan` and `PlanItem` contracts.

`BlueprintCandidateReviewFormatter` accepts that plan and groups its items into stable product-facing sections. It is a presentation layer, not a second planner and not a new incompatible plan schema.

## Output Shape

The formatted review includes:

- `version`
- `status`
- `title`
- `summary`
- grouped `sections`

Each item preserves useful plan fields:

- `action`
- `severity`
- `type`
- `entity`
- `message`
- `path`
- `before`
- `after`

## Sections

The v1 formatter uses these groups:

- `identity`: site name, language, permalink, and business identity;
- `design`: design context, style tokens, and image context;
- `structure`: pages, CPTs, taxonomies, terms, render settings, and single templates;
- `dynamic_features`: queries, filters, forms, and listings;
- `content`: demo content and asset declarations;
- `safety`: warnings, unknown sections, and review requirements;
- `advanced`: fallback technical items that do not fit product-facing groups.

## Core-Only Boundary

The formatter does not:

- call WordPress functions;
- instantiate plugin adapters;
- inspect runtime IDs;
- check filesystem paths;
- check plugin availability;
- call AI providers;
- generate manifests;
- apply or mutate anything.

## Example Runner

`core/tools/format-blueprint-candidate-review-example.php` rebuilds the candidate review plan, formats it, compares the result to `core/examples/blueprint-candidate-review-formatted.example.json`, and exits non-zero on mismatch.

Run it locally:

```powershell
C:\OSPanel\modules\php\PHP_8.1\php.exe core\tools\format-blueprint-candidate-review-example.php
```

## Future Work

The next safe task is to define a read-only Core-to-plugin preview response contract that can carry the formatted review into a future dashboard without wiring runtime apply.
