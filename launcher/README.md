## Factory Launcher

Standalone Factory Launcher is the control plane that lives outside WordPress.

Current scope:
- start a local Launcher UI
- create local project scaffolds
- list local project scaffolds

Commands:

```powershell
node launcher/src/cli.js start
node launcher/src/cli.js start --port 3847
node launcher/src/cli.js create --name "Kyiv Realty" --port 8120
node launcher/src/cli.js list
node launcher/src/cli.js provision --slug kyiv-realty
node launcher/src/cli.js install-agent --slug kyiv-realty
node launcher/src/cli.js plan --slug kyiv-realty --prompt "Create a real estate site for Kyiv apartments"
node launcher/src/cli.js dependencies --slug kyiv-realty
```

Optional flags:
- `--projects-root "C:\path\to\projects"`

## Windows development package

Build the early installable Launcher skeleton with the maintained local Node.js executable already available on the build machine:

```powershell
node scripts/build-windows-launcher-package.js
```

The generated archive contains `installer\install.cmd`, a Start menu shortcut helper, and an uninstall script. The installer stores application data and project configuration outside the installation folder. Uninstall removes only the installed application files and shortcut; it preserves application data and Factory projects.

This development package does not install or configure Docker, WordPress, databases, plugins, or dependencies. On launch it presents safe status labels for Docker availability, project storage, application-data storage, and the Launcher port. The package runs the copied executable and packaged application files, not the source checkout.

## macOS evaluation package foundation

The Launcher keeps its existing Node sidecar architecture. macOS arm64 and x64
targets, `.app`/`.dmg` layout, hardened-runtime signing hooks, notarization,
stapling, and Gatekeeper verification commands are configured in
`launcher/package.json` and `launcher/macos/package-config.json`.

On a Mac or macOS CI runner:

```sh
cd launcher
npm run validate:mac-package
npm run package:mac:arm64
npm run package:mac:x64
```

Evaluation builds require a Developer ID identity in the keychain, an external
notarytool keychain profile, and the approved `.icns` icon. The explicit
`unsigned-engineering` scripts are internal-only and cannot produce an artifact
named as a CEO evaluation build. No Apple credentials or proprietary package
archives belong in this repository.

What this does today:
- writes `factory-project.json`
- writes `.env`
- writes `docker-compose.yml`
- creates `runs`, `proofs`, `snapshots`, `logs`, and `exports` directories
- serves a local UI at `127.0.0.1`
- provisions Docker WordPress inside a launcher project runtime
- verifies `/wp-json/`
- writes provisioning proof JSON under `proofs/`
- installs and activates the local Site Factory Agent plugin
- reads Agent health and capabilities
- writes Agent install proof JSON under `proofs/`
- runs the read-only Agent planning chain
- reads Agent dependency status and records generate blockers
- writes Launcher run metadata under `runs/`
- writes read-only planning proof JSON under `proofs/`

What it does not do yet:
- call OpenAI
- generate a site
- mutate WordPress content during planning
- install premium dependencies

Next milestones:
1. run controlled generate to proof
2. track iterative runs and rollback
