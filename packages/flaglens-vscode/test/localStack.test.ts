import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { findComposeRoot, healthUrl, isHealthy, waitUntilHealthy } from "../src/localStack.ts";

describe("healthUrl", () => {
  it("is the API host's /health/liveness/", () => {
    assert.equal(healthUrl("http://localhost:8000/api/v1/"), "http://localhost:8000/health/liveness/");
  });
});

describe("waitUntilHealthy", () => {
  const noSleep = async () => {};

  it("returns healthy as soon as a probe answers 200", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      if (calls < 3) throw new Error("ECONNREFUSED"); // not listening yet
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    assert.equal(await waitUntilHealthy("u", { fetchFn, sleep: noSleep }), "healthy");
    assert.equal(calls, 3);
  });

  it("times out when it never answers 200", async () => {
    const fetchFn = (async () => new Response("starting", { status: 503 })) as unknown as typeof fetch;
    assert.equal(await waitUntilHealthy("u", { fetchFn, sleep: noSleep, intervalMs: 10, timeoutMs: 50 }), "timeout");
  });

  it("stops when cancelled", async () => {
    let cancelled = false;
    const fetchFn = (async () => {
      cancelled = true;
      return new Response("", { status: 503 });
    }) as unknown as typeof fetch;
    assert.equal(await waitUntilHealthy("u", { fetchFn, sleep: noSleep, isCancelled: () => cancelled }), "cancelled");
  });

  it("isHealthy treats network errors as not healthy", async () => {
    const fetchFn = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    assert.equal(await isHealthy("u", fetchFn), false);
  });
});

describe("findComposeRoot", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "flaglens-stack-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(path.join(dir, "docker-compose.yml"), "services: {}\n");
  mkdirSync(path.join(dir, "apps", "web"), { recursive: true });

  it("finds docker-compose.yml in the opened folder or its repo root", async () => {
    const real = (p: string | undefined) => (p ? path.resolve(p).toLowerCase() : p);
    assert.equal(real(await findComposeRoot(dir)), real(dir));
    assert.equal(real(await findComposeRoot(path.join(dir, "apps", "web"))), real(dir));
  });

  it("returns undefined outside a repo without a compose file", async () => {
    const lone = mkdtempSync(path.join(tmpdir(), "flaglens-lone-"));
    try {
      assert.equal(await findComposeRoot(lone), undefined);
    } finally {
      rmSync(lone, { recursive: true, force: true });
    }
  });
});
