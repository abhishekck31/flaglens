// Flag Health: which flags look stale or broken. Pure logic, no `vscode` import.

import { findFlagCalls, findFlagReferences } from "./flagScanner.ts";
import type { Environment, Feature } from "./flagsmithClient.ts";
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

  // Fully rolled out: the flag exists and is ON in every environment of the project.
  const fullyRolledOut = [...flagNames]
    .filter(
      (name) =>
        input.environments.length > 0 &&
        input.environments.every((env) =>
          input.featuresByEnvironment.get(env.id)?.find((f) => f.name === name)?.environment_feature_state?.enabled === true,
        ),
    )
    .sort();

  return { unused, missing, fullyRolledOut };
}
