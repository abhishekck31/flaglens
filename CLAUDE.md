# FlagLens: working rules

FlagLens is a VS Code extension for **self-hosted Flagsmith**, built for Toggle Wars Track 03.
Hard deadline: Nov 29 2026, 8:00 PM IST. Target submit: 6:00 PM IST.

## Layout
- `docker-compose.yml`: official Flagsmith compose file, pinned to the 2.295.2 image. Dashboard + API on http://localhost:8000.
- `scripts/seed.mjs`: creates demo org/project/environments/flags. Reads `flagsmith.env` (copy from `flagsmith.env.example`).
- `apps/demo-store`: small Next.js app that uses flags via the official SDK. It is the codebase FlagLens scans in the demo. Keep it frozen.
- `packages/flaglens-vscode`: the extension. Files without a `vscode` import (`flagsmithClient.ts`, `format.ts`,
  `toggle.ts`, `flagScanner.ts`) hold the logic and are unit-tested; the rest is VS Code wiring.
  `npm run typecheck`, `npm test`, `npm run build`; `npm run smoke` is a read-only live check.
- `docs/upstream-issue.md`: draft issue for Flagsmith/ci. Not filed.
- Branch `devbar-prototype`: archived earlier prototype. Do not merge.

## Verified API facts (Flagsmith 2.295.2, checked 2026-11-27)
- **Feature versioning:** `use_v2_feature_versioning = false` on both demo environments (Development, Production).
  FlagLens supports only v1 (non-versioned) environments: toggle = `PATCH /environments/{api_key}/featurestates/{id}/`
  with `{"enabled": bool}`. Under v2 versioning that endpoint is not how changes are made, so FlagLens must
  detect `use_v2_feature_versioning: true` and refuse to toggle with a clear message. Keep demo environments on v1.
- **Flags per environment:** `GET /projects/{id}/features/?environment=<env id>` (paginated). Each feature has
  `environment_feature_state` (`id`, `enabled`, `feature_state_value`) and `code_references_counts` (per repository).
- **List shapes:** `/organisations/`, `/environments/`, `/projects/{id}/features/` are paginated; `/projects/` is a plain array.
- **Code references:** `POST /projects/{id}/code-references/` with `repository_url`, `revision`, `vcs_provider`
  (only `github` is accepted), `code_references: [{feature_name, file_path, line_number}]`.
  The latest scan per repository replaces the previous one: a flag missing from it drops to count 0,
  and an empty list clears all references for that repo.

## Rules
- TypeScript `strict`. Keep code simple and comment anything non-obvious: the author must be able to explain every line.
- Depth over breadth: each feature works end to end before starting the next.
- Never guess Flagsmith endpoints. Verify against the running instance's schema (`http://localhost:8000/api/v1/swagger.json`) or the Flagsmith repo source.
- Management API: Organisation API key, header `Authorization: Api-Key <key>`. SDK endpoints: environment key, header `X-Environment-Key`.
- Never hardcode keys. The extension stores them in VS Code `SecretStorage`. `flagsmith.env` and `.env.local` files are git-ignored.
- Prod safety: toggling a flag in an environment whose name matches `/prod/i` needs a modal confirmation.
- After each task: run build + tests, then give a 5-line summary of what changed and how to verify it manually.
