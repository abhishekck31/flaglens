// "FlagLens: Start local Flagsmith", "Open dashboard" and "Open demo file" (VS Code wiring).

import path from "node:path";
import { access } from "node:fs/promises";
import * as vscode from "vscode";
import { dashboardBaseUrl } from "./format.ts";
import { findComposeRoot, healthUrl, isHealthy, runningServices, waitUntilHealthy } from "./localStack.ts";

export interface StackDeps {
  getApiUrl: () => string;
  /** The saved Organisation API key, if connected (passed to the seed script, never printed). */
  getApiKey: () => Promise<string | undefined>;
}

function dashboardUrl(deps: StackDeps): string {
  return dashboardBaseUrl(deps.getApiUrl(), vscode.workspace.getConfiguration("flaglens").get<string>("dashboardUrl", ""));
}

export async function openDashboard(deps: StackDeps): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(dashboardUrl(deps)));
}

export async function startLocalFlagsmith(deps: StackDeps): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const root = folder ? await findComposeRoot(folder.uri.fsPath) : undefined;
  if (!root) {
    void vscode.window.showErrorMessage(
      "FlagLens: no docker-compose.yml in this folder or its git repository. Open the FlagLens repo (or your own Flagsmith compose folder).",
    );
    return;
  }
  const url = healthUrl(deps.getApiUrl());

  // 1. Is something already running? Read-only checks: a health probe and `docker compose ps`.
  let services: string[];
  try {
    services = await runningServices(root);
  } catch {
    void vscode.window.showErrorMessage("FlagLens: `docker compose` failed. Is Docker Desktop running?");
    return;
  }
  const healthy = await isHealthy(url);

  let runUp = true;
  if (healthy || services.length > 0) {
    // Never touch a running stack without asking. We only ever offer `up -d` (which leaves running
    // containers alone); FlagLens never stops or restarts it.
    const what = healthy ? `Flagsmith is already answering at ${dashboardUrl(deps)}.` : `Running services: ${services.join(", ")}.`;
    const choice = await vscode.window.showWarningMessage(
      "Flagsmith is already running",
      { modal: true, detail: `${what}\n\nFlagLens won't stop or restart it. Use it as it is, or run "docker compose up -d" in ${root} anyway?` },
      "Use it as is",
      "Run docker compose up -d",
    );
    if (!choice) return;
    runUp = choice === "Run docker compose up -d";
  }

  // 2. Start it in a visible terminal, so the user sees docker's own output.
  if (runUp) {
    const terminal = vscode.window.createTerminal({ name: "Flagsmith (docker compose)", cwd: root });
    terminal.show(true);
    terminal.sendText("docker compose up -d");
  }

  // 3. Poll the liveness endpoint.
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Waiting for Flagsmith (first start can take a few minutes)…", cancellable: true },
    (_progress, token) => waitUntilHealthy(url, { isCancelled: () => token.isCancellationRequested }),
  );
  if (result === "cancelled") return;
  if (result === "timeout") {
    void vscode.window.showErrorMessage(`FlagLens: Flagsmith didn't become healthy at ${url}. Check the terminal or \`docker compose logs flagsmith\`.`);
    return;
  }

  // 4. Offer the next steps.
  const hasSeed = await fileExists(path.join(root, "scripts", "seed.mjs"));
  const actions = hasSeed ? ["Seed demo data", "Open dashboard"] : ["Open dashboard"];
  const next = await vscode.window.showInformationMessage(`FlagLens: Flagsmith is running at ${dashboardUrl(deps)}.`, ...actions);
  if (next === "Open dashboard") return openDashboard(deps);
  if (next === "Seed demo data") return seed(root, deps);
}

async function seed(root: string, deps: StackDeps): Promise<void> {
  const apiKey = await deps.getApiKey();
  const hasEnvFile = await fileExists(path.join(root, "flagsmith.env"));
  if (!apiKey && !hasEnvFile) {
    const choice = await vscode.window.showWarningMessage(
      "Seeding needs an Organisation API key. Sign up in the dashboard, create a key (Organisation Settings → API Keys), then Connect FlagLens and seed again.",
      "Open dashboard",
      "Connect",
    );
    if (choice === "Open dashboard") await openDashboard(deps);
    if (choice === "Connect") await vscode.commands.executeCommand("flaglens.connect");
    return;
  }
  // The key goes in the terminal's environment, not on the command line, so it isn't echoed.
  // (seed.mjs reads FLAGSMITH_API_KEY when flagsmith.env doesn't set one.)
  const terminal = vscode.window.createTerminal({
    name: "Flagsmith seed",
    cwd: root,
    env: apiKey ? { FLAGSMITH_API_KEY: apiKey } : {},
  });
  terminal.show(true);
  terminal.sendText("npm run seed");
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** Opens the demo store's flag file at the intentional typo (for the walkthrough). */
export async function openDemoFile(): Promise<void> {
  const [uri] = await vscode.workspace.findFiles("**/apps/demo-store/src/components/FlagsmithProvider.tsx", "**/node_modules/**", 1);
  if (!uri) {
    void vscode.window.showWarningMessage("FlagLens: the demo store isn't in this workspace. Open the FlagLens repository folder.");
    return;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  const offset = doc.getText().indexOf("checkout_cta_varient");
  const editor = await vscode.window.showTextDocument(doc);
  if (offset >= 0) {
    const start = doc.positionAt(offset);
    editor.selection = new vscode.Selection(start, start.translate(0, "checkout_cta_varient".length));
    editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenter);
  }
}
