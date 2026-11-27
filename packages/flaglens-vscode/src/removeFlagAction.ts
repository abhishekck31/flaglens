// "Remove flag (keep enabled path)" code action and command (VS Code wiring).
// The rewriting itself is in removeFlag.ts. That module pulls in the TypeScript compiler,
// so it is imported lazily, only when the command runs, to keep extension startup fast.

import path from "node:path";
import * as vscode from "vscode";
import { DEFAULT_EXCLUDE_GLOBS } from "./codeReferences.ts";
import { isFullyRolledOut, sharedValue } from "./flagHealth.ts";
import { findFlagReferences } from "./flagScanner.ts";
import type { FlagsmithClient } from "./flagsmithClient.ts";
import type { FlagStore } from "./flagStore.ts";
import { readTrackedFiles } from "./repoFiles.ts";

export const REMOVE_FLAG_KIND = vscode.CodeActionKind.RefactorRewrite.append("flaglens.removeFlag");

export const REMOVE_FLAG_LANGUAGES: vscode.DocumentSelector = [
  { language: "typescript" },
  { language: "typescriptreact" },
  { language: "javascript" },
  { language: "javascriptreact" },
];

/** Offers the action on lines that mention a flag which is on in every environment. */
export class RemoveFlagActionProvider implements vscode.CodeActionProvider {
  private readonly store: FlagStore;

  constructor(store: FlagStore) {
    this.store = store;
  }

  provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
    const snapshot = this.store.current;
    if (!snapshot) return [];
    const allNames = new Set<string>();
    for (const features of snapshot.featuresByEnvironment.values()) for (const f of features) allNames.add(f.name);

    const names = new Set<string>();
    for (let line = range.start.line; line <= range.end.line; line++) {
      for (const ref of findFlagReferences(document.lineAt(line).text, allNames)) {
        if (isFullyRolledOut(ref.name, snapshot.environments, snapshot.featuresByEnvironment)) names.add(ref.name);
      }
    }
    return [...names].map((name) => {
      const action = new vscode.CodeAction(`Remove flag "${name}" (keep enabled path)`, REMOVE_FLAG_KIND);
      action.command = { command: "flaglens.removeFlag", title: action.title, arguments: [name] };
      return action;
    });
  }
}

interface ManualItem {
  file: string; // repo-relative
  line: number; // 1-based
  reason: string;
}

