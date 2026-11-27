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
- **Reading references:** FlagLens shows each flag's reference count (from the same API the Action writes to) in the sidebar and in hover cards.
- **Pushing references:** **FlagLens: Push code references to Flagsmith** (the ☁ button in the Flags panel) scans every tracked file in the repository and uploads the result to the same endpoint the Action uses. It matches any quoted string equal to a real flag name, so it also catches `getValue("…")` and `useFlags([…])`. It always uploads the full scan, even an empty one, so references to deleted code clear. Those two gaps in the Action are written up in [`docs/upstream-issue.md`](docs/upstream-issue.md).
  - It respects `.gitignore` (only tracked files are read) and skips `node_modules`, `dist`, `out`, `.next`, test folders, Markdown and `*.test.*` / `*.spec.*` files (setting: `flaglens.scanExcludeDirs`).
  - Before uploading, it warns if your commit isn't pushed yet (dashboard permalinks would 404) or you have uncommitted changes, and lets you continue anyway.
  - Afterwards it shows "N references across M flags", lists flags with 0 references, and writes the full list to the **FlagLens** Output panel.
  - Same thing from a terminal: `FLAGLENS_API_KEY=<key> npm --prefix packages/flaglens-vscode run push` (add `--allow-unpushed` to skip the safety stop).
  - Because it uses a plain "quoted name" match, a flag name quoted in a comment counts as a reference.

## License

MIT
