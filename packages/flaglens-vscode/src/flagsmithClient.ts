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

  private async request<T>(url: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        headers: { Authorization: `Api-Key ${this.apiKey}`, Accept: "application/json" },
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
