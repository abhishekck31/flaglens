import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FlagsmithClient, type Environment, type Feature } from "../src/flagsmithClient.ts";
import { toggleFlag, type ConfirmFn } from "../src/toggle.ts";

const BASE = "http://localhost:8000/api/v1";

function environment(overrides: Partial<Environment> = {}): Environment {
  return { id: 1, name: "Development", api_key: "dev-key", project: 1, use_v2_feature_versioning: false, ...overrides };
}

const feature: Feature = {
  id: 2,
  name: "enable_express_checkout",
  type: "STANDARD",
  description: null,
  // The tree's (possibly stale) copy says "on"...
  environment_feature_state: { id: 3, enabled: true, feature_state_value: null },
  code_references_counts: [],
};

/**
 * Fake Flagsmith holding one feature state. `serverEnabled` is the live value,
 * which may differ from the stale copy above. Records every PATCH body.
 */
function fakeServer(serverEnabled: boolean, envKey = "dev-key") {
  const patches: unknown[] = [];
  const url = `${BASE}/environments/${envKey}/featurestates/3/`;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) !== url) return new Response("not found", { status: 404 });
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { enabled: boolean };
      patches.push(body);
      serverEnabled = body.enabled;
    }
    return new Response(JSON.stringify({ id: 3, enabled: serverEnabled }), { status: 200 });
  }) as typeof fetch;
  return { client: new FlagsmithClient(BASE, "k", fetchFn), patches };
}

/** A confirm function that answers `answer` and records the questions it was asked. */
function confirmer(answer: boolean): { confirm: ConfirmFn; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    confirm: async (question) => {
      asked.push(question);
      return answer;
    },
  };
}

describe("toggleFlag", () => {
  it("toggles a non-production flag without asking", async () => {
    const { client, patches } = fakeServer(true);
    const { confirm, asked } = confirmer(false);
    const outcome = await toggleFlag(client, environment(), feature, confirm);
    assert.deepEqual(outcome, { kind: "toggled", enabled: false });
    assert.deepEqual(patches, [{ enabled: false }]);
    assert.equal(asked.length, 0);
  });

  it("flips the LIVE state, not the stale copy", async () => {
    const { client, patches } = fakeServer(false); // someone already turned it off
    const outcome = await toggleFlag(client, environment(), feature, confirmer(true).confirm);
    assert.deepEqual(outcome, { kind: "toggled", enabled: true });
    assert.deepEqual(patches, [{ enabled: true }]);
  });

  it("asks before changing production, and does nothing if the user says no", async () => {
    const { client, patches } = fakeServer(true, "prod-key");
    const { confirm, asked } = confirmer(false);
    const prod = environment({ name: "Production", api_key: "prod-key" });
    const outcome = await toggleFlag(client, prod, feature, confirm);
    assert.deepEqual(outcome, { kind: "cancelled" });
    assert.deepEqual(patches, []);
    assert.deepEqual(asked, ['Turn OFF "enable_express_checkout" in Production?']);
  });

  it("changes production after an explicit yes", async () => {
    const { client, patches } = fakeServer(true, "prod-key");
    const prod = environment({ name: "Production", api_key: "prod-key" });
    const outcome = await toggleFlag(client, prod, feature, confirmer(true).confirm);
    assert.deepEqual(outcome, { kind: "toggled", enabled: false });
    assert.deepEqual(patches, [{ enabled: false }]);
  });

  it("refuses v2-versioned environments without calling Flagsmith", async () => {
    let called = false;
    const fetchFn = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    const outcome = await toggleFlag(
      new FlagsmithClient(BASE, "k", fetchFn),
      environment({ use_v2_feature_versioning: true }),
      feature,
      confirmer(true).confirm,
    );
    assert.equal(outcome.kind, "refused");
    assert.match(outcome.kind === "refused" ? outcome.reason : "", /feature versioning \(v2\)/);
    assert.equal(called, false);
  });
});
