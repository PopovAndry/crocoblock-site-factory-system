# Start Here

This is the quickest safe path for a reviewer or teammate to verify the Crocoblock Site Factory alpha locally.

It is intentionally read-only with respect to WordPress content.

## What This Alpha Is

This alpha proves a Launcher-first Terraform-like control flow around:

- local project runtimes
- controlled generate
- managed state
- read-only proof packing
- split readiness reporting
- alpha smoke verification

## What It Can Prove

- the Launcher starts locally
- known alpha runtimes can be inspected safely
- generated-site readiness is healthy
- full alpha proof history exists on the reference runtime
- `secrets/ai.env` is absent on known alpha projects

## What It Does Not Do Yet

- no live AI calls in this path
- no apply
- no rollback
- no generate
- no dependency install
- no WordPress content mutation

## Prerequisites

- Windows PowerShell
- Node.js
- Docker Desktop
- local vendor ZIPs:
  - `C:\sf-vendor\kava.zip`
  - `C:\sf-vendor\jet-engine.zip`
  - `C:\sf-vendor\jet-smart-filters.zip`

## Step 1: Run Preflight

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\factory-preflight.ps1
```

Expected:

- `PASS` or `WARN`
- no project mutation
- no secrets required

## Step 2: Start Launcher

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-launcher.ps1
```

Optional:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-launcher.ps1 -Port 3848
```

## Step 3: Open Launcher

Default URL:

- [http://127.0.0.1:3847](http://127.0.0.1:3847)

If you used `-Port`, open the reported port instead.

## Step 4: Run Generated-site Alpha Smoke

Direct CLI:

```powershell
node launcher/src/cli.js alpha-smoke --slug alpha-v01-fresh-smoke-1
```

Wrapper:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\alpha-smoke.ps1 -Slug alpha-v01-fresh-smoke-1
```

Expected:

- `Status: PASS`
- `generated_site_ready = ready`
- `ai_safe_apply_history_ready = not_ready`
- `alpha_evaluator_ready = partial`

That is expected for a fresh generated-only runtime.

## Step 5: Run Full-alpha Smoke On The Reference Runtime

Direct CLI:

```powershell
node launcher/src/cli.js alpha-smoke --slug alpha-e2e-smoke-1 --require full-alpha
```

Wrapper:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\alpha-smoke.ps1 -Slug alpha-e2e-smoke-1 -Require full-alpha
```

Expected:

- `Status: PASS`
- `generated_site_ready = ready`
- `ai_safe_apply_history_ready = ready`
- `alpha_evaluator_ready = ready`

## Readiness Split

- `generated_site_ready`:
  the generated runtime itself is healthy
- `ai_safe_apply_history_ready`:
  the runtime has live AI desired-state, safe-apply, rollback, and rollback-reporting proof history
- `secrets_ready`:
  `secrets/ai.env` is absent and secret posture is clean
- `alpha_evaluator_ready`:
  the overall evaluator verdict across the above dimensions

## Known Alpha Projects

- `alpha-e2e-smoke-1`
- `alpha-v01-fresh-smoke-1`

## Safety

- no live AI key required
- no apply / rollback / generate during these scripts
- no `secrets/ai.env` expected

## Troubleshooting

Docker not running:

- start Docker Desktop
- rerun `factory-preflight.ps1`

Vendor ZIP missing:

- restore the ZIP into `C:\sf-vendor\`
- rerun preflight

Launcher port already in use:

- rerun with another port:
  `powershell -ExecutionPolicy Bypass -File .\scripts\start-launcher.ps1 -Port 3848`

Stale Launcher process on `3847`:

- stop the old process or use `-Port`

Fresh project is partial for full-alpha:

- expected
- this does not mean generated-site health is broken
- it means live AI safe-apply/rollback history was not intentionally run on that runtime
