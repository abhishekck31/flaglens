// Hover card over a known flag name: state and value in every environment,
// code reference count, and a dashboard link per environment.

import * as vscode from "vscode";
import { findFlagReferences } from "./flagScanner.ts";
import type { FlagStore } from "./flagStore.ts";
import { dashboardBaseUrl, dashboardFeatureUrl, isProductionName, totalCodeReferences } from "./format.ts";

export class FlagHoverProvider implements vscode.HoverProvider {
  private readonly store: FlagStore;

  constructor(store: FlagStore) {
    this.store = store;
  }

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const snapshot = this.store.current;
    if (!snapshot) return undefined;

    // Only scan the hovered line, and pick the reference under the cursor (quotes included).
    const lineText = document.lineAt(position.line).text;
    const ref = findFlagReferences(lineText, this.store.flagNames()).find(
      (r) => position.character >= r.column && position.character <= r.column + r.name.length + 1,
    );
    if (!ref) return undefined;

    const config = vscode.workspace.getConfiguration("flaglens");
    const base = dashboardBaseUrl(config.get<string>("apiUrl", ""), config.get<string>("dashboardUrl", ""));

    const md = new vscode.MarkdownString();
    let header = false;

    for (const environment of snapshot.environments) {
      const feature = snapshot.featuresByEnvironment.get(environment.id)?.find((f) => f.name === ref.name);
      if (!feature) continue;

      if (!header) {
        // Type, refs and description are the same in every environment: show them once.
        const refs = totalCodeReferences(feature);
        md.appendMarkdown(`**${feature.name}** · ${feature.type} · ${refs} code ${refs === 1 ? "reference" : "references"}\n\n`);
        if (feature.description) md.appendMarkdown(`${feature.description}\n\n`);
        md.appendMarkdown("| Environment | State | Value |\n|---|---|---|\n");
        header = true;
      }

      const state = feature.environment_feature_state;
      const link = dashboardFeatureUrl(base, snapshot.project.id, environment.api_key, feature.id);
      const name = `${isProductionName(environment.name) ? "⚠ " : ""}[${environment.name}](${link})`;
      const onOff = state ? (state.enabled ? "● on" : "○ off") : "no state";
      const value = state && state.feature_state_value !== null ? `\`${JSON.stringify(state.feature_state_value)}\`` : "–";
      md.appendMarkdown(`| ${name} | ${onOff} | ${value} |\n`);
    }

    if (!header) return undefined;
    md.appendMarkdown("\nClick an environment to open the flag in the Flagsmith dashboard.");
    // We scanned a single line, so `ref.line` is 0: the real line is the hovered one.
    const start = new vscode.Position(position.line, ref.column);
    return new vscode.Hover(md, new vscode.Range(start, start.translate(0, ref.name.length + 2)));
  }
}
