import { describe, expect, test } from "bun:test";

import { fetchManifest } from "./validatorFetch";
import { parseValidatorManifest } from "./validatorManifest";
import { captureFetch, STORE_DOWN, trackedSleep } from "./fetch/test-helpers";
import { jsonResponse } from "../test-helpers/fetchStub";

function validManifest(): Record<string, unknown> {
  return {
    schema: "federation_tester_manifest.v1",
    apiVersion: "v1",
    servicePrefix: "/validator",
    optIn: {
      default: "off",
      start: {
        optInStats: { type: "boolean", default: false },
        optInPermanent: { type: "boolean", default: false },
      },
      scan: { statsQuery: "stats", permanentQuery: "permanent", optInValue: "1" },
    },
    retention: {
      tiers: ["ephemeral"],
      defaultTier: "ephemeral",
      clock: "utc",
      patchPath: "/retention",
      lockPath: "/lock",
    },
    report: { htmlPath: "/report/{id}", apiPath: "/api/report/{id}" },
    statistics: {
      schema: "federation_tester_statistics.v1",
      timeframesDays: [7, 14, 30],
      defaultDays: 14,
      kAnonymityUniqueHosts: 5,
      unknownPlatformExempt: true,
    },
    routes: [{ method: "GET", fullPath: "/api/manifest" }],
    reverseInvite: { available: true },
    platform: { available: true },
    tlsSummary: { available: false },
    sessionKind: { supported: ["passive"], scanDefault: "passive" },
    nextInstruction: { created: "wait_probe" },
  };
}

describe("fetchManifest", () => {
  test("GETs /api/manifest and returns a typed payload", async () => {
    const body = validManifest();
    const { fetchLike, calls } = captureFetch(() => jsonResponse(200, body));
    const result = await fetchManifest({ fetch: fetchLike, origin: "https://api.example.com" });
    const parsed = parseValidatorManifest(body);
    expect(calls[0]?.url).toBe("https://api.example.com/validator/api/manifest");
    expect(calls[0]?.init.method).toBe("GET");
    if (parsed === null) {
      throw new Error("valid manifest fixture failed to parse");
    }
    expect(result).toEqual({ ok: true, status: 200, data: parsed });
  });

  test("malformed 2xx bodies are invalid_response", async () => {
    const missing = await fetchManifest({
      fetch: captureFetch(() => jsonResponse(200, { schema: "federation_tester_manifest.v1" })).fetchLike,
    });
    expect(missing).toMatchObject({ ok: false, kind: "invalid_response", status: 200 });
    const broken = await fetchManifest({
      fetch: captureFetch(() => new Response("{not-json", { status: 200 })).fetchLike,
    });
    expect(broken).toMatchObject({ ok: false, kind: "invalid_response", status: 200 });
  });

  test("maps a flat error envelope without retrying 4xx", async () => {
    const { sleeps, sleep } = trackedSleep();
    let hits = 0;
    const result = await fetchManifest({
      fetch: captureFetch(() => {
        hits += 1;
        return jsonResponse(404, { error: "not_found", message: "no manifest" });
      }).fetchLike,
      sleep,
    });
    expect(hits).toBe(1);
    expect(sleeps).toEqual([]);
    expect(result).toEqual({
      ok: false,
      kind: "http",
      status: 404,
      error: "not_found",
      message: "no manifest",
    });
  });

  test("retries GET 5xx with bounded exponential backoff", async () => {
    const { sleeps, sleep } = trackedSleep();
    const body = validManifest();
    let hits = 0;
    const result = await fetchManifest({
      fetch: captureFetch(() => {
        hits += 1;
        return hits < 3 ? jsonResponse(503, STORE_DOWN) : jsonResponse(200, body);
      }).fetchLike,
      sleep,
    });
    expect(hits).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
    expect(result.ok).toBe(true);
  });

  test("exhausts bounded 5xx retries as http", async () => {
    const { sleeps, sleep } = trackedSleep();
    let hits = 0;
    const result = await fetchManifest({
      fetch: captureFetch(() => {
        hits += 1;
        return jsonResponse(503, STORE_DOWN);
      }).fetchLike,
      maxRetries: 2,
      sleep,
    });
    expect(hits).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
    expect(result).toMatchObject({ ok: false, kind: "http", status: 503, error: "store_error" });
  });

  test("caller abort is terminal before fetch and during backoff", async () => {
    const pre = new AbortController();
    pre.abort();
    let preHits = 0;
    const preResult = await fetchManifest({
      fetch: captureFetch(() => {
        preHits += 1;
        return jsonResponse(200, validManifest());
      }).fetchLike,
      signal: pre.signal,
    });
    expect(preHits).toBe(0);
    expect(preResult).toMatchObject({ ok: false, kind: "aborted" });

    const mid = new AbortController();
    let midHits = 0;
    const midResult = await fetchManifest({
      fetch: captureFetch(() => {
        midHits += 1;
        return jsonResponse(503, STORE_DOWN);
      }).fetchLike,
      signal: mid.signal,
      sleep: () => {
        mid.abort();
        return new Promise(() => {});
      },
    });
    expect(midHits).toBe(1);
    expect(midResult).toMatchObject({ ok: false, kind: "aborted" });
  });
});
