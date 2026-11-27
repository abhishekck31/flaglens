import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CALL_PATTERNS, findFlagCalls, findFlagReferences } from "../src/flagScanner.ts";

const FLAGS = new Set(["checkout_cta_variant", "enable_express_checkout"]);

describe("findFlagReferences", () => {
  it("finds flag names in any quote style and call shape", () => {
    const code = [
      'flagsmith.getValue("checkout_cta_variant")', // missed by the official scanner
      "const flags = useFlags(['enable_express_checkout']);", // ditto
      "const name = `checkout_cta_variant`;",
    ].join("\n");
    assert.deepEqual(findFlagReferences(code, FLAGS), [
      { name: "checkout_cta_variant", line: 0, column: 19 },
      { name: "enable_express_checkout", line: 1, column: 24 },
      { name: "checkout_cta_variant", line: 2, column: 13 },
    ]);
  });

  it("ignores unquoted names, partial matches and unknown strings", () => {
    const code = [
      "checkout_cta_variant: { enabled: true },", // object key, not a string
      'log("checkout_cta_variant_old")', // different name
      'log("hello")',
    ].join("\r\n");
    assert.deepEqual(findFlagReferences(code, FLAGS), []);
  });

  it("finds two flags on one line", () => {
    const refs = findFlagReferences('both("checkout_cta_variant", "enable_express_checkout")', FLAGS);
    assert.deepEqual(refs.map((r) => r.name), ["checkout_cta_variant", "enable_express_checkout"]);
  });
});

describe("findFlagCalls", () => {
  it("finds the key in each default SDK call, including typos", () => {
    const code = [
      'flagsmith.getValue("checkout_cta_varient")',
      'flags.isFeatureEnabled( "new_checkout" )',
      "const { a, b } = useFlags(['flag_a', \"flag_b\"]);",
      'hasFeature(`beta`)',
    ].join("\n");
    assert.deepEqual(findFlagCalls(code, DEFAULT_CALL_PATTERNS), [
      { name: "checkout_cta_varient", line: 0, column: 20 },
      { name: "new_checkout", line: 1, column: 25 },
      { name: "flag_a", line: 2, column: 28 },
      { name: "flag_b", line: 2, column: 38 },
      { name: "beta", line: 3, column: 12 },
    ]);
  });

  it("ignores other functions, non-literal args and look-alike names", () => {
    const code = ['getValues("x")', "getValue(flagName)", 'log("getValue")', 'mygetValue("y")'].join("\n");
    assert.deepEqual(findFlagCalls(code, DEFAULT_CALL_PATTERNS), []);
  });

  it("supports configured patterns such as Python's is_feature_enabled", () => {
    const calls = findFlagCalls('if flags.is_feature_enabled("dark_mode"):', ["is_feature_enabled"]);
    assert.deepEqual(calls.map((c) => c.name), ["dark_mode"]);
  });

  it("reports the column of the key itself, inside the quotes", () => {
    const line = 'getValue("abc")';
    const [call] = findFlagCalls(line, ["getValue"]);
    assert.equal(line.slice(call!.column, call!.column + 3), "abc");
  });
});
