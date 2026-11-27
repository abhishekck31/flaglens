# FlagLens for self-hosted Flagsmith

See, toggle and track your [Flagsmith](https://flagsmith.com) feature flags without leaving VS Code. Built for **self-hosted** Flagsmith (default API `http://localhost:8000/api/v1/`).

## Features

- **Flags sidebar:** project → environment → flag, showing on/off, value and code-reference count. Production-like environments are marked ⚠.
- **CodeLens on flag names:** `Development: ● on | ⚠ Production: ○ off` above every line that mentions a flag. Click to toggle.
- **Safe toggling:** environments whose name contains "prod" need a confirmation in a modal dialog. Environments using v2 feature versioning are refused with an explanation.
- **Hover cards:** state and value in every environment, reference count, and a link to the flag in the dashboard.
- **Typo detection:** keys passed to `hasFeature`, `isFeatureEnabled`, `getValue`, `getFeatureValue`, `getFlag` and `useFlags([...])` that don't exist in Flagsmith are underlined. Quick fixes: **Did you mean …?** and **Create flag in Flagsmith** (created off everywhere).
- **Flag Health view:** three groups for the open folder. **Unused** lists flags no tracked file mentions. **Missing in Flagsmith** lists SDK-call keys with no matching flag; click one to jump to the line. **Fully rolled out** lists flags that are on in every environment, which are candidates for cleanup. It updates after connect, refresh, toggle, push and file save.
- **Push code references:** scans every tracked file and uploads `file:line` references to Flagsmith, so the dashboard shows where each flag is used.

## Getting started

1. Run self-hosted Flagsmith. The [project README](https://github.com/abhishekck31/flaglens#readme) has a 3-command quickstart.
2. In the dashboard, create an **Organisation API key**: Organisation Settings → API Keys.
3. Click the FlagLens icon in the activity bar, then **Connect to Flagsmith**. Accept or edit the API URL and paste the key. The key is stored in your OS keychain (VS Code SecretStorage), never in settings.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `flaglens.apiUrl` | `http://localhost:8000/api/v1/` | Your Flagsmith API |
| `flaglens.projectId` | `0` (first project) | Project used for CodeLens, hovers, warnings and push |
| `flaglens.dashboardUrl` | empty (API URL without `/api/v1`) | Dashboard base for hover links |
| `flaglens.callPatterns` | `hasFeature`, `getValue`, … | Functions whose first argument is a flag key |
| `flaglens.exclude` | build output, tests, docs, `stack/**`, `scripts/**`, `**/seed*` | Files that don't count as code references |

## Requirements

VS Code 1.90+, git (for pushing code references), and a Flagsmith instance you can reach. Code references need the repository's `origin` remote to be on GitHub, the only provider Flagsmith accepts.
