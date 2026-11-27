import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFullyRolledOut, sharedValue } from "../src/flagHealth.ts";
import { FlagsmithClient, type Environment, type Feature } from "../src/flagsmithClient.ts";
import { changedRange, isSupportedFile, removeFlag } from "../src/removeFlag.ts";

const FLAG = "new_checkout";
const lines = (...l: string[]) => l.join("\n") + "\n";

/** Rewrites and asserts the result has no leftover mentions. */
function clean(file: string, source: string, value?: string | number | boolean): string {
  const result = removeFlag(file, source, FLAG, value);
  assert.deepEqual(result.manual, [], "expected no manual cleanup");
  return result.text;
}

describe("shape 1: if (hasFeature(x)) {A} else {B} -> A", () => {
  it("unwraps A, drops B, keeps indentation and the surrounding code", () => {
    const source = lines(
      "function render() {",
      '  if (flagsmith.hasFeature("new_checkout")) {',
      "    showNew();",
      '    track("new");',
      "  } else {",
      "    showOld();",
      "  }",
      "  done();",
      "}",
    );
    assert.equal(clean("a.ts", source), lines("function render() {", "  showNew();", '  track("new");', "  done();", "}"));
  });

  it("works without an else branch", () => {
    assert.equal(clean("a.js", lines('if (hasFeature("new_checkout")) {', "  a();", "}", "b();")), lines("a();", "b();"));
  });

  it("keeps the braces in an else-if position", () => {
    const source = lines("if (a) {", "  one();", '} else if (hasFeature("new_checkout")) {', "  two();", "} else {", "  three();", "}");
    assert.equal(clean("a.ts", source), lines("if (a) {", "  one();", "} else {", "  two();", "}"));
  });

  it("keeps the braces when A declares let/const (so names can't clash)", () => {
    const source = lines('if (hasFeature("new_checkout")) {', "  const x = 1;", "  use(x);", "}");
    assert.equal(clean("a.ts", source), lines("{", "  const x = 1;", "  use(x);", "}"));
  });

  it("handles a nested check in the kept branch", () => {
    const source = lines(
      'if (hasFeature("new_checkout")) {',
      '  if (hasFeature("new_checkout")) {',
      "    a();",
      "  } else {",
      "    b();",
      "  }",
      "}",
    );
    assert.equal(clean("a.ts", source), lines("a();"));
  });

  it("removes the whole if when A is empty", () => {
    assert.equal(clean("a.ts", lines('if (hasFeature("new_checkout")) {} else { old(); }', "next();")), lines("next();"));
  });

  it("keeps Windows line endings", () => {
    const source = 'if (hasFeature("new_checkout")) {\r\n  a();\r\n  b();\r\n}\r\nc();\r\n';
    assert.equal(clean("a.ts", source), "a();\r\nb();\r\nc();\r\n");
  });
});

describe("shape 2: hasFeature(x) ? A : B -> A", () => {
  it("keeps the true branch", () => {
    assert.equal(
      clean("a.ts", lines('const label = flagsmith.hasFeature("new_checkout") ? "Pay now" : "Checkout";')),
      lines('const label = "Pay now";'),
    );
  });

  it("works inside JSX", () => {
    assert.equal(
      clean("a.tsx", lines('return <div>{hasFeature("new_checkout") ? <New /> : <Old />}</div>;')),
      lines("return <div>{<New />}</div>;"),
    );
  });

  it("wraps an object literal so an arrow body stays an expression", () => {
    assert.equal(
      clean("a.ts", lines('const cfg = () => hasFeature("new_checkout") ? { a: 1 } : { a: 2 };')),
      lines("const cfg = () => ({ a: 1 });"),
    );
  });
});

describe("shape 3: const v = getValue(x) -> inline the literal", () => {
  it("inlines a string everywhere v is used (shorthand too), skips a shadowing v, removes the declaration", () => {
    const source = lines(
      'const cta = flagsmith.getValue("new_checkout");',
      "render(cta, { cta });",
      "function inner() {",
      '  const cta = "shadow";',
      "  return cta;",
      "}",
    );
    assert.equal(
      clean("a.ts", source, "Buy now"),
      lines('render("Buy now", { cta: "Buy now" });', "function inner() {", '  const cta = "shadow";', "  return cta;", "}"),
    );
  });

  it("parenthesises numbers where needed", () => {
    const source = lines('const n = getValue("new_checkout");', "console.log(n.toFixed(1), -n, n + 1);");
    assert.equal(clean("a.js", source, 5), lines("console.log((5).toFixed(1), -5, 5 + 1);"));
    assert.equal(clean("a.js", source, -2), lines("console.log((-2).toFixed(1), -(-2), (-2) + 1);"));
  });

  it("inlines booleans", () => {
    assert.equal(clean("a.ts", lines('const on = getValue("new_checkout");', "if (on) go();"), true), lines("if (true) go();"));
  });
});

