import { describe, expect, test } from "bun:test";

import {
  fetchStatistics,
  type FetchLike,
  type ValidatorFetchDeps,
} from "./validatorFetch";
import { parseValidatorStatistics } from "./validatorStatistics";

const STORE_DOWN = { error: "store_error", message: "down" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function captureFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchLike: FetchLike = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetchLike, calls };
}

function trackedSleep(): { sleeps: number[]; sleep: NonNullable<ValidatorFetchDeps["sleep"]> } {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms) => { sleeps.push(ms); } };
}

function validStatistics(): Record<string, unknown> {
  return {
    schema: "federation_tester_statistics.v1",
    window: { days: 14, from: 1, to: 2, selector: "14" },
    totals: { sessions: 10, uniqueHosts: 4, healthyPct: 50 },
    platforms: [{ platform: "nextcloud", count: 3, pct: 30 }],
    areas: [{ area: "tls", pass: 2, warn: 1, fail: 0 }],
    daily: [{ ts: 1, sessions: 2, healthyPct: 50 }],
  };
}

describe("fetchStatistics", () => {
  test("GETs /api/statistics with the default days query", async () => {
    const body = validStatistics();
    const { fetchLike, calls } = captureFetch(() => jsonResponse(200, body));
    const result = await fetchStatistics(undefined, { fetch: fetchLike });
    const parsed = parseValidatorStatistics(body);
    expect(calls[0]?.url).toBe("/validator/api/statistics?days=14");
    if (parsed === null) {
      throw new Error("valid statistics fixture failed to parse");
    }
    expect(result).toEqual({ ok: true, status: 200, data: parsed });
  });

  test("encodes numeric and string days selectors, including all-time 0", async () => {
    const body = validStatistics();
    const run = async (days: string | number) => {
      const { fetchLike, calls } = captureFetch(() => jsonResponse(200, body));
      await fetchStatistics(days, { fetch: fetchLike });
      return calls[0]?.url;
    };
    expect(await run(7)).toBe("/validator/api/statistics?days=7");
    expect(await run("30")).toBe("/validator/api/statistics?days=30");
    expect(await run(0)).toBe("/validator/api/statistics?days=0");
    expect(await run("")).toBe("/validator/api/statistics?days=14");
  });

  test("malformed 2xx bodies are invalid_response", async () => {
    const missing = await fetchStatistics(14, {
      fetch: captureFetch(() => jsonResponse(200, { schema: "federation_tester_statistics.v1" })).fetchLike,
    });
    expect(missing).toMatchObject({ ok: false, kind: "invalid_response", status: 200 });
    const broken = await fetchStatistics(14, {
      fetch: captureFetch(() => new Response("{not-json", { status: 200 })).fetchLike,
    });
    expect(broken).toMatchObject({ ok: false, kind: "invalid_response", status: 200 });
  });

  test("maps a flat error envelope without retrying 4xx", async () => {
    const { sleeps, sleep } = trackedSleep();
    let hits = 0;
    const result = await fetchStatistics(14, {
      fetch: captureFetch(() => {
        hits += 1;
        return jsonResponse(400, { error: "bad_window", message: "unknown days" });
      }).fetchLike,
      sleep,
    });
    expect(hits).toBe(1);
    expect(sleeps).toEqual([]);
    expect(result).toEqual({
      ok: false,
      kind: "http",
      status: 400,
      error: "bad_window",
      message: "unknown days",
    });
  });

  test("retries GET 5xx with bounded exponential backoff", async () => {
    const { sleeps, sleep } = trackedSleep();
    const body = validStatistics();
    let hits = 0;
    const result = await fetchStatistics(14, {
      fetch: captureFetch(() => {
        hits += 1;
        return hits < 4 ? jsonResponse(503, STORE_DOWN) : jsonResponse(200, body);
      }).fetchLike,
      sleep,
    });
    expect(hits).toBe(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
    expect(result.ok).toBe(true);
  });

  test("caller abort is terminal before fetch and during backoff", async () => {
    const pre = new AbortController();
    pre.abort();
    let preHits = 0;
    const preResult = await fetchStatistics(14, {
      fetch: captureFetch(() => {
        preHits += 1;
        return jsonResponse(200, validStatistics());
      }).fetchLike,
      signal: pre.signal,
    });
    expect(preHits).toBe(0);
    expect(preResult).toMatchObject({ ok: false, kind: "aborted" });

    const mid = new AbortController();
    let midHits = 0;
    const midResult = await fetchStatistics(14, {
      fetch: captureFetch(() => {
        midHits += 1;
        return jsonResponse(503, STORE_DOWN);
      }).fetchLike,
      signal: mid.signal,
      maxRetries: 2,
      sleep: () => {
        mid.abort();
        return new Promise(() => {});
      },
    });
    expect(midHits).toBe(1);
    expect(midResult).toMatchObject({ ok: false, kind: "aborted" });
  });
});
