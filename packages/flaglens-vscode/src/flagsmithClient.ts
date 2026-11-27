// Typed client for the Flagsmith Management (Admin) API.
//
// Deliberately has NO dependency on `vscode`, so it can be unit-tested with plain Node.
// Every endpoint here was checked against the running instance's schema
// (GET /api/v1/swagger.json on Flagsmith 2.295.2).
//
// Auth: an Organisation API key, sent as `Authorization: Api-Key <key>`.

export interface Organisation {
  id: number;
  name: string;
}

export interface Project {
  id: number;
  name: string;
  organisation: number;
}

export interface Environment {
  id: number;
  name: string;
  /** The environment's client-side SDK key. Also used in Management API paths. */
  api_key: string;
  project: number;
  /** v2 versioning changes how flags are edited. FlagLens only toggles v1 environments. */
  use_v2_feature_versioning: boolean;
}

export type FlagValue = string | number | boolean | null;

/** A flag's state in one environment (its environment default, not segment/identity overrides). */
export interface EnvironmentFeatureState {
  /** Feature-state id; this is what gets PATCHed to toggle the flag. */
  id: number;
  enabled: boolean;
  feature_state_value: FlagValue;
}

/** How many references to the flag the latest scan of one repository found. */
export interface CodeReferenceCount {
  repository_url: string;
  count: number;
}

export interface Feature {
  id: number;
  name: string;
  type: "STANDARD" | "MULTIVARIATE";
  description: string | null;
  /** Only filled when the list is requested with `?environment=<id>`. */
  environment_feature_state: EnvironmentFeatureState | null;
  code_references_counts: CodeReferenceCount[];
  /** Archived flags are still listed (and still served to SDKs); checked on 2.295.2. */
  is_archived?: boolean;
}

/** Thrown for any non-2xx response, so callers can react to e.g. 401 vs 404. */
export class FlagsmithApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "FlagsmithApiError";
    this.status = status;
  }
}

/** Shape of Flagsmith's paginated list responses (organisations, environments, ...). */
interface Page<T> {
  count: number;
  next: string | null;
  results: T[];
}

/**
 * Accepts "http://host:8000", "http://host:8000/", "http://host:8000/api/v1" etc.
 * and always returns "http://host:8000/api/v1" (no trailing slash).
 */
export function normaliseApiUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
}

