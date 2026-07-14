# Launcher HTTP Security Boundary

The Launcher HTTP server is a local-first control surface for one user on one machine.
It is intended to run on loopback, normally at `http://127.0.0.1:3847`, and serve the
standalone Launcher UI plus its project-scoped API routes.

## Threat Model

This boundary protects against:

- public webpages attempting browser POST requests to the local Launcher;
- DNS rebinding through attacker-controlled hostnames resolving to loopback;
- untrusted `Origin`, `Host`, content type, and malformed JSON inputs;
- oversized JSON bodies reaching route business logic;
- future unsafe HTTP methods bypassing CSRF protection by default;
- accidental exposure on non-loopback interfaces;
- CSRF token leakage through URLs, errors, proofs, operation records, or logs.

Out of scope:

- malware or a malicious user already running as the local OS account;
- cloud multi-tenancy or remote identity;
- distributed denial of service;
- TLS termination;
- Launcher-to-Agent authentication, which is handled by the signed Agent auth layer.

## Loopback Binding

The Launcher defaults to `127.0.0.1` and rejects non-loopback remote addresses before
static or API route handling. Accepted remote addresses are loopback forms such as
`127.0.0.1`, `::1`, and IPv4-mapped loopback.

## Host Validation

Every request, including HTML, static assets, and API routes, must use an allowed Host
for the configured Launcher port:

- `127.0.0.1:<port>`
- `localhost:<port>`
- IPv6 loopback only where represented by the runtime as loopback

Unexpected hostnames, missing Host, malformed Host, and wrong ports are rejected with
`host_not_allowed`. Proxy headers such as `X-Forwarded-Host` are ignored.

## Same-Origin And CSRF

Unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`) require:

- allowed loopback remote address;
- allowed Host;
- same-origin `Origin`;
- `X-Factory-CSRF-Token`;
- JSON content type for JSON API bodies.

The CSRF token is generated once per Launcher process from at least 32 random bytes.
It is held in memory only, changes on restart, and is exposed only through:

`GET /api/security/session`

The session response includes the token in JSON so the same-origin Launcher UI can keep
it in browser memory. The token is not stored in project files, proofs, operation
records, URLs, or logs.

## CORS

The Launcher does not support cross-origin browser access. It does not emit wildcard
CORS headers or reflect arbitrary origins. Same-origin preflight requests may receive
the narrow methods and headers required by the Launcher UI, including
`X-Factory-CSRF-Token`.

## JSON Body Limits

JSON API requests are limited to 64 KiB. Oversized bodies are rejected with
`request_body_too_large` before route business logic runs. Malformed JSON is rejected
with `invalid_json_body`, and unsupported content types are rejected with
`unsupported_media_type`.

## Rate Limits

The boundary applies small in-memory single-process limits by route class and loopback
remote address:

- security session: 60 requests per minute;
- read-only API/status polling: 600 requests per minute;
- planning/preview POST routes: 60 requests per minute;
- coordinated mutation routes: 30 requests per minute.

These limits are defense in depth for local misuse and are not distributed rate
limiting.

## Security Headers

Launcher responses include non-breaking security headers such as:

- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: no-referrer`;
- `X-Frame-Options: DENY`;
- a restrictive `Permissions-Policy`;
- `Cache-Control: no-store` for HTML/API/session responses.

The HTML response uses a nonce-based Content Security Policy compatible with the
existing inline Launcher config and self-hosted static assets.

## Error Contract

Security failures use the standard API shape:

```json
{
  "status": "error",
  "code": "csrf_token_required",
  "message": "safe message"
}
```

The error serializer redacts sensitive headers, filesystem paths, tokens, and internal
details. Security errors do not include supplied Host, Origin, CSRF token, request body,
stack traces, process ids, or environment values.