export async function removeFlagCommand(
  name: string,
  store: FlagStore,
  getClient: () => Promise<FlagsmithClient | undefined>,
  output: vscode.OutputChannel,
): Promise<void> {
  const snapshot = store.current;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!snapshot || !folder) {
    void vscode.window.showErrorMessage("FlagLens: connect to Flagsmith and open a folder first.");
    return;
  }
  // The code action may be stale (someone toggled the flag since), so check again.
  if (!isFullyRolledOut(name, snapshot.environments, snapshot.featuresByEnvironment)) {
    void vscode.window.showWarningMessage(`FlagLens: "${name}" is not on in every environment, so it can't be removed safely.`);
    return;
  }
  const value = sharedValue(name, snapshot.environments, snapshot.featuresByEnvironment);
  const { removeFlag, isSupportedFile, changedRange } = await import("./removeFlag.ts");

  const config = vscode.workspace.getConfiguration("flaglens");
  const { root, files } = await readTrackedFiles(folder.uri.fsPath, config.get<string[]>("exclude", DEFAULT_EXCLUDE_GLOBS));
  const openDocs = new Map(vscode.workspace.textDocuments.map((d) => [path.normalize(d.uri.fsPath).toLowerCase(), d]));

  const edit = new vscode.WorkspaceEdit();
  let changedFiles = 0;
  let rewrites = 0;
  const manual: ManualItem[] = [];

  for (const file of files) {
    const absolute = path.join(root, file.path);
    // Use the editor's text when the file is open, so unsaved changes are respected.
    const doc = openDocs.get(path.normalize(absolute).toLowerCase());
    const text = doc?.getText() ?? file.text;
    if (!text.includes(name)) continue;

    if (!isSupportedFile(file.path)) {
      for (const ref of findFlagReferences(text, new Set([name]))) {
        manual.push({ file: file.path, line: ref.line + 1, reason: "not a TS/JS file" });
      }
      continue;
    }
    const result = removeFlag(file.path, text, name, value);
    for (const m of result.manual) manual.push({ file: file.path, line: m.line + 1, reason: m.reason });
    if (result.rewrites === 0) continue;

    const target = doc ?? (await vscode.workspace.openTextDocument(vscode.Uri.file(absolute)));
    const change = changedRange(text, result.text);
    // needsConfirmation = true: VS Code shows the Refactor Preview (a diff per file) and
    // only applies the edit when the user clicks Apply.
    edit.replace(
      target.uri,
      new vscode.Range(target.positionAt(change.start), target.positionAt(change.end)),
      change.text,
      { needsConfirmation: true, label: `Remove flag "${name}"`, description: file.path },
    );
    changedFiles++;
    rewrites += result.rewrites;
  }

  output.clear();
  output.appendLine(`Remove flag "${name}" (keep enabled path)`);

  if (changedFiles === 0) {
    reportManual(output, manual, "");
    void vscode.window.showWarningMessage(
      manual.length > 0
        ? `FlagLens: no supported shapes for "${name}". Manual cleanup needed: ${shortList(manual)}`
        : `FlagLens: "${name}" isn't used in any tracked file of this folder.`,
    );
    if (manual.length > 0) output.show(true);
    if (manual.length === 0) await offerArchive(name, snapshot, store, getClient, 0);
    return;
  }

  const applied = await vscode.workspace.applyEdit(edit, { isRefactoring: true });
  if (!applied) {
    output.appendLine("Preview discarded; nothing changed.");
    return;
  }
  output.appendLine(`Rewrote ${rewrites} check(s) in ${changedFiles} file(s). Review and save the changed files.`);
  // Line numbers are AFTER the rewrite, i.e. what's in the editor now.
  reportManual(output, manual, " (line numbers after the rewrite)");
  if (manual.length > 0) {
    output.show(true);
    void vscode.window.showWarningMessage(`FlagLens: manual cleanup needed: ${shortList(manual)}`);
  }
  await offerArchive(name, snapshot, store, getClient, manual.length);
}

function reportManual(output: vscode.OutputChannel, manual: ManualItem[], note: string): void {
  if (manual.length === 0) return;
  output.appendLine(`Not changed${note}:`);
  for (const m of manual) output.appendLine(`  manual cleanup needed: ${m.file}:${m.line}  ${m.reason}`);
}

function shortList(manual: ManualItem[]): string {
  const shown = manual.slice(0, 3).map((m) => `${m.file}:${m.line}`).join(", ");
  return manual.length > 3 ? `${shown} and ${manual.length - 3} more (see Output → FlagLens)` : shown;
}

/** Asks (modal) before archiving: archiving affects every environment, Production included. */
async function offerArchive(
  name: string,
  snapshot: NonNullable<FlagStore["current"]>,
  store: FlagStore,
  getClient: () => Promise<FlagsmithClient | undefined>,
  remaining: number,
): Promise<void> {
  const feature = [...snapshot.featuresByEnvironment.values()].flat().find((f) => f.name === name);
  if (!feature) return;
  const detail =
    `This archives "${name}" in project "${snapshot.project.name}" for every environment, including Production. ` +
    "SDKs keep serving archived flags, and you can unarchive it in the dashboard." +
    (remaining > 0 ? `\n\n${remaining} mention(s) in code still need manual cleanup.` : "");
  const choice = await vscode.window.showWarningMessage(`Archive "${name}" in Flagsmith?`, { modal: true, detail }, "Archive flag");
  if (choice !== "Archive flag") return;

  const client = await getClient();
  if (!client) return;
  try {
    await client.archiveFeature(snapshot.project.id, feature.id);
    await store.reload();
    void vscode.window.showInformationMessage(`FlagLens: archived "${name}" in Flagsmith.`);
  } catch (err) {
    void vscode.window.showErrorMessage(`FlagLens: archiving failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
