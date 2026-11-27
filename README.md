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

## FlagLens vs the official code-references scanner

Flagsmith ships an official scanner, the [`Flagsmith/ci`](https://github.com/Flagsmith/ci) GitHub Action. FlagLens sends data to the same Flagsmith API, but works differently:

- **Where it runs:** the Action runs in GitHub CI after you push to `main`. FlagLens runs in your editor whenever you ask, before you commit.
- **What it matches:** the Action only matches calls shaped like `feature…("name")` or `flag…("name")`, so it misses `flagsmith.getValue("name")`. FlagLens matches any quoted string equal to a real flag name from your Flagsmith project.
- **Which way the data goes:** the Action only uploads, and skips the upload when it finds nothing, so it never clears stale references. FlagLens also reads the data back into the editor and always uploads its full latest scan, which can be empty.

## License

MIT
