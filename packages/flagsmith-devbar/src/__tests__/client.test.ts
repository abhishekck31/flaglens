import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDevFlagsmithClient } from "../client.ts";
import { simulateExperimentTraffic } from "../simulator.ts";
import { createMemoryStorage } from "../storage.ts";

function makeMockFetch(
  flagsByEnv: Record<string, Array<{ feature: { name: string; type?: string }; enabled: boolean; feature_state_value: unknown; variant?: string | null }>>
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const envKey = headers.get("X-Environment-Key") || "dev-key";

    if (url.includes("/flags/") || url.includes("/identities/")) {
      const items = flagsByEnv[envKey] || [];
      const body = url.includes("/identities/") ? { identifier: "u1", flags: items } : items;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/v1/events/")) {
      const parsed = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({ accepted: parsed.events?.length ?? 0, rejected: [] }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/results/refresh/")) {
      return new Response(JSON.stringify({ detail: "Refresh cooldown: wait 5 minutes" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;
}

describe("createDevFlagsmithClient", () => {
  it("supports per-tab sessionStorage variation pinning and 1-click reset", async () => {
    const tab1Storage = createMemoryStorage();
    const tab2Storage = createMemoryStorage();
    const fetchImpl = makeMockFetch({
      "dev-key": [
        {
          feature: { name: "checkout_cta_variant", type: "MULTIVARIATE" },
          enabled: true,
          feature_state_value: "control",
          variant: "control",
        },
      ],
    });

    const tab1 = createDevFlagsmithClient({
      environmentID: "dev-key",
      fetchImpl,
      storage: tab1Storage,
    });
    const tab2 = createDevFlagsmithClient({
      environmentID: "dev-key",
      fetchImpl,
      storage: tab2Storage,
    });

    await tab1.init();
    await tab2.init();

    tab1.setOverride("checkout_cta_variant", {
      enabled: true,
      value: "Complete Order Now ->",
      variant: "urgent_copy",
    });
    tab2.setOverride("checkout_cta_variant", {
      enabled: true,
      value: "Join 12,400+ Builders ->",
      variant: "social_proof",
    });

    assert.equal(tab1.getValue("checkout_cta_variant"), "Complete Order Now ->");
    assert.equal(tab2.getValue("checkout_cta_variant"), "Join 12,400+ Builders ->");
    assert.equal(tab1.getFlag("checkout_cta_variant").isPinned, true);

    tab1.resetOverrides();
    assert.equal(tab1.getValue("checkout_cta_variant"), "control");
    assert.equal(tab1.getFlag("checkout_cta_variant").isPinned, false);
    assert.equal(tab2.getValue("checkout_cta_variant"), "Join 12,400+ Builders ->");
  });

  it("injects artificial latency and triggers defaultFlagHandler on 503 offline chaos", async () => {
    const fetchImpl = makeMockFetch({
      "dev-key": [
        {
          feature: { name: "checkout_cta_variant", type: "MULTIVARIATE" },
          enabled: true,
          feature_state_value: "control",
        },
      ],
    });

    const client = createDevFlagsmithClient({
      environmentID: "dev-key",
      fetchImpl,
      storage: createMemoryStorage(),
      defaultFlagHandler: (name) => ({
        enabled: name === "checkout_cta_variant",
        value: name === "checkout_cta_variant" ? "fallback-cta" : false,
        variant: "fallback",
      }),
    });

    await client.init();
    assert.equal(client.getValue("checkout_cta_variant"), "control");

    client.setChaos({ latencyMs: 60, offline503: true });
    await client.refresh();

    const snap = client.getSnapshot();
    assert.equal(snap.isFallback, true);
    assert.match(snap.lastError || "", /503/);
    assert.ok((snap.lastLatencyMs ?? 0) >= 50);
    assert.equal(client.getValue("checkout_cta_variant"), "fallback-cta");

    client.setChaos({ latencyMs: 0, offline503: false });
    await client.refresh();
    assert.equal(client.getSnapshot().isFallback, false);
    assert.equal(client.getValue("checkout_cta_variant"), "control");
  });

  it("detects environment parity drift between Development and Production", async () => {
    const fetchImpl = makeMockFetch({
      "dev-key": [
        { feature: { name: "checkout_cta_variant", type: "MULTIVARIATE" }, enabled: true, feature_state_value: "control" },
        { feature: { name: "enable_express_checkout", type: "STANDARD" }, enabled: true, feature_state_value: null },
      ],
      "prod-key": [
        { feature: { name: "checkout_cta_variant", type: "MULTIVARIATE" }, enabled: true, feature_state_value: "control" },
        { feature: { name: "enable_express_checkout", type: "STANDARD" }, enabled: false, feature_state_value: null },
      ],
    });

    const client = createDevFlagsmithClient({
      environmentID: "dev-key",
      productionEnvironmentID: "prod-key",
      fetchImpl,
      storage: createMemoryStorage(),
    });

    const parity = await client.getEnvironmentParity();
    assert.equal(parity.length, 2);

    const cta = parity.find((p) => p.featureName === "checkout_cta_variant");
    const express = parity.find((p) => p.featureName === "enable_express_checkout");

    assert.equal(cta?.hasDrift, false);
    assert.equal(express?.hasDrift, true);
    assert.match(express?.driftReason || "", /Enabled mismatch/);
  });

  it("buffers events and flushes them via flushEvents(), and handles simulator 429 cooldown", async () => {
    const fetchImpl = makeMockFetch({ "dev-key": [] });
    const client = createDevFlagsmithClient({
      environmentID: "dev-key",
      fetchImpl,
      storage: createMemoryStorage(),
    });

    client.trackEvent({ event: "$flag_exposure", featureName: "checkout_cta_variant", identifier: "v1", value: "control" });
    client.trackEvent({ event: "checkout_clicked", identifier: "v1", value: 1 });
    assert.equal(client.getSnapshot().queuedEventCount, 2);

    const flushed = await client.flushEvents();
    assert.equal(flushed.accepted, 2);
    assert.equal(client.getSnapshot().queuedEventCount, 0);

    const sim = await simulateExperimentTraffic({
      environmentKey: "dev-key",
      experimentId: 1,
      masterApiKey: "test-master-key",
      visitorCount: 30,
      fetchImpl,
    });
    assert.equal(sim.totalVisitors, 30);
    assert.equal(sim.exposuresSent, 30);
    assert.equal(sim.refreshStatus, "cooldown");
  });
});
