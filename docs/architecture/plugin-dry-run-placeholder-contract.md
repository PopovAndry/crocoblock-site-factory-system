# Plugin Dry-Run Placeholder Contract

The Core Engine can build a read-only preview from a blueprint candidate, but it cannot know what the live WordPress runtime would create, update, skip, or reject. That runtime knowledge belongs to the WordPress plugin adapters.

This document defines the placeholder contract used inside Core preview responses until a real plugin dry-run bridge exists.

## Why The Placeholder Exists

Core preview is deliberately pure:

- it validates blueprint and patch shapes;
- it normalizes candidate blueprint state;
- it builds human-readable Core preview plans;
- it does not call WordPress functions;
- it does not call Crocoblock APIs;
- it does not execute plugin adapters;
- it does not mutate runtime state.

The placeholder makes that boundary explicit instead of pretending the Core preview is a full runtime plan.

## Current Placeholder Shape

```json
{
  "available": false,
  "status": "not_run",
  "source": "plugin_runtime",
  "message": "Plugin dry-run is not part of this Core-only preview response.",
  "summary": {
    "create": 0,
    "update": 0,
    "delete": 0,
    "skip": 0,
    "warning": 0,
    "error": 0
  },
  "items": [],
  "requires_runtime": true,
  "next_required_step": "plugin_dry_run"
}
```

The placeholder is produced by `Crocoblock\SiteFactory\Core\Bridge\PluginDryRunPlaceholder`.

## Future Runtime Dry-Run Shape

A future plugin runtime bridge should replace the placeholder with the same envelope:

```json
{
  "available": true,
  "status": "ok|warning|error",
  "source": "plugin_runtime",
  "message": "Plugin dry-run completed.",
  "summary": {
    "create": 0,
    "update": 0,
    "delete": 0,
    "skip": 0,
    "warning": 0,
    "error": 0
  },
  "items": []
}
```

The envelope should remain stable so dashboard and review UI can display Core preview and plugin dry-run results side by side.

## Future Item Shape

Plugin dry-run items should be product-readable but retain enough adapter detail for diagnosis:

```json
{
  "action": "create|update|delete|skip|warning|error",
  "adapter": "content|render|filters|queries|forms|commerce|...",
  "type": "runtime_action",
  "entity": "human-readable entity",
  "message": "What plugin runtime would do",
  "path": "/optional/blueprint/path",
  "details": {}
}
```

## Core Preview Versus Plugin Dry-Run

Core preview answers: "What does this blueprint or patch intend to change?"

Plugin dry-run answers: "What would the current WordPress runtime actually do if asked to apply this desired state?"

Both are needed before safe mutation. Core remains the blueprint-first planning layer; the plugin remains the runtime cockpit and adapter host.

## Safety Rules

- Core must not call WordPress directly.
- Core must not call Crocoblock plugin APIs directly.
- Core must not execute plugin adapters.
- Core must not write runtime files or database rows.
- AI must not bypass this boundary by applying changes directly.
- Future AI output must still become `BlueprintPatch` or `BlueprintCandidate` first.

## Dashboard Preview Relationship

The dashboard can eventually show:

1. Core candidate review.
2. Plugin dry-run result.
3. Ownership or user-editing safety checks.
4. Final user confirmation before apply.

Until plugin dry-run is wired, the placeholder should be shown as a clear "requires runtime" state, not as a failure.

## Roadmap Relation

This contract aligns with the future Crocoblock adapter capability roadmap: plugin adapters will report runtime actions, supported capabilities, skipped optional integrations, and hard blockers through the dry-run envelope without moving WordPress-specific logic into Core.