describe("never touches shapes it doesn't recognise", () => {
  const cases: Array<[string, string, string]> = [
    ["negated condition", 'if (!hasFeature("new_checkout")) { old(); }', "hasFeature(...) is not the whole condition of an if or ?:"],
    ["&& expression", 'const show = hasFeature("new_checkout") && isAdmin;', "hasFeature(...) is not the whole condition of an if or ?:"],
    ["object property", 'const f = { fast: flagsmith.hasFeature("new_checkout") };', "hasFeature(...) is not the whole condition of an if or ?:"],
    ["let instead of const", 'let cta = getValue("new_checkout");', "getValue(...) is not in a plain, non-exported `const v = getValue(...)`"],
    ["exported const", 'export const cta = getValue("new_checkout");', "getValue(...) is not in a plain, non-exported `const v = getValue(...)`"],
    ["other SDK function", 'if (isFeatureEnabled("new_checkout")) { a(); }', "isFeatureEnabled(...) is not a supported call"],
    ["useFlags array", 'const flags = useFlags(["new_checkout"]);', "mentioned outside a hasFeature/getValue call"],
    ["comment", '// "new_checkout" is legacy', "mentioned outside a hasFeature/getValue call"],
  ];
  for (const [label, code, reason] of cases) {
    it(`${label}: unchanged, reported with file position and reason`, () => {
      const source = lines("first();", code);
      const result = removeFlag("a.tsx", source, FLAG, "value");
      assert.equal(result.text, source);
      assert.equal(result.rewrites, 0);
      assert.deepEqual(result.manual, [{ line: 1, column: code.indexOf('"new_checkout"'), reason }]);
    });
  }

  it("getValue without a shared literal value is left alone", () => {
    const source = lines('const cta = getValue("new_checkout");', "use(cta);");
    const result = removeFlag("a.ts", source, FLAG, undefined);
    assert.equal(result.text, source);
    assert.match(result.manual[0]!.reason, /isn't the same string\/number\/boolean/);
  });

  it("reports leftovers with line numbers in the rewritten text", () => {
    const source = lines('if (hasFeature("new_checkout")) {', "  a();", "}", 'const x = hasFeature("new_checkout") || b;');
    const result = removeFlag("a.ts", source, FLAG);
    assert.equal(result.text, lines("a();", 'const x = hasFeature("new_checkout") || b;'));
    assert.equal(result.manual[0]!.line, 1);
  });
});

describe("helpers", () => {
  it("isSupportedFile: TS/JS family only", () => {
    assert.deepEqual(["a.ts", "a.TSX", "a.mjs", "a.jsx", "a.py", "a.vue"].map(isSupportedFile), [true, true, true, true, false, false]);
  });

  it("changedRange: smallest single replacement", () => {
    assert.deepEqual(changedRange("abcXYZdef", "abcQdef"), { start: 3, end: 6, text: "Q" });
    assert.deepEqual(changedRange("same", "same"), { start: 4, end: 4, text: "" });
  });

  const env = (id: number): Environment => ({ id, name: `e${id}`, api_key: `k${id}`, project: 1, use_v2_feature_versioning: false });
  const feature = (enabled: boolean, value: string | number | null, archived = false): Feature => ({
    id: 9,
    name: FLAG,
    type: "STANDARD",
    description: null,
    environment_feature_state: { id: 1, enabled, feature_state_value: value },
    code_references_counts: [],
    is_archived: archived,
  });

  it("isFullyRolledOut: on everywhere and not archived", () => {
    const envs = [env(1), env(2)];
    assert.equal(isFullyRolledOut(FLAG, envs, new Map([[1, [feature(true, null)]], [2, [feature(true, null)]]])), true);
    assert.equal(isFullyRolledOut(FLAG, envs, new Map([[1, [feature(true, null)]], [2, [feature(false, null)]]])), false);
    assert.equal(isFullyRolledOut(FLAG, envs, new Map([[1, [feature(true, null, true)]], [2, [feature(true, null, true)]]])), false);
  });

  it("sharedValue: only when every environment has the same literal", () => {
    const envs = [env(1), env(2)];
    assert.equal(sharedValue(FLAG, envs, new Map([[1, [feature(true, "Buy")]], [2, [feature(true, "Buy")]]])), "Buy");
    assert.equal(sharedValue(FLAG, envs, new Map([[1, [feature(true, "Buy")]], [2, [feature(true, "control")]]])), undefined);
    assert.equal(sharedValue(FLAG, envs, new Map([[1, [feature(true, null)]], [2, [feature(true, null)]]])), undefined);
  });

  it("archiveFeature: PATCH /projects/<id>/features/<id>/ with is_archived", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ id: 9, is_archived: true }), { status: 200 });
    }) as typeof fetch;
    await new FlagsmithClient("http://localhost:8000", "k", fetchFn).archiveFeature(1, 9);
    assert.deepEqual(calls, [{ url: "http://localhost:8000/api/v1/projects/1/features/9/", method: "PATCH", body: { is_archived: true } }]);
  });
});
