// Unit tests for the Flagsmith client, using a fake fetch (no network, no VS Code).
// Run with: npm test

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FlagsmithApiError, FlagsmithClient, normaliseApiUrl } from "../src/flagsmithClient.ts";

interface Recorded {
  url: string;
  headers: Headers;
}

/** Builds a fake fetch that answers from a URL → [status, body] table and records each call. */
function fakeFetch(routes: Record<string, [number, unknown]>): { fetchFn: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    const [status, body] = route;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const BASE = "http://localhost:8000/api/v1";

describe("normaliseApiUrl", () => {
  it("adds /api/v1 and strips trailing slashes", () => {
    assert.equal(normaliseApiUrl("http://localhost:8000"), BASE);
    assert.equal(normaliseApiUrl("http://localhost:8000/"), BASE);
    assert.equal(normaliseApiUrl("http://localhost:8000/api/v1/"), BASE);
    assert.equal(normaliseApiUrl("  http://localhost:8000/api/v1  "), BASE);
  });
});

describe("FlagsmithClient", () => {
  it("sends the Organisation key as an Api-Key Authorization header", async () => {
    const { fetchFn, calls } = fakeFetch({ [`${BASE}/projects/`]: [200, []] });
    await new FlagsmithClient("http://localhost:8000", "org-key-123", fetchFn).listProjects();
    assert.equal(calls[0]?.headers.get("Authorization"), "Api-Key org-key-123");
  });

  it("reads plain-array responses (projects)", async () => {
    const { fetchFn } = fakeFetch({
      [`${BASE}/projects/`]: [200, [{ id: 1, name: "Toggle Wars", organisation: 1 }]],
    });
    const projects = await new FlagsmithClient(BASE, "k", fetchFn).listProjects();
    assert.deepEqual(projects.map((p) => p.name), ["Toggle Wars"]);
  });

  it("follows `next` links across pages, rewriting them to the configured host", async () => {
    const { fetchFn, calls } = fakeFetch({
      [`${BASE}/environments/?project=1`]: [
        200,
        // Flagsmith may advertise an internal hostname in `next`.
        { count: 2, next: "http://flagsmith:8000/api/v1/environments/?page=2&project=1", results: [{ id: 1, name: "Development", api_key: "dev", project: 1 }] },
      ],
      [`${BASE}/environments/?page=2&project=1`]: [
        200,
        { count: 2, next: null, results: [{ id: 2, name: "Production", api_key: "prod", project: 1 }] },
      ],
    });
    const envs = await new FlagsmithClient(BASE, "k", fetchFn).listEnvironments(1);
    assert.deepEqual(envs.map((e) => e.name), ["Development", "Production"]);
    assert.equal(calls[1]?.url, `${BASE}/environments/?page=2&project=1`);
  });

  it("throws FlagsmithApiError with a key hint on 401", async () => {
    const { fetchFn } = fakeFetch({ [`${BASE}/organisations/`]: [401, { detail: "Invalid API key" }] });
    await assert.rejects(new FlagsmithClient(BASE, "bad", fetchFn).listOrganisations(), (err: unknown) => {
      assert.ok(err instanceof FlagsmithApiError);
      assert.equal(err.status, 401);
      assert.match(err.message, /Organisation API key/);
      return true;
    });
  });

  it("reports an unreachable server as status 0", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await assert.rejects(new FlagsmithClient(BASE, "k", failing).listProjects(), (err: unknown) => {
      assert.ok(err instanceof FlagsmithApiError);
      assert.equal(err.status, 0);
      assert.match(err.message, /Cannot reach Flagsmith/);
      return true;
    });
  });
});
