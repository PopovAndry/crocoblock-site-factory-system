# Clean Install Beta

This guide covers packaging and checking the installable Crocoblock Site Factory beta on a clean WordPress site.

## Build the Plugin ZIP

Use the project script from the repository root:

```powershell
.\tools\build-plugin-zip.ps1
```

The script uses `git archive` and creates:

```text
build/crocoblock-site-factory-v0.2-beta-git.zip
```

The archive root folder is:

```text
crocoblock-site-factory/
```

Use `git archive` for release ZIPs. Do not use PowerShell `Compress-Archive` for this beta package; a manually compressed ZIP failed during WordPress install with a directory-copy error around `crocoblock-site-factory\assets\`.

## Dependencies

Required:

- WordPress
- Kava theme
- JetEngine

Optional:

- JetSmartFilters, for the experimental `/properties-native/` proof page
- JetFormBuilder, for the generated Request Viewing form

If optional dependencies are missing, the stable Real Estate beta still uses fallback behavior where available.

## Clean Install Steps

1. Install WordPress.
2. Install and activate Kava.
3. Install and activate JetEngine.
4. Optional: install and activate JetSmartFilters.
5. Optional: install and activate JetFormBuilder.
6. Build the plugin ZIP with `.\tools\build-plugin-zip.ps1`.
7. Upload and activate the ZIP in WordPress admin.
8. Open **Site Factory**.
9. Optionally edit the dashboard prompt.
10. Optionally adjust the safe preset variables for agency, hero, and contact copy.
11. Click **Generate Real Estate Demo**.
12. Confirm the dashboard shows validation proof.

Before the first generation, the dashboard should show:

```text
No runs yet. Generate a demo to create the first validation proof.
```

## Expected Frontend Proof

After generation:

- `/` shows the generated Real Estate home page.
- `/properties/` shows the stable catalog with GET filters.
- `/properties-native/` shows the experimental native JetSmartFilters proof when JetSmartFilters is active.
- `/contact/` shows Contact and Request Viewing.
- A single property page opens and the Contact agency link routes to `/contact/?factory_property={slug}`.

## Expected Data Proof

In a clean install with JetEngine and JetSmartFilters active:

- Query Builder rows: `2`
  - `factory_real_estate_properties`
  - `native_list`
- Generated JetSmartFilters definitions: `3`
  - Purpose
  - Property Type
  - District

The Contact page should exist once as a page. The navigation menu should contain one Contact menu item.

## Known Beta Notes

- `/properties/` remains the stable beta catalog.
- `/properties/` uses Render Adapter GET filters.
- `/properties-native/` is a native JetSmartFilters proof page, not the promoted main catalog.
- Native JetSmartFilters rendering depends on `native_list` Query Builder and Listing Grid bindings.
- JetFormBuilder is optional; the Request Viewing fallback is a valid beta state.
- Prompt Testing v1 captures the dashboard prompt in the run manifest.
- Prompt Testing v1 Phase 2 supports explicit safe preset variables for selected copy fields only: agency name, hero title/subtitle, and contact title/intro.
- Prompt Testing v1 does not mutate schema, property content, filters, forms, queries, listings, media, or page topology.
- Build release ZIPs with `git archive` through `tools/build-plugin-zip.ps1`.
