// The toggle rules, kept free of `vscode` so they can be unit-tested.
// The caller passes in how to ask the user for confirmation (a modal dialog in VS Code).

import type { Environment, Feature, FlagsmithClient } from "./flagsmithClient.ts";
import { isProductionName } from "./format.ts";

export type ToggleOutcome =
  | { kind: "toggled"; enabled: boolean }
  | { kind: "cancelled" }
  | { kind: "refused"; reason: string };

/** Asks the user a yes/no question; resolves true only on an explicit "yes". */
export type ConfirmFn = (question: string, detail: string, confirmLabel: string) => Promise<boolean>;

/**
 * Flips a flag's environment-level `enabled` state.
 *
 * 1. Refuse environments that use v2 feature versioning (PATCH isn't the way to change them).
 * 2. Re-read the current state from Flagsmith, so we never act on a stale tree/CodeLens.
 * 3. For production-like environments, require an explicit confirmation.
 * 4. PATCH the new state and check that Flagsmith reports it back.
 */
export async function toggleFlag(
  client: FlagsmithClient,
  environment: Environment,
  feature: Feature,
  confirm: ConfirmFn,
): Promise<ToggleOutcome> {
  if (environment.use_v2_feature_versioning) {
    return {
      kind: "refused",
      reason:
        `"${environment.name}" uses feature versioning (v2). FlagLens can only toggle environments ` +
        `without versioning. Change "${feature.name}" in the Flagsmith dashboard instead.`,
    };
  }

  const state = feature.environment_feature_state;
  if (!state) {
    return { kind: "refused", reason: `"${feature.name}" has no state in "${environment.name}".` };
  }

  const current = await client.getFeatureState(environment.api_key, state.id);
  const next = !current.enabled;

  if (isProductionName(environment.name)) {
    const verb = next ? "ON" : "OFF";
    const confirmed = await confirm(
      `Turn ${verb} "${feature.name}" in ${environment.name}?`,
      `This changes the flag for every user of ${environment.name} immediately.`,
      `Turn ${verb.toLowerCase()}`,
    );
    if (!confirmed) return { kind: "cancelled" };
  }

  const result = await client.setFeatureStateEnabled(environment.api_key, state.id, next);
  if (result.enabled !== next) {
    return { kind: "refused", reason: `Flagsmith did not apply the change to "${feature.name}".` };
  }
  return { kind: "toggled", enabled: next };
}
