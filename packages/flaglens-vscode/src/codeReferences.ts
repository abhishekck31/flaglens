// Builds the code-reference payload Flagsmith stores, from scanned files. No `vscode` import.

import { findFlagReferences } from "./flagScanner.ts";

/** One entry of `code_references` in POST /projects/{id}/code-references/. */
export interface CodeReferenceSubmit {
  feature_name: string;
  file_path: string;
  /** 1-based, as Flagsmith and GitHub permalinks expect. */
  line_number: number;
}

/**
 * Files that never count as real flag usage. Mirrors the `flaglens.exclude` default.
 * Only tracked files are scanned, so .gitignore'd files are already out.
 */
export const DEFAULT_EXCLUDE_GLOBS = [
  // build output and dependencies
  "**/node_modules/**",
  "**/dist/**",
  "**/out/**",
  "**/.next/**",
  // tests and docs mention flag names without using them
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.md",
  "**/*.mdx",
  // local stack, tooling and seed data set flags up rather than use them
  "stack/**",
  "scripts/**",
  "**/seed*",
];

/**
 * Turns a glob into a regular expression over repo-relative paths ("a/b/c.ts").
 *   `**` + `/` : any number of folders (including none)
 *   `**`       : anything, including "/"
 *   `*`        : anything except "/"
 *   `?`        : one character except "/"
 * Everything else matches literally. The whole path must match.
 */
export function globToRegExp(glob: string): RegExp {
  let pattern = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob.charAt(i);
    if (glob.startsWith("**/", i)) {
      pattern += "(?:.*/)?";
      i += 2;
    } else if (glob.startsWith("**", i)) {
      pattern += ".*";
      i += 1;
    } else if (char === "*") {
      pattern += "[^/]*";
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${pattern}$`);
}

/** Whether a repo-relative path (forward slashes) should be scanned. */
export function shouldScanPath(filePath: string, excludeGlobs: readonly string[]): boolean {
  return !excludeGlobs.some((glob) => globToRegExp(glob).test(filePath));
}

/** Same binary/size heuristics as the official Flagsmith/ci scanner. */
export function looksLikeText(content: Buffer): boolean {
  if (content.length === 0 || content.length > 1024 * 1024) return false;
  return !content.subarray(0, 4096).includes(0);
}

/** Every known flag name found in the given files, as Flagsmith's payload entries. */
export function buildCodeReferences(
  files: ReadonlyArray<{ path: string; text: string }>,
  flagNames: ReadonlySet<string>,
): CodeReferenceSubmit[] {
  const refs: CodeReferenceSubmit[] = [];
  for (const file of files) {
    for (const ref of findFlagReferences(file.text, flagNames)) {
      refs.push({ feature_name: ref.name, file_path: file.path, line_number: ref.line + 1 });
    }
  }
  return refs;
}

export interface PushSummary {
  totalReferences: number;
  /** Flag name -> its references, only for flags that were found. */
  byFlag: Map<string, CodeReferenceSubmit[]>;
  /** Flags in Flagsmith that the scan didn't find anywhere (sorted). */
  unreferenced: string[];
}

export function summarize(refs: readonly CodeReferenceSubmit[], flagNames: ReadonlySet<string>): PushSummary {
  const byFlag = new Map<string, CodeReferenceSubmit[]>();
  for (const ref of refs) {
    byFlag.set(ref.feature_name, [...(byFlag.get(ref.feature_name) ?? []), ref]);
  }
  const unreferenced = [...flagNames].filter((name) => !byFlag.has(name)).sort();
  return { totalReferences: refs.length, byFlag, unreferenced };
}
