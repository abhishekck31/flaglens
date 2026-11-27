// "Flag Health" tree: Unused / Missing in Flagsmith / Fully rolled out.
// Rescans whenever the flag snapshot reloads (connect, refresh, toggle, push, create)
// and shortly after a file is saved.

import path from "node:path";
import * as vscode from "vscode";
import { DEFAULT_EXCLUDE_GLOBS } from "./codeReferences.ts";
import { computeHealth, type FlagHealth, type MissingKey } from "./flagHealth.ts";
import { DEFAULT_CALL_PATTERNS } from "./flagScanner.ts";
import type { FlagStore } from "./flagStore.ts";
import { readTrackedFiles } from "./repoFiles.ts";

type GroupId = "unused" | "missing" | "rolledOut";

export type HealthNode =
  | { kind: "group"; id: GroupId }
  | { kind: "unused"; name: string }
  | { kind: "missing"; key: MissingKey }
  | { kind: "rolledOut"; name: string }
  | { kind: "message"; text: string; detail?: string };

const GROUP_LABELS: Record<GroupId, string> = {
  unused: "Unused",
  missing: "Missing in Flagsmith",
  rolledOut: "Fully rolled out",
};

export class FlagHealthProvider implements vscode.TreeDataProvider<HealthNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<HealthNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  private readonly store: FlagStore;
  private health: FlagHealth | undefined;
  /** Repo root of the last scan, to turn repo-relative paths back into files. */
  private root = "";
  private error: string | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly subscriptions: vscode.Disposable[];

  constructor(store: FlagStore) {
    this.store = store;
    this.subscriptions = [
      store.onDidChange(() => void this.scan()),
      // Saving a file (e.g. after the "Did you mean" quick fix) rescans after a short pause,
      // so several quick saves cause one scan.
      vscode.workspace.onDidSaveTextDocument(() => {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => void this.scan(), 500);
      }),
    ];
  }

  /** Reads the open folder's tracked files and recomputes all three groups. */
  async scan(): Promise<void> {
    const snapshot = this.store.current;
    const folder = vscode.workspace.workspaceFolders?.[0];
    this.health = undefined;
    this.error = undefined;

    if (snapshot && folder) {
      const config = vscode.workspace.getConfiguration("flaglens");
      try {
        // Only the open folder: Flag Health is about the code you're working on.
        const { root, files } = await readTrackedFiles(
          folder.uri.fsPath,
          config.get<string[]>("exclude", DEFAULT_EXCLUDE_GLOBS),
        );
        this.root = root;
        this.health = computeHealth({
          environments: snapshot.environments,
          featuresByEnvironment: snapshot.featuresByEnvironment,
          files,
          callPatterns: config.get<string[]>("callPatterns", DEFAULT_CALL_PATTERNS),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
        this.error = `Flag Health needs the folder to be in a git repository. (${message})`;
      }
    }
    this.changed.fire(undefined);
  }

  getChildren(node?: HealthNode): HealthNode[] {
    if (!node) {
      if (this.error) return [{ kind: "message", text: "Could not scan this folder", detail: this.error }];
      if (!this.health) {
        // Connected but nothing to scan: say so. Not connected: the welcome view explains.
        const noFolder = this.store.current && !vscode.workspace.workspaceFolders?.length;
        return noFolder ? [{ kind: "message", text: "Open a folder to check flag health" }] : [];
      }
      return (["unused", "missing", "rolledOut"] as const).map((id) => ({ kind: "group", id }));
    }
    if (node.kind !== "group" || !this.health) return [];

    const items: HealthNode[] =
      node.id === "unused"
        ? this.health.unused.map((name) => ({ kind: "unused", name }))
        : node.id === "missing"
          ? this.health.missing.map((key) => ({ kind: "missing", key }))
          : this.health.fullyRolledOut.map((name) => ({ kind: "rolledOut", name }));
    return items.length > 0 ? items : [{ kind: "message", text: "None" }];
  }

  getTreeItem(node: HealthNode): vscode.TreeItem {
    switch (node.kind) {
      case "group": {
        const count = this.countFor(node.id);
        const item = new vscode.TreeItem(
          GROUP_LABELS[node.id],
          count > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.description = String(count);
        return item;
      }
      case "unused": {
        const item = new vscode.TreeItem(node.name);
        item.description = "0 references";
        item.iconPath = new vscode.ThemeIcon("circle-slash");
        item.tooltip = `No tracked file in this folder mentions "${node.name}". If it's really unused, archive it in Flagsmith.`;
        return item;
      }
      case "missing": {
        const { key } = node;
        const item = new vscode.TreeItem(key.name);
        item.description = `${key.path}:${key.line + 1}`;
        item.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground"));
        item.tooltip = `"${key.name}" is not a flag in Flagsmith project "${this.store.current?.project.name ?? ""}". Click to open the line.`;
        const start = new vscode.Position(key.line, key.column);
        // Built-in "vscode.open" command: opens the file and selects the key.
        item.command = {
          command: "vscode.open",
          title: "Open",
          arguments: [
            vscode.Uri.file(path.join(this.root, key.path)),
            { selection: new vscode.Range(start, start.translate(0, key.name.length)) },
          ],
        };
        return item;
      }
      case "rolledOut": {
        const envCount = this.store.current?.environments.length ?? 0;
        const item = new vscode.TreeItem(node.name);
        item.description = `on in all ${envCount} environments`;
        item.iconPath = new vscode.ThemeIcon("pass-filled", new vscode.ThemeColor("testing.iconPassed"));
        item.tooltip =
          `"${node.name}" is on everywhere. If the rollout is final, remove the flag check from the code ` +
          "(keep the 'on' branch) and archive the flag in Flagsmith.";
        return item;
      }
      case "message": {
        const item = new vscode.TreeItem(node.text);
        item.tooltip = node.detail ?? node.text;
        if (node.detail) item.iconPath = new vscode.ThemeIcon("error");
        return item;
      }
    }
  }

  private countFor(id: GroupId): number {
    if (!this.health) return 0;
    if (id === "unused") return this.health.unused.length;
    if (id === "missing") return this.health.missing.length;
    return this.health.fullyRolledOut.length;
  }

  dispose(): void {
    clearTimeout(this.saveTimer);
    for (const s of this.subscriptions) s.dispose();
    this.changed.dispose();
  }
}
