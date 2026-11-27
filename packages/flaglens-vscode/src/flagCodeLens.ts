// CodeLens: above every line that mentions a flag, show its state in each environment.
// Clicking one runs `flaglens.toggleFlag` for that flag + environment.
//
//   Development: ● on  |  ⚠ Production: ○ off
//   flagsmith.hasFeature("new_checkout")

import * as vscode from "vscode";
import { findFlagReferences } from "./flagScanner.ts";
import type { FlagStore } from "./flagStore.ts";
import { isProductionName } from "./format.ts";

/** What the CodeLens passes to the toggle command. */
export interface ToggleTarget {
  environmentId: number;
  featureName: string;
}

/** Skip huge files (minified bundles etc.): scanning them on every edit would be slow. */
const MAX_FILE_CHARS = 1_000_000;

export class FlagCodeLensProvider implements vscode.CodeLensProvider {
  private readonly store: FlagStore;
  /** Redraw lenses whenever the store reloads (e.g. after a toggle). */
  readonly onDidChangeCodeLenses: vscode.Event<void>;

  constructor(store: FlagStore) {
    this.store = store;
    this.onDidChangeCodeLenses = store.onDidChange;
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const snapshot = this.store.current;
    const text = document.getText();
    if (!snapshot || text.length > MAX_FILE_CHARS) return [];

    const references = findFlagReferences(text, this.store.flagNames());
    const lenses: vscode.CodeLens[] = [];
    const seen = new Set<string>(); // one set of lenses per flag per line

    for (const ref of references) {
      const key = `${ref.line}:${ref.name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // If a line mentions several flags, prefix each lens with the flag name.
      const flagsOnLine = new Set(references.filter((r) => r.line === ref.line).map((r) => r.name));
      const prefix = flagsOnLine.size > 1 ? `${ref.name} · ` : "";
      const range = new vscode.Range(ref.line, ref.column, ref.line, ref.column);

      for (const environment of snapshot.environments) {
        const feature = snapshot.featuresByEnvironment.get(environment.id)?.find((f) => f.name === ref.name);
        const state = feature?.environment_feature_state;
        if (!state) continue;

        const warn = isProductionName(environment.name) ? "⚠ " : "";
        const target: ToggleTarget = { environmentId: environment.id, featureName: ref.name };
        lenses.push(
          new vscode.CodeLens(range, {
            title: `${prefix}${warn}${environment.name}: ${state.enabled ? "● on" : "○ off"}`,
            tooltip: `Click to turn ${state.enabled ? "off" : "on"} "${ref.name}" in ${environment.name}`,
            command: "flaglens.toggleFlag",
            arguments: [target],
          }),
        );
      }
    }
    return lenses;
  }
}
