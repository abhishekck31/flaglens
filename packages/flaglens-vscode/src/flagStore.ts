// In-memory snapshot of one project's flags in every environment.
// CodeLens reads from it (it must answer instantly, without network calls per keystroke).

import * as vscode from "vscode";
import type { Environment, Feature, FlagsmithClient, Project } from "./flagsmithClient.ts";

export interface ProjectSnapshot {
  project: Project;
  environments: Environment[];
  /** Flags keyed by environment id. */
  featuresByEnvironment: Map<number, Feature[]>;
}

export class FlagStore {
  private snapshot: ProjectSnapshot | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires after every reload, so CodeLens can redraw. */
  readonly onDidChange = this.changed.event;
  private readonly getClient: () => Promise<FlagsmithClient | undefined>;

  constructor(getClient: () => Promise<FlagsmithClient | undefined>) {
    this.getClient = getClient;
  }

  get current(): ProjectSnapshot | undefined {
    return this.snapshot;
  }

  /**
   * Loads the project chosen by the `flaglens.projectId` setting (or the first project)
   * with its environments and their flags.
   */
  async reload(): Promise<void> {
    try {
      const client = await this.getClient();
      this.snapshot = client ? await loadSnapshot(client) : undefined;
    } catch (err) {
      // The tree shows connection errors to the user; here we just stop showing CodeLens.
      console.warn("FlagLens: could not load flags", err);
      this.snapshot = undefined;
    }
    this.changed.fire();
  }

  flagNames(): Set<string> {
    const names = new Set<string>();
    for (const features of this.snapshot?.featuresByEnvironment.values() ?? []) {
      for (const feature of features) names.add(feature.name);
    }
    return names;
  }

  find(environmentId: number, featureName: string): { environment: Environment; feature: Feature } | undefined {
    const environment = this.snapshot?.environments.find((e) => e.id === environmentId);
    const feature = this.snapshot?.featuresByEnvironment.get(environmentId)?.find((f) => f.name === featureName);
    return environment && feature ? { environment, feature } : undefined;
  }
}

async function loadSnapshot(client: FlagsmithClient): Promise<ProjectSnapshot | undefined> {
  const projects = await client.listProjects();
  const wantedId = vscode.workspace.getConfiguration("flaglens").get<number>("projectId", 0);
  const project = projects.find((p) => p.id === wantedId) ?? projects[0];
  if (!project) return undefined;

  const environments = await client.listEnvironments(project.id);
  // One request per environment, sent in parallel.
  const lists = await Promise.all(environments.map((env) => client.listFeatures(project.id, env.id)));

  const featuresByEnvironment = new Map<number, Feature[]>();
  environments.forEach((env, i) => featuresByEnvironment.set(env.id, lists[i] ?? []));
  return { project, environments, featuresByEnvironment };
}
