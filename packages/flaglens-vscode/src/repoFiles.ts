// Reads the source files FlagLens scans: tracked by git, not excluded, and text. No `vscode` import.
// Shared by "Push code references" (whole repo) and "Flag Health" (the open folder).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { looksLikeText, shouldScanPath } from "./codeReferences.ts";
import { getRepoRoot, listTrackedFiles } from "./git.ts";

export interface ScannedFile {
  /** Repo-relative path with forward slashes, e.g. "apps/web/src/a.ts". */
  path: string;
  text: string;
}

/**
 * Tracked files under `cwd` that pass the exclude globs and look like text.
 * Content comes from disk, so unsaved-to-git edits (but saved files) are included.
 */
export async function readTrackedFiles(
  cwd: string,
  excludeGlobs: readonly string[],
): Promise<{ root: string; files: ScannedFile[] }> {
  const root = await getRepoRoot(cwd);
  const files: ScannedFile[] = [];
  for (const relPath of await listTrackedFiles(cwd)) {
    if (!shouldScanPath(relPath, excludeGlobs)) continue;
    let content: Buffer;
    try {
      content = await readFile(path.join(root, relPath));
    } catch {
      continue; // tracked but deleted from disk
    }
    if (looksLikeText(content)) files.push({ path: relPath, text: content.toString("utf8") });
  }
  return { root, files };
}
