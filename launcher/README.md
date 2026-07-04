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
```

Optional flags:
- `--projects-root "C:\path\to\projects"`

What this does today:
- writes `factory-project.json`
- writes `.env`
- writes `docker-compose.yml`
- creates `runs`, `proofs`, `snapshots`, `logs`, and `exports` directories
- serves a local UI at `127.0.0.1`
- provisions Docker WordPress inside a launcher project runtime
- verifies `/wp-json/`
- writes provisioning proof JSON under `proofs/`

What it does not do yet:
- install or pair the Site Factory Agent plugin
- call WordPress
- call OpenAI
- generate a site

Next milestones:
1. install Site Factory Agent
2. pair Launcher with Agent
3. run prompt to read-only plan
4. run controlled generate to proof
