import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildComparison, describeChange, planPromotion, promote } from "../src/compare.ts";
import { differingFlags, escapeHtml, renderCompareHtml } from "../src/compareHtml.ts";
import { toTypedValue, type Environment, type Feature, type FlagsmithClient, type FlagValue } from "../src/flagsmithClient.ts";

const dev: Environment = { id: 1, name: "Development", api_key: "dev", project: 1, use_v2_feature_versioning: false };
const prod: Environment = { id: 2, name: "Production", api_key: "prod", project: 1, use_v2_feature_versioning: false };

let nextStateId = 100;
function f(name: string, id: number, enabled: boolean, value: FlagValue = null): Feature {
  return {
    id,
    name,
    type: "STANDARD",
    description: null,
    environment_feature_state: { id: nextStateId++, enabled, feature_state_value: value },
    code_references_counts: [],
  };
}

describe("buildComparison", () => {
  it("one row per flag, one cell per environment, differs when any cell differs", () => {
    const rows = buildComparison(
      [dev, prod],
      new Map([
        [1, [f("cta", 1, true, "new"), f("same", 2, true)]],
        [2, [f("cta", 1, true, "control"), f("same", 2, true)]],
      ]),
    );
    assert.deepEqual(rows.map((r) => [r.name, r.differs]), [["cta", true], ["same", false]]);
    assert.equal(rows[0]!.cells[1]!.value, "control");
  });
});

describe("planPromotion", () => {
  const source = [f("cta", 1, true, "new"), f("fast", 2, true), f("same", 3, false), f("only_dev", 4, true)];
  const target = [f("cta", 1, true, "control"), f("fast", 2, false), f("same", 3, false)];

  it("lists only real differences, aimed at the TARGET state ids", () => {
    const plan = planPromotion(["cta", "fast", "same", "only_dev"], source, target);
    assert.deepEqual(
      plan.changes.map((c) => [c.flag, c.stateId === target.find((t) => t.name === c.flag)!.environment_feature_state!.id]),
      [["cta", true], ["fast", true]],
    );
    assert.deepEqual(plan.skipped, [{ flag: "only_dev", reason: "no state in the target environment" }]);
  });

  it("describes each change for the diff list", () => {
    const [cta, fast] = planPromotion(["cta", "fast"], source, target).changes;
    assert.equal(describeChange(cta!), 'cta: value "control" → "new"');
    assert.equal(describeChange(fast!), "fast: off → on");
  });
});

/** A fake client whose "Flagsmith" state is a mutable map, recording every write. */
function fakeClient(states: Map<number, Feature[]>) {
  const writes: string[] = [];
  const find = (key: string, stateId: number) => {
    const envId = key === "dev" ? 1 : 2;
    return states.get(envId)!.find((x) => x.environment_feature_state!.id === stateId)!.environment_feature_state!;
  };
  const client = {
    listFeatures: async (_project: number, envId: number) => structuredClone(states.get(envId)!),
    getFeatureState: async (key: string, stateId: number) => ({ ...find(key, stateId) }),
    setFeatureStateValue: async (envId: number, featureId: number, stateId: number, value: FlagValue) => {
      writes.push(`value env=${envId} feature=${featureId} state=${stateId} ${JSON.stringify(value)}`);
      find(envId === 1 ? "dev" : "prod", stateId).feature_state_value = value;
      return { id: stateId };
    },
    setFeatureStateEnabled: async (key: string, stateId: number, enabled: boolean) => {
      writes.push(`enabled ${key} state=${stateId} ${enabled}`);
      find(key, stateId).enabled = enabled;
      return { enabled };
    },
  } as unknown as FlagsmithClient;
  return { client, writes };
}

