// FlagLens command line: `check` and `push`. No `vscode` import; runs with Node 22.18+ directly from
// this .ts file (Node strips the types), so it needs no build step or npm install.
//
//   node packages/flaglens-vscode/src/cli.ts check [--json] [--markdown-file f] [--json-file f]
//   node packages/flaglens-vscode/src/cli.ts push  [--allow-unpushed]
//
// Env: FLAGLENS_API_KEY (Organisation API key, required), FLAGLENS_API_URL (default localhost).
// Settings: reads `flaglens.*` from <repo>/.vscode/settings.json if present, so CI and the editor
// use the same exclude globs and call patterns. Flags on the command line win.
// Exit codes: 0 = OK, 1 = missing flag keys found, 2 = usage, config or network error.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { formatGitHubAnnotations, formatMarkdown, formatText, runCheck } from "./check.ts";
import { DEFAULT_EXCLUDE_GLOBS } from "./codeReferences.ts";
import { DEFAULT_CALL_PATTERNS } from "./flagScanner.ts";
import { FlagsmithClient } from "./flagsmithClient.ts";
import { getRepoRoot } from "./git.ts";
import { formatSummary, scanAndPush } from "./pushReferences.ts";

const USAGE = `Usage: flaglens <check|push> [options]

check   Exit 1 if code uses flag keys that don't exist in Flagsmith
  --json                 print JSON instead of text
  --markdown-file <f>    also write a Markdown report (for PR comments)
  --json-file <f>        also write the JSON result to a file
push    Upload code references to Flagsmith
  --allow-unpushed       push even if HEAD isn't on the remote / tree is dirty

Common:
  --project <id>         Flagsmith project id (default: first project)
  --path <dir>           folder to scan (default: current directory)
  --exclude <glob>       exclude glob, repeatable (replaces the default list)
  --call-pattern <name>  SDK function name, repeatable (replaces the default list)

Env: FLAGLENS_API_KEY (required), FLAGLENS_API_URL (default http://localhost:8000/api/v1/)`;

/** The `flaglens.*` settings we read from .vscode/settings.json. */
interface RepoSettings {
  exclude?: string[];
  callPatterns?: string[];
  projectId?: number;
}

/**
 * Reads flaglens.* from <repo>/.vscode/settings.json. VS Code allows comments there (JSONC);
 * we only strip whole-line `//` comments, which is what this repo uses.
 */
async function readRepoSettings(cwd: string): Promise<RepoSettings> {
  try {
    const root = await getRepoRoot(cwd);
    const raw = await readFile(path.join(root, ".vscode", "settings.json"), "utf8");
    const json = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;
    return {
      exclude: json["flaglens.exclude"] as string[] | undefined,
      callPatterns: json["flaglens.callPatterns"] as string[] | undefined,
      projectId: json["flaglens.projectId"] as number | undefined,
    };
  } catch {
    return {}; // no repo, no file, or unreadable: use defaults
  }
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      "markdown-file": { type: "string" },
      "json-file": { type: "string" },
      "allow-unpushed": { type: "boolean", default: false },
      project: { type: "string" },
      path: { type: "string" },
      exclude: { type: "string", multiple: true },
      "call-pattern": { type: "string", multiple: true },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const command = positionals[0];
  if (values.help || (command !== "check" && command !== "push")) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }

  const apiKey = process.env.FLAGLENS_API_KEY;
  if (!apiKey) {
    console.error("Set FLAGLENS_API_KEY to your Flagsmith Organisation API key.");
    return 2;
  }
  const cwd = path.resolve(values.path ?? process.cwd());
  const settings = await readRepoSettings(cwd);
  const client = new FlagsmithClient(process.env.FLAGLENS_API_URL ?? "http://localhost:8000/api/v1/", apiKey);
  const projectId = values.project ? Number(values.project) : settings.projectId;
  const excludeGlobs = values.exclude ?? settings.exclude ?? DEFAULT_EXCLUDE_GLOBS;
  const callPatterns = values["call-pattern"] ?? settings.callPatterns ?? DEFAULT_CALL_PATTERNS;

  if (command === "check") {
    const result = await runCheck({ client, projectId, cwd, excludeGlobs, callPatterns });
    if (values["markdown-file"]) await writeFile(values["markdown-file"], formatMarkdown(result) + "\n");
    if (values["json-file"]) await writeFile(values["json-file"], JSON.stringify(result, null, 2) + "\n");
    if (values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatText(result));
      // Inside GitHub Actions, also annotate the offending lines in the PR diff.
      if (process.env.GITHUB_ACTIONS === "true" && result.findings.length > 0) console.log(formatGitHubAnnotations(result));
    }
    return result.findings.length > 0 ? 1 : 0;
  }

  // push
  const projects = await client.listProjects();
  const project = projectId ? projects.find((p) => p.id === projectId) : projects[0];
  if (!project) throw new Error("Project not found.");
  const [environment] = await client.listEnvironments(project.id);
  const features = environment ? await client.listFeatures(project.id, environment.id) : [];
  const outcome = await scanAndPush({
    client,
    projectId: project.id,
    flagNames: new Set(features.map((f) => f.name)),
    cwd,
    excludeGlobs,
    confirmRisk: async (warning) => {
      console.warn(`Warning: ${warning}`);
      if (!values["allow-unpushed"]) console.warn("Not pushing. Re-run with --allow-unpushed to push anyway.");
      return values["allow-unpushed"];
    },
  });
  if (outcome.kind === "pushed") {
    console.log(formatSummary(outcome, project.name));
    return 0;
  }
  if (outcome.kind === "refused") console.error(outcome.reason);
  return 2;
}

// process.exitCode (not process.exit) lets pending network handles close cleanly on Windows.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`flaglens: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
  },
);
