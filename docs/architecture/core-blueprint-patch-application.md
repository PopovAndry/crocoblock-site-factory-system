# Core BlueprintPatch Application

BlueprintPatch application is the Core-only step between a proposed change and
any WordPress runtime action.

The purpose is to turn:

```text
BlueprintDocument + BlueprintPatch
```

into:

```text
Candidate Blueprint + Preview Plan + ValidationResult
```

This happens in memory only. It does not write files, call WordPress, execute
adapters, mutate posts, or call AI providers.

## Why Patch Application Happens In Core

Site Factory is a blueprint-first system. Future user edits, product controls,
and AI-assisted suggestions should change blueprint state first, not live
WordPress objects.

Core patch application lets the system:

- Validate the current Blueprint shape.
- Validate the patch shape.
- Apply a conservative patch model in memory.
- Validate the candidate Blueprint.
- Produce a simple preview Plan.
- Require user confirmation before plugin runtime apply.

## Supported v1 Operations

Core v1 supports a small safe subset:

- `set`
  - Sets a value at a JSON-pointer-like path.
  - May create the final key if the parent exists.

- `add`
  - Adds a value to an object key or list index.
  - Supports `-` as append for list paths.

- `replace`
  - Replaces an existing value.
  - Fails if the target value does not exist.

All operations require:

- `op`
- `path`
- `value`

## Rejected Unsafe Operations

Core v1 rejects:

- `direct_apply`
- `wordpress_mutation`
- `php_code`
- `callback`
- `delete`
- `remove`
- Any operation declaring direct runtime mutation flags.

Deletion is intentionally not supported yet. Removing generated objects has
ownership, safety, and user-editing implications that need a richer policy.

## Candidate Blueprint Is Not Runtime State

A candidate Blueprint is a proposed desired-state document after applying a
patch in memory. It is not proof that WordPress changed.

Runtime changes still require:

```text
Preview Plan
-> User Confirm
-> Plugin Apply
-> Runtime Validate
-> Manifest / Proof
```

The WordPress plugin remains responsible for actual runtime mutations, adapters,
REST, dashboard UI, capability checks, and live-site validation.

## Examples And Runner

Patch examples:

- `core/examples/blueprint-patch.real-estate-safe.example.json`
- `core/examples/blueprint-patch.real-estate-unsafe.invalid.json`
- `core/examples/blueprint-patch-apply-result.example.json`

The local runner:

```powershell
C:\OSPanel\modules\php\PHP_8.1\php.exe core\tools\apply-blueprint-patch-example.php
```

loads the Real Estate Blueprint example, applies the safe patch in memory, and
prints the candidate site name plus plan summary.

## Not AI Integration Yet

This is not prompt-to-blueprint generation. No AI provider is called, and no AI
output is trusted or applied.

Future AI may propose `BlueprintPatch` or `BlueprintCandidate` artifacts, but
those artifacts must pass validation, preview, and user confirmation before any
runtime apply.
