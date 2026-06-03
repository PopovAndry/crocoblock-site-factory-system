# Crocoblock Site Factory Plugin

Installable beta of the Crocoblock Site Factory engine.

This plugin packages the current WordPress/Crocoblock automation engine as a normal WordPress plugin. It preserves the Real Estate beta flow:

- Site Factory admin dashboard
- Real Estate prompt preview
- Preview plan
- Generate Real Estate Demo
- Validation proof
- Home page at `/`
- Properties catalog at `/properties/`
- GET-based property filters
- Experimental native JetSmartFilters proof page at `/properties-native/`
- Native `/property/` archive redirect to `/properties/`
- Single property pages
- Contact page at `/contact/`
- Run manifests and run history
- Optional WP-CLI commands when WP-CLI is available

## Requirements

- WordPress 6.0+
- PHP 8.0+
- Kava theme installed and active
- JetEngine plugin installed and active

The beta does not bundle or silently install commercial dependencies. The dashboard/API report missing dependencies and block the Real Estate generation action until required dependencies are active.

## Installation

1. Copy this directory to `wp-content/plugins/crocoblock-site-factory-plugin`.
2. Activate **Crocoblock Site Factory** in WordPress admin.
3. Open **Site Factory** in the WordPress admin menu.
4. Use **Preview plan** and **Generate Real Estate Demo**.

## Storage

Bundled presets live in the plugin:

- `presets/real-estate.json`
- `presets/job-board.json`

Bundled demo assets live in:

- `assets/real-estate/`

Generated runtime files live in WordPress uploads:

- `uploads/crocoblock-site-factory/blueprints/generated/`
- `uploads/crocoblock-site-factory/blueprints/cache/`
- `uploads/crocoblock-site-factory/runs/`
- `uploads/crocoblock-site-factory/reports/`

Imported images are normal WordPress Media Library attachments.

## REST

Factory REST endpoints are intended for authenticated administrators in this beta and require `manage_options`.

Key endpoints:

- `/wp-json/factory/v1/runs`
- `/wp-json/factory/v1/run/latest`
- `/wp-json/factory/v1/run/{file}`
- `/wp-json/factory/v1/doctor`
- `/wp-json/factory/v1/adapters`
- `/wp-json/factory/v1/beta/real-estate/plan`
- `/wp-json/factory/v1/beta/real-estate/apply`

## WP-CLI

WP-CLI commands are registered only when WP-CLI is available.

Examples:

```bash
wp factory health
wp factory doctor
wp factory latest
wp factory apply wp-content/plugins/crocoblock-site-factory-plugin/presets/real-estate.json
```

## Beta Scope

This repository is intentionally plugin-first and beta-focused. It does not include SaaS provisioning, external deployment, promoted native JetSmartFilters rendering on the main catalog, billing, queues, or rollback UI.

## Milestones

- [Clean install beta guide](docs/clean-install-beta.md)
- [v0.2 milestone](docs/v0.2-milestone.md)
