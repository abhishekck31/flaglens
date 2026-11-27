// Pure text helpers for the tree view. No `vscode` import, so they are unit-testable.

import type { Feature } from "./flagsmithClient.ts";

/** Total references across every repository that has been scanned. */
export function totalCodeReferences(feature: Feature): number {
  return feature.code_references_counts.reduce((sum, repo) => sum + repo.count, 0);
}

/**
 * The dashboard's base URL. With the official docker-compose file the dashboard and API
 * share a host, so by default it's the API URL without `/api/v1`.
 */
export function dashboardBaseUrl(apiUrl: string, override: string): string {
  const base = override.trim() || apiUrl.trim().replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  return base.replace(/\/+$/, "");
}

/**
 * Link that opens a flag in the dashboard. Same format the dashboard builds itself
 * (frontend/web/components/audit-log/getAuditLogRelatedObjectLink.ts at v2.295.2).
 */
export function dashboardFeatureUrl(base: string, projectId: number, environmentApiKey: string, featureId: number) {
  return `${base}/project/${projectId}/environment/${environmentApiKey}/features?feature=${featureId}`;
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
