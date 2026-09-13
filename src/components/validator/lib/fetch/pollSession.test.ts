import { describe, expect, test } from "bun:test";

import { pollSession } from "./session";
import {
  captureFetch,
  STORE_DOWN,
  trackedSleep,
  unreadResponse,
} from "./test-helpers";
import { jsonResponse } from "../../test-helpers/fetchStub";
import type { ValidatorFetchDeps } from "./types";

const SESSION_ID = "0193a0c2-7c1d-7b4a-8f2e-1a2b3c4d5e6f";
const CREATED = { state: "created", ts: 1, optInActive: false };

describe("pollSession", () => {
  test("GETs /api/session/{id} and keeps optional fields", async () => {
    const body = {
      state: "invite_minted",
      ts: 100,
      optInActive: true,
      nextInstruction: "paste_s1",
      failModeLabel: "ok",
    };
    const { fetchLike, calls } = captureFetch(() => jsonResponse(200, body));
    const result = await pollSession(SESSION_ID, { fetch: fetchLike });
    expect(calls[0]?.url).toBe(`/validator/api/session/${SESSION_ID}`);
    expect(calls[0]?.init.method).toBe("GET");
    expect(result).toEqual({ ok: true, status: 200, data: body });
  });

  test("maps only exact SESSION_NOT_FOUND envelopes to terminal loss", async () => {
    const { sleeps, sleep } = trackedSleep();
    const result = await pollSession(SESSION_ID, {
      fetch: captureFetch(() => jsonResponse(404, { error: "SESSION_NOT_FOUND", message: "session not found" })).fetchLike,
      sleep,
    });
    expect(sleeps).toEqual([]);
    expect(result).toMatchObject({ ok: false, kind: "session_not_found", error: "SESSION_NOT_FOUND" });
  });

  test("bare 404 and lowercase envelopes are retryable http, not terminal", async () => {
    const bare = await pollSession(SESSION_ID, {
      fetch: captureFetch(() => new Response("", { status: 404 })).fetchLike,
    });
    expect(bare).toMatchObject({ ok: false, kind: "http", status: 404, error: "http_error" });
    const lower = await pollSession(SESSION_ID, {
      fetch: captureFetch(() =>
        jsonResponse(404, { error: "session_not_found", message: "session not found" }),
      ).fetchLike,
    });
    expect(lower).toMatchObject({ ok: false, kind: "http", error: "session_not_found" });
  });

  test("maps 410 gone to terminal expiry", async () => {
    expect(await pollSession(SESSION_ID, { fetch: captureFetch(() => jsonResponse(410, { error: "gone", message: "session expired" })).fetchLike })).toMatchObject({ ok: false, kind: "expired", status: 410 });
  });

  test("unreadable 410 is terminal expired, not invalid_response", async () => {
    expect(await pollSession(SESSION_ID, { fetch: captureFetch(() => unreadResponse(410)).fetchLike })).toMatchObject({ ok: false, kind: "expired", status: 410 });
  });
  test("unreadable 404 is terminal expired, not retryable http", async () => {
    expect(await pollSession(SESSION_ID, { fetch: captureFetch(() => unreadResponse(404)).fetchLike })).toMatchObject({ ok: false, kind: "expired", status: 404 });
  });

  test("returns nested 429 envelopes with Retry-After and does not auto-retry", async () => {
    const { sleeps, sleep } = trackedSleep();
    let hits = 0;
    const result = await pollSession(SESSION_ID, {
      fetch: captureFetch(() => {
        hits += 1;
        return jsonResponse(
          429,
          { error: { code: "Too Many Requests", reasonCode: "rate_limited", message: "too many requests" } },
          { "Retry-After": "7" },
        );
      }).fetchLike,
      sleep,
    });
    expect(hits).toBe(1);
    expect(sleeps).toEqual([]);
    expect(result).toEqual({
      ok: false,
      kind: "http",
      status: 429,
      error: "rate_limited",
      message: "too many requests",
      retryAfterMs: 7000,
    });
  });

  test("retries GET 5xx with bounded exponential backoff", async () => {
    const { sleeps, sleep } = trackedSleep();
    let hits = 0;
    const result = await pollSession(SESSION_ID, {
      fetch: captureFetch(() => {
        hits += 1;
        return hits < 4
          ? jsonResponse(503, STORE_DOWN)
          : jsonResponse(200, { state: "passive_running", ts: 1, optInActive: false, nextInstruction: "wait_probe" });
      }).fetchLike,
      sleep,
    });
    expect(hits).toBe(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
    expect(result.ok).toBe(true);
  });

  test("retries GET network failures with the same backoff schedule", async () => {
    const { sleeps, sleep } = trackedSleep();
    let hits = 0;
    const result = await pollSession(SESSION_ID, {
      fetch: captureFetch(() => {
        hits += 1;
        if (hits === 1) throw new Error("socket reset");
        return jsonResponse(200, { ...CREATED, ts: 3, nextInstruction: "wait_probe" });
      }).fetchLike,
      sleep,
    });
    expect(hits).toBe(2);
    expect(sleeps).toEqual([1000]);
    expect(result.ok).toBe(true);
  });

  test("uses capped Retry-After while backing off 5xx", async () => {
    const { sleeps, sleep } = trackedSleep();
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    let hits = 0;
    const result = await pollSession(SESSION_ID, {
      fetch: captureFetch(() => {
        hits += 1;
        if (hits === 1) return jsonResponse(503, STORE_DOWN, { "Retry-After": "3" });
        if (hits === 2) {
          return jsonResponse(502, STORE_DOWN, { "Retry-After": new Date(now + 60_000).toUTCString() });
        }
        return jsonResponse(200, { ...CREATED, ts: 2, nextInstruction: "wait_probe" });
      }).fetchLike,
      now: () => now,
      sleep,
    });
    expect(result.ok).toBe(true);
    expect(sleeps).toEqual([3000, 8000]);
  });

  test("exhausts bounded 5xx retries as http", async () => {
    const { sleeps, sleep } = trackedSleep();
    let hits = 0;
    const result = await pollSession(SESSION_ID, {
      fetch: captureFetch(() => { hits += 1; return jsonResponse(503, STORE_DOWN); }).fetchLike,
      maxRetries: 2,
      sleep,
    });
    expect(hits).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
    expect(result).toMatchObject({ ok: false, kind: "http", status: 503, error: "store_error" });
  });

  test("malformed 2xx and body-read throws are invalid_response", async () => {
    const malformed = await pollSession(SESSION_ID, {
      fetch: captureFetch(() => new Response("{not-json", { status: 200 })).fetchLike,
    });
    expect(malformed).toMatchObject({ ok: false, kind: "invalid_response", status: 200 });
    const unread = await pollSession(SESSION_ID, {
      fetch: captureFetch(() => unreadResponse(200)).fetchLike,
    });
    expect(unread).toMatchObject({ ok: false, kind: "invalid_response", status: 200 });
  });

  test("retries unreadable GET 5xx then notes unreadable_body", async () => {
    const { sleeps, sleep } = trackedSleep();
    let hits = 0;
    const recovered = await pollSession(SESSION_ID, {
      fetch: captureFetch(() => {
        hits += 1;
        return hits === 1 ? unreadResponse(503) : jsonResponse(200, CREATED);
      }).fetchLike,
      sleep,
    });
    expect(hits).toBe(2);
    expect(sleeps).toEqual([1000]);
    expect(recovered.ok).toBe(true);

    hits = 0;
    sleeps.length = 0;
    const exhausted = await pollSession(SESSION_ID, {
      fetch: captureFetch(() => { hits += 1; return unreadResponse(503); }).fetchLike,
      maxRetries: 1,
      sleep,
    });
    expect(hits).toBe(2);
    expect(sleeps).toEqual([1000]);
    expect(exhausted).toMatchObject({ ok: false, kind: "http", status: 503, error: "unreadable_body" });
  });

  test("caller abort is terminal before fetch and during body read", async () => {
    const pre = new AbortController();
    pre.abort();
    let preHits = 0;
    const preResult = await pollSession(SESSION_ID, {
      fetch: captureFetch(() => { preHits += 1; return jsonResponse(200, CREATED); }).fetchLike,
      signal: pre.signal,
      maxRetries: 4,
    });
    expect(preHits).toBe(0);
    expect(preResult).toMatchObject({ ok: false, kind: "aborted", error: "aborted" });

    const mid = new AbortController();
    let midHits = 0;
    const midResult = await pollSession(SESSION_ID, {
      fetch: captureFetch(() => { midHits += 1; return jsonResponse(503, STORE_DOWN); }).fetchLike,
      signal: mid.signal,
      sleep: () => { mid.abort(); return new Promise(() => {}); },
    });
    expect(midHits).toBe(1);
    expect(midResult).toMatchObject({ ok: false, kind: "aborted" });

    const duringBody = new AbortController();
    const duringBodyResult = await pollSession(SESSION_ID, {
      fetch: captureFetch(() => unreadResponse(200, () => duringBody.abort())).fetchLike,
      signal: duringBody.signal,
    });
    expect(duringBodyResult).toMatchObject({ ok: false, kind: "aborted", error: "aborted" });
  });

  test("sleep rejection is a typed failure with or without abort", async () => {
    let hits = 0;
    const rejectSleep = async (): Promise<void> => { throw new Error("sleep rejected"); };
    const withoutSignal = await pollSession(SESSION_ID, {
      fetch: captureFetch(() => { hits += 1; return jsonResponse(503, STORE_DOWN); }).fetchLike,
      maxRetries: 2,
      sleep: rejectSleep,
    });
    expect(hits).toBe(1);
    expect(withoutSignal).toMatchObject({ ok: false, kind: "network", error: "backoff_failed" });

    hits = 0;
    const liveSignal = await pollSession(SESSION_ID, {
      fetch: captureFetch(() => { hits += 1; return jsonResponse(503, STORE_DOWN); }).fetchLike,
      signal: new AbortController().signal,
      maxRetries: 2,
      sleep: rejectSleep,
    });
    expect(hits).toBe(1);
    expect(liveSignal).toMatchObject({ ok: false, kind: "network", error: "backoff_failed" });

    const controller = new AbortController();
    hits = 0;
    const aborted = await pollSession(SESSION_ID, {
      fetch: captureFetch(() => { hits += 1; return jsonResponse(503, STORE_DOWN); }).fetchLike,
      signal: controller.signal,
      maxRetries: 2,
      sleep: async () => { controller.abort(); throw new Error("sleep rejected"); },
    });
    expect(hits).toBe(1);
    expect(aborted).toMatchObject({ ok: false, kind: "aborted" });
  });

  test("fetch timeout retries then exhausts as timeout", async () => {
    let hits = 0;
    const result = await pollSession(SESSION_ID, {
      fetch: captureFetch((_url, init) => {
        hits += 1;
        if (init.signal?.aborted) {
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        }
        return jsonResponse(200, CREATED);
      }).fetchLike,
      timeoutMs: 5,
      maxRetries: 2,
      sleep: async () => undefined,
      setTimeout: (handler) => { handler(); return 0; },
      clearTimeout: () => undefined,
    });
    expect(hits).toBe(3);
    expect(result).toMatchObject({ ok: false, kind: "timeout", error: "timeout" });
  });

  test("timeout during body read retries then exhausts as timeout", async () => {
    const { sleeps, sleep } = trackedSleep();
    let hits = 0;
    let fireTimeout: (() => void) | undefined;
    const clock: Pick<ValidatorFetchDeps, "timeoutMs" | "sleep" | "setTimeout" | "clearTimeout"> = {
      timeoutMs: 25,
      sleep,
      setTimeout: (handler) => {
        fireTimeout = handler;
        return 0;
      },
      clearTimeout: () => { fireTimeout = undefined; },
    };
    const hangBody = (init: RequestInit): Response => {
      expect(init.signal?.aborted).toBe(false);
      const response = new Response("{}", { status: 200 });
      const fail = async (): Promise<string> => {
        fireTimeout?.();
        expect(init.signal?.aborted).toBe(true);
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      };
      Object.defineProperty(response, "text", { value: fail });
      Object.defineProperty(response, "json", { value: fail });
      return response;
    };

    const recovered = await pollSession(SESSION_ID, {
      fetch: captureFetch((_url, init) => {
        hits += 1;
        return hits === 1 ? hangBody(init) : jsonResponse(200, CREATED);
      }).fetchLike,
      signal: new AbortController().signal,
      ...clock,
    });
    expect(hits).toBe(2);
    expect(sleeps).toEqual([1000]);
    expect(recovered.ok).toBe(true);

    hits = 0;
    sleeps.length = 0;
    const exhausted = await pollSession(SESSION_ID, {
      fetch: captureFetch((_url, init) => {
        hits += 1;
        return hangBody(init);
      }).fetchLike,
      signal: new AbortController().signal,
      maxRetries: 2,
      ...clock,
    });
    expect(hits).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
    expect(exhausted).toMatchObject({ ok: false, kind: "timeout", error: "timeout" });
  });
});
