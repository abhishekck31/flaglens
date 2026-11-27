// Helpers for "FlagLens: Start local Flagsmith". No `vscode` import.

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { dashboardBaseUrl } from "./format.ts";
import { getRepoRoot } from "./git.ts";

const run = promisify(execFile);

/** Flagsmith's liveness endpoint (same host as the API with the official compose file). */
export function healthUrl(apiUrl: string): string {
  return `${dashboardBaseUrl(apiUrl, "")}/health/liveness/`;
}

/** One quick health probe; any error (not listening yet, timeout) counts as "not healthy". */
export async function isHealthy(url: string, fetchFn: typeof fetch = fetch, timeoutMs = 3000): Promise<boolean> {
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
    await res.arrayBuffer(); // drain the body so the connection is released
    return res.ok;
  } catch {
    return false;
  }
}

export interface WaitOptions {
  fetchFn?: typeof fetch;
  intervalMs?: number;
  timeoutMs?: number;
  isCancelled?: () => boolean;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** Polls until healthy. The first start pulls images and runs migrations, hence the long default. */
export async function waitUntilHealthy(url: string, options: WaitOptions = {}): Promise<"healthy" | "timeout" | "cancelled"> {
  const { fetchFn = fetch, intervalMs = 2000, timeoutMs = 5 * 60_000, isCancelled = () => false } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let i = 0; i < attempts; i++) {
    if (isCancelled()) return "cancelled";
    if (await isHealthy(url, fetchFn)) return "healthy";
    await sleep(intervalMs);
  }
  return "timeout";
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** The folder with docker-compose.yml: the opened folder itself, else its git repository root. */
export async function findComposeRoot(folder: string): Promise<string | undefined> {
  if (await exists(path.join(folder, "docker-compose.yml"))) return folder;
  try {
    const root = await getRepoRoot(folder);
    return (await exists(path.join(root, "docker-compose.yml"))) ? root : undefined;
  } catch {
    return undefined; // not a git repo
  }
}

/** Services of THIS compose project that are running (read-only `docker compose ps`). */
export async function runningServices(composeRoot: string): Promise<string[]> {
  const { stdout } = await run("docker", ["compose", "ps", "--status", "running", "--services"], { cwd: composeRoot });
  return stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
