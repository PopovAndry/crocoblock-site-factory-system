# Core BlueprintCandidate Review Plan

## Purpose

The BlueprintCandidate review plan is a Core-only, read-only preview of how a proposed full blueprint differs from a known baseline blueprint.

It answers one product question:

> What changes in the desired blueprint if this candidate is accepted?

It does not answer what WordPress adapters will create or update. That remains a future plugin dry-run/runtime responsibility.

## Flow

The future AI-safe flow is:

`Prompt -> BlueprintCandidate proposal -> Core normalization -> Core validation -> Candidate Review Plan -> Plugin dry-run later -> User confirmation later -> Plugin apply later`

This task implements only the `Candidate Review Plan` portion.

## Read-Only Boundary

`BlueprintCandidateReviewPlanBuilder` compares in-memory arrays only. It does not:

- call WordPress functions;
- call Crocoblock APIs;
- instantiate plugin adapters;
- inspect runtime IDs;
- inspect filesystem paths;
- apply a blueprint;
- write manifests;
- call AI providers.

The WordPress plugin remains the runtime cockpit and adapter layer.

## V1 Review Sections

The v1 builder is intentionally conservative. It compares high-value desired-state sections:

- `/site/name`
- `/site/style`
- `/design`
- `/image_context`
- `/pages`
- `/cpt`
- `/taxonomies`
- `/terms`
- `/content`
- `/queries`
- `/filters`
- `/forms`
- `/listings`
- `/render`
- `/single`
- `/assets`

Large sections are summarized by counts and identifiers instead of deeply diffing every nested field. This keeps the review human-readable and avoids pretending to be a runtime dry-run.

Unknown candidate root sections are preserved and surfaced as warning plan items.

## Example Runner

`core/tools/preview-blueprint-candidate-example.php`:

- loads `core/examples/real-estate-blueprint.example.json`;
- loads `core/examples/blueprint-candidate.real-estate.input.json`;
- normalizes the candidate with `BlueprintNormalizer`;
- validates the candidate with `BlueprintValidator`;
- builds a candidate review plan;
- validates the plan with `PlanValidator`;
- compares it to `core/examples/blueprint-candidate-review-plan.example.json`;
- exits non-zero on mismatch or validation error.

Run it locally:

```powershell
C:\OSPanel\modules\php\PHP_8.1\php.exe core\tools\preview-blueprint-candidate-example.php
```

## Future Work

The next safe task is to add a Core-only candidate review formatter that can group plan items into user-facing sections for a future UI, still without plugin wiring or runtime apply.
