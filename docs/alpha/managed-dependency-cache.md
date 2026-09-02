# Managed Dependency Cache

Phase 19d-a moves dependency onboarding behind a Launcher-managed package boundary.

The browser may request an approved dependency by key, such as `kava`, `jet-engine`, or `jet-smart-filters`. It may not provide a local ZIP path, URL, checksum, cache path, command, or arbitrary filesystem location.

## Flow

1. The Launcher resolves the dependency key through the trusted catalog.
2. The development-local provider maps that key to the configured vendor directory.
3. The ZIP is copied into quarantine.
4. The raw ZIP SHA-256 is computed.
5. The ZIP central directory is checked for unsafe entries.
6. The expected WordPress product identity file and version header are validated.
7. The ZIP is copied into the immutable content-addressed cache.
8. A server-issued install plan is written under the project runtime.
9. The install mutation consumes that plan and installs only from the verified cache.

## Approved Development Sources

The default development vendor directory is `C:\sf-vendor`.

Approved package keys:

- `kava`
- `jet-engine`
- `jet-smart-filters`
- `jet-form-builder`

The API response can expose only safe inventory data:

- dependency key
- display label
- ZIP filename
- availability
- file size

It must not expose the absolute vendor path or any environment value.

### JetFormBuilder onboarding

| CSF key | Approved filename | Native package mapping |
| --- | --- | --- |
| `jet-form-builder` | `jet-form-builder.zip` | `wp_slug` and ZIP root `jetformbuilder`; identity `jetformbuilder/jet-form-builder.php` |

The onboarded package is JetFormBuilder `3.6.5.1`, 4,038,716 bytes, SHA-256
`1cb8319f7e8d590b7268c9387465dd563a3d916a6bbc006857479b9f34180376`.
Its origin is a user-confirmed manual download from WordPress.org. Build verified
local path safety, ZIP structure, native identity, header, version, size, and
digest. Independent byte-for-byte correspondence with an official archive is
not proven.

The Windows package builder includes every current catalog entry, so the next
Windows package build requires the fourth approved ZIP, `jet-form-builder.zip`.
Archive-only vendor copies are not catalog inputs and are not packaged.
JetFormBuilder is optional for the current Real Estate Create Website required
dependency set and does not add a Generate readiness blocker.

## What This Does Not Do

- It does not download packages from the internet.
- It does not let the browser upload or select packages.
- It does not accept arbitrary checksums from the browser.
- It does not prove public package distribution rights.
- It does not implement package signing or revocation.

The cache is local plaintext filesystem storage. It is content-addressed and project-local to the Factory workspace, but it is not an external package vault.
