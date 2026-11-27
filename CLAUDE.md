# FlagLens: working rules

FlagLens is a VS Code extension for **self-hosted Flagsmith**, built for Toggle Wars Track 03.
Hard deadline: Nov 29 2026, 8:00 PM IST. Target submit: 6:00 PM IST.

## Layout
- `docker-compose.yml`: official Flagsmith compose file, pinned to the 2.295.2 image. Dashboard + API on http://localhost:8000.
- `scripts/seed.mjs`: creates demo org/project/environments/flags. Reads `flagsmith.env` (copy from `flagsmith.env.example`).
- `apps/demo-store`: small Next.js app that uses flags via the official SDK. It is the codebase FlagLens scans in the demo. Keep it frozen.
  It contains one INTENTIONAL typo, `getValue("checkout_cta_varient")`, for the unknown-flag demo. Do not fix it.
  Never run `npm run build:demo` while `npm run demo` is running: both write `.next` and the dev server breaks.
- `packages/flaglens-vscode`: the extension. Files without a `vscode` import (`flagsmithClient.ts`, `format.ts`, `suggest.ts`,
  `toggle.ts`, `flagScanner.ts`) hold the logic and are unit-tested; the rest is VS Code wiring.
  `npm run typecheck`, `npm test`, `npm run build`; `npm run smoke` is a read-only live check;
  `npm run package` writes the .vsix. `src/cli.ts` (`npm run check` / `npm run push`) is the no-VS-Code CLI;
  `.github/actions/flaglens-check` wraps `check`, and `.github/workflows/flaglens-check.yml` runs it on PRs against a
  throwaway Flagsmith started on the runner (`scripts/ci-bootstrap.mjs` creates its admin, org and key).
  Releases: bump `version` + CHANGELOG, then push tag `v<version>`
  (.github/workflows/release.yml attaches the .vsix to a GitHub Release, and publishes to Open VSX
  only if the `OVSX_TOKEN` repo secret is set; namespace `togglewars` must exist there first).
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
- Never stop, restart or modify the user's running Flagsmith stack (`docker compose` in this folder) or the
  demo dev server (`npm run demo`, port 3000) without asking first. This includes `docker compose down`,
  `npm run up`, and `npm run build:demo` (it overwrites the dev server's `.next`).
- Any test stack (e.g. a fresh-clone test) must use different ports (not 8000/8001/3000) and its own
  compose project name. The compose file hard-codes `container_name: flagsmith_postgres`, so override that as well
  or the test stack will clash with the running one.
- Prod safety: toggling a flag in an environment whose name matches `/prod/i` needs a modal confirmation.
- After each task: run build + tests, then give a 5-line summary of what changed and how to verify it manually.
