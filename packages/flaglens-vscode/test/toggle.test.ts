import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FlagsmithClient, type Environment, type Feature } from "../src/flagsmithClient.ts";
import { editFlagValue, parseFlagValueInput, toggleFlag, type ConfirmFn } from "../src/toggle.ts";

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

describe("parseFlagValueInput", () => {
  it("preserves strings, integers, booleans, and parses null inputs", () => {
    assert.deepEqual(parseFlagValueInput("Complete Order Now ->", "control"), {
      ok: true,
      value: "Complete Order Now ->",
    });
    assert.deepEqual(parseFlagValueInput("42", 10), { ok: true, value: 42 });
    assert.equal(parseFlagValueInput("abc", 10).ok, false);
    assert.deepEqual(parseFlagValueInput("false", true), { ok: true, value: false });
    assert.equal(parseFlagValueInput("yes", true).ok, false);
    assert.deepEqual(parseFlagValueInput("", null), { ok: true, value: null });
    assert.deepEqual(parseFlagValueInput("99", null), { ok: true, value: 99 });
    assert.deepEqual(parseFlagValueInput("true", null), { ok: true, value: true });
    assert.deepEqual(parseFlagValueInput("hello", null), { ok: true, value: "hello" });
  });
});

describe("editFlagValue", () => {
  const valueFeature: Feature = {
    id: 1,
    name: "checkout_cta_variant",
    type: "MULTIVARIATE",
    description: null,
    environment_feature_state: { id: 1, enabled: true, feature_state_value: "control" },
    code_references_counts: [],
  };

  function fakeValueServer(serverValue: string, envKey = "dev-key") {
    const patches: unknown[] = [];
    const getUrl = `${BASE}/environments/${envKey}/featurestates/1/`;
    const patchUrl = `${BASE}/features/featurestates/1/`;
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === getUrl) {
        return new Response(JSON.stringify({ id: 1, enabled: true, feature_state_value: serverValue }), {
          status: 200,
        });
      }
      if (url === patchUrl && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as {
          feature_state_value: { type: string; string_value?: string };
        };
        patches.push(body);
        serverValue = body.feature_state_value.string_value ?? "";
        return new Response(
          JSON.stringify({ id: 1, feature_state_value: body.feature_state_value }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    return { client: new FlagsmithClient(BASE, "k", fetchFn), patches };
  }

  it("reads the live value, updates Development without a modal, and verifies the response", async () => {
    const { client, patches } = fakeValueServer("control");
    const { confirm, asked } = confirmer(false);
    let seenCurrent: unknown;

    const outcome = await editFlagValue(
      client,
      environment(),
      valueFeature,
      async (cur) => {
        seenCurrent = cur;
        return "Complete Order Now ->";
      },
      confirm,
    );

    assert.equal(seenCurrent, "control");
    assert.deepEqual(outcome, { kind: "updated", value: "Complete Order Now ->" });
    assert.equal(asked.length, 0);
    assert.deepEqual(patches, [
      {
        feature: 1,
        environment: 1,
        feature_state_value: { type: "unicode", string_value: "Complete Order Now ->" },
      },
    ]);
  });

  it("asks before updating Production and aborts on cancel", async () => {
    const { client, patches } = fakeValueServer("control", "prod-key");
    const { confirm, asked } = confirmer(false);
    const prod = environment({ name: "Production", api_key: "prod-key" });

    const outcome = await editFlagValue(
      client,
      prod,
      valueFeature,
      async () => "Complete Order Now ->",
      confirm,
    );

    assert.deepEqual(outcome, { kind: "cancelled" });
    assert.deepEqual(patches, []);
    assert.deepEqual(asked, [
      'Change value of "checkout_cta_variant" in Production to "Complete Order Now ->"?',
    ]);
  });
});
