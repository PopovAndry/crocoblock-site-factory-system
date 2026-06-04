# Plugin Preview Bridge Response Builder

`PluginPreviewBridgeResponseBuilder` is the final Core-only composition layer for preview bridge examples.

It combines:

1. Core preview response.
2. Optional `RuntimeEvidence`.
3. `ApplyGatePolicy` output.
4. A read-only Plugin Preview Bridge response.

It does not implement the real plugin bridge. It does not call WordPress, Crocoblock APIs, plugin adapters, REST, dashboard code, AI providers, or runtime mutation paths.

## What The Builder Does

The builder accepts:

- a Core preview response array;
- optional RuntimeEvidence array.

If RuntimeEvidence is missing, the builder uses placeholder dry-run and ownership envelopes through `RuntimeEvidence::placeholder()`.

It composes a response with:

- `version: 1`
- `mode: read_only`
- `applied: false`
- `runtime_mutation: false`
- `core.preview`
- `plugin.dry_run`
- `ownership`
- optional `runtime_evidence`
- `apply_gate`

The built response is validated by `PluginPreviewBridgeValidator`.

## Difference From The Future Real Plugin Bridge

The real plugin bridge will run inside the WordPress plugin runtime. It may:

- call plugin dry-run adapters;
- perform ownership checks;
- inspect WordPress/Crocoblock runtime objects;
- collect runtime evidence from adapters;
- return actual runtime proof.

This Core builder does none of that. It only composes example data that already exists in `core/examples/`.

## RuntimeEvidence Use

RuntimeEvidence supplies the plugin dry-run and ownership sections:

```text
RuntimeEvidence
-> plugin_dry_run
-> ownership
-> apply_gate policy input
```

Without RuntimeEvidence, the builder uses placeholder evidence:

- dry-run is `not_run`;
- ownership is `not_checked`;
- apply gate is `blocked`;
- next required step is `plugin_dry_run`.

## ApplyGatePolicy Use

The builder derives an apply gate from evidence status:

| RuntimeEvidence status | Apply gate status | Next required step |
| --- | --- | --- |
| `not_ready` | `blocked` | `plugin_dry_run` |
| `ok` | `ready` | `user_confirmation` |
| `warning` | `warning` | `user_confirmation` |
| `error` | `error` | `resolve_conflicts` |

`ready` means ready for user confirmation. It does not mean apply now.

## Why `can_apply` Stays False

Core-only examples always use:

```json
"can_apply": false
```

Apply can only become possible in the future WordPress plugin runtime after:

1. real dry-run evidence;
2. real ownership evidence;
3. explicit user confirmation;
4. runtime permission checks.

The Core builder cannot collect confirmation and cannot mutate runtime state.

## Fixture Builder

Run:

```powershell
C:\OSPanel\modules\php\PHP_8.1\php.exe core\tools\build-plugin-preview-bridge-response-example.php
```

The tool builds and validates:

- `plugin-preview-bridge-response.placeholder-built.example.json`
- `plugin-preview-bridge-response.ready-built.example.json`
- `plugin-preview-bridge-response.warning-built.example.json`
- `plugin-preview-bridge-response.error-built.example.json`

Use `--write-fixtures` only to regenerate those Core example fixtures.

## Why This Is The Final Core-Only Composition Layer

Core now has contracts for:

- Core preview;
- plugin dry-run placeholder;
- ownership placeholder;
- RuntimeEvidence;
- ApplyGatePolicy;
- Plugin Preview Bridge response.

The next step should be analysis of a real plugin runtime bridge, not more Core simulation. Runtime behavior belongs in the WordPress plugin layer.

## What Must Not Happen In Core

Core must not:

- call WordPress functions;
- call Crocoblock APIs;
- call plugin adapters;
- add REST endpoints;
- edit dashboard behavior;
- execute dry-run;
- perform ownership checks;
- apply, fix, reset, or generate runtime state;
- write manifests or runtime files;
- infer runtime object IDs;
- let AI bypass runtime evidence, apply gate, and user confirmation.
