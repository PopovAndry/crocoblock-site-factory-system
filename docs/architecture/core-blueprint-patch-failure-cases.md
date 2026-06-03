# Core BlueprintPatch Failure Cases

BlueprintPatch failure fixtures prove that Core rejects unsafe or ambiguous
patches before any WordPress runtime layer can see them.

This is still Core-only validation and in-memory application. It does not wire
Core into the plugin, mutate WordPress, execute adapters, call AI providers, or
change the Real Estate beta.

## Fixtures

The failure fixtures live under `core/examples/invalid/`.

| Fixture | Protection |
|---|---|
| `blueprint-patch.replace-missing-path.invalid.json` | A `replace` operation must target an existing value. |
| `blueprint-patch.add-to-non-array.invalid.json` | A patch cannot traverse through a scalar parent such as `site.name`. |
| `blueprint-patch.patch-root-document.invalid.json` | A patch cannot replace the root document directly. |
| `blueprint-patch.invalid-path.invalid.json` | Paths must be JSON-pointer-like and start with `/`. |
| `blueprint-patch.mutates-protected-runtime.invalid.json` | Patches cannot target protected runtime state or declare WordPress mutation. |

## Why Direct, Root, And Runtime Mutations Are Rejected

Core patches are safe desired-state proposals. They are not an execution API.

Root document replacement is too broad for v1 because it bypasses granular
review, plan generation, and safe user confirmation. Runtime paths such as
`/runtime`, `/wp`, `/wordpress`, `/database`, and `/secrets` are rejected because
Core must never mutate WordPress, databases, secrets, options, posts, or other
runtime state directly.

Deletion is also intentionally unsupported for now because removing generated
objects requires ownership and user-editing safety rules.

## Original Blueprint Immutability

The failure runner verifies that the original Blueprint array remains unchanged
after every failed patch attempt. That matters because future AI-assisted
BlueprintPatch proposals must be treated as untrusted input. Failed proposals
must not partially mutate the source desired state.

## Runner

From the integrated repository root:

```powershell
C:\OSPanel\modules\php\PHP_8.1\php.exe core\tools\apply-blueprint-patch-failure-examples.php
```

The runner loads `core/examples/real-estate-blueprint.example.json`, applies each
failure fixture in memory, expects an `error` validation status, and checks that
the original Blueprint hash is unchanged.

## Future AI Safety

When AI is restored, it should produce `BlueprintPatch` or `BlueprintCandidate`
artifacts only. These failure fixtures help ensure unsafe patches fail before
Preview Plan, user confirmation, plugin apply, runtime validation, and manifest
proof.
