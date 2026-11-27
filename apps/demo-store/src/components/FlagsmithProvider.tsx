"use client";

import flagsmith from "@flagsmith/flagsmith";
import {
  createDevFlagsmithClient,
  FlagsmithDevBar,
  type DevFlagsmithClient,
  type DevFlagsmithSnapshot,
} from "@togglewars/flagsmith-devbar";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getOrCreateVisitorId } from "@/lib/visitor";

export type FlagSource = "live" | "tab-override" | "fallback";

export interface CheckoutCtaEvaluation {
  variation: string;
  label: string;
  source: FlagSource;
}

export interface TrackClickResult {
  identifier: string;
  variation: string;
  source: FlagSource;
  timestamp: string;
}

interface FlagsmithContextValue {
  visitorId: string;
  snapshot: DevFlagsmithSnapshot;
  devClient: DevFlagsmithClient;
  cta: CheckoutCtaEvaluation;
  expressCheckoutEnabled: boolean;
  expressCheckoutSource: FlagSource;
  trackCheckoutClick: () => Promise<TrackClickResult>;
}

const FlagsmithContext = createContext<FlagsmithContextValue | null>(null);

const DEV_ENV_KEY = process.env.NEXT_PUBLIC_FLAGSMITH_ENV_KEY || "";
const PROD_ENV_KEY = process.env.NEXT_PUBLIC_FLAGSMITH_PROD_ENV_KEY || "";
const API_URL = process.env.NEXT_PUBLIC_FLAGSMITH_API_URL || "http://localhost:8000/api/v1/";
const EVENTS_URL = process.env.NEXT_PUBLIC_FLAGSMITH_EVENTS_URL || "http://localhost:8000/api/";

function mapVariationToLabel(rawValue: unknown): string {
  if (typeof rawValue !== "string" || !rawValue || rawValue === "control") {
    return "Continue to Checkout";
  }
  return rawValue;
}

export function FlagsmithProvider({ children }: { children: React.ReactNode }) {
  const [visitorId, setVisitorId] = useState<string>("initializing...");
  const [sdkReady, setSdkReady] = useState(false);

  const devClient = useMemo(
    () =>
      createDevFlagsmithClient({
        environmentID: DEV_ENV_KEY,
        productionEnvironmentID: PROD_ENV_KEY,
        api: API_URL,
        eventsUrl: EVENTS_URL,
        defaultFlagHandler: (featureName) => {
          if (featureName === "checkout_cta_variant") {
            return {
              enabled: true,
              value: "Continue to Checkout",
              variant: "fallback",
              reason: "DEFAULT_FLAG_HANDLER",
            };
          }
          return {
            enabled: false,
            value: false,
            variant: null,
            reason: "DEFAULT_FLAG_HANDLER",
          };
        },
      }),
    []
  );

  const [snapshot, setSnapshot] = useState<DevFlagsmithSnapshot>(() => devClient.getSnapshot());

  useEffect(() => {
    const unsub = devClient.subscribe(setSnapshot);
    const id = getOrCreateVisitorId();
    setVisitorId(id);

    void Promise.all([
      devClient.identify(id),
      flagsmith
        .init({
          environmentID: DEV_ENV_KEY,
          api: API_URL,
          enableAnalytics: true,
          enableEvents: true,
          eventProcessorConfig: {
            eventsApiUrl: EVENTS_URL,
          },
          identity: id,
          defaultFlags: {
            checkout_cta_variant: { enabled: true, value: "Continue to Checkout" },
            enable_express_checkout: { enabled: false, value: null },
          },
        })
        .catch(() => undefined),
    ]).then(() => {
      setSdkReady(true);
    });

    return unsub;
  }, [devClient]);

  const cta = useMemo<CheckoutCtaEvaluation>(() => {
    const devFlag = snapshot.flags["checkout_cta_variant"];
    if (devFlag?.isPinned) {
      return {
        variation: devFlag.variant || String(devFlag.value || "pinned"),
        label: mapVariationToLabel(devFlag.value),
        source: "tab-override",
      };
    }

    if (snapshot.isFallback || snapshot.chaos.offline503) {
      return {
        variation: "fallback",
        label: "Continue to Checkout",
        source: "fallback",
      };
    }

    if (sdkReady) {
      const expFlag = flagsmith.getExperimentFlag("checkout_cta_variant");
      if (expFlag) {
        return {
          variation: String(expFlag.value ?? "control"),
          label: mapVariationToLabel(expFlag.value),
          source: "live",
        };
      }
    }

    return {
      variation: devFlag?.variant || String(devFlag?.value ?? "control"),
      label: mapVariationToLabel(devFlag?.value),
      source: "live",
    };
  }, [snapshot, sdkReady]);

  const expressState = useMemo(() => {
    const devFlag = snapshot.flags["enable_express_checkout"];
    if (devFlag?.isPinned) {
      return { enabled: devFlag.enabled, source: "tab-override" as FlagSource };
    }
    if (snapshot.isFallback || snapshot.chaos.offline503) {
      return { enabled: false, source: "fallback" as FlagSource };
    }
    if (sdkReady) {
      return {
        enabled: flagsmith.hasFeature("enable_express_checkout"),
        source: "live" as FlagSource,
      };
    }
    return { enabled: Boolean(devFlag?.enabled), source: "live" as FlagSource };
  }, [snapshot, sdkReady]);

  const trackCheckoutClick = async (): Promise<TrackClickResult> => {
    if (cta.source !== "fallback" && !snapshot.chaos.offline503) {
      try {
        flagsmith.trackEvent("checkout_clicked", {
          identifier: visitorId,
          value: 1,
          metadata: {
            variant: cta.variation,
            source: cta.source,
          },
        });
        await flagsmith.flushEvents();
      } catch {
        // Fallback to devClient event flush if SDK flush fails
      }
    }

    return {
      identifier: visitorId,
      variation: cta.variation,
      source: cta.source,
      timestamp: new Date().toLocaleTimeString(),
    };
  };

  return (
    <FlagsmithContext.Provider
      value={{
        visitorId,
        snapshot,
        devClient,
        cta,
        expressCheckoutEnabled: expressState.enabled,
        expressCheckoutSource: expressState.source,
        trackCheckoutClick,
      }}
    >
      {children}
      <FlagsmithDevBar
        client={devClient}
        devEnvironmentKey={DEV_ENV_KEY}
        prodEnvironmentKey={PROD_ENV_KEY}
        apiUrl={API_URL}
        eventsUrl={EVENTS_URL}
        experimentId={1}
        refreshUrl="/api/flagsmith/refresh"
      />
    </FlagsmithContext.Provider>
  );
}

export function useFlagsmithDemo(): FlagsmithContextValue {
  const ctx = useContext(FlagsmithContext);
  if (!ctx) {
    throw new Error("useFlagsmithDemo must be used inside FlagsmithProvider");
  }
  return ctx;
}
