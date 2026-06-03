# Crocoblock Site Factory - Observable Blueprint Execution Demo

## Prerequisites

- Docker containers are running.
- The current repository is clean.
- The generated blueprint exists:

```text
/var/www/blueprints/generated/ai-blueprint.json
```

## Step 1 - Confirm Repository State

```powershell
git status
git log --oneline --decorate -5
```

Expected: the working tree is clean and the current checkpoint branch/commit is visible.

## Step 2 - Confirm Docker State

```powershell
docker compose ps
```

Expected: WordPress, database, and WP-CLI environment are available.

## Step 3 - Check Runtime Health

```powershell
docker compose run --rm wpcli wp factory health
docker compose run --rm wpcli wp factory doctor
```

Expected:

- runtime health has no critical errors;
- doctor shows the desired state is in sync or ready for inspection.

## Step 4 - Show Convergence Plan

```powershell
docker compose run --rm wpcli wp factory dry-run /var/www/blueprints/generated/ai-blueprint.json
```

Expected result:

- 0 create;
- 0 update;
- 16 unchanged.

## Step 5 - Apply Blueprint And Save Manifest

```powershell
docker compose run --rm wpcli wp factory apply /var/www/blueprints/generated/ai-blueprint.json
```

Explanation:

- apply applies the blueprint;
- adapters perform the required runtime/durable operations;
- the engine collects the execution trace;
- the engine builds the post-apply convergence plan;
- the engine validates WordPress state;
- the engine saves the run manifest.

## Step 6 - Inspect Latest Run

```powershell
docker compose run --rm wpcli wp factory latest
```

Expected output:

- Plan Summary;
- Execution items = 16;
- Validation checks = 28.

Expected execution categories:

- plugin;
- theme;
- taxonomy;
- terms;
- cpt;
- meta;
- jetengine;
- listing;
- render;
- single;
- content.

## Step 7 - Validate And Doctor

```powershell
docker compose run --rm wpcli wp factory validate
docker compose run --rm wpcli wp factory doctor
```

Expected:

- validation complete;
- system healthy;
- all layers in sync.

## Step 8 - REST Visibility

```powershell
$response = Invoke-RestMethod -UseBasicParsing http://localhost:8080/wp-json/factory/v1/run/latest

$response.status
$response.run.file
$response.run.prompt
$response.run.execution.count
$response.run.validation.count
$response.run.blueprint -ne $null
```

Expected result:

- `status`: `ok`;
- `execution.count`: `16`;
- `validation.count`: `28`;
- `blueprint`: `True`.

## Step 9 - REST Run History Summary

```powershell
$runs = Invoke-RestMethod -UseBasicParsing http://localhost:8080/wp-json/factory/v1/runs

$runs.status
$runs.runs[0].file
$runs.runs[0].status
$runs.runs[0].plan_summary
$runs.runs[0].execution_count
$runs.runs[0].validation_count
$runs.runs[0].results_summary
$runs.runs[0].blueprint -eq $null
```

Expected result:

- latest row status: `ok`;
- plan summary: `0 create / 0 update / 16 skip`;
- `execution_count`: `16`;
- `validation_count`: `28`;
- `results_summary.ok`: `28`;
- `blueprint` is absent from `/runs`; the PowerShell null check returns `True`.

## Optional: Demonstrate Repair Flow

Create a temporary eval-file that deletes the generated `Backend Developer` post:

```powershell
@'
<?php
$post = get_page_by_title( 'Backend Developer', OBJECT, 'job' );

if ( $post ) {
	wp_delete_post( $post->ID, true );
	WP_CLI::log( 'Deleted Backend Developer job post.' );
} else {
	WP_CLI::log( 'Backend Developer job post was already missing.' );
}
'@ | Set-Content -Encoding UTF8 .\wp\tmp-delete-backend-developer.php

docker compose run --rm wpcli wp eval-file /var/www/html/tmp-delete-backend-developer.php
Remove-Item .\wp\tmp-delete-backend-developer.php
```

Show drift:

```powershell
docker compose run --rm wpcli wp factory doctor
docker compose run --rm wpcli wp factory dry-run /var/www/blueprints/generated/ai-blueprint.json
```

Expected:

- doctor shows `Missing content item: job -> Backend Developer`;
- dry-run shows `+ Create content item: job -> Backend Developer`.

Run repair:

```powershell
docker compose run --rm wpcli wp factory fix
docker compose run --rm wpcli wp factory latest
```

Expected:

- `fix` recreates `Backend Developer`;
- latest prompt: `Fix active blueprint`;
- execution items: `skip Frontend Developer`, `create Backend Developer`;
- `execution.count`: `2`;
- post-fix plan: `0 create / 0 update / 16 skip`;
- validation checks: `28`.

REST verification:

```powershell
$repair = Invoke-RestMethod -UseBasicParsing http://localhost:8080/wp-json/factory/v1/run/latest

$repair.status
$repair.run.prompt
$repair.run.execution.count
$repair.run.validation.count
```

Final verification:

```powershell
docker compose run --rm wpcli wp factory validate
docker compose run --rm wpcli wp factory doctor
```

Expected: validation complete, doctor green.

## Demo Narration

During the demo, emphasize:

- the blueprint is the desired state;
- apply executes adapters in a stable order;
- the execution trace shows what actually happened;
- dry-run after apply proves convergence;
- validation proves the actual WordPress state;
- the manifest stores run history;
- `/runs` provides lightweight run history summaries;
- REST exposes the data for UI/AI workflows.

## Known Demo Notes

- Use manual apply for a deterministic demo.
- Avoid `wp factory ai --no-cache` during the demo because AI can change content values.
- The Codex runtime cannot run full WP checks because it does not include a full WordPress core.
- Runtime verification is done locally in the full WordPress/Docker environment.
- In PowerShell, `curl` is an alias; use `Invoke-RestMethod` for REST demos.
- Command strings that appear in terminal output can be paste artifacts, not Factory output.
