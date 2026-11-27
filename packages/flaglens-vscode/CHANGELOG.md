# Changelog

## Unreleased

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
