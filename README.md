# FlagLens

A VS Code extension for **self-hosted Flagsmith**: see your feature flags next to the code that uses them, toggle them without leaving the editor, and push code references back into Flagsmith.

Built for the Toggle Wars hackathon (Track 03: Build on Open Source Flagsmith). The extension lives in [`packages/flaglens-vscode`](packages/flaglens-vscode).

## Quickstart

Prerequisites: Docker Desktop (running), Node.js 20+, git, and VS Code 1.90+ with the `code` command on your PATH.

1. **Clone and start self-hosted Flagsmith** (Postgres, API, task processor; image pinned to `2.295.2`):
   ```bash
   git clone https://github.com/abhishekck31/flaglens.git
   cd flaglens
   npm run up
   ```
   Wait for `Flagsmith ready at http://localhost:8000`.

2. **Create your admin user and an Organisation API key.** Open http://localhost:8000, sign up, and create an organisation when asked.
   Then go to Organisation Settings → API Keys → Create API Key, and copy the key.

3. **Seed demo data:**
   ```bash
   cp flagsmith.env.example flagsmith.env   # then paste the key into flagsmith.env
   npm run seed
   ```
   This creates a `Toggle Wars` project with `Development` and `Production` environments and two flags
   (`checkout_cta_variant`, `enable_express_checkout`), and writes `apps/demo-store/.env.local`.

4. **Install the extension.** Download `flaglens-0.1.0.vsix` from the [latest release](https://github.com/abhishekck31/flaglens/releases/latest), then:
   ```bash
   code --install-extension flaglens-0.1.0.vsix
   ```
   (Or in VS Code: Extensions view → `…` menu → Install from VSIX…)

5. **Connect.** Open the cloned folder in VS Code (`code .`), click the **FlagLens** icon in the activity bar, then **Connect to Flagsmith**.
   Keep the default URL `http://localhost:8000/api/v1/` and paste the same Organisation API key.
   The Flags panel shows `Toggle Wars` → `Development` / `Production` with both flags.

6. **Optional: run the demo store,** the app whose flags FlagLens shows:
   ```bash
   npm --prefix apps/demo-store install
   npm run demo
   ```
   Open http://localhost:3000. Open `apps/demo-store/src/components/FlagsmithProvider.tsx` to see CodeLens, hover cards
   and the deliberate `checkout_cta_varient` typo warning.

### Build the extension yourself

```bash
npm --prefix packages/flaglens-vscode install
npm run package   # writes packages/flaglens-vscode/flaglens-<version>.vsix
```

## How FlagLens complements the official code-references scanner

Flagsmith ships an official scanner, the [`Flagsmith/ci`](https://github.com/Flagsmith/ci) GitHub Action. It keeps the dashboard's Code References up to date from CI on every push to `main`. FlagLens works alongside it, in the editor before you commit:

- **CI coverage vs. the editor before commit:** use the Action to keep references current for the whole team. Use FlagLens to see flag state and reference counts while you write the code.
- **Reading references:** FlagLens shows each flag's reference count (from the same API the Action writes to) in the sidebar and in hover cards.
- **Pushing references:** **FlagLens: Push code references to Flagsmith** (the ☁ button in the Flags panel) scans every tracked file in the repository and uploads the result to the same endpoint the Action uses. It matches any quoted string equal to a real flag name, so it also catches `getValue("…")` and `useFlags([…])`. It always uploads the full scan, even an empty one, so references to deleted code clear. Those two gaps in the Action are written up in [`docs/upstream-issue.md`](docs/upstream-issue.md).
  - It respects `.gitignore` (only tracked files are read) and skips files matching the `flaglens.exclude` globs. By default that is build output (`node_modules`, `dist`, `out`, `.next`), tests, Markdown, and setup code that is not real app usage (`stack/**`, `scripts/**`, `**/seed*`).
  - Before uploading, it warns if your commit isn't pushed yet (dashboard permalinks would 404) or you have uncommitted changes, and lets you continue anyway.
  - Afterwards it shows "N references across M flags", lists flags with 0 references, and writes the full list to the **FlagLens** Output panel.
  - Same thing from a terminal: `FLAGLENS_API_KEY=<key> npm --prefix packages/flaglens-vscode run push` (add `--allow-unpushed` to skip the safety stop).
  - Because it uses a plain "quoted name" match, a flag name quoted in a comment counts as a reference.

## License

MIT
