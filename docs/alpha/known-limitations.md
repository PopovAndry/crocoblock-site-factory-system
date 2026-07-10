# Known Limitations

This alpha is intentionally narrow. These limitations are real and should be presented directly.

## AI Limits

- Live AI is enabled only for desired-state candidate planning.
- Live AI must not mutate WordPress directly.
- Live AI still requires explicit estimate, `enable-live`, and `--confirm-live` gates.
- Local deterministic prompt personalization still exists and remains the default path.

## State / Apply / Rollback Limits

- `field_only_safe_apply` covers only the current safe allowlist:
  - `agency_name`
  - `hero_title`
  - `hero_subtitle`
  - `hero_cta_text`
- `State Apply rollback v1` restores safe personalization fields only. It is not a full database, media, or full-site snapshot restore.
- Full drift detection is not implemented yet.
- Rollback-aware reporting is fixed, but this is still a Launcher-managed state layer rather than a full Terraform state engine.

## Dependency / Install Limits

- Dependency install uses user-provided local ZIPs only.
- The alpha does not bundle premium plugins.
- The alpha does not bypass Crocoblock licensing or premium download boundaries.

## UX / Runtime Limits

- There is no production UX polish yet.
- The embedded WordPress console is not the product surface; the Launcher is the intended control plane.
- PowerShell console output may still show mojibake for Ukrainian prompt text in some terminals even when JSON proofs are UTF-8.

## Frontend Editing Limits

- Frontend Safe Edit currently proves supported-field preview/save/proof on a generated site.
- This alpha does not add new frontend edit fields beyond the current safe allowlist.

## Scope Limits

- No multi-vertical support yet.
- Elementor and WooCommerce generation are not part of this alpha path.
- The proof-pack command is a read-only summarizer. It does not replace the underlying mutation proofs.
