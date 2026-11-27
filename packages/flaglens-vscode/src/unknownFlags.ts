// Warnings for flag keys that don't exist in Flagsmith, plus two quick fixes:
//   - "Did you mean <closest flag>?" (only if it's within 3 edits)
//   - "Create flag '<key>' in Flagsmith" (created off in every environment)

import * as vscode from "vscode";
import { DEFAULT_CALL_PATTERNS, findFlagCalls } from "./flagScanner.ts";
import type { FlagStore } from "./flagStore.ts";
import { closestName } from "./suggest.ts";

/** Marks our diagnostics so the quick-fix provider only reacts to them. */
const DIAGNOSTIC_CODE = "flaglens.unknownFlag";
const MAX_FILE_CHARS = 1_000_000;

function callPatterns(): string[] {
  return vscode.workspace.getConfiguration("flaglens").get<string[]>("callPatterns", DEFAULT_CALL_PATTERNS);
}

export class UnknownFlagDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("flaglens");
  private readonly store: FlagStore;
  private readonly subscriptions: vscode.Disposable[];

  constructor(store: FlagStore) {
    this.store = store;
    this.subscriptions = [
      vscode.workspace.onDidOpenTextDocument((doc) => this.update(doc)),
      vscode.workspace.onDidChangeTextDocument((e) => this.update(e.document)),
      vscode.workspace.onDidCloseTextDocument((doc) => this.collection.delete(doc.uri)),
      // New flag list (connect, refresh, create, toggle): re-check every open file.
      store.onDidChange(() => this.updateAll()),
    ];
  }

  updateAll(): void {
    for (const doc of vscode.workspace.textDocuments) this.update(doc);
  }

  private update(document: vscode.TextDocument): void {
    const snapshot = this.store.current;
    const text = document.getText();
    // Without a flag list (not connected) we can't tell what's unknown, so show nothing.
    if (!snapshot || document.uri.scheme !== "file" || text.length > MAX_FILE_CHARS) {
      this.collection.delete(document.uri);
      return;
    }

    const known = this.store.flagNames();
    const diagnostics = findFlagCalls(text, callPatterns())
      .filter((call) => !known.has(call.name))
      .map((call) => {
        const range = new vscode.Range(call.line, call.column, call.line, call.column + call.name.length);
        const diagnostic = new vscode.Diagnostic(
          range,
          `"${call.name}" is not a flag in Flagsmith project "${snapshot.project.name}".`,
          vscode.DiagnosticSeverity.Warning,
        );
        diagnostic.source = "FlagLens";
        diagnostic.code = DIAGNOSTIC_CODE;
        return diagnostic;
      });
    this.collection.set(document.uri, diagnostics);
  }

  dispose(): void {
    this.collection.dispose();
    for (const s of this.subscriptions) s.dispose();
  }
}

export class UnknownFlagQuickFixes implements vscode.CodeActionProvider {
  static readonly metadata = { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] };
  private readonly store: FlagStore;

  constructor(store: FlagStore) {
    this.store = store;
  }

  provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext) {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.code !== DIAGNOSTIC_CODE) continue;
      const unknown = document.getText(diagnostic.range);

      const suggestion = closestName(unknown, this.store.flagNames());
      if (suggestion) {
        const fix = new vscode.CodeAction(`Did you mean "${suggestion}"?`, vscode.CodeActionKind.QuickFix);
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.replace(document.uri, diagnostic.range, suggestion);
        fix.diagnostics = [diagnostic];
        fix.isPreferred = true; // offered first, and applied by "Auto Fix"
        actions.push(fix);
      }

      const create = new vscode.CodeAction(`Create flag "${unknown}" in Flagsmith (off everywhere)`, vscode.CodeActionKind.QuickFix);
      create.command = { command: "flaglens.createFlag", title: create.title, arguments: [unknown] };
      create.diagnostics = [diagnostic];
      actions.push(create);
    }
    return actions;
  }
}
