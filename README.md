# Flagsmith DevBar (`@togglewars/flagsmith-devbar`)

**Local QA, Chaos Testing & Bayesian Experimentation Simulator for Self-Hosted Flagsmith** — built for Toggle Wars Track 03.

## The Problem

Developing against feature flags and Bayesian experiments locally breaks down in three ways:
1. **Multivariate QA friction:** Toggling a flag in the Flagsmith dashboard mutates global state for every tab and teammate, making side-by-side comparison of `control`, `urgent_copy`, and `social_proof` painful.
2. **Untested offline fallbacks:** Verifying `default_flag_handler` and timeout states usually requires stopping Docker containers or hacking network throttling.
3. **Empty local experiments:** Self-hosted Flagsmith starts with zero traffic, making it impossible to preview Bayesian experiment lift and Postgres warehouse ingestion without wiring up a traffic generator.

`@togglewars/flagsmith-devbar` solves all three with a drop-in TypeScript/React wrapper (`createDevFlagsmithClient()`) and a collapsible dark-mode `<FlagsmithDevBar />` floating pill.

---

## 3-Command Quickstart

> Prerequisites: Docker Desktop (running) and Node.js 20+.

1. **Start self-hosted Flagsmith** (Postgres + API + Task Processor):
   ```bash
   npm run up
   ```
   Expected output: `Flagsmith ready at http://localhost:8000` (Flagsmith Dashboard & API at `http://localhost:8000`).

2. **Bootstrap org, project, flags, metric, and running experiment:**
   ```bash
   npm run seed
   ```
   Expected output:
   ```json
   {
     "projectId": 1,
     "devEnvKey": "<your_dev_env_key>",
     "prodEnvKey": "<your_prod_env_key>",
     "experimentId": 1,
     "experimentStatus": "running"
   }
   ```
   *(Requires `flagsmith.env` with `FLAGSMITH_API_URL` and `FLAGSMITH_API_KEY_localhost_8000`.)*

3. **Launch the Next.js demo store + DevBar:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` and click the **Flagsmith DevBar** pill in the bottom-right corner.

---

## Drop-In Integration (Any React / Next.js App)

```tsx
import { createDevFlagsmithClient, FlagsmithDevBar } from "@togglewars/flagsmith-devbar";

const devClient = createDevFlagsmithClient({
  environmentID: process.env.NEXT_PUBLIC_FLAGSMITH_ENV_KEY!,
  productionEnvironmentID: process.env.NEXT_PUBLIC_FLAGSMITH_PROD_ENV_KEY,
  api: process.env.NEXT_PUBLIC_FLAGSMITH_API_URL,
  eventsUrl: process.env.NEXT_PUBLIC_FLAGSMITH_EVENTS_URL,
  defaultFlagHandler: () => ({ enabled: true, value: "Continue to Checkout" }),
});

// Mount inside your root layout or provider:
<FlagsmithDevBar client={devClient} devEnvironmentKey={DEV_KEY} prodEnvironmentKey={PROD_KEY} />
```

---

## Architecture & Wiring Guarantees

- **Per-Tab `sessionStorage` Overrides:** Variation pins and chaos toggles live in `sessionStorage` (`flagsmith_devbar:overrides:<envKey>`), isolated per browser tab. Open 3 tabs side-by-side pinned to `control`, `urgent_copy`, and `social_proof` without mutating Flagsmith's backend state, or click **Reset to Live Flagsmith** to clear.
- **Chaos & `503 Offline` Injection:** Inject `0ms`–`3000ms` artificial latency or force `503 Service Unavailable` to trigger `defaultFlagHandler` fallback UI in real time.
- **Environment Parity / Drift Inspector:** Compares live `Development` vs `Production` flag states in parallel and highlights drifted flags (e.g. `enable_express_checkout` ON in Dev, OFF in Prod).
- **Stable Visitor IDs & Self-Hosted `eventsUrl` Routing:** `apps/demo-store` persists a single visitor UUID in `localStorage` + cookie and passes it to both `getExperimentFlag("checkout_cta_variant")` and `trackEvent("checkout_clicked")`, routing all `$flag_exposure` / `$exposure` and conversion events to `http://localhost:8000/api/` (never Flagsmith Cloud).
- **1-Click Bayesian Traffic Simulator:** Sends 300 stable-UUID visitor exposures + conversions (`12%` control, `19%` urgent_copy, `15%` social_proof) to `POST /api/v1/events/`, flushes buffered events, and refreshes experiment results via `/api/flagsmith/refresh` (gracefully handling Flagsmith's 5-minute refresh cooldown).
