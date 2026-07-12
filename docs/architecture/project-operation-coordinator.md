# Project Operation Coordinator v1

Phase 19a makes the Launcher use one project-wide mutation coordinator for the local release path. The coordinator is a local single-machine safety layer, not a distributed job queue.

## Invariant

Only one project mutation may run for a given Launcher project at a time. The coordinated operation types are:

- `provision`
- `install_agent`
- `install_dependency`
- `controlled_generate`
- `state_apply`
- `state_rollback`

Project creation remains outside the coordinator because the project does not exist yet. Read-only routes such as setup status, plan preview, site status, proof-pack generation, and alpha smoke remain unwrapped.

## Persistence

Canonical operation records are stored under:

```text
C:\sf-factory-projects\<slug>\runs\operations\
```

New records use schema `factory_project_operation` v1 and are written atomically by writing a temporary file in the same directory, flushing it where practical, and renaming it into place.

The coordinator does not store raw prompts when a hash is enough, raw idempotency keys, credentials, authorization headers, environment dumps, stack traces, browser-supplied paths, or lock internals.

## Locking

The project lock is a filesystem directory:

```text
C:\sf-factory-projects\<slug>\runs\operations\.project-operation.lock\
```

Atomic directory creation coordinates the Launcher server, separate CLI processes, multiple browser requests, and accidentally concurrent Launcher instances. Lock metadata is safe operational metadata only. Browser-facing APIs never expose PID, process instance id, command line, or lock path.

## Lifecycle

The canonical order is:

1. validate project, operation type, idempotency key, and allowlisted semantic input
2. compute the server-side request fingerprint
3. check idempotency before acquiring the lock
4. acquire the project lock
5. check idempotency again
6. persist a requested operation
7. mark it running and heartbeat while active
8. call the existing business service
9. mark the operation succeeded or failed
10. release the lock in `finally`

No WordPress/runtime mutation should happen before lock acquisition and requested-operation persistence.

## Idempotency

Mutation routes accept the standard `Idempotency-Key` header. The raw key is validated, hashed, and never persisted.

Rules:

- same key + same fingerprint + `succeeded`: replay the prior safe result with `idempotent_replay=true`
- same key + same fingerprint + `requested` or `running`: return `409 project_operation_in_progress`
- same key + same fingerprint + `failed` or `interrupted`: return `409 operation_retry_requires_new_idempotency_key`
- same key + different fingerprint: return `409 idempotency_key_conflict`
- no key: preserve backward compatibility by generating a server-side key

Launcher UI and updated CLI mutation paths provide a key for each deliberate mutation action.

## Interrupted Operations

The coordinator does not retry, resume, or silently complete interrupted work.

A stale lock may be recovered when the owning process is no longer alive or its heartbeat is stale. Recovery quarantines the stale lock, marks the matching `requested` or `running` operation as `interrupted`, records a safe `operation_interrupted` error, removes the stale lock, and leaves follow-up decisions to the user/operator.

If a new-schema operation is `requested` or `running` but no active matching lock exists, reconciliation marks it `interrupted`.

## Legacy Compatibility

Existing Phase 18d `factory_generation_operation` records are preserved untouched. Readers normalize them into the operation history as `factory_project_operation`-shaped entries with `legacy=true`. New controlled generate operations write only the canonical project-operation schema.

## API/UI Surface

`GET /api/projects/:slug/operations?limit=20` returns safe operation history and active operation metadata. It validates the slug, returns `400 invalid_project_slug` for malformed slugs, `404 project_not_found` for missing projects, and does not expose lock internals or idempotency hashes.

The Launcher UI Project Operations panel is read-only. It shows the active operation, latest history, status, stage, proof reference, safe errors, and legacy badge. It does not provide retry, resume, force unlock, delete, edit JSON, apply, or rollback controls.

## Limitations

This is not a distributed worker system, not a persistent background queue, not automatic resume, and not full-site rollback. It is the local mutation-safety foundation for the current Launcher-first release path.
