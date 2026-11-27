// The toggle rules, kept free of `vscode` so they can be unit-tested.
// The caller passes in how to ask the user for confirmation (a modal dialog in VS Code).

import type { Environment, Feature, FlagsmithClient, FlagValue } from "./flagsmithClient.ts";
import { isProductionName } from "./format.ts";

export type ToggleOutcome =
  | { kind: "toggled"; enabled: boolean }
  | { kind: "cancelled" }
  | { kind: "refused"; reason: string };

export type EditValueOutcome =
  | { kind: "updated"; value: FlagValue }
  | { kind: "cancelled" }
  | { kind: "refused"; reason: string };

/** Asks the user a yes/no question; resolves true only on an explicit "yes". */
export type ConfirmFn = (question: string, detail: string, confirmLabel: string) => Promise<boolean>;

/** Prompts the user for a new flag value; resolves undefined if cancelled. */
export type PromptValueFn = (currentValue: FlagValue) => Promise<FlagValue | undefined>;

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

/**
 * Parses raw text from an input box into a typed FlagValue, preserving the existing
 * value's type when one is already set.
 */
export function parseFlagValueInput(
  raw: string,
  currentValue: FlagValue,
): { ok: true; value: FlagValue } | { ok: false; error: string } {
  const trimmed = raw.trim();

  if (typeof currentValue === "number") {
    if (!/^-?\d+$/.test(trimmed)) {
      return { ok: false, error: "Enter a whole integer." };
    }
    const num = Number(trimmed);
    if (!Number.isSafeInteger(num) || num < INT32_MIN || num > INT32_MAX) {
      return { ok: false, error: "Integer is outside 32-bit range." };
    }
    return { ok: true, value: num };
  }

  if (typeof currentValue === "boolean") {
    const lower = trimmed.toLowerCase();
    if (lower !== "true" && lower !== "false") {
      return { ok: false, error: 'Enter "true" or "false".' };
    }
    return { ok: true, value: lower === "true" };
  }

  if (currentValue === null) {
    if (trimmed === "") return { ok: true, value: null };
    if (trimmed.toLowerCase() === "true") return { ok: true, value: true };
    if (trimmed.toLowerCase() === "false") return { ok: true, value: false };
    if (/^-?\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      if (Number.isSafeInteger(num) && num >= INT32_MIN && num <= INT32_MAX) {
        return { ok: true, value: num };
      }
    }
    return { ok: true, value: raw };
  }

  return { ok: true, value: raw };
}

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

/**
 * Updates a flag's environment-level `feature_state_value` with the same v2-versioning,
 * live re-read, and production-confirmation safeguards as `toggleFlag`.
 */
export async function editFlagValue(
  client: FlagsmithClient,
  environment: Environment,
  feature: Feature,
  promptValue: PromptValueFn,
  confirm: ConfirmFn,
): Promise<EditValueOutcome> {
  if (environment.use_v2_feature_versioning) {
    return {
      kind: "refused",
      reason:
        `"${environment.name}" uses feature versioning (v2). FlagLens can only edit environments ` +
        `without versioning. Change "${feature.name}" in the Flagsmith dashboard instead.`,
    };
  }

  const state = feature.environment_feature_state;
  if (!state) {
    return { kind: "refused", reason: `"${feature.name}" has no state in "${environment.name}".` };
  }

  const current = await client.getFeatureState(environment.api_key, state.id);
  const nextValue = await promptValue(current.feature_state_value);
  if (nextValue === undefined) return { kind: "cancelled" };

  if (isProductionName(environment.name)) {
    const confirmed = await confirm(
      `Change value of "${feature.name}" in ${environment.name} to ${JSON.stringify(nextValue)}?`,
      `This changes the flag value for every user of ${environment.name} immediately.`,
      "Update value",
    );
    if (!confirmed) return { kind: "cancelled" };
  }

  const result = await client.setFeatureStateValue(state.id, feature.id, environment.id, nextValue);
  if (result.feature_state_value !== nextValue) {
    return { kind: "refused", reason: `Flagsmith did not apply the value change to "${feature.name}".` };
  }
  return { kind: "updated", value: nextValue };
}
