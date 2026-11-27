"use client";

import { useStoreFlags } from "@/components/FlagsmithProvider";

export default function CheckoutPage() {
  const { loading, ctaLabel, expressCheckoutEnabled } = useStoreFlags();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-xs font-medium text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-indigo-400" />
            FlagLens demo store · Self-hosted Flagsmith
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-white">Upgrade Your Workspace</h1>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl">
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

          {/* Shown only when the enable_express_checkout flag is on */}
          {expressCheckoutEnabled && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Express 1-Click Pay Enabled
            </div>
          )}

          {/* Button text comes from the checkout_cta_variant flag */}
          <button
            type="button"
            disabled={loading}
            className="mt-6 w-full rounded-xl bg-indigo-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:opacity-60"
          >
            {loading ? "Loading flags..." : ctaLabel}
          </button>
        </div>
      </div>
    </main>
  );
}
