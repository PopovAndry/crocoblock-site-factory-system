# Core Preview Response Contract

## Purpose

The Core preview response contract defines a read-only response shape that can later be returned by a plugin bridge endpoint and consumed by a dashboard.

This contract is Core-only for now. It does not add REST routes, does not modify the dashboard, and does not wire Core into `wordpress-plugin/`.

## Read-Only Guarantees

Every Core preview response must state:

- `mode` is `read_only`;
- `applied` is `false`;
- `runtime_mutation` is `false`;
- the message says nothing was applied.

The response must not pretend that WordPress runtime checks happened.

## Response Contents

The v1 response carries:

- Core availability and candidate validity;
- normalization status and warnings;
- validation status and checks;
- raw Core candidate review plan;
- product-facing formatted candidate review;
- placeholder plugin dry-run result;
- placeholder ownership report;
- next required step.

The plugin dry-run and ownership sections are intentionally placeholders:

- plugin dry-run requires `wordpress-plugin/` runtime and adapters;
- ownership checks require plugin runtime state;
- neither is executed by this Core-only response.

## Future Bridge Use

A future plugin-side bridge may expose this response through a REST endpoint. The bridge can later add real plugin dry-run and ownership data beside the Core review.

Recommended future flow:

`Prompt -> BlueprintCandidate -> Core Normalize -> Core Validate -> Core Preview Response -> Plugin Dry-run -> User Confirm -> Plugin Apply`

## What Must Not Be Included

This contract must not include:

- raw API keys or secrets;
- AI provider responses;
- WordPress runtime IDs inferred by Core;
- adapter execution traces from fake runtime work;
- manifest writes;
- apply/fix/reset results;
- hidden mutation flags.

## Example Runner

`core/tools/build-core-preview-response-example.php` rebuilds the response from the Real Estate baseline and candidate fixtures.

Run default compare mode:

```powershell
C:\OSPanel\modules\php\PHP_8.1\php.exe core\tools\build-core-preview-response-example.php
```

The runner compares against:

```text
core/examples/core-preview-response.example.json
```

The optional `--write-fixture` mode is for maintaining that Core example fixture only.
