// Pure text helpers for the tree view. No `vscode` import, so they are unit-testable.

import type { Feature } from "./flagsmithClient.ts";

/** Total references across every repository that has been scanned. */
export function totalCodeReferences(feature: Feature): number {
  return feature.code_references_counts.reduce((sum, repo) => sum + repo.count, 0);
}

/** Matches environment names like "Production", "prod", "prod-eu". Used for the safety prompt. */
export function isProductionName(environmentName: string): boolean {
  return /prod/i.test(environmentName);
}

/**
 * The grey text after a flag's name in the tree, e.g. `on · "control" · 3 refs`.
 * The value is shown only when the flag has one, and is truncated to keep rows short.
 */
export function describeFlag(feature: Feature): string {
  const state = feature.environment_feature_state;
  const parts: string[] = [state ? (state.enabled ? "on" : "off") : "no state"];

  const value = state?.feature_state_value;
  if (value !== null && value !== undefined && value !== "") {
    const text = JSON.stringify(value);
    parts.push(text.length > 24 ? `${text.slice(0, 23)}…` : text);
  }

  const refs = totalCodeReferences(feature);
  parts.push(`${refs} ${refs === 1 ? "ref" : "refs"}`);
  return parts.join(" · ");
}
