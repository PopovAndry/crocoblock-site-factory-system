# RuntimeEvidence Contract

`RuntimeEvidence` is the Core-side contract for grouping plugin dry-run evidence and ownership evidence into one stable input object for future plugin preview bridge validation.

It is a contract only. It does not run dry-run. It does not perform ownership checks. It does not apply anything. It does not call WordPress, Crocoblock APIs, adapters, REST endpoints, dashboard code, AI providers, or runtime mutation paths.

## Why RuntimeEvidence Exists

The Plugin Preview Bridge needs two runtime evidence sources before it can calculate an apply gate:

1. Plugin dry-run evidence.
2. Plugin ownership evidence.

Those envelopes already exist separately:

- `plugin-dry-run-placeholder-contract.md`
- `ownership-placeholder-contract.md`

`RuntimeEvidence` groups them into one read-only object so future bridge validation can reason about evidence completeness before apply-gate policy is evaluated.

## Shape

```json
{
  "version": 1,
  "mode": "read_only",
  "source": "plugin_runtime",
  "status": "not_ready|ok|warning|error",
  "complete": false,
  "applied": false,
  "runtime_mutation": false,
  "message": "Runtime evidence has not been collected yet.",
  "plugin_dry_run": {},
  "ownership": {},
  "summary": {
    "dry_run_available": false,
    "ownership_available": false,
    "runtime_checks_complete": false,
    "blocking_errors": 0,
    "warnings": 0
  }
}
```

## Status Values

| Status | Meaning |
| --- | --- |
| `not_ready` | One or more runtime evidence sources are missing or placeholders. |
| `ok` | Dry-run and ownership evidence are complete and clean. |
| `warning` | Runtime evidence is complete but needs review. |
| `error` | Runtime evidence contains blocking errors or conflicts. |

## Rules

- `mode` must be `read_only`.
- `source` must be `plugin_runtime`.
- `applied` must be `false`.
- `runtime_mutation` must be `false`.
- `plugin_dry_run` must exist.
- `ownership` must exist.
- `complete` can be `true` only when dry-run and ownership are available and not placeholder states.
- Placeholder evidence must use `complete: false` and `status: not_ready`.
- Dry-run `error` makes RuntimeEvidence `error`.
- Ownership errors, conflicts, or locked unsafe items make RuntimeEvidence `warning` or `error`.
- RuntimeEvidence must not contain `can_apply`.
- RuntimeEvidence must not contain apply permissions.

## Difference From ApplyGatePolicy

RuntimeEvidence answers:

> What runtime evidence has the plugin collected?

ApplyGatePolicy answers:

> Given runtime evidence and preview constraints, what is the next safe step?

RuntimeEvidence never says whether apply is allowed. Apply readiness remains the responsibility of `ApplyGatePolicy`, documented in `apply-gate-policy-contract.md`.

## Why Core Cannot Produce Real Runtime Evidence

Core is blueprint-first and runtime-neutral. It cannot inspect:

- WordPress posts, terms, users, options, or metadata;
- JetEngine, JetSmartFilters, JetFormBuilder, Woo, or other Crocoblock runtime storage;
- plugin adapter state;
- current dashboard session state;
- generated object ownership markers.

The future WordPress plugin bridge will populate RuntimeEvidence from real dry-run and ownership checks.

## Relationship To Plugin Preview Bridge

`plugin-preview-bridge-contract.md` defines the future bridge response envelope. RuntimeEvidence can become an optional bridge input or response section that groups dry-run and ownership evidence before `apply_gate` is calculated.

The bridge can use RuntimeEvidence to decide whether the apply gate should be:

- `blocked`
- `ready`
- `warning`
- `error`

Core-only examples must still keep `can_apply: false`.

## Relationship To Crocoblock Adapter Roadmap

`crocoblock-adapter-roadmap.md` defines future runtime adapter responsibilities. Each adapter may contribute dry-run and ownership evidence. RuntimeEvidence is the shared container for that adapter-derived proof before apply.

## Examples

Valid fixtures:

- `runtime-evidence.placeholder.example.json`
- `runtime-evidence.ok.example.json`
- `runtime-evidence.warning.example.json`
- `runtime-evidence.error.example.json`

Invalid fixtures:

- `runtime-evidence.missing-dry-run.invalid.json`
- `runtime-evidence.missing-ownership.invalid.json`
- `runtime-evidence.claims-complete-with-placeholders.invalid.json`
- `runtime-evidence.invalid-status.invalid.json`
- `runtime-evidence.mutation-flag.invalid.json`

## Validator

The validator lives at:

```text
core/src/Bridge/RuntimeEvidenceValidator.php
```

Run the fixture suite:

```powershell
C:\OSPanel\modules\php\PHP_8.1\php.exe core\tools\validate-runtime-evidence-example.php
```

## What Must Not Happen In Core

Core must not:

- call WordPress functions;
- call Crocoblock APIs;
- run plugin dry-run;
- perform ownership checks;
- call adapters;
- add REST endpoints;
- edit dashboard behavior;
- apply, fix, reset, or generate runtime state;
- write runtime files or manifests;
- let AI bypass runtime evidence and apply-gate policy.

RuntimeEvidence is evidence language only. Runtime authority remains in the plugin.
