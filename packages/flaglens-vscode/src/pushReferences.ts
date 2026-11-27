// "Push code references": scan the git repo for known flag names and upload the result.
// No `vscode` import: the VS Code command and the CLI script (scripts/push.ts) both use this.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildCodeReferences, looksLikeText, shouldScanPath, summarize, type PushSummary } from "./codeReferences.ts";
import type { FlagsmithClient } from "./flagsmithClient.ts";
import { getRepoInfo, listTrackedFiles, type RepoInfo } from "./git.ts";

export type PushOutcome =
  | { kind: "pushed"; repo: RepoInfo; summary: PushSummary }
  | { kind: "cancelled" }
  | { kind: "refused"; reason: string };

export interface PushOptions {
  client: FlagsmithClient;
  projectId: number;
  flagNames: ReadonlySet<string>;
  /** Any folder inside the repository; the WHOLE repository is always scanned. */
  cwd: string;
  /** Repo-relative globs of files to skip (see DEFAULT_EXCLUDE_GLOBS). */
  excludeGlobs: readonly string[];
  /** Asked when permalinks may be wrong; resolve true to upload anyway. */
  confirmRisk: (warning: string) => Promise<boolean>;
}

export async function scanAndPush(options: PushOptions): Promise<PushOutcome> {
  let repo: RepoInfo;
  try {
    repo = await getRepoInfo(options.cwd);
  } catch (err) {
    const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return { kind: "refused", reason: `Needs a git repository with an "origin" remote. (${detail})` };
  }
  if (!repo.githubUrl) {
    return { kind: "refused", reason: "The origin remote isn't on GitHub, and Flagsmith only accepts GitHub repositories." };
  }

  // Flagsmith turns each reference into a GitHub permalink at this commit.
  const short = repo.head.slice(0, 7);
  const risks: string[] = [];
  if (!repo.headIsPushed) risks.push(`Commit ${short} isn't on the remote yet, so dashboard links will 404 until you push.`);
  if (repo.hasUncommittedChanges) risks.push(`You have uncommitted changes, so some line numbers may not match commit ${short}.`);
  if (risks.length > 0 && !(await options.confirmRisk(risks.join(" ")))) return { kind: "cancelled" };

  // The latest scan replaces the previous one for this repository, so scan ALL of it,
  // even if the editor only has a sub-folder open; otherwise references elsewhere would vanish.
  const files: Array<{ path: string; text: string }> = [];
  for (const relPath of await listTrackedFiles(repo.root)) {
    if (!shouldScanPath(relPath, options.excludeGlobs)) continue;
    let content: Buffer;
    try {
      content = await readFile(path.join(repo.root, relPath));
    } catch {
      continue; // tracked but deleted from disk
    }
    if (looksLikeText(content)) files.push({ path: relPath, text: content.toString("utf8") });
  }

  const codeReferences = buildCodeReferences(files, options.flagNames);
  // Sent even when empty, so references to deleted code are cleared.
  await options.client.pushCodeReferences(options.projectId, {
    repository_url: repo.githubUrl,
    revision: repo.head,
    code_references: codeReferences,
  });
  return { kind: "pushed", repo, summary: summarize(codeReferences, options.flagNames) };
}

/** Plain-text report, used by the output channel and the CLI. */
export function formatSummary(outcome: Extract<PushOutcome, { kind: "pushed" }>, projectName: string): string {
  const { summary, repo } = outcome;
  const lines = [
    `Pushed ${summary.totalReferences} references across ${summary.byFlag.size} flags to "${projectName}"`,
    `Repository ${repo.githubUrl} at ${repo.head.slice(0, 7)}`,
    "",
  ];
  for (const [name, refs] of [...summary.byFlag].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${name} (${refs.length})`);
    for (const ref of refs) lines.push(`  ${ref.file_path}:${ref.line_number}`);
  }
  lines.push("", `Flags with 0 references: ${summary.unreferenced.join(", ") || "none"}`);
  return lines.join("\n");
}
