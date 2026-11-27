import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { DEFAULT_EXCLUDE_GLOBS } from "../src/codeReferences.ts";
import { computeHealth } from "../src/flagHealth.ts";
import { DEFAULT_CALL_PATTERNS } from "../src/flagScanner.ts";
import type { Environment, Feature } from "../src/flagsmithClient.ts";
import { readTrackedFiles } from "../src/repoFiles.ts";

const dev: Environment = { id: 1, name: "Development", api_key: "d", project: 1, use_v2_feature_versioning: false };
const prod: Environment = { id: 2, name: "Production", api_key: "p", project: 1, use_v2_feature_versioning: false };

function flag(name: string, enabled: boolean): Feature {
  return {
    id: name.length,
    name,
    type: "STANDARD",
    description: null,
    environment_feature_state: { id: 1, enabled, feature_state_value: null },
    code_references_counts: [],
  };
}

/** Same three flags in both environments; only `everywhere` is on in both. */
const featuresByEnvironment = new Map<number, Feature[]>([
  [1, [flag("checkout_cta_variant", true), flag("enable_express_checkout", true), flag("everywhere", true)]],
  [2, [flag("checkout_cta_variant", false), flag("enable_express_checkout", false), flag("everywhere", true)]],
]);

describe("computeHealth", () => {
  const health = computeHealth({
    environments: [dev, prod],
    featuresByEnvironment,
    callPatterns: DEFAULT_CALL_PATTERNS,
    files: [
      {
        path: "src/app.ts",
        text: [
          'const cta = flagsmith.getValue("checkout_cta_varient");', // typo
          'const fast = flagsmith.hasFeature("enable_express_checkout");',
          'if (flagsmith.hasFeature("everywhere")) {}',
        ].join("\n"),
      },
      { path: "src/other.ts", text: 'useFlags(["brand_new_flag"]);' },
    ],
  });

  it("Unused: flags no file mentions (the typo doesn't count as a use)", () => {
    assert.deepEqual(health.unused, ["checkout_cta_variant"]);
  });

  it("Missing: SDK-call keys with no flag, with file and position for jumping to them", () => {
    const typoLine = 'const cta = flagsmith.getValue("checkout_cta_varient");';
    assert.deepEqual(health.missing, [
      // column = where the key itself starts, i.e. what the tree selects when clicked
      { name: "checkout_cta_varient", path: "src/app.ts", line: 0, column: typoLine.indexOf("checkout_cta_varient") },
      { name: "brand_new_flag", path: "src/other.ts", line: 0, column: 'useFlags(["'.length },
    ]);
  });

  it("Fully rolled out: on in every environment", () => {
    assert.deepEqual(health.fullyRolledOut, ["everywhere"]);
  });

  it("a flag missing from one environment is not fully rolled out", () => {
    const partial = computeHealth({
      environments: [dev, prod],
      featuresByEnvironment: new Map([[1, [flag("only_dev", true)]], [2, []]]),
      callPatterns: [],
      files: [],
    });
    assert.deepEqual(partial.fullyRolledOut, []);
  });

  it("no environments means nothing is fully rolled out", () => {
    const none = computeHealth({ environments: [], featuresByEnvironment: new Map(), callPatterns: [], files: [] });
    assert.deepEqual(none, { unused: [], missing: [], fullyRolledOut: [] });
  });
});

describe("readTrackedFiles (real git repo in a temp folder)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "flaglens-health-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  };
  execFileSync("git", ["init", "-q"], { cwd: dir });
  write("apps/web/src/a.ts", "a");
  write("apps/web/seed.ts", "seed"); // excluded by **/seed*
  write("tools/b.ts", "b"); // outside the opened folder
  write("apps/web/untracked.ts", "u");
  execFileSync("git", ["add", "apps/web/src/a.ts", "apps/web/seed.ts", "tools/b.ts"], { cwd: dir });

  it("lists only tracked, non-excluded files under the opened folder, with repo-relative paths", async () => {
    const { files } = await readTrackedFiles(path.join(dir, "apps", "web"), DEFAULT_EXCLUDE_GLOBS);
    assert.deepEqual(files.map((f) => f.path), ["apps/web/src/a.ts"]);
  });

  it("from the repo root, lists the whole repo", async () => {
    const { files } = await readTrackedFiles(dir, DEFAULT_EXCLUDE_GLOBS);
    assert.deepEqual(files.map((f) => f.path).sort(), ["apps/web/src/a.ts", "tools/b.ts"]);
  });
});
