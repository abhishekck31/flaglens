"use client";

import React, { useState } from "react";
import { useFlagsmithDemo, type TrackClickResult } from "@/components/FlagsmithProvider";

export default function CheckoutPage() {
  const {
    visitorId,
    snapshot,
    cta,
    expressCheckoutEnabled,
    trackCheckoutClick,
  } = useFlagsmithDemo();

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<TrackClickResult | null>(null);

  const handleCheckout = async () => {
    setSubmitting(true);
    try {
      const result = await trackCheckoutClick();
      setToast(result);
    } finally {
      setSubmitting(false);
    }
  };

  const sourceBadgeStyle =
    cta.source === "tab-override"
      ? "bg-violet-500/20 text-violet-300 border-violet-500/40"
      : cta.source === "fallback"
        ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
        : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-950/40 via-zinc-950 to-zinc-950 px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-xs font-medium text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-indigo-400" />
            ToggleWars Track 03 · Self-Hosted Flagsmith
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-white">
            Upgrade Your Workspace
          </h1>
          <p className="mt-1.5 text-sm text-zinc-400">
            Test per-tab variation pinning, chaos 503 fallback, parity drift, and Bayesian simulation via the DevBar.
          </p>
        </div>

        {/* Checkout Card */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">DevCloud Pro Plan</h2>
              <p className="text-xs text-zinc-400">Unlimited feature flags, edge SDKs &amp; experiments</p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-white">$49</div>
              <div className="text-[11px] text-zinc-400">per month</div>
            </div>
          </div>

          {expressCheckoutEnabled && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Express 1-Click Pay Enabled
            </div>
          )}

          <ul className="mt-5 space-y-2.5 border-t border-zinc-800 pt-5 text-xs text-zinc-300">
            <li className="flex items-center justify-between">
              <span>10M monthly flag evaluations</span>
              <span className="text-emerald-400">Included</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Self-hosted Postgres experimentation</span>
              <span className="text-emerald-400">Included</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Per-tab QA &amp; Chaos DevBar</span>
              <span className="text-indigo-300">Active</span>
            </li>
          </ul>

          <button
            type="button"
            onClick={() => void handleCheckout()}
            disabled={submitting || snapshot.loading}
            className="mt-6 w-full rounded-xl bg-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {snapshot.loading ? "Loading Flags..." : submitting ? "Recording Event..." : cta.label}
          </button>

          {/* Live Telemetry Metadata */}
          <div className="mt-5 space-y-2 rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-3 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Visitor ID</span>
              <span className="max-w-[210px] truncate font-mono text-zinc-300">{visitorId}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">CTA Variation</span>
              <span className="font-mono text-zinc-200">{cta.variation}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Flag Source</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sourceBadgeStyle}`}>
                {cta.source}
              </span>
            </div>
          </div>
        </div>

        {/* Event Log Toast */}
        {toast && (
          <div
            role="status"
            className="rounded-xl border border-indigo-500/40 bg-zinc-900/95 p-4 text-xs shadow-xl"
          >
            <div className="flex items-center justify-between font-semibold text-indigo-300">
              <span>Event Flushed: checkout_clicked</span>
              <span className="font-mono text-[10px] text-zinc-400">{toast.timestamp}</span>
            </div>
            <div className="mt-2 space-y-1 font-mono text-[11px] text-zinc-300">
              <div>identifier: {toast.identifier}</div>
              <div>variation: {toast.variation}</div>
              <div>source: {toast.source}</div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
