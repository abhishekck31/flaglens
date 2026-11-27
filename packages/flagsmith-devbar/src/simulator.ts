import type {
  QueuedEvent,
  SimulationConfig,
  SimulationResult,
  VariantSimulationSpec,
} from "./types.ts";

export const DEFAULT_SIMULATION_VARIANTS: VariantSimulationSpec[] = [
  { key: "control", value: "control", weight: 34, conversionRate: 0.12 },
  { key: "urgent_copy", value: "Complete Order Now ->", weight: 33, conversionRate: 0.19 },
  { key: "social_proof", value: "Join 12,400+ Builders ->", weight: 33, conversionRate: 0.15 },
];

function createUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sim-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function pickVariant(variants: VariantSimulationSpec[], roll: number): VariantSimulationSpec {
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
  let cursor = roll * totalWeight;
  for (const variant of variants) {
    cursor -= variant.weight;
    if (cursor <= 0) {
      return variant;
    }
  }
  return variants[variants.length - 1];
}

export async function simulateExperimentTraffic(
  config: SimulationConfig
): Promise<SimulationResult> {
  const fetchFn = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const eventsBase = (config.eventsUrl || "http://localhost:8000/api").replace(/\/+$/, "");
  const apiBase = (config.apiUrl || "http://localhost:8000/api/v1").replace(/\/+$/, "");
  const featureName = config.featureName || "checkout_cta_variant";
  const metricEventName = config.metricEventName || "checkout_clicked";
  const totalVisitors = config.visitorCount ?? 300;
  const variants = config.variants ?? DEFAULT_SIMULATION_VARIANTS;

  const statsMap = new Map<string, { exposures: number; conversions: number }>();
  for (const v of variants) {
    statsMap.set(v.key, { exposures: 0, conversions: 0 });
  }

  const events: QueuedEvent[] = [];
  const baseTimestamp = Date.now() - 60_000;

  for (let i = 0; i < totalVisitors; i += 1) {
    const visitorId = createUuid();
    const chosen = pickVariant(variants, (i % 100) / 100);
    const ts = baseTimestamp + i * 150;

    events.push({
      event: "$flag_exposure",
      feature_name: featureName,
      identifier: visitorId,
      timestamp: ts,
      value: chosen.key,
      metadata: {
        variant: chosen.key,
        simulated: true,
      },
    });

    const stat = statsMap.get(chosen.key)!;
    stat.exposures += 1;

    if (Math.random() < chosen.conversionRate) {
      events.push({
        event: metricEventName,
        identifier: visitorId,
        timestamp: ts + 50,
        value: 1,
        metadata: {
          variant: chosen.key,
          simulated: true,
        },
      });
      stat.conversions += 1;
    }
  }

  const batchSize = 100;
  let exposuresSent = 0;
  let conversionsSent = 0;
  let sentCount = 0;

  for (let i = 0; i < events.length; i += batchSize) {
    const chunk = events.slice(i, i + batchSize);
    const res = await fetchFn(`${eventsBase}/v1/events/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Environment-Key": config.environmentKey,
      },
      body: JSON.stringify({ events: chunk }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Simulation event ingestion failed (${res.status}): ${body}`);
    }

    for (const ev of chunk) {
      if (ev.event === "$flag_exposure") exposuresSent += 1;
      else conversionsSent += 1;
    }
    sentCount += chunk.length;
    config.onProgress?.(Math.min(sentCount, events.length), events.length);
  }

  let refreshStatus: SimulationResult["refreshStatus"] = "skipped";
  let refreshMessage = "Skipped results refresh (no refresh endpoint or master key configured).";

  const targetRefreshUrl =
    config.refreshUrl ||
    (config.experimentId
      ? `${apiBase}/environments/${config.environmentKey}/experiments/${config.experimentId}/results/refresh/`
      : undefined);

  if (targetRefreshUrl && (config.refreshUrl || config.masterApiKey)) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (config.masterApiKey) {
        headers.Authorization = `Api-Key ${config.masterApiKey}`;
      }

      const refreshRes = await fetchFn(targetRefreshUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });

      if (refreshRes.ok) {
        refreshStatus = "refreshed";
        refreshMessage = "Experiment results refreshed successfully.";
      } else if (refreshRes.status === 429) {
        const detail = await refreshRes.text().catch(() => "");
        refreshStatus = "cooldown";
        refreshMessage =
          detail || "Results refresh is in Flagsmith's 5-minute cooldown; events are ingested.";
      } else {
        const detail = await refreshRes.text().catch(() => "");
        if (detail.toLowerCase().includes("cooldown") || detail.toLowerCase().includes("5 minute")) {
          refreshStatus = "cooldown";
          refreshMessage = detail;
        } else {
          refreshStatus = "error";
          refreshMessage = `Refresh returned HTTP ${refreshRes.status}: ${detail}`;
        }
      }
    } catch (err) {
      refreshStatus = "error";
      refreshMessage = err instanceof Error ? err.message : String(err);
    }
  }

  const variantStats = variants.map((v) => {
    const s = statsMap.get(v.key) ?? { exposures: 0, conversions: 0 };
    return {
      key: v.key,
      exposures: s.exposures,
      conversions: s.conversions,
      conversionRate: s.exposures > 0 ? Number(((s.conversions / s.exposures) * 100).toFixed(1)) : 0,
    };
  });

  return {
    totalVisitors,
    exposuresSent,
    conversionsSent,
    variants: variantStats,
    refreshStatus,
    refreshMessage,
  };
}
