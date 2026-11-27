// FlagLens entry point. VS Code calls `activate` once, shortly after startup.

import * as vscode from "vscode";
import { FlagCodeLensProvider, type ToggleTarget } from "./flagCodeLens.ts";
import { FlagHoverProvider } from "./flagHover.ts";
import { UnknownFlagDiagnostics, UnknownFlagQuickFixes } from "./unknownFlags.ts";
import { DEFAULT_EXCLUDE_GLOBS } from "./codeReferences.ts";
import { formatSummary, scanAndPush } from "./pushReferences.ts";

/** "FlagLens" panel in the Output view: holds the full push report. */
const output = vscode.window.createOutputChannel("FlagLens");
import { FlagStore } from "./flagStore.ts";
import { FlagsmithClient, normaliseApiUrl, type Environment, type Feature } from "./flagsmithClient.ts";
import { FlagTreeProvider, type FlagTreeNode } from "./flagTree.ts";
import { toggleFlag } from "./toggle.ts";

/** Name under which the Organisation API key lives in VS Code's SecretStorage (OS keychain). */
const API_KEY_SECRET = "flaglens.organisationApiKey";

/** Everything that shows Flagsmith data and must be refreshed together. */
interface Views {
  tree: FlagTreeProvider;
  treeView: vscode.TreeView<FlagTreeNode>;
  store: FlagStore;
}

function getConfiguredApiUrl(): string {
  return vscode.workspace.getConfiguration("flaglens").get<string>("apiUrl", "http://localhost:8000/api/v1/");
}

/** Returns a client built from the saved URL and key, or undefined if not connected yet. */
async function getClient(context: vscode.ExtensionContext): Promise<FlagsmithClient | undefined> {
  const apiKey = await context.secrets.get(API_KEY_SECRET);
  return apiKey ? new FlagsmithClient(getConfiguredApiUrl(), apiKey) : undefined;
}

/**
 * Re-reads everything from Flagsmith: the `flaglens.connected` context key (which picks
 * between the welcome screen and the tree), the organisation name in the panel header,
 * the tree, and the CodeLens snapshot.
 */
async function reloadAll(context: vscode.ExtensionContext, views: Views): Promise<void> {
  const client = await getClient(context);
  await vscode.commands.executeCommand("setContext", "flaglens.connected", client !== undefined);

  views.tree.refresh();
  const storeLoaded = views.store.reload();

  try {
    const organisations = client ? await client.listOrganisations() : [];
    views.treeView.description = organisations.map((o) => o.name).join(", ") || undefined;
  } catch {
    views.treeView.description = undefined; // the tree itself shows the connection error
  }
  await storeLoaded;
}

/**
 * "FlagLens: Connect to Flagsmith": asks for the API URL and Organisation API key,
 * proves they work by listing organisations and projects, and only then saves them.
 */
async function connect(context: vscode.ExtensionContext, views: Views): Promise<void> {
  const apiUrl = await vscode.window.showInputBox({
    title: "FlagLens: Flagsmith API URL",
    prompt: "Your self-hosted Flagsmith API, e.g. http://localhost:8000/api/v1/",
    value: getConfiguredApiUrl(),
    ignoreFocusOut: true,
  });
  if (apiUrl === undefined) return; // user pressed Escape

  const apiKey = await vscode.window.showInputBox({
    title: "FlagLens: Organisation API key",
    prompt: "Dashboard → Organisation Settings → API Keys. Stored in your OS keychain, never in settings.",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : "The key can't be empty"),
  });
  if (apiKey === undefined) return;

  const client = new FlagsmithClient(apiUrl, apiKey.trim());

  try {
    const { organisations, projects } = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "FlagLens: connecting to Flagsmith..." },
      async () => ({
        organisations: await client.listOrganisations(),
        projects: await client.listProjects(),
      }),
    );

    // Save only after the key has been proven to work.
    await context.secrets.store(API_KEY_SECRET, apiKey.trim());
    await vscode.workspace
      .getConfiguration("flaglens")
      .update("apiUrl", normaliseApiUrl(apiUrl) + "/", vscode.ConfigurationTarget.Global);
    await reloadAll(context, views);

    const orgNames = organisations.map((o) => o.name).join(", ") || "none";
    vscode.window.showInformationMessage(
      `FlagLens connected to ${normaliseApiUrl(apiUrl)}. Organisation: ${orgNames}. Projects: ${projects.length}.`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`FlagLens could not connect. ${message}`);
  }
}

async function disconnect(context: vscode.ExtensionContext, views: Views): Promise<void> {
  await context.secrets.delete(API_KEY_SECRET);
  await reloadAll(context, views);
  vscode.window.showInformationMessage("FlagLens: API key removed from this machine.");
}

/** Shows a blocking (modal) warning; true only if the user clicked the confirm button. */
async function confirmModal(question: string, detail: string, confirmLabel: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(question, { modal: true, detail }, confirmLabel);
  return choice === confirmLabel;
}

/**
 * "Toggle flag": called from the tree (with the clicked row) or from a CodeLens
 * (with a {environmentId, featureName} target looked up in the store).
 */
