# Agent Signed Authentication

This document records the local-first trust boundary between the standalone
Launcher and the Site Factory Agent REST API in WordPress.

## Boundary

Browser requests terminate at the local Launcher HTTP server. The browser never
receives the Agent signing secret and never signs Agent requests. Launcher
server-side services call WordPress through the canonical Agent client, which
adds signed request headers from the selected project's local credential.

The expected path is:

Browser -> local Launcher HTTP boundary -> Launcher Agent client -> signed Agent
request -> WordPress Agent signed-auth middleware -> replay and capability
checks -> existing Agent business service.

## Protocol

Current version: `factory-agent-hmac-v1`.

Each signed request includes these headers:

- `x-factory-agent-auth-version`
- `x-factory-agent-key-id`
- `x-factory-project-slug`
- `x-factory-agent-timestamp`
- `x-factory-agent-request-id`
- `x-factory-agent-body-sha256`
- `x-factory-agent-signature`

The canonical string is newline-delimited:

1. protocol version
2. key id
3. project slug
4. ISO timestamp
5. request id
6. uppercase HTTP method
7. normalized REST path, with `/wp-json` removed
8. canonical sorted query string
9. SHA-256 hash of the exact transmitted body bytes

The signature is HMAC-SHA256 using the shared project signing secret and is
encoded as base64url. Verification uses constant-time comparison.

## Freshness and Replay

Signed requests are accepted only within the configured freshness window:

- freshness: 300 seconds
- forward clock skew: 30 seconds

Each request id is single-use per credential inside the freshness window.
WordPress stores replay claims as hashed option names with autoload disabled,
using `add_option` as the atomic uniqueness primitive. Replay cleanup is
opportunistic.

## Credentials

Each Launcher project owns a separate local credential file:

`<project-root>/secrets/agent-auth.json`

The record contains the contract version, key id, signing secret, status,
timestamps, capabilities, and project slug. It is not written into project
manifests, proof files, operation records, browser responses, or support-style
summaries. The Launcher applies best-effort restrictive file permissions and
atomic file replacement.

WordPress stores the active Agent credential in the
`factory_agent_signed_auth_credentials` option with autoload disabled. The
shared secret is stored in plaintext because HMAC verification requires access
to it.

## Bootstrap and Migration

Initial bootstrap is limited to:

`POST /wp-json/factory/v1/agent/auth/bootstrap`

This route requires WordPress administrator authentication and `manage_options`.
It does not accept anonymous or signed-auth-only bootstrap. It accepts only the
credential material needed to establish the Launcher machine credential and
returns sanitized metadata.

Existing projects are migrated through the explicit Agent install/repair flow:
install or activate the Agent if needed, ensure a local signing credential,
bootstrap it through administrator authentication, then verify signed health and
capabilities. Operational callers do not silently fall back to Basic Auth or
cookie authentication after signed bootstrap fails.

## Rotation and Revoke

Credential lifecycle operations are signed Agent operations:

- `POST /wp-json/factory/v1/agent/auth/rotate`
- `POST /wp-json/factory/v1/agent/auth/revoke`

Rotation registers a new active key with capabilities no broader than the
current key, verifies it, promotes the local credential atomically, then revokes
the old key. Revoke requires explicit confirmation. No lifecycle response
returns a signing secret.

Automatic remote recovery, vault-backed keys, and user-facing rotation UX are
future work.

## Capabilities

Capabilities are selected server-side from the Agent route registry. The client
cannot supply or downgrade the required capability in headers or body.

Operational routes require signed authentication. The bootstrap route is the
only administrator-authenticated Agent setup route. Frontend Safe Edit routes
remain on their separate WordPress user plus nonce boundary and are intentionally
not converted to Launcher HMAC authentication.

## Request Limits

The signed Agent permission boundary rejects unsafe requests before business
handlers run:

- body size over 64 KiB: `agent_request_body_too_large`
- non-JSON bodies for JSON mutation/planning methods: `agent_unsupported_media_type`
- per-key/per-route-class rate excess: `agent_rate_limit_exceeded`

Current rate classes:

- read routes: 600/minute
- planning and estimate routes: 120/minute
- mutation routes: 30/minute
- credential lifecycle routes: 10/minute

Rate limit responses include safe retry metadata and do not reveal secrets.

## Safe Errors

Agent authentication and limit failures return stable codes and sanitized
messages. Responses do not include the signing secret, expected signature,
canonical request, request body, stored key list, Authorization headers, database
queries, stack traces, or filesystem paths.

## Limitations

This is a local-first security boundary. It does not provide TLS confidentiality
over a hostile network, cloud identity, external vault storage, distributed
nonce storage across multiple WordPress servers, or protection from a malicious
local OS administrator who can read project and database files. Remote hosting
requires a separate hardened transport and identity phase.
