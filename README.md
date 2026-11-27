# FlagLens

A VS Code extension for **self-hosted Flagsmith**: see your feature flags next to the code that uses them, toggle them without leaving the editor, and push code references back into Flagsmith.

> Work in progress for the Toggle Wars hackathon (Track 03: Build on Open Source Flagsmith). The extension lands in `packages/flaglens-vscode`.

## Run self-hosted Flagsmith and the demo app

Prerequisites: Docker Desktop (running) and Node.js 20+.

1. **Start Flagsmith** (Postgres, API, task processor; image pinned to `2.295.2`):
   ```bash
   npm run up
   ```
   Open http://localhost:8000 and create your admin account.

2. **Create an Organisation API key** in the dashboard (Organisation Settings → API Keys), then:
   ```bash
   cp flagsmith.env.example flagsmith.env   # paste the key into flagsmith.env
   npm run seed
   ```
   This creates a `Toggle Wars` project with `Development` and `Production` environments and two flags
   (`checkout_cta_variant`, `enable_express_checkout`), and writes `apps/demo-store/.env.local`.

3. **Run the demo store** (the codebase FlagLens inspects):
   ```bash
   npm --prefix apps/demo-store install
   npm run demo
   ```
   Open http://localhost:3000.

## How FlagLens complements the official code-references scanner

Flagsmith ships an official scanner, the [`Flagsmith/ci`](https://github.com/Flagsmith/ci) GitHub Action. It keeps the dashboard's Code References up to date from CI on every push to `main`. FlagLens works alongside it, in the editor before you commit:

- **CI coverage vs. the editor before commit:** use the Action to keep references current for the whole team. Use FlagLens to see flag state and reference counts while you write the code.
- **Reading references:** FlagLens shows each flag's reference count (from the same API the Action writes to) in the VS Code sidebar.
- **Pushing references (planned):** a FlagLens command to scan the workspace and upload references. It would match any quoted string equal to a real flag name, so it also catches calls like `getValue("…")` and `useFlags([…])`, and it would upload empty scans so removed references clear. Those two gaps in the Action are written up in [`docs/upstream-issue.md`](docs/upstream-issue.md).

## License

MIT
