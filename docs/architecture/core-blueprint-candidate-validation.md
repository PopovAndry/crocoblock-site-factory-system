# Core BlueprintCandidate Validation

## Purpose

`BlueprintCandidate` is a full proposed blueprint document from a future generator, AI assistant, or product workflow. It is a review artifact only. It must be normalized and validated in Core before any preview or WordPress runtime work can happen.

This task adds a read-only runner for candidate normalization and validation. It does not apply anything, does not call WordPress, does not call Crocoblock APIs, and does not integrate AI providers.

## Flow

The intended future flow is:

`Prompt -> BlueprintCandidate proposal -> Core normalization -> Core validation -> Core Preview / review -> Plugin dry-run later -> User confirmation later -> Plugin apply later`

The current runner only covers the Core normalization and validation portion.

## What The Runner Does

`core/tools/validate-blueprint-candidate-example.php`:

- loads `core/examples/blueprint-candidate.real-estate.input.json`;
- treats it as a proposed full blueprint, not runtime state;
- normalizes it with `BlueprintNormalizer`;
- compares the normalized result with `core/examples/blueprint-candidate.real-estate.expected.json`;
- validates the normalized result with `BlueprintValidator`;
- strict-checks invalid fixtures for unsafe code fields and bad shapes;
- exits non-zero on mismatch or validation error.

## Fixture Behavior

The valid Real Estate candidate includes modern desired-state sections:

- `version`
- `site`
- `theme`
- `plugins`
- `pages`
- `cpt`
- `taxonomies`
- `terms`
- `content`
- `queries`
- `filters`
- `forms`
- `listings`
- `render`
- `single`
- `design`
- `style`
- `image_context`
- `assets`

The fixture intentionally contains mixed case, whitespace, and slug/reference values that the normalizer makes more canonical.

The `experimental_notes` root section is preserved in tolerant mode. This documents forward compatibility: unknown candidate sections can be reviewed without being silently discarded.

## Invalid Fixtures

`core/examples/invalid/blueprint-candidate.unsafe-code.invalid.json` checks that dangerous fields are detected in strict mode:

- `php_code`
- `callback`
- `eval`
- `sql`
- `shell`
- `wordpress_mutation`
- `direct_apply`
- `raw_css`
- `custom_js`

`core/examples/invalid/blueprint-candidate.bad-shape.invalid.json` checks strict handling for object/list shape mistakes such as `site` as a list and `plugins` / `queries` as objects.

## What It Does Not Do

This runner does not:

- call AI providers;
- create a diff;
- create a `BlueprintPatch`;
- apply a blueprint;
- mutate WordPress;
- call plugin adapters;
- write runtime files;
- connect Core to `wordpress-plugin/`.

## Relationship To AI Safety

Future AI output should be treated as untrusted proposal data. A full `BlueprintCandidate` must pass through Core normalization and validation before it can become a reviewable plan or approved patch. AI must never mutate WordPress directly.

## Running Locally

From the integrated system repository root:

```powershell
C:\OSPanel\modules\php\PHP_8.1\php.exe core\tools\validate-blueprint-candidate-example.php
```

## Future Work

The next safe task is to add a Core-only candidate-to-preview-plan draft that summarizes candidate differences against a baseline blueprint without applying anything to WordPress.
