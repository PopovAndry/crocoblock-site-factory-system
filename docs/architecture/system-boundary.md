# Core / Plugin / Provisioning Boundary

## Core Engine Responsibilities

The Core Engine owns product-agnostic Site Factory logic:

- Blueprint and BlueprintPatch data models.
- BlueprintCandidate creation and validation.
- Planning and dry-run summaries.
- Validation rules and repair recommendations.
- Run manifests and proof records.
- AI-safe interpretation that produces blueprint state, not direct WordPress mutations.
- Product modules such as Real Estate that define safe preset behavior and guardrails.

## WordPress Plugin / Runtime Responsibilities

The WordPress plugin is the runtime cockpit, adapter layer, and product shell inside WordPress:

- Admin dashboard and user-facing controls.
- REST endpoints for preview, apply, validation, proof, and settings.
- WordPress/Crocoblock adapters that apply approved blueprint state to WordPress.
- Runtime validation against WordPress state.
- Plugin packaging and installability.

The plugin should call or host Core Engine decisions where appropriate, but it should not become the entire Site Factory system.

## Provisioning Responsibilities

The provisioning layer is reserved for environment and deployment concerns:

- WordPress environment creation.
- Plugin/theme provisioning.
- Docker, WP-CLI, hosting, and deployment recipes.
- Future multi-site or external deployment automation.

Provisioning should not be tightly coupled to the WordPress plugin UI.

## AI Safety Rule

AI must never mutate WordPress directly. AI may only produce a `BlueprintPatch` or `BlueprintCandidate` that is validated, previewed, confirmed by the user, applied deterministically, validated again, and recorded in a manifest.

## Safe Flow

`Prompt -> BlueprintPatch -> Preview Plan -> User Confirm -> Apply -> Validate -> Manifest`

This boundary preserves the current Real Estate beta flow while leaving room for future AI-assisted generation, repair, and deployment.
