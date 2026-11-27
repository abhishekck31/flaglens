// "FlagLens: Compare environments" webview panel (VS Code wiring).
// Rendering is in compareHtml.ts, the promote rules in compare.ts.

import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { buildComparison, describeChange, promote } from "./compare.ts";
import { renderCompareHtml, type CompareMessage } from "./compareHtml.ts";
import type { FlagsmithClient } from "./flagsmithClient.ts";
import type { FlagStore } from "./flagStore.ts";
import { isProductionName } from "./format.ts";

export class ComparePanel {
  private static current: ComparePanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly store: FlagStore;
  private readonly getClient: () => Promise<FlagsmithClient | undefined>;
  private readonly output: vscode.OutputChannel;
  private sourceIndex = 0;
  private targetIndex = 1;
  private readonly disposables: vscode.Disposable[] = [];

  /** Opens the panel, or brings the existing one to the front. */
  static show(store: FlagStore, getClient: () => Promise<FlagsmithClient | undefined>, output: vscode.OutputChannel): void {
    if (ComparePanel.current) {
      ComparePanel.current.panel.reveal();
      return;
    }
    ComparePanel.current = new ComparePanel(store, getClient, output);
  }

  private constructor(store: FlagStore, getClient: () => Promise<FlagsmithClient | undefined>, output: vscode.OutputChannel) {
    this.store = store;
    this.getClient = getClient;
    this.output = output;
    this.panel = vscode.window.createWebviewPanel("flaglens.compare", "Compare environments", vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [], // the page loads nothing from disk
    });
    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((msg: CompareMessage) => void this.onMessage(msg)),
      // Toggles, refreshes and promotes all reload the store; redraw with the new states.
      store.onDidChange(() => this.render()),
    );
    // Default: the first non-production environment -> the first production one (e.g. Development -> Production).
    const envs = store.current?.environments ?? [];
    const prod = envs.findIndex((e) => isProductionName(e.name));
    if (prod >= 0) {
      this.targetIndex = prod;
      this.sourceIndex = Math.max(0, envs.findIndex((e) => !isProductionName(e.name)));
    }
    this.render();
  }

  private render(): void {
    const snapshot = this.store.current;
    const nonce = randomBytes(16).toString("base64");
    if (!snapshot || snapshot.environments.length < 2) {
      this.panel.webview.html = `<!DOCTYPE html><html><body><p>${
        snapshot ? "This project has fewer than two environments." : "Connect to Flagsmith first."
      }</p></body></html>`;
      return;
    }
    const last = snapshot.environments.length - 1;
    this.sourceIndex = Math.min(this.sourceIndex, last);
    this.targetIndex = Math.min(this.targetIndex, last);
    this.panel.webview.html = renderCompareHtml(
      {
        projectName: snapshot.project.name,
        environments: snapshot.environments,
        rows: buildComparison(snapshot.environments, snapshot.featuresByEnvironment),
        sourceIndex: this.sourceIndex,
        targetIndex: this.targetIndex,
      },
      nonce,
      this.panel.webview.cspSource,
    );
  }

  private async onMessage(msg: CompareMessage): Promise<void> {
    if (msg.type === "refresh") return this.store.reload();
    if (msg.type === "select") {
      this.sourceIndex = msg.source;
      this.targetIndex = msg.target;
      return this.render();
    }

    const snapshot = this.store.current;
    const client = await this.getClient();
    const source = snapshot?.environments[this.sourceIndex];
    const target = snapshot?.environments[this.targetIndex];
    if (!snapshot || !client || !source || !target) return;

    const outcome = await promote(client, snapshot.project.id, source, target, msg.flags, async (question, detail, label) => {
      // Always a modal: the user sees the exact diff list (re-read from Flagsmith) before any write.
      return (await vscode.window.showWarningMessage(question, { modal: true, detail }, label)) === label;
    });

    this.output.appendLine(`Promote ${source.name} → ${target.name}: ${outcome.kind}`);
    switch (outcome.kind) {
      case "refused":
        void vscode.window.showErrorMessage(`FlagLens: ${outcome.reason}`);
        break;
      case "nothing":
        void vscode.window.showInformationMessage(
          `FlagLens: ${target.name} already matches ${source.name} for ${msg.flags.length === 1 ? `"${msg.flags[0]}"` : "these flags"}.`,
        );
        break;
      case "cancelled":
        break;
      case "promoted": {
        for (const c of outcome.applied) this.output.appendLine(`  applied  ${describeChange(c)}`);
        for (const s of outcome.skipped) this.output.appendLine(`  skipped  ${s.flag}: ${s.reason}`);
        for (const f of outcome.failed) this.output.appendLine(`  FAILED   ${f.flag}: ${f.error}`);
        const problems = outcome.skipped.length + outcome.failed.length;
        const message = `FlagLens: promoted ${outcome.applied.length} flag(s) to ${target.name}.` + (problems > 0 ? ` ${problems} not written (see Output).` : "");
        if (outcome.failed.length > 0) void vscode.window.showErrorMessage(message);
        else void vscode.window.showInformationMessage(message);
        if (problems > 0) this.output.show(true);
        break;
      }
    }
    // Reload so the table, tree, CodeLens and hovers show what Flagsmith now has.
    await this.store.reload();
  }

  private dispose(): void {
    ComparePanel.current = undefined;
    for (const d of this.disposables) d.dispose();
  }
}
