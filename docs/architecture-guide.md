# FlagLens Architecture & Judge Q&A Guide

Quick reference covering how FlagLens works end to end (Rule 07: understand and explain every file you submit).

## 1. Core Design: Pure Logic vs. VS Code Wiring

In `packages/flaglens-vscode/src/`, all business logic has **zero `vscode` imports** so it runs both in the extension and in plain Node.js (`cli.ts` + 92 unit tests):

| Pure Module | What It Does |
| :--- | :--- |
| `flagsmithClient.ts` | Typed Flagsmith Management API client (`Authorization: Api-Key <org_key>`), pagination (`next` rewritten to configured host), `getFeatureState`, `setFeatureStateEnabled`, `setFeatureStateValue`, `createFeature`, `archiveFeature`, `pushCodeReferences`. |
| `toggle.ts` | Safe v1 toggling (`toggleFlag`) and value editing (`editFlagValue`, `parseFlagValueInput`). Refuses `use_v2_feature_versioning: true`, re-reads live state before writing, requires modal confirmation when env name matches `/prod/i`, and verifies the server response. |
| `flagScanner.ts` | Two matchers: `findFlagReferences` (any quoted string matching a real Flagsmith flag name, catching `getValue` and `useFlags`) and `findFlagCalls` (call-pattern matcher finding SDK keys including typos). |
| `suggest.ts` | Levenshtein edit distance (`<= 3`) for `"Did you mean X?"` typo quick fixes. |
| `codeReferences.ts` | Scans git-tracked files (`repoFiles.ts`, honoring `.gitignore` + `flaglens.exclude`), summarizes counts, and uploads full scans to Flagsmith (`vcs_provider: "github"`). |
| `flagHealth.ts` | Computes **Unused** (0 refs), **Missing in Flagsmith** (SDK call keys not in Flagsmith), and **Fully rolled out** (on in every environment, excluding archived flags). |
| `removeFlag.ts` | Uses the TypeScript compiler AST (`typescript`) to safely rewrite 3 shapes (`if (hasFeature("x"))`, ternary `hasFeature("x") ? A : B`, `const v = getValue("x")` literal inline) and reports unrecognized usages with exact `file:line` for manual review. |
| `check.ts` / `cli.ts` / `format.ts` | Standalone Node.js CLI (`flaglens check`, `flaglens push`) with `--json`, GitHub annotations, and PR Markdown reports. |
| `localStack.ts` | Locates `docker-compose.yml` and polls `/health/liveness/` until Flagsmith 2.295.2 is ready. |

## 2. How VS Code Integrates (`extension.ts` & Views)

- **Auth & Keychain:** `SecretStorage` (`flaglens.organisationApiKey`) stores the Organisation API key in the OS keychain after verifying `listOrganisations()` + `listProjects()`.
- **Views:** `FlagTreeProvider` (`flagTree.ts`: Project → Environment → Flag with inline Toggle & Edit Value) and `FlagHealthProvider` (`flagHealthView.ts`: Unused → Archive, Missing → click to jump to line, Fully rolled out → Remove flag).
- **Editor Intelligence:** `FlagCodeLensProvider` (inline env states + click-to-toggle), `FlagHoverProvider` (table of all envs + dashboard deep links), `UnknownFlagDiagnostics` + `UnknownFlagQuickFixes` (typo warning, `"Did you mean …?"`, `"Create flag"`), and `RemoveFlagActionProvider`.

## 3. Flagsmith 2.295.2 APIs Verified & Used

- `GET /api/v1/organisations/`, `/projects/`, `/environments/?project=<id>`
- `GET /api/v1/projects/<id>/features/?environment=<env_id>` (states + `code_references_counts`)
- `POST /api/v1/projects/<id>/features/` (quick-fix flag creation, off everywhere)
- `PATCH /api/v1/projects/<id>/features/<id>/` (`{"is_archived": true}`)
- `GET / PATCH /api/v1/environments/<env_key>/featurestates/<id>/` (live re-read & boolean `enabled` toggle)
- `PATCH /api/v1/features/featurestates/<id>/` (`SimpleFeatureStateViewSet` writable `feature_state_value`)
- `POST /api/v1/projects/<id>/code-references/` (full repo scan replacement per repo URL)
