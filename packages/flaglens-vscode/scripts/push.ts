// Same "Push code references" as the VS Code command, from a terminal (e.g. CI or a git hook).
// Usage: FLAGLENS_API_KEY=<organisation key> npm run push -- [--project <id>] [--allow-unpushed]
// Optional: FLAGLENS_API_URL (default http://localhost:8000/api/v1/)

import { DEFAULT_EXCLUDE_GLOBS } from "../src/codeReferences.ts";
import { FlagsmithClient } from "../src/flagsmithClient.ts";
import { formatSummary, scanAndPush } from "../src/pushReferences.ts";

const apiKey = process.env.FLAGLENS_API_KEY;
if (!apiKey) {
  console.error("Set FLAGLENS_API_KEY to your Organisation API key.");
  process.exit(1);
}
const args = process.argv.slice(2);
const projectArg = args.indexOf("--project");
const allowUnpushed = args.includes("--allow-unpushed");

const client = new FlagsmithClient(process.env.FLAGLENS_API_URL ?? "http://localhost:8000/api/v1/", apiKey);
const projects = await client.listProjects();
const project = projectArg >= 0 ? projects.find((p) => p.id === Number(args[projectArg + 1])) : projects[0];
if (!project) {
  console.error("Project not found.");
  process.exit(1);
}

// Flag names are the same in every environment, so one environment is enough.
const [environment] = await client.listEnvironments(project.id);
const features = environment ? await client.listFeatures(project.id, environment.id) : [];

const outcome = await scanAndPush({
  client,
  projectId: project.id,
  flagNames: new Set(features.map((f) => f.name)),
  cwd: process.cwd(),
  excludeGlobs: DEFAULT_EXCLUDE_GLOBS,
  confirmRisk: async (warning) => {
    console.warn(`Warning: ${warning}`);
    if (!allowUnpushed) console.warn("Not pushing. Re-run with --allow-unpushed to push anyway.");
    return allowUnpushed;
  },
});

if (outcome.kind === "pushed") console.log(formatSummary(outcome, project.name));
else if (outcome.kind === "refused") {
  console.error(outcome.reason);
  process.exit(1);
} else process.exit(2);
