import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { DEFAULT_EXCLUDE_GLOBS, globToRegExp, shouldScanPath, summarize } from "../src/codeReferences.ts";
import { FlagsmithClient } from "../src/flagsmithClient.ts";
import { toGitHubUrl } from "../src/git.ts";
import { scanAndPush } from "../src/pushReferences.ts";

describe("toGitHubUrl", () => {
  it("normalises SSH and HTTPS GitHub remotes", () => {
    assert.equal(toGitHubUrl("git@github.com:owner/repo.git"), "https://github.com/owner/repo");
    assert.equal(toGitHubUrl("https://github.com/owner/repo.git"), "https://github.com/owner/repo");
    assert.equal(toGitHubUrl("https://github.com/owner/repo"), "https://github.com/owner/repo");
    assert.equal(toGitHubUrl("ssh://git@github.com/owner/repo.git"), "https://github.com/owner/repo");
  });
  it("rejects other hosts", () => {
    assert.equal(toGitHubUrl("https://gitlab.com/owner/repo.git"), undefined);
  });
});

describe("globToRegExp", () => {
  it("supports **, * and ?", () => {
    assert.equal(globToRegExp("**/seed*").test("scripts/seed.mjs"), true);
    assert.equal(globToRegExp("**/seed*").test("seed.ts"), true); // "**/" also matches no folder
    assert.equal(globToRegExp("**/seed*").test("src/seedling/x.ts"), false); // * stays within one name
    assert.equal(globToRegExp("stack/**").test("stack/docker/compose.yml"), true);
    assert.equal(globToRegExp("stack/**").test("apps/stack/x.ts"), false); // anchored at the repo root
    assert.equal(globToRegExp("src/?.ts").test("src/a.ts"), true);
    assert.equal(globToRegExp("*.md").test("docs/a.md"), false); // no folders without **
  });
});

describe("shouldScanPath", () => {
  it("excludes seed data, local stack and root scripts by default", () => {
    for (const p of ["scripts/seed.mjs", "stack/flagsmith/docker-compose.yml", "apps/api/seed_data.ts"]) {
      assert.equal(shouldScanPath(p, DEFAULT_EXCLUDE_GLOBS), false, p);
    }
  });

  it("skips excluded directories, Markdown and test files", () => {
    for (const p of ["node_modules/x/index.js", "apps/web/.next/a.js", "dist/extension.cjs", "pkg/test/a.ts", "README.md", "src/a.test.ts", "src/a.spec.js"]) {
      assert.equal(shouldScanPath(p, DEFAULT_EXCLUDE_GLOBS), false, p);
    }
    assert.equal(shouldScanPath("apps/demo-store/src/components/FlagsmithProvider.tsx", DEFAULT_EXCLUDE_GLOBS), true);
  });
});

describe("summarize", () => {
  it("counts references per flag and lists flags with none", () => {
    const s = summarize(
      [
        { feature_name: "a", file_path: "x.ts", line_number: 1 },
        { feature_name: "a", file_path: "y.ts", line_number: 2 },
      ],
      new Set(["a", "b"]),
    );
    assert.equal(s.totalReferences, 2);
    assert.equal(s.byFlag.get("a")?.length, 2);
    assert.deepEqual(s.unreferenced, ["b"]);
  });
});

describe("scanAndPush (real git repo in a temp folder)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "flaglens-test-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  const write = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  };

  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "FlagLens test");
  git("remote", "add", "origin", "git@github.com:owner/demo.git");
  write(".gitignore", "secret.ts\n");
  write("src/app.ts", 'line one\nflagsmith.getValue("new_checkout");\n');
  write("secret.ts", 'getValue("new_checkout")\n'); // ignored: must not be scanned
  write("node_modules/lib/index.js", 'getValue("new_checkout")\n'); // force-added below, still skipped
  write("docs/notes.md", 'mentions "new_checkout"\n');
  git("add", ".");
  git("add", "-f", "node_modules/lib/index.js");
  git("commit", "-q", "-m", "init");

  /** Fake Flagsmith that records each upload body. */
  function recordingClient() {
    const uploads: Array<{ code_references: unknown[]; repository_url: string; revision: string }> = [];
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      uploads.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 201 });
    }) as typeof fetch;
    return { client: new FlagsmithClient("http://localhost:8000", "k", fetchFn), uploads };
  }

  it("scans only tracked, non-excluded files and reports the unpushed commit", async () => {
    const { client, uploads } = recordingClient();
    const warnings: string[] = [];
    const outcome = await scanAndPush({
      client,
      projectId: 1,
      flagNames: new Set(["new_checkout", "dark_mode"]),
      cwd: path.join(dir, "src"), // a sub-folder: the whole repo is still scanned
      excludeGlobs: DEFAULT_EXCLUDE_GLOBS,
      confirmRisk: async (w) => (warnings.push(w), true),
    });

    assert.equal(outcome.kind, "pushed");
    assert.match(warnings[0] ?? "", /isn't on the remote/);
    assert.equal(uploads[0]?.repository_url, "https://github.com/owner/demo");
    assert.deepEqual(uploads[0]?.code_references, [{ feature_name: "new_checkout", file_path: "src/app.ts", line_number: 2 }]);
    if (outcome.kind === "pushed") assert.deepEqual(outcome.summary.unreferenced, ["dark_mode"]);
  });

  it("uploads nothing when the user declines the warning", async () => {
    const { client, uploads } = recordingClient();
    const outcome = await scanAndPush({
      client, projectId: 1, flagNames: new Set(["new_checkout"]), cwd: dir,
      excludeGlobs: DEFAULT_EXCLUDE_GLOBS, confirmRisk: async () => false,
    });
    assert.equal(outcome.kind, "cancelled");
    assert.equal(uploads.length, 0);
  });

  it("still uploads an empty scan, so old references are cleared", async () => {
    const { client, uploads } = recordingClient();
    await scanAndPush({
      client, projectId: 1, flagNames: new Set(["unused_flag"]), cwd: dir,
      excludeGlobs: DEFAULT_EXCLUDE_GLOBS, confirmRisk: async () => true,
    });
    assert.equal(uploads.length, 1);
    assert.deepEqual(uploads[0]?.code_references, []);
  });
});
