# Reuse-first Capability Map

Goal:
Avoid rebuilding old system capabilities from scratch.

## Product target

Desired site state / Blueprint
→ Plan
→ Apply
→ Validate
→ Manifest / Proof
→ Doctor / Fix
→ Safe modifications through BlueprintPatch

## Rule

Before implementing a new Core or plugin feature, check:
1. Did old R&D system already have it?
2. Does current plugin already have it?
3. Does current Core already have a clean contract for it?
4. Should we reuse, wrap, port, rewrite, or discard it?

## Capability Matrix

| Capability | Old R&D | Current plugin | Current Core | Decision | Notes |
|---|---|---|---|---|---|
| Blueprint loading | Audit | Audit | Contract only | Audit | |
| Blueprint validation | Audit | Exists plugin-side | Exists Core-side | Compare | |
| Blueprint normalization | Exists but WP sanitizer-based and old-section oriented | Same as old; current runtime overlays style/image separately | Missing pure normalizer | PORT | Port concepts only; build Core pure normalizer for v0.2+ sections. |
| AI-safe flow | Unsafe full blueprint generation/direct apply path | Safer settings/local interpreter plus legacy generator remains | Interfaces and patch/candidate contracts | REWRITE | Rebuild as PromptInterpretation → BlueprintPatch/Candidate; no direct apply. |
| Ownership / user-editing safety | Limited/no dedicated layer in audited paths | Exists plugin-side with Factory markers, hashes, skip-on-user-edit | Missing policy contract | KEEP_PLUGIN_SIDE | Runtime markers stay WP-side; Core may model ownership policy later. |
| REST bridge / dashboard bridge | Exists but older | Product-ready but rest.php is monolithic | Bridge docs only | WRAP | Add thin read-only bridge contract before implementation. |
| Design profiles / style tokens / component variants | Minimal/legacy visual concepts | Style/image context, deterministic tokens, render consumption | RealEstateProfile defaults only | PORT | Add controlled Core design profiles; AI chooses profiles, not arbitrary CSS. |
| Dry-run / Plan | Exists via Factory_Dry_Run_Command | Exists via Factory_Dry_Run_Command | Patch preview only | Reuse/wrap plugin dry-run; do not rebuild runtime plan in Core | Adapter-driven plan already exists; Core preview should explain blueprint patch only. |
| Apply | Exists | Exists plugin-side | Not in Core | Keep plugin runtime | |
| Runtime validation | Exists adapter-driven | Improved plugin-side with new adapters/proof | Contract and desired-state validation only | Keep plugin-side runtime validation | Core validates blueprint shape; plugin validates real WordPress/Crocoblock state. |
| Manifest / Run storage | Exists via run manifest/registry/storage utilities | Exists plugin-side and richer with context/configurable storage | RunManifest contract only | Keep persistence plugin-side; Core may define schema/status rules | Current plugin adds context support and FACTORY_RUNS_DIR-based storage; do not duplicate run persistence in Core. |
| Doctor / Health | Exists via Factory_Doctor_Command / Factory_Health_Command | Exists plugin-side and improved with run storage helpers | Missing runtime | Keep plugin-side execution; Core may model health result shape later | Current plugin uses FACTORY_RUNS_DIR/factory_get_runs_registry_path; do not rebuild runtime doctor/health in Core. |
| Fix / Repair | Exists via Factory_Fix_Command | Exists via Factory_Fix_Command | RepairPlan contract only | Keep plugin-side execution; Core may model RepairPlan only | Old R&D and current plugin fix are identical/migrated; do not rebuild repair execution in Core. |
| Adapter registry | Exists | Improved plugin-side with queries/filters and dependency graph | Missing runtime | Keep plugin-side; Core may consume serialized capability report later | Current plugin registry is runtime source of truth; do not move adapter registry or dependency order into Core. |
| Adapter plan/apply/validate capabilities | Exists | Improved and complete plugin-side | Core contracts only | Wrap with future capability report | Keep runtime methods in plugin; expose serialized read-only capability report later. |
| AI generator | Exists | Exists plugin-side/mock | Interfaces only | Reuse only safe pieces | |
| Prompt cache | Audit | Audit | Missing | Audit | |
| User editing safety | Audit | Exists plugin-side | Missing | Preserve plugin-side | |
| Core Patch Preview | Not old | Not plugin-side yet | Exists | New safe layer | |

## Decisions

- Do not rebuild apply/validate/fix until old and plugin implementations are mapped.
- Do not move WordPress adapter runtime into Core.
- Use Core for contracts, patch safety, candidate blueprint, readable preview plan.
- Use plugin for WordPress mutation, adapters, REST, dashboard, run persistence.
- Use old R&D system as a reuse/reference source, not as code to blindly copy.

## Next audit targets

1. Dry-run / Plan
2. Fix / Repair
3. Manifest / Run storage
4. Adapter registry
5. AI generator