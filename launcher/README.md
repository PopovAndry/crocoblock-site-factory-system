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
```

Optional flags:
- `--projects-root "C:\path\to\projects"`

What this does today:
- writes `factory-project.json`
- writes `.env`
- writes `docker-compose.yml`
- creates `runs`, `proofs`, `snapshots`, `logs`, and `exports` directories
- serves a local UI at `127.0.0.1`

What it does not do yet:
- start Docker
- install WordPress
- install or pair the Site Factory Agent plugin
- call WordPress
- call OpenAI
- generate a site

Next milestones:
1. provision Docker WordPress
2. install Site Factory Agent
3. pair Launcher with Agent
4. run prompt to read-only plan
5. run controlled generate to proof
