# Server-owned Runtime Binding v1

Runtime Binding v1 binds a Factory project record to the disposable runtime that
the Launcher created for it. It is an execution precondition, not an API for
choosing a project from inside WordPress.

## Authoritative lifecycle

For a new project, the Launcher writes the host record in this order:

1. `runtime_binding` is persisted as `pending`.
2. It atomically promotes `runtime-binding-v1.json` in the runtime directory.
3. It writes the canonical `docker-compose.yml` with the artifact mounted
   read-only at `/run/csf/project-binding.json` in both `wordpress` and
   `wpcli`.
4. It re-reads the artifact, checks its SHA-256 and exact Compose bytes, then
   atomically promotes the host record to `ready`.

The only v1 artifact schema is:

```json
{
  "schema_version": 1,
  "binding_kind": "server_owned_runtime_binding",
  "project_id": "<uuid>",
  "project_slug": "<slug>"
}
```

The host record is either:

```json
{ "schema_version": 1, "status": "pending", "artifact": "runtime-binding-v1.json" }
```

or:

```json
{ "schema_version": 1, "status": "ready", "artifact": "runtime-binding-v1.json", "sha256": "<sha256>" }
```

`project_id`, `slug`, artifact name, and a ready record's SHA-256 are immutable
through ordinary project saves. There is no automatic repair or legacy
backfill. A record without `runtime_binding` is reported in memory as
`unbound_legacy`, remains compatible with existing general Provision/Agent
flows, and cannot satisfy a Binding-v1-only workflow.

## Host gate

Before a declared v1 project can reach Docker in Provision or Agent install,
the Launcher validates the strict project inventory, direct runtime path,
non-reparse artifact, exact payload, stored SHA-256, and byte-for-byte
canonical Compose. Any missing, pending, malformed, rewritten, duplicate,
writable, or alternate mount fails closed with a sanitized error.
Every guarded `docker compose` command then passes that runtime's canonical
`docker-compose.yml` with `-f` and removes inherited `COMPOSE_FILE`, so the
validated file is also the one Docker executes.

The PHP reader has no parameters and reads only
`/run/csf/project-binding.json`. It bounds input size and requires exact keys,
kind, UUID, and slug. It neither writes state nor registers a route. The
Request Viewing fixture rejects project identity supplied through its own
environment or request inputs and uses only that fixed reader.

## Scope and limit

This is not a cryptographic lifecycle and it does not claim to prove that a
human never invokes WP-CLI directly on a correctly bound local host runtime.
It rejects caller-selected identity and validates the Launcher-owned runtime
lineage; host administrator and local filesystem TOCTOU threats remain outside
v1. Read-only tests cover the artifact, host gate, PHP parser, and fixture
preflight. A future authorized disposable runtime trial is required to prove a
container refuses writes through the `:ro` mount.
