// FlagLens entry point. VS Code calls `activate` the first time a FlagLens command runs.

import * as vscode from "vscode";
import { FlagsmithClient, normaliseApiUrl } from "./flagsmithClient.ts";
import { FlagTreeProvider } from "./flagTree.ts";

/** Name under which the Organisation API key lives in VS Code's SecretStorage (OS keychain). */
const API_KEY_SECRET = "flaglens.organisationApiKey";

/**
 * Sets the `flaglens.connected` context key. package.json uses it to choose between
 * the "Connect" welcome screen and the flag tree.
 */
async function updateConnectedContext(context: vscode.ExtensionContext): Promise<void> {
  const connected = (await context.secrets.get(API_KEY_SECRET)) !== undefined;
  await vscode.commands.executeCommand("setContext", "flaglens.connected", connected);
}

function getConfiguredApiUrl(): string {
  return vscode.workspace.getConfiguration("flaglens").get<string>("apiUrl", "http://localhost:8000/api/v1/");
}

/**
 * Returns a client built from the saved URL and key, or undefined if the user
 * hasn't connected yet. Later features (tree view, toggling) go through this.
 */
export async function getClient(context: vscode.ExtensionContext): Promise<FlagsmithClient | undefined> {
  const apiKey = await context.secrets.get(API_KEY_SECRET);
  return apiKey ? new FlagsmithClient(getConfiguredApiUrl(), apiKey) : undefined;
}

/**
 * "FlagLens: Connect to Flagsmith": asks for the API URL and Organisation API key,
 * proves they work by listing organisations and projects, and only then saves them.
 */
async function connect(context: vscode.ExtensionContext, tree: FlagTreeProvider): Promise<void> {
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
    await updateConnectedContext(context);
    tree.refresh();

    const orgNames = organisations.map((o) => o.name).join(", ") || "none";
    vscode.window.showInformationMessage(
      `FlagLens connected to ${normaliseApiUrl(apiUrl)}. Organisation: ${orgNames}. Projects: ${projects.length}.`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`FlagLens could not connect. ${message}`);
  }
}

async function disconnect(context: vscode.ExtensionContext, tree: FlagTreeProvider): Promise<void> {
  await context.secrets.delete(API_KEY_SECRET);
  await updateConnectedContext(context);
  tree.refresh();
  vscode.window.showInformationMessage("FlagLens: API key removed from this machine.");
}

export function activate(context: vscode.ExtensionContext): void {
  const tree = new FlagTreeProvider(() => getClient(context));

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("flaglens.flags", tree),
    vscode.commands.registerCommand("flaglens.connect", () => connect(context, tree)),
    vscode.commands.registerCommand("flaglens.disconnect", () => disconnect(context, tree)),
    vscode.commands.registerCommand("flaglens.refresh", () => tree.refresh()),
    // If the API URL setting is edited by hand, reload the tree from the new server.
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("flaglens.apiUrl")) tree.refresh();
    }),
  );

  void updateConnectedContext(context);
}

export function deactivate(): void {
  // Nothing to clean up: everything registered above is disposed via context.subscriptions.
}