async function runToggle(context: vscode.ExtensionContext, views: Views, arg: FlagTreeNode | ToggleTarget) {
  const client = await getClient(context);
  if (!client) {
    vscode.window.showErrorMessage("FlagLens: connect to Flagsmith first.");
    return;
  }

  let target: { environment: Environment; feature: Feature } | undefined;
  if ("kind" in arg) {
    if (arg.kind === "flag") target = { environment: arg.environment, feature: arg.feature };
  } else {
    target = views.store.find(arg.environmentId, arg.featureName);
  }
  if (!target) {
    vscode.window.showErrorMessage("FlagLens: that flag is no longer loaded. Refresh and try again.");
    return;
  }

  const { environment, feature } = target;
  try {
    const outcome = await toggleFlag(client, environment, feature, confirmModal);
    if (outcome.kind === "refused") {
      vscode.window.showErrorMessage(`FlagLens: ${outcome.reason}`);
    } else if (outcome.kind === "toggled") {
      vscode.window.showInformationMessage(
        `FlagLens: "${feature.name}" is now ${outcome.enabled ? "ON" : "OFF"} in ${environment.name}.`,
      );
    }
    // "cancelled": the user said no in the dialog, so say nothing.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`FlagLens could not toggle "${feature.name}". ${message}`);
  }
  // Refresh even after an error: the flag may have been changed elsewhere.
  await reloadAll(context, views);
}

/** Quick fix "Create flag 'x' in Flagsmith": creates it (off everywhere) in the CodeLens project. */
async function createFlag(context: vscode.ExtensionContext, views: Views, name: string): Promise<void> {
  const client = await getClient(context);
  const project = views.store.current?.project;
  if (!client || !project) {
    vscode.window.showErrorMessage("FlagLens: connect to Flagsmith first.");
    return;
  }
  try {
    await client.createFeature(project.id, name);
    vscode.window.showInformationMessage(`FlagLens: created "${name}" in ${project.name}, off in every environment.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`FlagLens could not create "${name}". ${message}`);
  }
  await reloadAll(context, views); // clears the warning once the flag exists
}

/** "FlagLens: Push code references": scan the repo and upload to Flagsmith. */
async function pushReferences(context: vscode.ExtensionContext, views: Views): Promise<void> {
  const client = await getClient(context);
  const snapshot = views.store.current;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!client || !snapshot) {
    vscode.window.showErrorMessage("FlagLens: connect to Flagsmith first.");
    return;
  }
  if (!folder) {
    vscode.window.showErrorMessage("FlagLens: open a folder inside a git repository first.");
    return;
  }

  try {
    const outcome = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "FlagLens: scanning and pushing code references..." },
      () =>
        scanAndPush({
          client,
          projectId: snapshot.project.id,
          flagNames: views.store.flagNames(),
          cwd: folder.uri.fsPath,
          excludeGlobs: vscode.workspace
            .getConfiguration("flaglens")
            .get<string[]>("exclude", DEFAULT_EXCLUDE_GLOBS),
          confirmRisk: (warning) => confirmModal("Push code references anyway?", warning, "Push anyway"),
        }),
    );

    if (outcome.kind === "refused") {
      vscode.window.showErrorMessage(`FlagLens: ${outcome.reason}`);
      return;
    }
    if (outcome.kind === "cancelled") return;

    output.clear();
    output.appendLine(formatSummary(outcome, snapshot.project.name));
    const { summary } = outcome;
    const zero = summary.unreferenced.length ? ` Flags with 0 refs: ${summary.unreferenced.join(", ")}.` : "";
    const choice = await vscode.window.showInformationMessage(
      `FlagLens: pushed ${summary.totalReferences} references across ${summary.byFlag.size} flags.${zero}`,
      "Show details",
    );
    if (choice) output.show();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`FlagLens could not push code references. ${message}`);
  } finally {
    // New counts for the tree, hover cards and CodeLens.
    await reloadAll(context, views);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const tree = new FlagTreeProvider(() => getClient(context));
  const treeView = vscode.window.createTreeView("flaglens.flags", { treeDataProvider: tree });
  const store = new FlagStore(() => getClient(context));
  const views: Views = { tree, treeView, store };

  context.subscriptions.push(
    treeView,
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, new FlagCodeLensProvider(store)),
    vscode.languages.registerHoverProvider({ scheme: "file" }, new FlagHoverProvider(store)),
    new UnknownFlagDiagnostics(store),
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      new UnknownFlagQuickFixes(store),
      UnknownFlagQuickFixes.metadata,
    ),
    vscode.commands.registerCommand("flaglens.createFlag", (name: string) => createFlag(context, views, name)),
    vscode.commands.registerCommand("flaglens.pushCodeReferences", () => pushReferences(context, views)),
    output,
    vscode.commands.registerCommand("flaglens.connect", () => connect(context, views)),
    vscode.commands.registerCommand("flaglens.disconnect", () => disconnect(context, views)),
    vscode.commands.registerCommand("flaglens.refresh", () => reloadAll(context, views)),
    vscode.commands.registerCommand("flaglens.toggleFlag", (arg: FlagTreeNode | ToggleTarget) =>
      runToggle(context, views, arg),
    ),
    // If the URL or project setting is edited by hand, reload from the new source.
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("flaglens")) void reloadAll(context, views);
    }),
  );

  void reloadAll(context, views);
}

export function deactivate(): void {
  // Nothing to clean up: everything registered above is disposed via context.subscriptions.
}