export class FlagsmithClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;

  /** `fetchFn` is injectable so tests can fake the network. */
  constructor(apiUrl: string, apiKey: string, fetchFn: typeof fetch = fetch) {
    this.baseUrl = normaliseApiUrl(apiUrl);
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
  }

  /** GET /api/v1/organisations/ (paginated) */
  listOrganisations(): Promise<Organisation[]> {
    return this.getAll<Organisation>("/organisations/");
  }

  /** GET /api/v1/projects/ (plain array: this endpoint is not paginated) */
  listProjects(): Promise<Project[]> {
    return this.getAll<Project>("/projects/");
  }

  /** GET /api/v1/environments/?project=<id> (paginated) */
  listEnvironments(projectId: number): Promise<Environment[]> {
    return this.getAll<Environment>(`/environments/?project=${projectId}`);
  }

  /**
   * GET /api/v1/projects/<id>/features/?environment=<env id> (paginated).
   * Passing the environment makes Flagsmith include each flag's state in that environment.
   */
  listFeatures(projectId: number, environmentId: number): Promise<Feature[]> {
    return this.getAll<Feature>(`/projects/${projectId}/features/?environment=${environmentId}`);
  }

  /**
   * POST /api/v1/projects/<id>/features/ with {"name", "default_enabled": false}.
   * Flagsmith gives the new flag an "off" state in every environment (checked live on 2.295.2).
   */
  createFeature(projectId: number, name: string): Promise<{ id: number; name: string }> {
    return this.request(`${this.baseUrl}/projects/${projectId}/features/`, {
      method: "POST",
      body: { name, default_enabled: false },
    });
  }

  /**
   * PATCH /api/v1/projects/<id>/features/<feature id>/ with {"is_archived": true}.
   * Schema: PatchedUpdateFeature, no required fields (checked on 2.295.2). Archiving applies to
   * every environment; it can be undone in the dashboard.
   */
  archiveFeature(projectId: number, featureId: number): Promise<{ id: number; is_archived: boolean }> {
    return this.request(`${this.baseUrl}/projects/${projectId}/features/${featureId}/`, {
      method: "PATCH",
      body: { is_archived: true },
    });
  }

  /**
   * POST /api/v1/projects/<id>/code-references/
   * The latest scan per repository replaces the previous one, so this is ALWAYS sent,
   * even with an empty list: that's how references to deleted code get cleared.
   */
  pushCodeReferences(
    projectId: number,
    scan: {
      repository_url: string;
      revision: string;
      code_references: Array<{ feature_name: string; file_path: string; line_number: number }>;
    },
  ): Promise<unknown> {
    return this.request(`${this.baseUrl}/projects/${projectId}/code-references/`, {
      method: "POST",
      body: { ...scan, vcs_provider: "github" }, // the only provider Flagsmith 2.295.2 accepts
    });
  }

  /** GET /api/v1/environments/<env api key>/featurestates/<id>/ : the flag's current state. */
  getFeatureState(
    environmentApiKey: string,
    featureStateId: number,
  ): Promise<{ id: number; enabled: boolean; feature_state_value: FlagValue }> {
    return this.request(`${this.baseUrl}/environments/${environmentApiKey}/featurestates/${featureStateId}/`);
  }

  /**
   * PATCH /api/v1/environments/<env api key>/featurestates/<id>/ with {"enabled": ...}.
   * Only valid for environments WITHOUT v2 feature versioning (see CLAUDE.md).
   */
  setFeatureStateEnabled(
    environmentApiKey: string,
    featureStateId: number,
    enabled: boolean,
  ): Promise<{ enabled: boolean }> {
    return this.request(`${this.baseUrl}/environments/${environmentApiKey}/featurestates/${featureStateId}/`, {
      method: "PATCH",
      body: { enabled },
    });
  }

  /**
   * Fetches a list endpoint and follows `next` links until every page is read.
   * Some endpoints return a bare array instead of a page; both are handled.
   */
  private async getAll<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    let url: string | null = this.baseUrl + path;

    while (url) {
      const body: T[] | Page<T> = await this.request<T[] | Page<T>>(url);
      if (Array.isArray(body)) {
        return body;
      }
      items.push(...body.results);
      url = body.next ? this.sameOrigin(body.next) : null;
    }
    return items;
  }

  /**
   * Flagsmith builds `next` from its own idea of its hostname, which can differ from
   * the URL the user configured (e.g. Docker internal names). Keep the path and query,
   * but always talk to the configured host.
   */
  private sameOrigin(nextUrl: string): string {
    const next = new URL(nextUrl);
    const base = new URL(this.baseUrl);
    return `${base.origin}${next.pathname}${next.search}`;
  }

  /** Sends one request. GET by default; pass `method` and a JSON `body` for writes. */
  private async request<T>(url: string, options: { method?: "GET" | "PATCH" | "POST"; body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Api-Key ${this.apiKey}`, Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (err) {
      // fetch only rejects on network failure (server down, DNS, refused connection).
      const reason = err instanceof Error ? err.message : String(err);
      throw new FlagsmithApiError(0, `Cannot reach Flagsmith at ${this.baseUrl} (${reason})`);
    }

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      const hint =
        res.status === 401 || res.status === 403
          ? " Check that you used an Organisation API key, not an environment key."
          : "";
      throw new FlagsmithApiError(res.status, `Flagsmith returned HTTP ${res.status}: ${detail}${hint}`);
    }
    return (await res.json()) as T;
  }
}
