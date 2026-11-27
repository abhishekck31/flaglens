import {
  readChaos,
  readOverrides,
  resolveSessionStorage,
  writeChaos,
  writeOverrides,
} from "./storage.ts";
import type {
  ChaosConfig,
  DevFlagsmithClient,
  DevFlagsmithConfig,
  DevFlagsmithSnapshot,
  EnvironmentParityItem,
  FlagMap,
  FlagOverride,
  FlagState,
  FlagValue,
  FlushResult,
  OverrideMap,
  QueuedEvent,
  TrackEventInput,
} from "./types.ts";

interface RawFlagItem {
  feature?: {
    name?: string;
    type?: string;
  };
  feature_state_value?: FlagValue;
  enabled?: boolean;
  reason?: string;
  variant?: string | null;
}

function normalizeApiBase(api?: string): string {
  const base = (api || "http://localhost:8000/api/v1").replace(/\/+$/, "");
  return base.endsWith("/api/v1") ? base : `${base}/api/v1`;
}

function normalizeEventsBase(eventsUrl?: string, apiBase?: string): string {
  if (eventsUrl) {
    return eventsUrl.replace(/\/+$/, "");
  }
  const derived = (apiBase || "http://localhost:8000/api/v1").replace(/\/api\/v1\/?$/, "");
  return `${derived}/api`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRawFlags(payload: unknown): { flags: FlagMap; types: Record<string, string> } {
  let items: RawFlagItem[] = [];
  if (Array.isArray(payload)) {
    items = payload as RawFlagItem[];
  } else if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.flags)) {
      items = obj.flags as RawFlagItem[];
    } else if (Array.isArray(obj.results)) {
      items = obj.results as RawFlagItem[];
    } else if (Array.isArray(obj.value)) {
      items = obj.value as RawFlagItem[];
    }
  }

  const flags: FlagMap = {};
  const types: Record<string, string> = {};
  for (const item of items) {
    const name = item.feature?.name;
    if (!name) continue;
    flags[name] = {
      enabled: Boolean(item.enabled),
      value: item.feature_state_value ?? null,
      variant: item.variant ?? null,
      reason: item.reason,
      isPinned: false,
      isFallback: false,
    };
    types[name] = item.feature?.type || "STANDARD";
  }
  return { flags, types };
}

