import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findFlagReferences } from "../src/flagScanner.ts";

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
