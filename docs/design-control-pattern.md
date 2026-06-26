# Design Control Pattern

This pattern keeps new executable design controls small, honest, and easy to prove.
It is meant for controlled enum-based design inputs such as palette presets, hero
variants, card variants, and future layout switches.

The goal is not arbitrary design generation. The goal is:

`prompt -> normalized design_profile -> preview/proof -> deterministic runtime consumption`

## What A Design Control Must Do

Each new design control should move through the same checkpoints:

1. Normalize a constrained input value in the AI/schema layer.
2. Declare capability status honestly:
   - `planning_supported`
   - `preview_supported`
   - `runtime_supported`
   - `apply_supported`
3. Surface the choice in preview/diff.
4. Surface authoritative proof in preflight/confirmation.
5. Bridge the value into deterministic runtime/apply context.
6. Persist the value into blueprint/runtime state where the renderer can consume it.
7. Prove the result with a read-only smoke and, when needed, a disposable exact-generate smoke.

## Keep The Contract Small

Use enum values only.

Do:

- `palette.preset = slate`
- `hero_variant = centered_overlay`

Do not:

- accept raw HTML
- accept raw CSS
- accept arbitrary classes
- accept raw PHP/JS
- accept raw hex colors as authoritative runtime input

## Implementation Checklist

For a new design control:

1. Add or extend the normalized schema value.
2. Add prompt detection only if it is small and deterministic.
3. Update the capability matrix with truthful support status.
4. Add preview/diff reporting.
5. Add authoritative preflight proof.
6. Add authoritative confirmation proof.
7. Bridge the value into runtime/apply context.
8. Persist it where deterministic rendering can read it.
9. Add a read-only regression guard if the bridge is easy to isolate.
10. Add or update a smoke spec under `core/examples/design-controls/`.

## Smoke Harness

Use:

```powershell
.\tools\smoke-design-control.ps1 `
  -RuntimePath C:\sf-slate-visual-smoke `
  -Spec .\core\examples\design-controls\palette-slate.json
```

Read-only mode is the default.

Exact generate is blocked unless all of these are true:

- `-Mode ExactGenerate`
- `-AllowMutation`
- runtime is not `C:\sf-playable-beta`

Example exact-generate command for a disposable runtime only:

```powershell
.\tools\smoke-design-control.ps1 `
  -RuntimePath C:\sf-slate-visual-smoke `
  -Spec .\core\examples\design-controls\hero-centered-overlay.json `
  -Mode ExactGenerate `
  -AllowMutation
```

## Spec Shape

Each spec is a compact JSON file with:

- `name`
- `prompt`
- `site_type`
- `assertions`
- `exact_generate`

`assertions` is keyed by standard AI rail stage:

- `site-plan`
- `blueprint-candidate`
- `preview-diff`
- `generate-gate`
- `generate-preflight`
- `generate-confirmation`
- optional `controlled-generate`

The harness treats each assertion object as a subset match against the stage body.

## Standard AI Rail

The harness runs the existing local deterministic rail in this order:

1. `/factory/v1/ai/site-plan`
2. `/factory/v1/ai/blueprint-candidate`
3. `/factory/v1/ai/preview-diff`
4. `/factory/v1/ai/generate-gate`
5. `/factory/v1/ai/generate-preflight`
6. `/factory/v1/ai/generate-confirmation`

In read-only mode it also verifies:

- `provider_called = false`
- `applies_changes = false`
- page/property/attachment counts remain stable

## When To Use Disposable Exact Generate

Use exact-generate smoke only when a design control claims:

- `runtime_supported = true`
- `apply_supported = true`

and only when the control has a visible runtime effect that needs frontend proof.

Examples:

- palette token changes
- hero layout variants
- template/card variants

Do not run exact generate in shared runtimes.

## What This Pattern Does Not Do

This pattern does not:

- redesign the dashboard
- change provider behavior
- add OpenAI usage
- replace deterministic apply logic
- authorize arbitrary creative generation

It is a bounded delivery pattern for safe executable design controls.