export function createDevFlagsmithClient(config: DevFlagsmithConfig): DevFlagsmithClient {
  const apiBase = normalizeApiBase(config.api);
  const eventsBase = normalizeEventsBase(config.eventsUrl, apiBase);
  const fetchFn = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const storage = resolveSessionStorage(config.storage);
  const prefix = config.storageKeyPrefix || "flagsmith_devbar";
  const overridesKey = `${prefix}:overrides:${config.environmentID}`;
  const chaosKey = `${prefix}:chaos:${config.environmentID}`;

  let identity: string | null = config.identity ?? null;
  let liveFlags: FlagMap = {};
  let fallbackFlags: FlagMap = {};
  let overrides: OverrideMap = readOverrides(storage, overridesKey);
  let chaos: ChaosConfig = readChaos(storage, chaosKey);
  let loading = false;
  let isFallback = false;
  let lastError: string | null = null;
  let lastLatencyMs: number | null = null;
  const eventQueue: QueuedEvent[] = [];
  const listeners = new Set<(snapshot: DevFlagsmithSnapshot) => void>();

  function computeFlags(): FlagMap {
    const base = isFallback ? fallbackFlags : liveFlags;
    const merged: FlagMap = {};

    for (const [name, state] of Object.entries(base)) {
      merged[name] = { ...state };
    }

    for (const [name, ov] of Object.entries(overrides)) {
      const existing = merged[name];
      merged[name] = {
        enabled: ov.enabled ?? existing?.enabled ?? true,
        value: ov.value !== undefined ? ov.value : (existing?.value ?? null),
        variant: ov.variant !== undefined ? ov.variant : (existing?.variant ?? null),
        reason: "LOCAL_PIN",
        isPinned: true,
        isFallback: existing?.isFallback ?? false,
      };
    }

    return merged;
  }

  function getSnapshot(): DevFlagsmithSnapshot {
    return {
      flags: computeFlags(),
      liveFlags: { ...liveFlags },
      overrides: { ...overrides },
      chaos: { ...chaos },
      loading,
      isFallback,
      lastError,
      lastLatencyMs,
      queuedEventCount: eventQueue.length,
      identity,
    };
  }

  function notify(): void {
    const snap = getSnapshot();
    for (const listener of listeners) {
      listener(snap);
    }
  }

  function buildFallbackState(featureName: string): FlagState {
    if (config.defaultFlagHandler) {
      const handled = config.defaultFlagHandler(featureName);
      return {
        ...handled,
        isFallback: true,
        isPinned: false,
        reason: handled.reason || "DEFAULT_FLAG_HANDLER",
      };
    }
    return {
      enabled: false,
      value: null,
      variant: null,
      isFallback: true,
      isPinned: false,
      reason: "FALLBACK_DEFAULT",
    };
  }

  async function fetchEnvFlags(envKey: string, id: string | null): Promise<{ flags: FlagMap; types: Record<string, string> }> {
    const endpoint = id
      ? `${apiBase}/identities/?identifier=${encodeURIComponent(id)}`
      : `${apiBase}/flags/`;
    const res = await fetchFn(endpoint, {
      method: "GET",
      headers: {
        "X-Environment-Key": envKey,
      },
    });
    if (!res.ok) {
      throw new Error(`Flagsmith HTTP ${res.status}`);
    }
    const payload = await res.json();
    return parseRawFlags(payload);
  }

  async function refresh(): Promise<FlagMap> {
    loading = true;
    notify();
    const startedAt = Date.now();

    try {
      if (chaos.latencyMs > 0) {
        await delay(chaos.latencyMs);
      }
      if (chaos.offline503) {
        throw new Error("503 Service Unavailable (Chaos Mode)");
      }

      const { flags } = await fetchEnvFlags(config.environmentID, identity);
      liveFlags = flags;
      isFallback = false;
      lastError = null;
      lastLatencyMs = Date.now() - startedAt;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      isFallback = true;
      lastLatencyMs = Date.now() - startedAt;

      const knownNames = new Set([
        ...Object.keys(liveFlags),
        ...Object.keys(overrides),
      ]);
      const nextFallback: FlagMap = {};
      for (const name of knownNames) {
        nextFallback[name] = buildFallbackState(name);
      }
      fallbackFlags = nextFallback;
    } finally {
      loading = false;
      notify();
    }

    return computeFlags();
  }

  function getFlag(featureName: string): FlagState {
    const flags = computeFlags();
    if (flags[featureName]) {
      return flags[featureName];
    }
    if (isFallback && config.defaultFlagHandler) {
      return buildFallbackState(featureName);
    }
    return {
      enabled: false,
      value: null,
      variant: null,
      isPinned: false,
      isFallback,
    };
  }

  return {
    init: refresh,
    refresh,
    async identify(newIdentity: string): Promise<FlagMap> {
      identity = newIdentity;
      return refresh();
    },
    getFlags: computeFlags,
    hasFeature(featureName: string): boolean {
      return getFlag(featureName).enabled;
    },
    isFeatureEnabled(featureName: string): boolean {
      return getFlag(featureName).enabled;
    },
    getValue(featureName: string, defaultValue: FlagValue = null): FlagValue {
      const flag = getFlag(featureName);
      return flag.value !== undefined && flag.value !== null ? flag.value : defaultValue;
    },
    getFlag,
    setOverride(featureName: string, override: FlagOverride): void {
      overrides = {
        ...overrides,
        [featureName]: {
          ...(overrides[featureName] || {}),
          ...override,
        },
      };
      writeOverrides(storage, overridesKey, overrides);
      notify();
    },
    clearOverride(featureName: string): void {
      if (!(featureName in overrides)) return;
      const next = { ...overrides };
      delete next[featureName];
      overrides = next;
      writeOverrides(storage, overridesKey, overrides);
      notify();
    },
    resetOverrides(): void {
      overrides = {};
      writeOverrides(storage, overridesKey, overrides);
      notify();
    },
    getOverrides(): OverrideMap {
      return { ...overrides };
    },
    setChaos(partial: Partial<ChaosConfig>): void {
      chaos = {
        latencyMs:
          partial.latencyMs !== undefined
            ? Math.max(0, Math.min(3000, partial.latencyMs))
            : chaos.latencyMs,
        offline503:
          partial.offline503 !== undefined ? Boolean(partial.offline503) : chaos.offline503,
      };
      writeChaos(storage, chaosKey, chaos);
      notify();
    },
    getChaos(): ChaosConfig {
      return { ...chaos };
    },
    trackEvent(input: TrackEventInput): void {
      eventQueue.push({
        event: input.event,
        feature_name: input.featureName ?? null,
        identifier: input.identifier ?? identity ?? null,
        timestamp: input.timestamp ?? Date.now(),
        value: input.value ?? null,
        metadata: input.metadata ?? null,
      });
      notify();
    },
    async flushEvents(): Promise<FlushResult> {
      if (eventQueue.length === 0) {
        return { accepted: 0, rejected: 0, batches: 0 };
      }

      const toSend = eventQueue.splice(0, eventQueue.length);
      const batchSize = 100;
      let accepted = 0;
      let rejected = 0;
      let batches = 0;

      for (let i = 0; i < toSend.length; i += batchSize) {
        const chunk = toSend.slice(i, i + batchSize);
        batches += 1;
        const res = await fetchFn(`${eventsBase}/v1/events/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Environment-Key": config.environmentID,
          },
          body: JSON.stringify({ events: chunk }),
        });

        if (!res.ok) {
          eventQueue.unshift(...toSend.slice(i));
          notify();
          throw new Error(`Event flush failed (${res.status})`);
        }

        const data = (await res.json().catch(() => ({}))) as {
          accepted?: number;
          rejected?: unknown[];
        };
        accepted += typeof data.accepted === "number" ? data.accepted : chunk.length;
        rejected += Array.isArray(data.rejected) ? data.rejected.length : 0;
      }

      notify();
      return { accepted, rejected, batches };
    },
    async getEnvironmentParity(
      devEnvKey = config.environmentID,
      prodEnvKey = config.productionEnvironmentID
    ): Promise<EnvironmentParityItem[]> {
      if (!prodEnvKey) {
        throw new Error("Production environment key is required to inspect parity.");
      }

      const [devRes, prodRes] = await Promise.all([
        fetchEnvFlags(devEnvKey, null),
        fetchEnvFlags(prodEnvKey, null),
      ]);

      const allNames = Array.from(
        new Set([...Object.keys(devRes.flags), ...Object.keys(prodRes.flags)])
      ).sort();

      return allNames.map((featureName) => {
        const development = devRes.flags[featureName] ?? null;
        const production = prodRes.flags[featureName] ?? null;
        const featureType = devRes.types[featureName] || prodRes.types[featureName] || "STANDARD";

        let hasDrift = false;
        let driftReason: string | null = null;

        if (!development || !production) {
          hasDrift = true;
          driftReason = !development ? "Missing in Development" : "Missing in Production";
        } else if (development.enabled !== production.enabled) {
          hasDrift = true;
          driftReason = `Enabled mismatch (Dev: ${development.enabled ? "ON" : "OFF"}, Prod: ${production.enabled ? "ON" : "OFF"})`;
        } else if (development.value !== production.value) {
          hasDrift = true;
          driftReason = `Value mismatch (Dev: ${String(development.value)}, Prod: ${String(production.value)})`;
        }

        return {
          featureName,
          featureType,
          development,
          production,
          hasDrift,
          driftReason,
        };
      });
    },
    getSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
