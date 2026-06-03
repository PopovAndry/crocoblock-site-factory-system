# Core Engine Contracts

## Why Core Exists

Crocoblock Site Factory is a blueprint-first system, not only a WordPress plugin.
The Core Engine defines portable contracts for describing, previewing, validating,
and proving a generated WordPress/Crocoblock site.

The WordPress plugin remains the runtime cockpit and product shell. It presents
the wizard, talks to WordPress, runs Crocoblock-specific adapters, and stores
runtime proof. Core defines the system language those runtime layers should
eventually speak.

## Desired-State Pipeline

The long-term system flow is:

```text
Desired site state / Blueprint
-> Plan
-> Apply
-> Validate
-> Manifest / Proof
-> Doctor / Fix
-> Safe future modifications through BlueprintPatch
```

For AI-assisted changes, the safe flow is:

```text
Prompt
-> PromptInterpretation
-> BlueprintPatch or BlueprintCandidate
-> Preview Plan
-> User Confirm
-> Runtime Apply
-> Validate
-> Manifest
```

## Core-Owned Contracts

Core owns portable, WordPress-agnostic contracts:

- `BlueprintDocument`: desired site state.
- `BlueprintPatch`: safe change proposal to an existing blueprint.
- `BlueprintCandidate`: full proposed blueprint that must not be applied directly.
- `Plan`, `PlanItem`, `PlanSummary`: preview of runtime changes before apply.
- `ValidationResult`, `ValidationCheck`: structured validation output.
- `RunManifest`, `ManifestStatus`: proof of a system run.
- `RepairPlan`: future repair/fix intent, not repair execution.
- `PromptInterpretation`: structured user intent.
- `PromptInterpreterInterface`: prompt interpretation boundary.
- `BlueprintPatchGeneratorInterface`: AI or generator patch proposal boundary.
- `RealEstateProfile`: product profile metadata and safe defaults.

These contracts must not call WordPress functions, use WordPress globals, run
adapters, or perform external provider calls.

## Plugin-Owned Runtime Responsibilities

The WordPress plugin owns runtime behavior:

- Admin dashboard and generation wizard.
- REST endpoints.
- WP-CLI commands.
- WordPress capability checks and nonces.
- Adapter registry and adapter execution.
- WordPress/Crocoblock object creation and updates.
- Runtime validation against posts, pages, terms, options, forms, listings,
  Query Builder rows, JetSmartFilters definitions, and generated pages.
- Run manifest storage and retrieval.
- Plugin packaging.

The plugin may eventually map its runtime data into Core contract objects, but
Core must not be wired into the plugin until that bridge is deliberate and
tested.

## AI Safety Rule

AI must never mutate WordPress directly.

AI may only produce interpretation, `BlueprintPatch`, or `BlueprintCandidate`
artifacts. Those artifacts must be validated, previewed in a plan, and confirmed
by the user before any runtime apply happens.

Not allowed yet:

- Direct prompt-to-WordPress mutation.
- Direct AI calls from Preview or Generate.
- Auto-applying AI JSON output.
- Applying full AI-generated blueprints without review.
- AI-created forms, filters, queries, CPTs, taxonomies, or content topology.
- AI image generation or external image APIs.

## What Must Not Happen Yet

This contract layer does not:

- Refactor the plugin.
- Move adapters into Core.
- Replace current Real Estate beta behavior.
- Restore the old R&D AI generator.
- Add provider calls.
- Add provisioning or deployment.
- Implement apply, validate, doctor, or fix logic inside Core.

The immediate goal is shared language and safe boundaries. Runtime integration
comes later.
