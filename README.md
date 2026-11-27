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

## License

MIT
