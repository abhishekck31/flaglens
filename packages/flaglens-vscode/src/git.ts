// Small wrappers around the `git` command line. No `vscode` import.
// We shell out to git (rather than reimplementing it) so .gitignore is respected for free.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  // execFile (not exec): arguments are passed as-is, never through a shell.
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/**
 * Turns a GitHub remote into the https URL Flagsmith expects, or undefined for other hosts.
 *   git@github.com:owner/repo.git     -> https://github.com/owner/repo
 *   https://github.com/owner/repo.git -> https://github.com/owner/repo
 */
export function toGitHubUrl(remote: string): string | undefined {
  const match = /^(?:git@github\.com:|https:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
    remote.trim(),
  );
  return match ? `https://github.com/${match[1]}/${match[2]}` : undefined;
}

export interface RepoInfo {
  /** Absolute path of the repository root. */
  root: string;
  /** `origin` as an https GitHub URL, or undefined if origin isn't on GitHub. */
  githubUrl: string | undefined;
  /** Full commit SHA of HEAD. */
  head: string;
  /** True if some remote-tracking branch already contains HEAD (so permalinks work). */
  headIsPushed: boolean;
  /** True if tracked files have uncommitted edits (scanned lines may differ from HEAD). */
  hasUncommittedChanges: boolean;
}

/** Throws if `cwd` isn't inside a git repository or `origin` isn't set. */
export async function getRepoInfo(cwd: string): Promise<RepoInfo> {
  const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
  const remote = (await git(root, ["remote", "get-url", "origin"])).trim();
  const head = (await git(root, ["rev-parse", "HEAD"])).trim();
  // Uses the local copies of remote branches (updated by push/fetch); no network call.
  const containing = (await git(root, ["branch", "-r", "--contains", head])).trim();
  const status = (await git(root, ["status", "--porcelain", "--untracked-files=no"])).trim();
  return {
    root,
    githubUrl: toGitHubUrl(remote),
    head,
    headIsPushed: containing.length > 0,
    hasUncommittedChanges: status.length > 0,
  };
}

/** Absolute path of the repository that contains `cwd`. Throws outside a git repo. */
export async function getRepoRoot(cwd: string): Promise<string> {
  return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
}

/**
 * Tracked files under `cwd` (the whole repo if `cwd` is the root), as paths relative to
 * the repo ROOT. Ignored and untracked files are never listed.
 */
export async function listTrackedFiles(cwd: string): Promise<string[]> {
  // -z separates with NUL so unusual file names survive; --full-name keeps paths root-relative.
  return (await git(cwd, ["ls-files", "-z", "--full-name"])).split("\0").filter(Boolean);
}
