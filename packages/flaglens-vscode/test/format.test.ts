import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Feature } from "../src/flagsmithClient.ts";
import { describeFlag, isProductionName, totalCodeReferences } from "../src/format.ts";

/** A feature with sensible defaults; override only what a test cares about. */
function feature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 1,
    name: "new_checkout",
    type: "STANDARD",
    description: null,
    environment_feature_state: { id: 10, enabled: true, feature_state_value: null },
    code_references_counts: [],
    ...overrides,
  };
}

describe("describeFlag", () => {
  it("shows state and reference count", () => {
    const f = feature({
      code_references_counts: [
        { repository_url: "https://github.com/a/one", count: 2 },
        { repository_url: "https://github.com/a/two", count: 1 },
      ],
    });
    assert.equal(describeFlag(f), "on · 3 refs");
  });

  it("uses the singular for one reference and shows off flags", () => {
    const f = feature({
      environment_feature_state: { id: 10, enabled: false, feature_state_value: null },
      code_references_counts: [{ repository_url: "https://github.com/a/one", count: 1 }],
    });
    assert.equal(describeFlag(f), "off · 1 ref");
  });

  it("includes the value and truncates long values", () => {
    assert.equal(
      describeFlag(feature({ environment_feature_state: { id: 1, enabled: true, feature_state_value: "control" } })),
      'on · "control" · 0 refs',
    );
    const long = describeFlag(
      feature({ environment_feature_state: { id: 1, enabled: true, feature_state_value: "x".repeat(50) } }),
    );
    assert.ok(long.includes("…"));
  });

  it("handles a flag with no environment state", () => {
    assert.equal(describeFlag(feature({ environment_feature_state: null })), "no state · 0 refs");
  });
});

describe("totalCodeReferences", () => {
  it("is 0 when no repository was scanned", () => {
    assert.equal(totalCodeReferences(feature()), 0);
  });
});

describe("isProductionName", () => {
  it("matches prod-like names case-insensitively", () => {
    for (const name of ["Production", "prod", "PROD-EU", "pre-prod"]) assert.equal(isProductionName(name), true, name);
    for (const name of ["Development", "Staging", "QA"]) assert.equal(isProductionName(name), false, name);
  });
});
