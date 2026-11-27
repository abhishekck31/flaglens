"use client";

// Demo app for FlagLens: a tiny checkout page that reads two flags from a
// self-hosted Flagsmith instance using the official JavaScript SDK.
// FlagLens (the VS Code extension) scans this code for flag names.

import flagsmith from "@flagsmith/flagsmith";
import React, { createContext, useContext, useEffect, useState } from "react";

interface StoreFlags {
  loading: boolean;
  ctaLabel: string;
  expressCheckoutEnabled: boolean;
}

const DEFAULT_CTA = "Continue to Checkout";

const FlagsContext = createContext<StoreFlags>({
  loading: true,
  ctaLabel: DEFAULT_CTA,
  expressCheckoutEnabled: false,
});

/** Turns the multivariate value into button text ("control" means the default copy). */
function toCtaLabel(value: unknown): string {
  return typeof value === "string" && value && value !== "control" ? value : DEFAULT_CTA;
}

export function FlagsmithProvider({ children }: { children: React.ReactNode }) {
  const [flags, setFlags] = useState<StoreFlags>({
    loading: true,
    ctaLabel: DEFAULT_CTA,
    expressCheckoutEnabled: false,
  });

  useEffect(() => {
    const readFlags = () =>
      setFlags({
        loading: false,
        ctaLabel: toCtaLabel(flagsmith.getValue("checkout_cta_variant")),
        expressCheckoutEnabled: flagsmith.hasFeature("enable_express_checkout"),
      });

    flagsmith
      .init({
        environmentID: process.env.NEXT_PUBLIC_FLAGSMITH_ENV_KEY ?? "",
        api: process.env.NEXT_PUBLIC_FLAGSMITH_API_URL ?? "http://localhost:8000/api/v1/",
        // Used if Flagsmith is unreachable, so the page still renders.
        defaultFlags: {
          checkout_cta_variant: { enabled: true, value: "control" },
          enable_express_checkout: { enabled: false, value: null },
        },
        onChange: readFlags,
      })
      .catch(readFlags);
  }, []);

  return <FlagsContext.Provider value={flags}>{children}</FlagsContext.Provider>;
}

export function useStoreFlags(): StoreFlags {
  return useContext(FlagsContext);
}
