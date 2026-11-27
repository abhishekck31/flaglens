import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { closestName, levenshtein } from "../src/suggest.ts";

describe("levenshtein", () => {
  it("counts single-character edits", () => {
    assert.equal(levenshtein("kitten", "sitting"), 3);
    assert.equal(levenshtein("checkout_cta_varient", "checkout_cta_variant"), 1);
    assert.equal(levenshtein("", "abc"), 3);
    assert.equal(levenshtein("same", "same"), 0);
  });
});

describe("closestName", () => {
  const flags = ["checkout_cta_variant", "enable_express_checkout"];

  it("suggests the nearest flag within 3 edits", () => {
    assert.equal(closestName("checkout_cta_varient", flags), "checkout_cta_variant");
    assert.equal(closestName("enable_expres_checkout", flags), "enable_express_checkout");
  });

  it("suggests nothing when every flag is more than 3 edits away", () => {
    assert.equal(closestName("dark_mode", flags), undefined);
  });

  it("breaks ties alphabetically", () => {
    assert.equal(closestName("ab", ["ac", "aa"]), "aa");
  });
});
