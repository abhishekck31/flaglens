// Read-only sidebar tree: Project → Environment → Flag.
// Data is fetched lazily: each level is requested from Flagsmith when the user expands it.

import * as vscode from "vscode";
import type { Environment, Feature, FlagsmithClient, Project } from "./flagsmithClient.ts";
import { describeFlag, isProductionName, totalCodeReferences } from "./format.ts";

/** One row in the tree. `kind` tells getTreeItem/getChildren what to do with it. */
export type FlagTreeNode =
  | { kind: "project"; project: Project }
  | { kind: "environment"; project: Project; environment: Environment }
  | { kind: "flag"; environment: Environment; feature: Feature }
  | { kind: "message"; text: string; detail?: string; isError: boolean };

export class FlagTreeProvider implements vscode.TreeDataProvider<FlagTreeNode> {
  private readonly changed = new vscode.EventEmitter<FlagTreeNode | undefined>();
  /** VS Code listens to this; firing it makes the tree re-ask for its rows. */
  readonly onDidChangeTreeData = this.changed.event;

  /** Returns undefined while the user isn't connected. */
  private readonly getClient: () => Promise<FlagsmithClient | undefined>;

  constructor(getClient: () => Promise<FlagsmithClient | undefined>) {
    this.getClient = getClient;
  }

  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(node: FlagTreeNode): vscode.TreeItem {
    const Collapsed = vscode.TreeItemCollapsibleState.Collapsed;

    switch (node.kind) {
      case "project": {
        const item = new vscode.TreeItem(node.project.name, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon("project");
        item.contextValue = "project";
        return item;
      }
      case "environment": {
        const isProd = isProductionName(node.environment.name);
        const item = new vscode.TreeItem(node.environment.name, Collapsed);
        item.iconPath = new vscode.ThemeIcon(isProd ? "warning" : "server-environment");
        item.description = isProd ? "production" : undefined;
        item.contextValue = "environment";
        return item;
      }
      case "flag": {
        const state = node.feature.environment_feature_state;
        const item = new vscode.TreeItem(node.feature.name, vscode.TreeItemCollapsibleState.None);
        item.description = describeFlag(node.feature);
        item.iconPath = state?.enabled
          ? new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("testing.iconPassed"))
          : new vscode.ThemeIcon("circle-outline");
        item.tooltip = flagTooltip(node.environment, node.feature);
        item.contextValue = "flag";
        return item;
      }
      case "message": {
        const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(node.isError ? "error" : "info");
        item.tooltip = node.detail ?? node.text;
        return item;
      }
    }
  }

  async getChildren(node?: FlagTreeNode): Promise<FlagTreeNode[]> {
    const client = await this.getClient();
    // Not connected: return nothing so VS Code shows the "Connect" welcome view instead.
    if (!client) return [];

    try {
      if (!node) {
        const projects = await client.listProjects();
        if (projects.length === 0) return [message("No projects in this organisation")];
        return projects.map((project) => ({ kind: "project", project }));
      }
      if (node.kind === "project") {
        const environments = await client.listEnvironments(node.project.id);
        if (environments.length === 0) return [message("No environments in this project")];
        return environments.map((environment) => ({ kind: "environment", project: node.project, environment }));
      }
      if (node.kind === "environment") {
        const features = await client.listFeatures(node.project.id, node.environment.id);
        if (features.length === 0) return [message("No flags in this project")];
        return features
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((feature) => ({ kind: "flag", environment: node.environment, feature }));
      }
      return [];
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      return [{ kind: "message", text: "Could not load from Flagsmith", detail: text, isError: true }];
    }
  }
}

function message(text: string): FlagTreeNode {
  return { kind: "message", text, isError: false };
}

/** Hover text for a flag row: state, value and where it's referenced. */
function flagTooltip(environment: Environment, feature: Feature): vscode.MarkdownString {
  const state = feature.environment_feature_state;
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${feature.name}** in *${environment.name}*\n\n`);
  md.appendMarkdown(`- State: ${state ? (state.enabled ? "on" : "off") : "no environment state"}\n`);
  md.appendMarkdown(`- Type: ${feature.type}\n`);
  if (state && state.feature_state_value !== null) {
    md.appendMarkdown(`- Value: \`${JSON.stringify(state.feature_state_value)}\`\n`);
  }
  md.appendMarkdown(`- Code references: ${totalCodeReferences(feature)}\n`);
  for (const repo of feature.code_references_counts) {
    md.appendMarkdown(`  - ${repo.repository_url}: ${repo.count}\n`);
  }
  if (feature.description) md.appendMarkdown(`\n${feature.description}\n`);
  return md;
}
