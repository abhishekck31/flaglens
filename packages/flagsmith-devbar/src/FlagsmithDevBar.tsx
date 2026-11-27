"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { simulateExperimentTraffic } from "./simulator.ts";
import type {
  DevFlagsmithSnapshot,
  EnvironmentParityItem,
  FlagsmithDevBarProps,
  PinPresetOption,
  SimulationResult,
} from "./types.ts";

type TabId = "pins" | "chaos" | "parity" | "simulate";

const DEFAULT_PIN_PRESETS: Record<string, PinPresetOption[]> = {
  checkout_cta_variant: [
    { label: "control", key: "control", value: "control", enabled: true },
    { label: "urgent_copy", key: "urgent_copy", value: "Complete Order Now ->", enabled: true },
    { label: "social_proof", key: "social_proof", value: "Join 12,400+ Builders ->", enabled: true },
  ],
};

export function FlagsmithDevBar({
  client,
  devEnvironmentKey,
  prodEnvironmentKey,
  apiUrl = "http://localhost:8000/api/v1",
  eventsUrl = "http://localhost:8000/api",
  experimentId = 1,
  masterApiKey,
  refreshUrl,
  pinPresets = DEFAULT_PIN_PRESETS,
  defaultOpen = false,
}: FlagsmithDevBarProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState<TabId>("pins");
  const [snapshot, setSnapshot] = useState<DevFlagsmithSnapshot>(() => client.getSnapshot());
  const [parity, setParity] = useState<EnvironmentParityItem[]>([]);
  const [parityLoading, setParityLoading] = useState(false);
  const [parityError, setParityError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simProgress, setSimProgress] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = client.subscribe(setSnapshot);
    return unsub;
  }, [client]);

  const loadParity = useCallback(async () => {
    if (!prodEnvironmentKey) {
      setParityError("No production environment key configured.");
      return;
    }
    setParityLoading(true);
    setParityError(null);
    try {
      const items = await client.getEnvironmentParity(devEnvironmentKey, prodEnvironmentKey);
      setParity(items);
    } catch (err) {
      setParityError(err instanceof Error ? err.message : String(err));
    } finally {
      setParityLoading(false);
    }
  }, [client, devEnvironmentKey, prodEnvironmentKey]);

  useEffect(() => {
    if (open && activeTab === "parity" && parity.length === 0 && !parityLoading) {
      void loadParity();
    }
  }, [open, activeTab, parity.length, parityLoading, loadParity]);

  const pinCount = useMemo(() => Object.keys(snapshot.overrides).length, [snapshot.overrides]);
  const driftCount = useMemo(() => parity.filter((p) => p.hasDrift).length, [parity]);

  const statusColor = snapshot.isFallback || snapshot.chaos.offline503
    ? "bg-amber-400"
    : pinCount > 0
      ? "bg-violet-400"
      : "bg-emerald-400";

  const handleSimulate = async () => {
    setSimulating(true);
    setSimError(null);
    setSimResult(null);
    setSimProgress("Flushing buffered events...");
    try {
      await client.flushEvents();
      const result = await simulateExperimentTraffic({
        environmentKey: devEnvironmentKey,
        apiUrl,
        eventsUrl,
        experimentId,
        masterApiKey,
        refreshUrl,
        visitorCount: 300,
        onProgress: (done, total) => {
          setSimProgress(`Sending events (${done}/${total})...`);
        },
      });
      setSimResult(result);
      setSimProgress(null);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : String(err));
      setSimProgress(null);
    } finally {
      setSimulating(false);
    }
  };

  if (!open) {
    return (
      <div className="fixed bottom-4 right-4 z-50 font-sans">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2.5 rounded-full border border-zinc-700/80 bg-zinc-950/95 px-4 py-2 text-xs font-medium text-zinc-100 shadow-2xl backdrop-blur transition hover:border-zinc-500 hover:bg-zinc-900"
        >
          <span className={`h-2 w-2 rounded-full ${statusColor}`} />
          <span>Flagsmith DevBar</span>
          {pinCount > 0 && (
            <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] text-violet-300">
              {pinCount} pinned
            </span>
          )}
          {snapshot.chaos.offline503 && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300">
              503
            </span>
          )}
          {snapshot.chaos.latencyMs > 0 && (
            <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] text-sky-300">
              +{snapshot.chaos.latencyMs}ms
            </span>
          )}
        </button>
      </div>
    );
  }

  const flagEntries = Object.entries(snapshot.flags);

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[430px] max-w-[calc(100vw-2rem)] rounded-2xl border border-zinc-800 bg-zinc-950/95 font-sans text-zinc-100 shadow-2xl backdrop-blur">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${statusColor}`} />
          <span className="text-xs font-semibold tracking-wide text-zinc-100">
            Flagsmith DevBar
          </span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
            {snapshot.isFallback ? "FALLBACK" : "LIVE"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Collapse Flagsmith DevBar"
        >
          Minimize
        </button>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-4 border-b border-zinc-800/80 bg-zinc-900/50 text-xs">
        {(
          [
            { id: "pins", label: `Pins${pinCount ? ` (${pinCount})` : ""}` },
            { id: "chaos", label: "Chaos" },
            { id: "parity", label: `Parity${driftCount ? ` (${driftCount})` : ""}` },
            { id: "simulate", label: "Simulate" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`py-2.5 font-medium transition ${
              activeTab === tab.id
                ? "border-b-2 border-indigo-400 text-indigo-300"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="max-h-[420px] overflow-y-auto p-4 text-xs">
        {activeTab === "pins" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-zinc-400">
                Scoped to this browser tab via <code className="text-zinc-300">sessionStorage</code>.
              </p>
              <button
                type="button"
                onClick={() => {
                  client.resetOverrides();
                  void client.refresh();
                }}
                disabled={pinCount === 0}
                className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Reset to Live Flagsmith
              </button>
            </div>

            {Object.entries(pinPresets).map(([featureName, options]) => {
              const current = snapshot.flags[featureName];
              return (
                <div key={featureName} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-mono text-[11px] font-semibold text-zinc-200">
                      {featureName}
                    </span>
                    {current?.isPinned && (
                      <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-300">
                        pinned: {current.variant || String(current.value)}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {options.map((opt) => {
                      const active =
                        current?.isPinned &&
                        (current.variant === opt.key || current.value === opt.value);
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() =>
                            client.setOverride(featureName, {
                              enabled: opt.enabled,
                              value: opt.value,
                              variant: opt.key,
                            })
                          }
                          className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${
                            active
                              ? "border-violet-400 bg-violet-500/20 text-violet-200"
                              : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-zinc-500"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Active Flags
              </div>
              {flagEntries.length === 0 && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-zinc-400">
                  No flags loaded yet.
                </div>
              )}
              {flagEntries.map(([name, state]) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
                >
                  <div className="min-w-0 pr-2">
                    <div className="truncate font-mono text-[11px] text-zinc-200">{name}</div>
                    <div className="truncate text-[10px] text-zinc-400">
                      val: {String(state.value ?? "null")} · {state.reason || "LIVE"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => client.setOverride(name, { enabled: !state.enabled })}
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition ${
                        state.enabled
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {state.enabled ? "ON" : "OFF"}
                    </button>
                    {state.isPinned && (
                      <button
                        type="button"
                        onClick={() => client.clearOverride(name)}
                        className="text-[10px] text-zinc-400 hover:text-zinc-200"
                      >
                        clear
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "chaos" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium text-zinc-200">Artificial SDK Latency</span>
                <span className="font-mono text-sky-300">{snapshot.chaos.latencyMs}ms</span>
              </div>
              <input
                type="range"
                min={0}
                max={3000}
                step={100}
                value={snapshot.chaos.latencyMs}
                onChange={(e) => {
                  client.setChaos({ latencyMs: Number(e.target.value) });
                }}
                onMouseUp={() => void client.refresh()}
                onTouchEnd={() => void client.refresh()}
                className="w-full accent-sky-400"
              />
              <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
                <span>0ms</span>
                <span>1500ms</span>
                <span>3000ms</span>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <div>
                <div className="font-medium text-zinc-200">Force 503 Offline Mode</div>
                <div className="text-[11px] text-zinc-400">
                  Triggers <code className="text-zinc-300">default_flag_handler</code> fallback UI
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  client.setChaos({ offline503: !snapshot.chaos.offline503 });
                  void client.refresh();
                }}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  snapshot.chaos.offline503
                    ? "bg-amber-500/25 text-amber-300 ring-1 ring-amber-400/50"
                    : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {snapshot.chaos.offline503 ? "503 ACTIVE" : "ONLINE"}
              </button>
            </div>

            {snapshot.lastError && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
                Last Error: {snapshot.lastError}
              </div>
            )}
          </div>
        )}

        {activeTab === "parity" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Development vs Production</span>
              <button
                type="button"
                onClick={() => void loadParity()}
                disabled={parityLoading}
                className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
              >
                {parityLoading ? "Checking..." : "Refresh Parity"}
              </button>
            </div>

            {parityError && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-rose-200">
                {parityError}
              </div>
            )}

            <div className="space-y-2">
              {parity.map((item) => (
                <div
                  key={item.featureName}
                  className={`rounded-xl border p-3 ${
                    item.hasDrift
                      ? "border-amber-500/50 bg-amber-500/10"
                      : "border-zinc-800 bg-zinc-900/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-semibold text-zinc-100">
                      {item.featureName}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        item.hasDrift
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-emerald-500/20 text-emerald-300"
                      }`}
                    >
                      {item.hasDrift ? "DRIFT" : "SYNCED"}
                    </span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-2 text-[11px] text-zinc-300">
                    <div>
                      Dev: {item.development?.enabled ? "ON" : "OFF"} (
                      {String(item.development?.value ?? "null")})
                    </div>
                    <div>
                      Prod: {item.production?.enabled ? "ON" : "OFF"} (
                      {String(item.production?.value ?? "null")})
                    </div>
                  </div>
                  {item.driftReason && (
                    <div className="mt-1 text-[10px] text-amber-300">{item.driftReason}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "simulate" && (
          <div className="space-y-3">
            <p className="text-zinc-400">
              Generates 300 stable visitor UUIDs, sends <code className="text-zinc-300">$flag_exposure</code> +{" "}
              <code className="text-zinc-300">checkout_clicked</code> events, flushes buffered events, and
              triggers experiment results refresh.
            </p>
            <button
              type="button"
              onClick={() => void handleSimulate()}
              disabled={simulating}
              className="w-full rounded-xl bg-indigo-500 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {simulating ? simProgress || "Simulating..." : "Simulate 300 Visitors"}
            </button>

            {simError && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-rose-200">
                {simError}
              </div>
            )}

            {simResult && (
              <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                <div className="flex justify-between text-[11px] text-zinc-300">
                  <span>Exposures: {simResult.exposuresSent}</span>
                  <span>Conversions: {simResult.conversionsSent}</span>
                </div>
                <div className="space-y-1">
                  {simResult.variants.map((v) => (
                    <div key={v.key} className="flex justify-between font-mono text-[11px]">
                      <span className="text-zinc-300">{v.key}</span>
                      <span className="text-emerald-300">
                        {v.conversions}/{v.exposures} ({v.conversionRate}%)
                      </span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-zinc-800 pt-2 text-[10px] text-zinc-400">
                  Refresh ({simResult.refreshStatus}): {simResult.refreshMessage}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
