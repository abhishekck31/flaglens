# FlagLens: working rules

FlagLens is a VS Code extension for **self-hosted Flagsmith**, built for Toggle Wars Track 03.
Hard deadline: Nov 29 2026, 8:00 PM IST. Target submit: 6:00 PM IST.

## Layout
- `docker-compose.yml`: official Flagsmith compose file, pinned to the 2.295.2 image. Dashboard + API on http://localhost:8000.
- `scripts/seed.mjs`: creates demo org/project/environments/flags. Reads `flagsmith.env` (copy from `flagsmith.env.example`).
- `apps/demo-store`: small Next.js app that uses flags via the official SDK. It is the codebase FlagLens scans in the demo. Keep it frozen.
- `packages/flaglens-vscode`: the extension (to be added).
- Branch `devbar-prototype`: archived earlier prototype. Do not merge.

## Rules
- TypeScript `strict`. Keep code simple and comment anything non-obvious: the author must be able to explain every line.
- Depth over breadth: each feature works end to end before starting the next.
- Never guess Flagsmith endpoints. Verify against the running instance's schema (`http://localhost:8000/api/v1/swagger.json`) or the Flagsmith repo source.
- Management API: Organisation API key, header `Authorization: Api-Key <key>`. SDK endpoints: environment key, header `X-Environment-Key`.
- Never hardcode keys. The extension stores them in VS Code `SecretStorage`. `flagsmith.env` and `.env.local` files are git-ignored.
- Prod safety: toggling a flag in an environment whose name matches `/prod/i` needs a modal confirmation.
- After each task: run build + tests, then give a 5-line summary of what changed and how to verify it manually.