describe("promote", () => {
  const world = () =>
    new Map([
      [1, [f("cta", 1, true, "new"), f("fast", 2, true)]],
      [2, [f("cta", 1, false, "control"), f("fast", 2, true)]],
    ]);
  const yes = async () => true;

  it("asks with the diff list (PRODUCTION called out), then writes value and on/off", async () => {
    const states = world();
    const { client, writes } = fakeClient(states);
    let asked = { question: "", detail: "" };
    const outcome = await promote(client, 1, dev, prod, ["cta", "fast"], async (question, detail) => {
      asked = { question, detail };
      return true;
    });
    assert.equal(outcome.kind, "promoted");
    assert.match(asked.question, /^⚠ PRODUCTION: Promote 1 flag change\(s\) from Development to Production\?/);
    assert.match(asked.detail, /• cta: off → on, value "control" → "new"/);
    const ctaState = states.get(2)![0]!.environment_feature_state!.id;
    assert.deepEqual(writes, [`value env=2 feature=1 state=${ctaState} "new"`, `enabled prod state=${ctaState} true`]);
  });

  it("cancel writes nothing", async () => {
    const { client, writes } = fakeClient(world());
    assert.equal((await promote(client, 1, dev, prod, ["cta"], async () => false)).kind, "cancelled");
    assert.deepEqual(writes, []);
  });

  it("skips a flag whose target changed after the list was shown (re-read before writing)", async () => {
    const states = world();
    const { client, writes } = fakeClient(states);
    const outcome = await promote(client, 1, dev, prod, ["cta"], async () => {
      states.get(2)![0]!.environment_feature_state!.enabled = true; // someone flipped it meanwhile
      return true;
    });
    assert.ok(outcome.kind === "promoted");
    assert.equal(outcome.applied.length, 0);
    assert.match(outcome.skipped[0]!.reason, /changed in Production since the list was shown/);
    assert.deepEqual(writes, []);
  });

  it("uses fresh states, not the table's: nothing to do if Flagsmith already matches", async () => {
    const { client } = fakeClient(new Map([[1, [f("fast", 2, true)]], [2, [f("fast", 2, true)]]]));
    assert.equal((await promote(client, 1, dev, prod, ["fast"], yes)).kind, "nothing");
  });

  it("refuses a v2-versioned target and same-environment promotes", async () => {
    const { client } = fakeClient(world());
    assert.equal((await promote(client, 1, dev, { ...prod, use_v2_feature_versioning: true }, ["cta"], yes)).kind, "refused");
    assert.equal((await promote(client, 1, dev, dev, ["cta"], yes)).kind, "refused");
  });
});

describe("toTypedValue", () => {
  it("matches Flagsmith's typed value shape", () => {
    assert.deepEqual(toTypedValue("x"), { type: "unicode", string_value: "x" });
    assert.deepEqual(toTypedValue(42), { type: "int", integer_value: 42 });
    assert.deepEqual(toTypedValue(true), { type: "bool", boolean_value: true });
    assert.deepEqual(toTypedValue(null), { type: "unicode", string_value: null });
  });
});

describe("renderCompareHtml", () => {
  const rows = buildComparison(
    [dev, prod],
    new Map([
      [1, [f("cta", 1, true, '<b>"new"</b>'), f("same", 2, true)]],
      [2, [f("cta", 1, true, "control"), f("same", 2, true)]],
    ]),
  );
  const model = { projectName: "Toggle Wars", environments: [dev, prod], rows, sourceIndex: 0, targetIndex: 1 };

  it("offers Promote only on differing rows, plus 'all differences'", () => {
    const html = renderCompareHtml(model, "n0nce", "vscode-resource:");
    assert.deepEqual(differingFlags(model), ["cta"]);
    assert.equal((html.match(/data-flag=/g) ?? []).length, 1);
    assert.match(html, /Promote all differences \(1\)/);
    assert.match(html, /target is production/);
  });

  it("escapes flag values and locks scripts to the nonce", () => {
    const html = renderCompareHtml(model, "n0nce", "vscode-resource:");
    assert.ok(!html.includes("<b>"));
    assert.match(html, /script-src 'nonce-n0nce'/);
    assert.equal(escapeHtml(`<a href="x">'`), "&lt;a href=&quot;x&quot;&gt;&#39;");
  });

  it("disables promote for a v2-versioned target", () => {
    const html = renderCompareHtml({ ...model, environments: [dev, { ...prod, use_v2_feature_versioning: true }] }, "n", "c");
    assert.equal((html.match(/data-flag=/g) ?? []).length, 0);
    assert.match(html, /promote is disabled/);
  });
});
