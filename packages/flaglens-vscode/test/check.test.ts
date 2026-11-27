import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { formatGitHubAnnotations, formatMarkdown, formatText, runCheck, type CheckResult } from "../src/check.ts";
import { DEFAULT_EXCLUDE_GLOBS } from "../src/codeReferences.ts";
import { DEFAULT_CALL_PATTERNS } from "../src/flagScanner.ts";
import { FlagsmithClient } from "../src/flagsmithClient.ts";

const BASE = "http://localhost:8000/api/v1";

/** Fake Flagsmith with one project, one environment and two flags. */
const fetchFn = (async (input: string | URL | Request) => {
  const url = String(input);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  if (url === `${BASE}/projects/`) return json([{ id: 1, name: "Toggle Wars", organisation: 1 }]);
  if (url === `${BASE}/environments/?project=1`) return json({ next: null, results: [{ id: 7, name: "Development", api_key: "d", project: 1 }] });
  if (url === `${BASE}/projects/1/features/?environment=7`) {
    return json({ next: null, results: [{ name: "checkout_cta_variant" }, { name: "enable_express_checkout" }] });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

/** A throwaway git repo: one file with the typo, one clean, one excluded test file. */
function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "flaglens-check-"));
  const write = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  };
  write("src/cta.ts", 'const cta = flagsmith.getValue("checkout_cta_varient");\n');
  write("src/fast.ts", 'flagsmith.hasFeature("enable_express_checkout");\nuseFlags(["totally_new"]);\n');
  write("src/a.test.ts", 'hasFeature("ignored_in_tests");\n');
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "."], { cwd: dir });
  return dir;
}

describe("runCheck", () => {
  const dir = makeRepo();
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("reports missing keys with 1-based positions and a suggestion when one is close", async () => {
    const result = await runCheck({
      client: new FlagsmithClient(BASE, "k", fetchFn),
      cwd: dir,
      excludeGlobs: DEFAULT_EXCLUDE_GLOBS,
      callPatterns: DEFAULT_CALL_PATTERNS,
    });
    assert.equal(result.project, "Toggle Wars");
    assert.equal(result.flagCount, 2);
    assert.equal(result.filesScanned, 2); // the test file is excluded
    assert.deepEqual(result.findings, [
      { key: "checkout_cta_varient", file: "src/cta.ts", line: 1, column: 33, suggestion: "checkout_cta_variant" },
      { key: "totally_new", file: "src/fast.ts", line: 2, column: 12, suggestion: null },
    ]);
  });
});

describe("formatters", () => {
  const result: CheckResult = {
    project: "Toggle Wars",
    filesScanned: 2,
    flagCount: 2,
    findings: [{ key: "checkout_cta_varient", file: "src/cta.ts", line: 1, column: 33, suggestion: "checkout_cta_variant" }],
  };

  it("text: file:line:col plus 'Did you mean'", () => {
    assert.match(formatText(result), /^src\/cta\.ts:1:33 {2}"checkout_cta_varient" is not a flag in Flagsmith\. Did you mean "checkout_cta_variant"\?$/m);
  });

  it("text: says OK when nothing is missing", () => {
    assert.match(formatText({ ...result, findings: [] }), /OK: every flag key/);
  });

  it("GitHub annotation points at the line", () => {
    assert.equal(
      formatGitHubAnnotations(result),
      '::error file=src/cta.ts,line=1,col=33,title=FlagLens::"checkout_cta_varient" is not a flag in Flagsmith. Did you mean "checkout_cta_variant"?',
    );
  });

  it("markdown: hidden marker and a table row", () => {
    const md = formatMarkdown(result);
    assert.ok(md.startsWith("<!-- flaglens-check -->"));
    assert.match(md, /\| `src\/cta\.ts:1` \| `checkout_cta_varient` \| `checkout_cta_variant` \|/);
  });
});

describe("cli", () => {
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const run = (args: string[], env: Record<string, string>) =>
    spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, ...env } });

  it("exits 2 with a clear message when FLAGLENS_API_KEY is missing", () => {
    const res = run(["check"], { FLAGLENS_API_KEY: "" });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /FLAGLENS_API_KEY/);
  });

  it("exits 2 and prints usage for an unknown command", () => {
    const res = run(["nope"], { FLAGLENS_API_KEY: "k" });
    assert.equal(res.status, 2);
    assert.match(res.stdout, /Usage: flaglens/);
  });
});
