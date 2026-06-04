# Apply Gate Policy Contract

The Apply Gate is the preview-time policy that decides the next safe step after Core preview, plugin dry-run, and ownership checks.

It does not apply anything. It does not call WordPress. It does not call Crocoblock APIs. It does not execute adapters. It only states whether a future plugin preview response is blocked, needs review, has errors, or is ready for user confirmation.

## Gate Shape

```json
{
  "status": "blocked|ready|warning|error",
  "can_apply": false,
  "requires_user_confirmation": true,
  "blocking_reasons": [],
  "warnings": [],
  "next_required_step": "plugin_dry_run|ownership_check|user_confirmation|apply|resolve_conflicts"
}
```

## Status Meanings

| Status | Meaning |
| --- | --- |
| `blocked` | Required runtime evidence is missing, unsafe, or unresolved. |
| `ready` | Runtime evidence is clean and the next step is user confirmation. |
| `warning` | Runtime evidence exists but the user must review warnings or ownership concerns. |
| `error` | Runtime dry-run or ownership evidence contains hard errors. |

## Ready Does Not Mean Apply Now

`ready` means:

> Ready for user confirmation.

It does not mean:

> Apply immediately.

In Core-only examples, `can_apply` remains `false` for every status, including `ready`.

Actual apply may only become possible in the future WordPress plugin runtime after explicit confirmation and runtime-controlled permission checks.

## Required Evidence

The gate depends on runtime evidence that Core cannot produce:

1. Plugin dry-run result.
2. Plugin ownership check.
3. User confirmation.

If plugin dry-run is missing, unavailable, or `not_run`:

- `status` must be `blocked`;
- `can_apply` must be `false`;
- `next_required_step` should be `plugin_dry_run`.

If ownership is missing, unavailable, or `not_checked`:

- `status` must be `blocked`;
- `can_apply` must be `false`;
- `next_required_step` should be `ownership_check`.

If plugin dry-run has `error`:

- `status` must be `error`;
- `can_apply` must be `false`;
- `next_required_step` should be `resolve_conflicts`.

If ownership has errors, conflicts, locked items, or unsafe user-modified items:

- `status` must be `blocked`, `warning`, or `error`;
- `can_apply` must be `false`;
- `next_required_step` should be `resolve_conflicts` or `user_confirmation`.

If plugin dry-run is `ok`, ownership is `ok`, no blocking conflicts exist, and user confirmation has not been collected:

- `status` may be `ready`;
- `can_apply` must still be `false`;
- `requires_user_confirmation` must be `true`;
- `next_required_step` should be `user_confirmation`.

## Relationship To Plugin Preview Bridge

`plugin-preview-bridge-contract.md` defines the larger response envelope:

```text
Core preview
-> Plugin dry-run
-> Ownership check
-> Apply gate
```

The Apply Gate is the policy section that explains whether the preview is ready for confirmation, blocked by missing evidence, or unsafe due to conflicts/errors.

## Relationship To Placeholder Contracts

When `plugin-dry-run-placeholder-contract.md` or `ownership-placeholder-contract.md` placeholders are present, the gate must remain blocked and `can_apply` must remain false.

Placeholders are not runtime evidence.

## Relationship To Future Dashboard

A future dashboard can translate the gate into user-facing states:

- "Run plugin dry-run first."
- "Check ownership before applying."
- "Review warnings before continuing."
- "Ready for confirmation."
- "Resolve conflicts."

The dashboard must not treat `ready` as an instruction to apply automatically.

## Validator

The Core-only validator lives at:

```text
core/src/Bridge/ApplyGatePolicyValidator.php
```

Run the fixture suite:

```powershell
C:\OSPanel\modules\php\PHP_8.1\php.exe core\tools\validate-apply-gate-policy-example.php
```

Valid examples:

- `apply-gate.blocked-placeholder.example.json`
- `apply-gate.ready-for-confirmation.example.json`
- `apply-gate.warning-needs-review.example.json`

Invalid fixtures:

- `apply-gate.ready-without-dry-run.invalid.json`
- `apply-gate.ready-without-ownership.invalid.json`
- `apply-gate.ready-without-user-confirmation.invalid.json`
- `apply-gate.can-apply-while-blocked.invalid.json`
- `apply-gate.invalid-status.invalid.json`

## What Must Not Happen In Core

Core must not:

- call WordPress functions;
- call Crocoblock APIs;
- call plugin adapters;
- run plugin dry-run;
- perform ownership checks;
- collect user confirmation;
- apply, fix, reset, or generate runtime state;
- write runtime files or manifests;
- allow AI to bypass dry-run, ownership, and confirmation gates.

The Apply Gate is policy language only. Runtime authority remains in the plugin.
