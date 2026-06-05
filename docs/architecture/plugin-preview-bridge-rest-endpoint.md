# Plugin Preview Bridge REST Endpoint

The Plugin Preview Bridge REST endpoint exposes the internal read-only plugin preview bridge service to authenticated administrators.

It is preview-only. It does not apply, generate, fix, reset, write manifests, or mutate WordPress runtime content.

## Route

```text
POST /wp-json/factory/v1/preview-bridge
```

The route uses the existing Factory REST namespace:

```text
factory/v1
```

## Permission

The endpoint uses the same permission callback as the existing beta dashboard endpoints:

```text
manage_options
```

## Accepted Input

The endpoint supports two safe input paths.

Use the bundled Real Estate preset:

```json
{
  "preset": "real-estate"
}
```

Or provide a blueprint object directly:

```json
{
  "blueprint": {},
  "core_preview": {},
  "ownership_targets": []
}
```

If `blueprint` is provided, it must be a JSON object. If `blueprint` is omitted, the endpoint defaults to the bundled `real-estate` preset. Other preset values are rejected with HTTP 400.

`core_preview` and `ownership_targets` are optional. If omitted or invalid, they default to empty arrays.

## Output

The endpoint returns the array from:

```php
factory_build_plugin_preview_bridge_response()
```

The response includes:

- bridge status;
- blueprint summary;
- optional Core preview data;
- plugin dry-run evidence;
- ownership evidence;
- RuntimeEvidence-compatible data;
- ApplyGatePolicy-compatible data;
- notices, warnings, and errors.

The endpoint does not wrap the response in a separate REST envelope.

## Read-Only Guarantees

The endpoint does not:

- call `factory_apply_blueprint()`;
- run apply, fix, reset, or generate commands;
- write run manifests;
- create or update posts, terms, templates, listings, forms, filters, products, options, transients, or files;
- add dashboard behavior;
- call Core autoloading;
- instantiate Core PHP classes;
- call AI providers.

The returned bridge response must keep:

```json
{
  "applied": false,
  "runtime_mutation": false,
  "apply_gate": {
    "can_apply": false
  }
}
```

## Runtime Dependency Status

The endpoint can return HTTP 200 with a bridge response status of `error` or `warning` when runtime dependencies such as JetEngine or Kava are missing. That is expected for preview evidence. The endpoint itself still succeeded if it returned the bridge response.

HTTP 400 is reserved for invalid input such as unsupported presets or invalid blueprint shape.

HTTP 500 is reserved for missing bridge service code or unexpected bridge construction failures.

## Future Integration

Future tasks may use this endpoint in:

- dashboard preview panels;
- confirmation gate UI;
- apply readiness review;
- eventual apply integration after explicit user confirmation.

Those integrations are not implemented here.
