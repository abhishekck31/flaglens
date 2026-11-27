// `flaglens check`: find SDK-call keys that don't exist in Flagsmith. No `vscode` import.
// Same matcher as the editor's "Missing in Flagsmith" warnings, so CI and editor agree.

import { findFlagCalls } from "./flagScanner.ts";
import type { FlagsmithClient } from "./flagsmithClient.ts";
import { readTrackedFiles } from "./repoFiles.ts";
import { closestName } from "./suggest.ts";

export interface CheckFinding {
  key: string;
  /** Repo-relative path. */
  file: string;
  /** 1-based, like compiler output and GitHub annotations. */
  line: number;
  column: number;
  /** Closest real flag within 3 edits, if any. */
  suggestion: string | null;
}

export interface CheckResult {
  project: string;
  filesScanned: number;
  flagCount: number;
  findings: CheckFinding[];
}

export interface CheckOptions {
  client: FlagsmithClient;
  /** Project to check against; undefined or 0 means the first project. */
  projectId?: number;
  /** Folder to scan (tracked files under it). */
  cwd: string;
  excludeGlobs: readonly string[];
  callPatterns: readonly string[];
}

export async function runCheck(options: CheckOptions): Promise<CheckResult> {
  const projects = await options.client.listProjects();
  const project = options.projectId ? projects.find((p) => p.id === options.projectId) : projects[0];
  if (!project) throw new Error(options.projectId ? `Project ${options.projectId} not found.` : "No projects in Flagsmith.");

  // Flag names are project-wide, so one environment's list has them all.
  const [environment] = await options.client.listEnvironments(project.id);
  const flagNames = new Set(
    environment ? (await options.client.listFeatures(project.id, environment.id)).map((f) => f.name) : [],
  );

  const { files } = await readTrackedFiles(options.cwd, options.excludeGlobs);
  const findings: CheckFinding[] = [];
  for (const file of files) {
    for (const call of findFlagCalls(file.text, options.callPatterns)) {
      if (flagNames.has(call.name)) continue;
      findings.push({
        key: call.name,
        file: file.path,
        line: call.line + 1,
        column: call.column + 1,
        suggestion: closestName(call.name, flagNames) ?? null,
      });
    }
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  return { project: project.name, filesScanned: files.length, flagCount: flagNames.size, findings };
}

function describe(f: CheckFinding): string {
  const hint = f.suggestion ? ` Did you mean "${f.suggestion}"?` : "";
  return `"${f.key}" is not a flag in Flagsmith.${hint}`;
}

/** Human-readable output, one `file:line:col` per finding (clickable in most terminals). */
export function formatText(result: CheckResult): string {
  const header = `FlagLens check: project "${result.project}", ${result.flagCount} flags, ${result.filesScanned} files scanned`;
  if (result.findings.length === 0) return `${header}\nOK: every flag key used in code exists in Flagsmith.`;
  const lines = result.findings.map((f) => `${f.file}:${f.line}:${f.column}  ${describe(f)}`);
  return [header, ...lines, `${result.findings.length} missing flag key(s).`].join("\n");
}

/**
 * GitHub Actions "workflow commands": each line becomes an error annotation on that line of the PR diff.
 * https://docs.github.com/actions/reference/workflow-commands-for-github-actions
 */
export function formatGitHubAnnotations(result: CheckResult): string {
  // Workflow-command values must escape %, CR and LF.
  const esc = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  return result.findings
    .map((f) => `::error file=${esc(f.file)},line=${f.line},col=${f.column},title=FlagLens::${esc(describe(f))}`)
    .join("\n");
}

/** Markdown for a PR comment. The hidden marker lets tools find and update the same comment. */
export function formatMarkdown(result: CheckResult): string {
  const lines = ["<!-- flaglens-check -->", "### FlagLens check"];
  if (result.findings.length === 0) {
    lines.push(`✅ Every flag key used in code exists in Flagsmith project **${result.project}**.`);
  } else {
    lines.push(
      `❌ **${result.findings.length}** flag key(s) used in code don't exist in Flagsmith project **${result.project}**:`,
      "",
      "| Location | Key | Did you mean |",
      "|---|---|---|",
      ...result.findings.map(
        (f) => `| \`${f.file}:${f.line}\` | \`${f.key}\` | ${f.suggestion ? `\`${f.suggestion}\`` : "–"} |`,
      ),
    );
  }
  lines.push("", `<sub>${result.flagCount} flags, ${result.filesScanned} files scanned.</sub>`);
  return lines.join("\n");
}
