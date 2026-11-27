// "Compare environments" and "Promote": pure logic, no `vscode` import.
// Promote copies a flag's environment-level state (on/off + value) from a source environment
// to a target environment. Segment and identity overrides, and multivariate weights, are not copied.

import type { Environment, Feature, FlagsmithClient, FlagValue } from "./flagsmithClient.ts";
import { isProductionName } from "./format.ts";

export interface Cell {
  featureId: number;
  stateId: number;
  enabled: boolean;
  value: FlagValue;
}

export interface CompareRow {
  name: string;
  /** One cell per environment, in the same order as the environments; null = no state there. */
  cells: Array<Cell | null>;
  /** True when not every environment has the same on/off and value. */
  differs: boolean;
}

export function toCell(feature: Feature | undefined): Cell | null {
  const s = feature?.environment_feature_state;
  return feature && s ? { featureId: feature.id, stateId: s.id, enabled: s.enabled, value: s.feature_state_value } : null;
}

export function sameCell(a: Cell | null, b: Cell | null): boolean {
  if (!a || !b) return a === b;
  return a.enabled === b.enabled && a.value === b.value;
}

/** Rows sorted by flag name, one column per environment. */
export function buildComparison(
  environments: readonly Environment[],
  featuresByEnvironment: ReadonlyMap<number, readonly Feature[]>,
): CompareRow[] {
  const names = new Set<string>();
  for (const features of featuresByEnvironment.values()) for (const f of features) names.add(f.name);
  return [...names].sort().map((name) => {
    const cells = environments.map((env) => toCell(featuresByEnvironment.get(env.id)?.find((f) => f.name === name)));
    return { name, cells, differs: cells.some((c) => !sameCell(c, cells[0] ?? null)) };
  });
}

/** One planned write: make the target look like the source. */
export interface PromotionChange {
  flag: string;
  featureId: number;
  /** The TARGET environment's feature-state id (what gets PATCHed). */
  stateId: number;
  from: { enabled: boolean; value: FlagValue };
  to: { enabled: boolean; value: FlagValue };
}

export interface PromotionPlan {
  changes: PromotionChange[];
  /** Flags that can't be promoted, with why. */
  skipped: Array<{ flag: string; reason: string }>;
}

/** Diffs `flags` between two environments' feature lists. Flags already equal are left out. */
export function planPromotion(
  flags: readonly string[],
  sourceFeatures: readonly Feature[],
  targetFeatures: readonly Feature[],
): PromotionPlan {
  const plan: PromotionPlan = { changes: [], skipped: [] };
  for (const flag of flags) {
    const source = toCell(sourceFeatures.find((f) => f.name === flag));
    const target = toCell(targetFeatures.find((f) => f.name === flag));
    if (!source || !target) {
      plan.skipped.push({ flag, reason: `no state in the ${source ? "target" : "source"} environment` });
      continue;
    }
    if (sameCell(source, target)) continue;
    plan.changes.push({
      flag,
      featureId: target.featureId,
      stateId: target.stateId,
      from: { enabled: target.enabled, value: target.value },
      to: { enabled: source.enabled, value: source.value },
    });
  }
  return plan;
}

export function formatValue(value: FlagValue): string {
  return value === null ? "no value" : JSON.stringify(value);
}

/** e.g. `checkout_cta_variant: value "control" → "Complete Order Now ->"` */
export function describeChange(c: PromotionChange): string {
  const parts: string[] = [];
  if (c.from.enabled !== c.to.enabled) parts.push(`${c.from.enabled ? "on" : "off"} → ${c.to.enabled ? "on" : "off"}`);
  if (c.from.value !== c.to.value) parts.push(`value ${formatValue(c.from.value)} → ${formatValue(c.to.value)}`);
  return `${c.flag}: ${parts.join(", ")}`;
}

export type ConfirmFn = (question: string, detail: string, confirmLabel: string) => Promise<boolean>;

export type PromoteOutcome =
  | { kind: "refused"; reason: string }
  | { kind: "nothing"; skipped: PromotionPlan["skipped"] }
  | { kind: "cancelled" }
  | {
      kind: "promoted";
      applied: PromotionChange[];
      /** Not written: the target changed in Flagsmith after the confirmation was shown, or similar. */
      skipped: Array<{ flag: string; reason: string }>;
      failed: Array<{ flag: string; error: string }>;
    };

/**
 * Promote flags from `source` to `target`:
 * 1. Refuse a target with v2 feature versioning (the PATCH endpoints aren't how it changes).
 * 2. Re-read BOTH environments from Flagsmith and diff them, so the list is never stale.
 * 3. Show the diff list and ask for confirmation (the caller makes it modal; it says when it's prod).
 * 4. Just before each write, re-read the target state; if it changed since step 2, skip that flag.
 * 5. Write the value, then on/off, only for the parts that differ.
 */
export async function promote(
  client: FlagsmithClient,
  projectId: number,
  source: Environment,
  target: Environment,
  flags: readonly string[],
  confirm: ConfirmFn,
): Promise<PromoteOutcome> {
  if (target.use_v2_feature_versioning) {
    return {
      kind: "refused",
      reason: `"${target.name}" uses feature versioning (v2). FlagLens only writes to environments without versioning; use the Flagsmith dashboard.`,
    };
  }
  if (source.id === target.id) return { kind: "refused", reason: "Source and target are the same environment." };

  const [sourceFeatures, targetFeatures] = await Promise.all([
    client.listFeatures(projectId, source.id),
    client.listFeatures(projectId, target.id),
  ]);
  const plan = planPromotion(flags, sourceFeatures, targetFeatures);
  if (plan.changes.length === 0) return { kind: "nothing", skipped: plan.skipped };

  const prod = isProductionName(target.name);
  const list = plan.changes.map((c) => `• ${describeChange(c)}`).join("\n");
  const confirmed = await confirm(
    `${prod ? "⚠ PRODUCTION: " : ""}Promote ${plan.changes.length} flag change(s) from ${source.name} to ${target.name}?`,
    `${list}${prod ? `\n\nThis changes ${target.name} for every user immediately.` : ""}` +
      (plan.skipped.length > 0 ? `\n\nSkipped: ${plan.skipped.map((s) => `${s.flag} (${s.reason})`).join(", ")}` : ""),
    "Promote",
  );
  if (!confirmed) return { kind: "cancelled" };

  const applied: PromotionChange[] = [];
  const skipped = [...plan.skipped];
  const failed: Array<{ flag: string; error: string }> = [];
  for (const change of plan.changes) {
    try {
      const now = await client.getFeatureState(target.api_key, change.stateId);
      if (now.enabled !== change.from.enabled || now.feature_state_value !== change.from.value) {
        skipped.push({ flag: change.flag, reason: `changed in ${target.name} since the list was shown; nothing written` });
        continue;
      }
      if (change.from.value !== change.to.value) {
        await client.setFeatureStateValue(target.id, change.featureId, change.stateId, change.to.value);
      }
      if (change.from.enabled !== change.to.enabled) {
        await client.setFeatureStateEnabled(target.api_key, change.stateId, change.to.enabled);
      }
      applied.push(change);
    } catch (err) {
      failed.push({ flag: change.flag, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { kind: "promoted", applied, skipped, failed };
}
