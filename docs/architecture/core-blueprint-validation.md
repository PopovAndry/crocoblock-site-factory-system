# Core Blueprint Validation

Core Blueprint validation checks the desired-state document before runtime
planning, apply, validation, repair, or future AI-assisted modification. It is a
shape and contract guardrail for the system layer.

The current reference input is the working Real Estate preset copied from:

```text
wordpress-plugin/presets/real-estate.json
```

The copy at `core/examples/real-estate-blueprint.example.json` is a Core example
only. The plugin preset remains the source of truth for the current beta flow.

## Core Validation vs Plugin Runtime Validation

Core Blueprint validation answers:

- Is this a plausible desired-state Blueprint document?
- Are known root sections shaped as objects or lists as expected?
- Do critical sections such as `site`, `pages`, `queries`, `filters`, and
  `content` contain enough structure for future planning?
- Are unknown sections safe to preserve as warnings rather than hard failures?

Plugin runtime validation answers different questions:

- Do WordPress pages, posts, terms, menus, forms, Query Builder rows,
  JetSmartFilters definitions, templates, and featured images exist?
- Does the live site match the latest manifest blueprint?
- Are generated objects user-modified and therefore preserved?
- Are optional plugin fallbacks valid?

Core does not replace plugin runtime validation.

## Supported v1 Sections

The draft validator recognizes the current and near-future blueprint roots:

- `version`
- `site`
- `theme`
- `plugins`
- `cpt`
- `taxonomies`
- `terms`
- `content`
- `listings`
- `pages`
- `render`
- `single`
- `queries`
- `filters`
- `forms`
- `style`
- `design`
- `image_context`

The validator is intentionally tolerant. Unknown root sections produce warnings
instead of hard errors so newer product experiments do not get rejected only
because Core v1 does not understand them yet.

## What Is Validated Now

Current v1 checks include:

- Required root `site`.
- `version` type when present.
- Object-shaped root sections.
- List-shaped `plugins`, `queries`, `filters`, and `forms`.
- `site.name`.
- Optional `site.style`, `site.assets`, and `site.forms` object shape.
- Plugin entries with `slug`.
- Page section object shape plus optional `slug` and `title`.
- Query entries with `slug`, `provider`, `type`, and `post_type`.
- Filter entries with `slug`, `provider`, and `type`.
- Content groups as lists with content item `title`.

## What Is Intentionally Not Validated Yet

Core does not yet validate:

- Full CPT schema correctness.
- Meta field definitions.
- Taxonomy term shape in depth.
- Crocoblock adapter semantics.
- JetEngine Query Builder argument details.
- JetSmartFilters native provider binding.
- JetFormBuilder form schema.
- Asset file existence.
- Page HTML/shortcode rendering.
- WordPress runtime state.
- User-editing ownership hashes.
- BlueprintPatch compatibility with a specific existing blueprint.

Those belong to later Core schema work or plugin runtime validation.

## Runner

`core/tools/validate-examples.php` now validates:

- `blueprint-patch.example.json`
- `plan.example.json`
- `validation-result.example.json`
- `run-manifest.example.json`
- `real-estate-blueprint.example.json`

The runner is local-only and is not wired into the WordPress plugin.

## Next Step

The next safe step is to add dedicated Core examples for invalid blueprints and
expected validation errors. That would turn the validator draft into a small
contract test suite without touching plugin runtime behavior.
