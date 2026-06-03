# Crocoblock Site Factory System

This repository is the integrated Crocoblock Site Factory system repository.

Site Factory is blueprint-first: product intent, AI assistance, planning, runtime apply, validation, repair, and proof should move through explicit blueprint state instead of ad hoc WordPress mutations.

## Repository Areas

- `core/` is reserved for Core Engine modules: blueprint modeling, patching, planning, validation, manifests, AI-safe interpretation, and product logic.
- `wordpress-plugin/` contains the installable WordPress runtime cockpit and product shell. In Phase 1 it is copied as-is from the current plugin-first beta.
- `provisioning/` is reserved for deployment and environment provisioning references.
- `blueprints/` is reserved for canonical integrated-system blueprint examples and generated runtime artifacts.
- `docs/` contains architecture notes for the integrated system.
- `tools/` is reserved for system-level developer and release tooling.
- `reference/` contains legacy R&D materials only. These files are not wired into the Core Engine or WordPress plugin in Phase 1.

## Phase 1 Status

Phase 1 creates the integrated repository skeleton and copies committed source snapshots for reference/package layout only. No behavior has been changed, no plugin paths have been refactored, and no Core extraction or AI/runtime coupling has been performed.
