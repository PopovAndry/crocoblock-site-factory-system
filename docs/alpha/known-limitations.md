# Known Limitations

This alpha is intentionally narrow. These limitations are real and should be presented directly.

## Core Product Limits

- There is no live AI yet.
- Prompt personalization is a local deterministic interpreter, not a live provider response.
- The system is not production ready.
- There is no multi-vertical support yet.
- Elementor and WooCommerce generation are not part of this alpha path.

## State / Apply / Rollback Limits

- Safe apply after a protected `hero_title` frontend override requires field-scoped planning or an overwrite confirmation flow.
- `State Apply rollback v1` restores safe personalization fields only. It is not a full database, media, or full-site snapshot restore.
- Full drift detection is not implemented yet.
- Apply currently reuses the existing controlled generate mutation path, not a narrow field-only apply contract.
- Overwrite confirmation UX is not implemented yet.

## Dependency / Install Limits

- Dependency install uses user-provided local ZIPs only.
- The alpha does not bundle premium plugins.
- The alpha does not bypass Crocoblock licensing or premium download boundaries.

## UX / Runtime Limits

- There is no production UX polish yet.
- The embedded WordPress console is not the product surface; the Launcher is the intended control plane.
- PowerShell console output may show mojibake for Ukrainian prompt text, but JSON proof files were UTF-8 intact during Phase 13f.

## Frontend Editing Limits

- Frontend Safe Edit currently proves supported-field preview/save/proof on a generated site.
- This alpha does not add new frontend edit fields beyond the current safe allowlist.
