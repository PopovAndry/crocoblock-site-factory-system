# Installable ZIP Smoke — v0.2 Beta

## Summary

Installable ZIP smoke passed for Crocoblock Site Factory beta package.

## Source checkpoint

- Repository: `C:\crocoblock-site-factory-system`
- Branch: `main`
- Commit: `ad47c6f`
- Commit title: `Add live AI interpretation stub endpoint`
- Working tree before ZIP build: clean

## ZIP package

Generated with canonical packaging script:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\build-plugin-zip.ps1
````

Generated ZIP:

```text
C:\crocoblock-site-factory-system\build\crocoblock-site-factory-v0.2-beta-system-ad47c6f.zip
````

Build output:

```text
Source tree: wordpress-plugin/
Archive root: crocoblock-site-factory/
Commit: ad47c6f
Size: 19.93 MB
```

## ZIP structure check

Expected plugin root was confirmed:

```text
crocoblock-site-factory/
crocoblock-site-factory/crocoblock-site-factory.php
crocoblock-site-factory/admin/
crocoblock-site-factory/assets/
crocoblock-site-factory/includes/
crocoblock-site-factory/presets/
```

No unwanted system-level folders were found in the package:

```text
core/
blueprints/
wordpress-plugin/
tools/
build-plugin-zip.ps1
```

The duplicate plugin packaging script was previously removed. Only the canonical root script remains:

```text
tools/build-plugin-zip.ps1
```

## Disposable runtime

Created clean Docker runtime:

```text
C:\sf-zip-smoke
```

Runtime URL:

```text
http://localhost:8099
```

WordPress was installed successfully with:

```text
admin / admin
```

## Plugin install result

Installed from ZIP:

```powershell
wp plugin install /build/crocoblock-site-factory-v0.2-beta-system-ad47c6f.zip --activate
```

Result:

```text
Plugin installed successfully.
Plugin 'crocoblock-site-factory' activated.
```

Plugin list confirmed:

```text
crocoblock-site-factory | active | 0.1.0-beta
```

## REST stub smoke

The live AI stub route was verified through `wp eval-file`.

Result:

```text
interpret-live route OK
http_status=200
status=disabled
code=live_ai_not_implemented
applies_changes=false
provider_called=false
```

This confirms:

* `/factory/v1/ai/interpret-live` exists.
* The endpoint is reachable.
* The endpoint is intentionally disabled.
* No provider call is made.
* No site changes are applied.

## Frontend smoke

Frontend returned HTTP 200:

```text
StatusCode: 200
```

## Result

PASS.

The package is installable as a normal WordPress plugin ZIP. The plugin activates successfully in a clean WordPress runtime. The live AI stub endpoint is registered and safely disabled. The frontend remains reachable.

## Notes

This was a ZIP install smoke only.

Full Real Estate generation was not tested in this clean runtime because required demo dependencies such as Kava and JetEngine were not installed there.

Full generation smoke should continue in the prepared playable runtime:

```text
C:\sf-playable-beta
```

## Next recommended steps

1. Keep `C:\sf-zip-smoke` for future clean install package checks.
2. Prepare OpenAI Safe Provider Service v1 implementation after Codex limits recover.
3. Keep provider output restricted to `safe_variables_only`.
4. Do not reuse legacy AI blueprint generator paths.
5. Keep generation deterministic through the Factory pipeline.


