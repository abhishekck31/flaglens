# Changelog

## 0.3.0 (2026-11-27)

- **Edit flag value** from the Flags sidebar (`PATCH /api/v1/features/featurestates/<id>/`), with live state re-reads, v2-versioning protection, and modal confirmation for production environments.
- **Flag Health quick actions:** archive **Unused** flags directly from the sidebar (with confirmation) and trigger **Remove flag (keep enabled path)** inline on **Fully rolled out** flags.

## 0.2.0 (2026-11-27)

- "FlagLens: Start local Flagsmith" (asks before touching a running stack), "Open dashboard", and a 4-step getting-started walkthrough.
- Releases also publish to Open VSX when the `OVSX_TOKEN` secret is set.
- "Remove flag (keep enabled path)" refactoring for fully rolled-out flags (TS/JS/TSX), with preview, manual-cleanup list and optional archive.
- Archived flags no longer count as fully rolled out.
- `flaglens check` CLI (`--json`), GitHub Action and example PR-comment workflow.
- Flag Health view: Unused, Missing in Flagsmith (click to jump to the line), and Fully rolled out.

## 0.1.0 (2026-11-27)

First release.

- Connect to self-hosted Flagsmith with an Organisation API key, which is stored in SecretStorage.
- Flags sidebar: project → environment → flag, with state, value and code-reference counts.
- Toggle from the sidebar or CodeLens. Production-like environments need a confirmation in a modal dialog, and environments using v2 feature versioning are refused.
- Hover cards with per-environment state, value and dashboard links.
- Unknown-flag warnings with "Did you mean …?" and "Create flag in Flagsmith" quick fixes.
- Push code references from the editor or CLI. It respects `.gitignore`, uses the `flaglens.exclude` globs, warns about unpushed commits, and always uploads the full scan.
