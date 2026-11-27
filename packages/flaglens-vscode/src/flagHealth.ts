// Flag Health: which flags look stale or broken. Pure logic, no `vscode` import.

import { findFlagCalls, findFlagReferences } from "./flagScanner.ts";
import type { Environment, Feature, FlagValue } from "./flagsmithClient.ts";
import type { ScannedFile } from "./repoFiles.ts";

/** A key passed to an SDK call that no Flagsmith flag has (e.g. a typo). */
export interface MissingKey {
  name: string;
  /** Repo-relative file path. */
  path: string;
  /** 0-based line and column of the key, ready for a VS Code Range. */
  line: number;
  column: number;
}

export interface FlagHealth {
  /** Flags in Flagsmith that no scanned file mentions (sorted). */
  unused: string[];
  /** SDK-call keys with no matching flag, in file/line order. */
  missing: MissingKey[];
  /** Flags enabled in every environment (sorted): candidates for cleanup. */
  fullyRolledOut: string[];
}

export interface HealthInput {
  environments: readonly Environment[];
  /** Flags keyed by environment id (same shape as the FlagStore snapshot). */
  featuresByEnvironment: ReadonlyMap<number, readonly Feature[]>;
  files: readonly ScannedFile[];
  callPatterns: readonly string[];
}

export function computeHealth(input: HealthInput): FlagHealth {
  const flagNames = new Set<string>();
  for (const features of input.featuresByEnvironment.values()) {
    for (const feature of features) flagNames.add(feature.name);
  }

  // Unused: the same "quoted name equals a flag" matcher as CodeLens and push.
  const referenced = new Set<string>();
  // Missing: the call-pattern matcher, which also sees keys that match no flag.
  const missing: MissingKey[] = [];
  for (const file of input.files) {
    for (const ref of findFlagReferences(file.text, flagNames)) referenced.add(ref.name);
    for (const call of findFlagCalls(file.text, input.callPatterns)) {
      if (!flagNames.has(call.name)) missing.push({ name: call.name, path: file.path, line: call.line, column: call.column });
    }
  }
  missing.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column);

  const unused = [...flagNames].filter((name) => !referenced.has(name)).sort();

  const fullyRolledOut = [...flagNames]
    .filter((name) => isFullyRolledOut(name, input.environments, input.featuresByEnvironment))
    .sort();

  return { unused, missing, fullyRolledOut };
}

/**
 * The flag exists, is not archived, and is ON in every environment of the project (and there is at
 * least one). Archived flags are excluded: they've already been cleaned up in Flagsmith.
 */
export function isFullyRolledOut(
  name: string,
  environments: readonly Environment[],
  featuresByEnvironment: ReadonlyMap<number, readonly Feature[]>,
): boolean {
  return (
    environments.length > 0 &&
    environments.every(
      (env) => {
        const feature = featuresByEnvironment.get(env.id)?.find((f) => f.name === name);
        return feature?.is_archived !== true && feature?.environment_feature_state?.enabled === true;
      },
    )
  );
}

/**
 * The flag's value if it is the SAME string, number or boolean in every environment; otherwise
 * undefined (no value, or values differ), in which case `getValue` can't be safely inlined.
 */
export function sharedValue(
  name: string,
  environments: readonly Environment[],
  featuresByEnvironment: ReadonlyMap<number, readonly Feature[]>,
): string | number | boolean | undefined {
  const values: FlagValue[] = environments.map(
    (env) => featuresByEnvironment.get(env.id)?.find((f) => f.name === name)?.environment_feature_state?.feature_state_value ?? null,
  );
  const first = values[0];
  if (first === undefined || first === null) return undefined;
  return values.every((v) => v === first) ? first : undefined;
}
