// Builds the code-reference payload Flagsmith stores, from scanned files. No `vscode` import.

import { findFlagReferences } from "./flagScanner.ts";

/** One entry of `code_references` in POST /projects/{id}/code-references/. */
export interface CodeReferenceSubmit {
  feature_name: string;
  file_path: string;
  /** 1-based, as Flagsmith and GitHub permalinks expect. */
  line_number: number;
}

/** Directories skipped even when tracked. Mirrors the `flaglens.scanExcludeDirs` default. */
export const DEFAULT_EXCLUDE_DIRS = ["node_modules", "dist", "out", ".next", "test", "tests", "__tests__"];

/**
 * Whether a repo-relative path should be scanned. Skips excluded directories anywhere in
 * the path, Markdown (docs mention flag names without using them) and *.test.* / *.spec.* files.
 */
export function shouldScanPath(filePath: string, excludeDirs: readonly string[]): boolean {
  const segments = filePath.split("/");
  const fileName = segments.pop() ?? "";
  if (segments.some((dir) => excludeDirs.includes(dir))) return false;
  if (/\.mdx?$/i.test(fileName)) return false;
  if (/\.(test|spec)\.[^.]+$/i.test(fileName)) return false;
  return true;
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
