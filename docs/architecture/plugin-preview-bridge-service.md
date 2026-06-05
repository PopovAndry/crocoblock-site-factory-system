# Plugin Preview Bridge Service

The plugin preview bridge service is an internal WordPress plugin runtime service that composes read-only runtime evidence into a Plugin Preview Bridge response-compatible array.

It is intentionally not exposed through REST or the dashboard yet.

## Location

```text
wordpress-plugin/includes/bridge/plugin-preview-bridge-service.php
```

The class is:

```php
Factory_Plugin_Preview_Bridge_Service
```

The convenience function is:

```php
factory_build_plugin_preview_bridge_response(
    array $blueprint,
    array $core_preview = [],
    array $ownership_targets = []
): array
```

## Purpose

Core can build blueprint-first preview plans, but it cannot inspect WordPress runtime state. The plugin preview bridge service stays inside the plugin and combines plugin-side runtime evidence with a Core-style preview response envelope.

This is the first internal composition layer after the separate dry-run and ownership evidence collectors.

## Inputs

The service accepts:

- `blueprint`: desired site state array;
- `core_preview`: optional Core preview response or summary array;
- `ownership_targets`: optional runtime target descriptors for ownership checks.

If `ownership_targets` is empty, the ownership collector returns a valid empty ownership check.

## Output Envelope

The response mirrors the existing Core Plugin Preview Bridge response examples as plain arrays:

- `version`
- `mode`
- `status`
- `applied`
- `runtime_mutation`
- `blueprint.summary`
- `core.preview`
- `plugin.dry_run`
- `ownership`
- `runtime_evidence`
- `apply_gate`
- `notices`
- `warnings`
- `errors`

The service does not import or instantiate Core PHP classes. It mirrors the contract shape only.

## Read-Only Guarantees

The service does not:

- add REST endpoints;
- edit dashboard UI;
- call `factory_apply_blueprint()`;
- run apply, fix, reset, or generate commands;
- write run manifests;
- create or update posts, terms, templates, listings, forms, filters, products, options, transients, or files;
- call Core autoloading;
- instantiate Core PHP classes.

The only runtime work it delegates is read-only evidence collection:

- plugin dry-run evidence from `Factory_Plugin_Dry_Run_Evidence_Collector`;
- ownership evidence from `Factory_Ownership_Evidence_Collector`.

Collector failures are converted into evidence errors instead of uncaught preview failures.

## RuntimeEvidence Representation

The service builds a RuntimeEvidence-compatible array with:

- `mode: read_only`;
- `source: plugin_runtime`;
- `applied: false`;
- `runtime_mutation: false`;
- `plugin_dry_run`;
- `ownership`;
- summary fields for evidence availability, completion, blocking errors, and warnings.

Runtime evidence status is:

- `error` when dry-run or ownership evidence reports errors;
- `not_ready` when a collector is unavailable;
- `warning` when ownership conflicts, locked items, user-modified items, or warnings exist;
- `ok` when both evidence sources are clean.

## ApplyGate Representation

The service builds an ApplyGatePolicy-compatible array.

`can_apply` is always `false` in this task because this is preview-only. A clean result means "ready for user confirmation", not "apply now".

Apply gate status is:

- `blocked` when required runtime evidence is unavailable or incomplete;
- `error` when runtime evidence has blocking errors;
- `warning` when runtime evidence requires review;
- `ready` when runtime evidence is clean and the next step is user confirmation.

## Relationship To Core Contracts

This service follows the shapes documented in:

- `plugin-preview-bridge-contract.md`
- `runtime-evidence-contract.md`
- `apply-gate-policy-contract.md`
- `plugin-dry-run-placeholder-contract.md`
- `ownership-placeholder-contract.md`

It does not make the plugin depend on Core code. The plugin remains installable as its own runtime package.

## Future Integration Points

Future tasks may add:

- a read-only REST endpoint;
- dashboard preview display;
- confirmation gate state;
- apply integration after explicit user confirmation.

Those integration points are not implemented here.
