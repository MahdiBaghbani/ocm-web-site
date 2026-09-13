import { describe, expect, test } from "bun:test";

import {
  claimInvite,
  fetchReport,
  isReportNotPublicFailure,
  joinValidatorUrl,
  normalizeReportVisibility,
  parseErrorEnvelope,
  parseRetryAfter,
  pollSession,
  postReverseInvite,
  resolvePublicReportUrl,
  startSession,
  stopSession,
  waitForBackoff,
  type ReportResponse,
  type ValidatorFetchDeps,
} from "./validatorFetch";
import { captureFetch, STORE_DOWN, trackedSleep, unreadResponse } from "./fetch/test-helpers";
import { jsonResponse } from "../test-helpers/fetchStub";

const SESSION_ID = "0193a0c2-7c1d-7b4a-8f2e-1a2b3c4d5e6f";
const CREATED = { state: "created", ts: 1, optInActive: false };

describe("joinValidatorUrl", () => {
  test("joins same-origin and absolute origins onto /validator", () => {
    expect(joinValidatorUrl("", "/start")).toBe("/validator/start");
    expect(joinValidatorUrl("https://api.example.com/", "/api/session/abc")).toBe(
      "https://api.example.com/validator/api/session/abc",
    );
  });
});

describe("error envelopes and Retry-After", () => {
  test("parses the flat ocmgo envelope and the nested API envelope", () => {
    expect(parseErrorEnvelope({ error: "session_not_found", message: "session not found" })).toEqual({
      error: "session_not_found",
      message: "session not found",
    });
    expect(parseErrorEnvelope({
      error: { code: "Too Many Requests", reasonCode: "rate_limited", message: "too many requests" },
    })).toEqual({ error: "rate_limited", message: "too many requests", reasonCode: "rate_limited" });
    expect(parseErrorEnvelope({ error: "report_not_public" })).toEqual({
      error: "report_not_public",
      message: "",
    });
  });

  test("parses Retry-After seconds and HTTP dates", () => {
    expect(parseRetryAfter("12", 0)).toBe(12_000);
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(parseRetryAfter(new Date(now + 4000).toUTCString(), now)).toBe(4000);
    expect(parseRetryAfter("not-a-date", now)).toBeUndefined();
  });
});

describe("startSession", () => {
  test("POSTs target plus optInActive and reads the create body", async () => {
    const { fetchLike, calls } = captureFetch(() =>
      jsonResponse(201, { id: SESSION_ID, optInStats: true, optInPermanent: false }),
    );
    const result = await startSession(
      { target: "https://peer.example", optInActive: true, optInStats: true },
      { fetch: fetchLike, origin: "https://api.example.com" },
    );
    expect(result).toEqual({
      ok: true,
      status: 201,
      data: { id: SESSION_ID, optInStats: true, optInPermanent: false },
    });
    expect(calls[0]?.url).toBe("https://api.example.com/validator/start");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBe(
      JSON.stringify({ target: "https://peer.example", optInActive: true, optInStats: true }),
    );
  });

  test("does not retry POST 5xx", async () => {
    const { sleeps, sleep } = trackedSleep();
    let hits = 0;
    const result = await startSession(
      { target: "https://peer.example", optInActive: false },
      { fetch: captureFetch(() => { hits += 1; return jsonResponse(503, STORE_DOWN); }).fetchLike, sleep },
    );
    expect(hits).toBe(1);
    expect(sleeps).toEqual([]);
    expect(result).toMatchObject({ ok: false, kind: "http", error: "store_error" });
  });
});

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

describe("waitForBackoff", () => {
  test("uses an injected timer and returns aborted when cancelled", async () => {
    let cleared = false;
    await expect(waitForBackoff(50, {
      setTimeoutFn: (handler) => { handler(); return 1; },
      clearTimeoutFn: () => { cleared = true; },
    })).resolves.toEqual({ ok: true });
    expect(cleared).toBe(true);
    const controller = new AbortController();
    const pending = waitForBackoff(60_000, { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toEqual({ ok: false, reason: "aborted" });
  });
});

describe("stopSession", () => {
  test("POSTs {id} to /stop", async () => {
    const { fetchLike, calls } = captureFetch(() => jsonResponse(200, { id: SESSION_ID, state: "interrupted" }));
    const result = await stopSession(SESSION_ID, { fetch: fetchLike });
    expect(calls[0]?.url).toBe("/validator/stop");
    expect(calls[0]?.init.body).toBe(JSON.stringify({ id: SESSION_ID }));
    expect(result).toEqual({ ok: true, status: 200, data: { id: SESSION_ID, state: "interrupted" } });
  });
});

describe("fetchReport", () => {
  test("GETs /api/report/{id}", async () => {
    const data: ReportResponse = {
      schema: "federation_tester_report.v1",
      id: SESSION_ID,
      visibility: "session",
      score: { grade: null },
    };
    const { fetchLike, calls } = captureFetch(() => jsonResponse(200, data));
    expect(await fetchReport(SESSION_ID, { fetch: fetchLike })).toEqual({ ok: true, status: 200, data });
    expect(calls[0]?.url).toBe(`/validator/api/report/${SESSION_ID}`);
  });

  test("preserves retentionTier as string, null, or omitted undefined", async () => {
    const base: ReportResponse = { schema: "federation_tester_report.v1", id: SESSION_ID, visibility: "session" };
    const run = (body: object) => fetchReport(SESSION_ID, { fetch: captureFetch(() => jsonResponse(200, body)).fetchLike });
    expect(await run({ ...base, retentionTier: "ephemeral" })).toEqual({ ok: true, status: 200, data: { ...base, retentionTier: "ephemeral" } });
    expect(await run({ ...base, retentionTier: null })).toEqual({ ok: true, status: 200, data: { ...base, retentionTier: null } });
    const absent = await run(base);
    expect(absent).toEqual({ ok: true, status: 200, data: base });
    if (absent.ok) expect(absent.data.retentionTier).toBeUndefined();
  });

  test("treats report 410 expired payload as terminal expiry", async () => {
    const result = await fetchReport(SESSION_ID, {
      fetch: captureFetch(() => jsonResponse(410, {
        schema: "federation_tester_report.v1",
        id: SESSION_ID,
        visibility: "expired",
      })).fetchLike,
    });
    expect(result).toMatchObject({ ok: false, kind: "expired", status: 410 });
  });

  test("keeps report_not_public as an HTTP error, not session_not_found", async () => {
    const result = await fetchReport(SESSION_ID, {
      fetch: captureFetch(() => jsonResponse(404, {
        error: "report_not_public",
        message: "report is not public",
      })).fetchLike,
    });
    expect(result).toEqual({ ok: false, kind: "http", status: 404, error: "report_not_public", message: "report is not public" });
    if (!result.ok) {
      expect(isReportNotPublicFailure(result)).toBe(true);
    }
  });

  test("distinguishes expired from report_not_public and unrelated 404", async () => {
    const expired = await fetchReport(SESSION_ID, {
      fetch: captureFetch(() => jsonResponse(410, { error: "gone", message: "report expired" })).fetchLike,
    });
    expect(expired).toMatchObject({ ok: false, kind: "expired", status: 410 });
    if (!expired.ok) {
      expect(isReportNotPublicFailure(expired)).toBe(false);
    }

    const unrelated = await fetchReport(SESSION_ID, {
      fetch: captureFetch(() => jsonResponse(404, { error: "nope", message: "missing" })).fetchLike,
    });
    expect(unrelated).toEqual({
      ok: false,
      kind: "http",
      status: 404,
      error: "nope",
      message: "missing",
    });
    if (!unrelated.ok) {
      expect(isReportNotPublicFailure(unrelated)).toBe(false);
    }

    const bare = await fetchReport(SESSION_ID, {
      fetch: captureFetch(() => new Response("", { status: 404 })).fetchLike,
    });
    expect(bare).toMatchObject({ ok: false, kind: "http", status: 404, error: "http_error" });
    if (!bare.ok) {
      expect(isReportNotPublicFailure(bare)).toBe(false);
    }
  });

  test("narrows successful visibility tokens and unknown values", async () => {
    expect(normalizeReportVisibility("session")).toBe("session");
    expect(normalizeReportVisibility("permanent")).toBe("permanent");
    expect(normalizeReportVisibility("not_saved")).toBe("not_saved");
    expect(normalizeReportVisibility("expired")).toBe("expired");
    expect(normalizeReportVisibility("private")).toBe("unknown");
    expect(normalizeReportVisibility("")).toBe("unknown");
    const odd = await fetchReport(SESSION_ID, {
      fetch: captureFetch(() => jsonResponse(200, {
        schema: "federation_tester_report.v1",
        id: SESSION_ID,
        visibility: "private",
      })).fetchLike,
    });
    expect(odd).toEqual({
      ok: true,
      status: 200,
      data: { schema: "federation_tester_report.v1", id: SESSION_ID, visibility: "unknown" },
    });
  });
});

describe("resolvePublicReportUrl", () => {
  const origin = "https://validator.example.com";

  test("resolves a relative /validator/report/{id} once against the API origin", () => {
    expect(resolvePublicReportUrl(`/validator/report/${SESSION_ID}`, origin)).toBe(
      `https://validator.example.com/validator/report/${SESSION_ID}`,
    );
  });

  test("resolves an absolute same-origin URL", () => {
    expect(resolvePublicReportUrl(`https://validator.example.com/validator/report/${SESSION_ID}`, origin)).toBe(
      `https://validator.example.com/validator/report/${SESSION_ID}`,
    );
  });

  test("rejects cross-origin, non-http, and empty URLs", () => {
    expect(resolvePublicReportUrl("https://evil.example/validator/report/abc", origin)).toBeNull();
    expect(resolvePublicReportUrl("ftp://validator.example.com/validator/report/abc", origin)).toBeNull();
    expect(resolvePublicReportUrl("javascript:alert(1)", origin)).toBeNull();
    expect(resolvePublicReportUrl("", origin)).toBeNull();
    expect(resolvePublicReportUrl("   ", origin)).toBeNull();
    expect(resolvePublicReportUrl(null, origin)).toBeNull();
    expect(resolvePublicReportUrl(undefined, origin)).toBeNull();
  });

  test("rejects an empty or missing API origin without using window.location.origin", () => {
    const candidate = `/validator/report/${SESSION_ID}`;
    const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: { location: { origin } },
    });
    try {
      expect(resolvePublicReportUrl(candidate, "")).toBeNull();
      expect(resolvePublicReportUrl(candidate, "   ")).toBeNull();
      expect(resolvePublicReportUrl(candidate, undefined)).toBeNull();
      expect(resolvePublicReportUrl(candidate, null)).toBeNull();
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        Object.defineProperty(globalThis, "window", previous);
      }
    }
  });
});

const CLAIM_OK = {
  inviteString: "dG9rZW5AcGVlci5leGFtcGxl",
  issuerFqdn: "validator.example.com",
  pasteTargetOrigin: "https://peer.example",
  pasteTargetHost: "peer.example",
  expiresAt: "2026-09-13T12:00:00Z",
} as const;

const INVITE_STRING = "dG9rZW5AcGVlci5leGFtcGxl";

const POST_JSON_HEADERS = { Accept: "application/json", "Content-Type": "application/json" } as const;

function nestedEnvelope(code: string, reasonCode: string, message: string) {
  return { error: { code, reasonCode, message } };
}

async function assertNoRetry(
  run: (deps: Pick<ValidatorFetchDeps, "fetch" | "sleep">) => Promise<unknown>,
  response: Response,
): Promise<void> {
  const { sleeps, sleep } = trackedSleep();
  let hits = 0;
  await run({
    fetch: captureFetch(() => {
      hits += 1;
      return response;
    }).fetchLike,
    sleep,
  });
  expect(hits).toBe(1);
  expect(sleeps).toEqual([]);
}

describe("claimInvite", () => {
  test("POSTs /api/session/{id}/invite with no body and reads the claim fields", async () => {
    const { fetchLike, calls } = captureFetch(() => jsonResponse(200, CLAIM_OK));
    const result = await claimInvite(SESSION_ID, { fetch: fetchLike, origin: "https://api.example.com" });
    expect(result).toEqual({ ok: true, status: 200, data: { ...CLAIM_OK } });
    expect(calls[0]?.url).toBe(`https://api.example.com/validator/api/session/${SESSION_ID}/invite`);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toEqual(POST_JSON_HEADERS);
    expect(calls[0]?.init.body).toBeUndefined();
    if (result.ok) {
      expect(result.data.expiresAt).toBe("2026-09-13T12:00:00Z");
    }
  });

  test("encodes the session id in the claim URL", async () => {
    const rawId = "sess/id with space";
    const { fetchLike, calls } = captureFetch(() => jsonResponse(200, CLAIM_OK));
    await claimInvite(rawId, { fetch: fetchLike });
    expect(calls[0]?.url).toBe(`/validator/api/session/${encodeURIComponent(rawId)}/invite`);
  });

  test("parses flat 410 INVITE_ALREADY_CLAIMED as expired", async () => {
    const result = await claimInvite(SESSION_ID, {
      fetch: captureFetch(() =>
        jsonResponse(410, { error: "INVITE_ALREADY_CLAIMED", message: "invite already claimed" }),
      ).fetchLike,
    });
    expect(result).toEqual({
      ok: false,
      kind: "expired",
      status: 410,
      error: "INVITE_ALREADY_CLAIMED",
      message: "invite already claimed",
    });
  });

  test("parses flat 409 SESSION_NOT_READY", async () => {
    const result = await claimInvite(SESSION_ID, {
      fetch: captureFetch(() =>
        jsonResponse(409, { error: "SESSION_NOT_READY", message: "session is not ready" }),
      ).fetchLike,
    });
    expect(result).toEqual({
      ok: false,
      kind: "http",
      status: 409,
      error: "SESSION_NOT_READY",
      message: "session is not ready",
    });
  });

  test("parses flat 404 SESSION_NOT_FOUND as session_not_found", async () => {
    const result = await claimInvite(SESSION_ID, {
      fetch: captureFetch(() =>
        jsonResponse(404, { error: "SESSION_NOT_FOUND", message: "session not found" }),
      ).fetchLike,
    });
    expect(result).toEqual({
      ok: false,
      kind: "session_not_found",
      status: 404,
      error: "SESSION_NOT_FOUND",
      message: "session not found",
    });
  });

  test("parses flat 500 store_unavailable and store_error", async () => {
    const unavailable = await claimInvite(SESSION_ID, {
      fetch: captureFetch(() =>
        jsonResponse(500, { error: "store_unavailable", message: "validator store is not configured" }),
      ).fetchLike,
    });
    expect(unavailable).toEqual({
      ok: false,
      kind: "http",
      status: 500,
      error: "store_unavailable",
      message: "validator store is not configured",
    });
    const storeError = await claimInvite(SESSION_ID, {
      fetch: captureFetch(() =>
        jsonResponse(500, { error: "store_error", message: "validator store error" }),
      ).fetchLike,
    });
    expect(storeError).toEqual({
      ok: false,
      kind: "http",
      status: 500,
      error: "store_error",
      message: "validator store error",
    });
  });

  test("does not retry claim POST failures, including 5xx", async () => {
    const cases: Array<[number, unknown]> = [
      [410, { error: "INVITE_ALREADY_CLAIMED", message: "invite already claimed" }],
      [409, { error: "SESSION_NOT_READY", message: "session is not ready" }],
      [404, { error: "SESSION_NOT_FOUND", message: "session not found" }],
      [500, { error: "store_unavailable", message: "validator store is not configured" }],
      [500, { error: "store_error", message: "validator store error" }],
    ];
    for (const [status, body] of cases) {
      await assertNoRetry(
        (deps) => claimInvite(SESSION_ID, deps),
        jsonResponse(status, body),
      );
    }
  });

  test("malformed 200 claim bodies including invalid expiresAt are invalid_response", async () => {
    const invalidBodies: unknown[] = [
      { ...CLAIM_OK, expiresAt: "not-a-date" },
      { ...CLAIM_OK, expiresAt: 1_694_592_000 },
      { ...CLAIM_OK, expiresAt: "" },
      { ...CLAIM_OK, expiresAt: "   " },
      { ...CLAIM_OK, inviteString: "" },
      { ...CLAIM_OK, issuerFqdn: "   " },
      { ...CLAIM_OK, pasteTargetOrigin: "" },
      { ...CLAIM_OK, pasteTargetHost: "\t" },
      {
        inviteString: CLAIM_OK.inviteString,
        issuerFqdn: CLAIM_OK.issuerFqdn,
        pasteTargetOrigin: CLAIM_OK.pasteTargetOrigin,
        pasteTargetHost: CLAIM_OK.pasteTargetHost,
      },
      {},
      [],
      "not-an-object",
      null,
    ];
    for (const body of invalidBodies) {
      const result = await claimInvite(SESSION_ID, {
        fetch: captureFetch(() => jsonResponse(200, body)).fetchLike,
      });
      expect(result).toEqual({
        ok: false,
        kind: "invalid_response",
        status: 200,
        error: "invalid_response",
        message: "unexpected response body",
      });
    }
  });
});

describe("postReverseInvite", () => {
  test("POSTs {inviteString} to /api/session/{id}/reverse-invite", async () => {
    const { fetchLike, calls } = captureFetch(() => jsonResponse(200, { status: "accepted" }));
    const result = await postReverseInvite(SESSION_ID, INVITE_STRING, {
      fetch: fetchLike,
      origin: "https://api.example.com",
    });
    expect(result).toEqual({ ok: true, status: 200, data: { status: "accepted" } });
    expect(calls[0]?.url).toBe(`https://api.example.com/validator/api/session/${SESSION_ID}/reverse-invite`);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toEqual(POST_JSON_HEADERS);
    expect(calls[0]?.init.body).toBe(JSON.stringify({ inviteString: INVITE_STRING }));
  });

  test("encodes the session id in the reverse-invite URL", async () => {
    const rawId = "sess/id with space";
    const { fetchLike, calls } = captureFetch(() => jsonResponse(200, { status: "accepted" }));
    await postReverseInvite(rawId, INVITE_STRING, { fetch: fetchLike });
    expect(calls[0]?.url).toBe(`/validator/api/session/${encodeURIComponent(rawId)}/reverse-invite`);
  });

  test("parses nested 400 missing_field for required, invalid, and sender-host cases", async () => {
    const messages = [
      "inviteString is required",
      "invalid invite string",
      "invalid invite sender host",
    ] as const;
    for (const message of messages) {
      const body = nestedEnvelope("Bad Request", "missing_field", message);
      const result = await postReverseInvite(SESSION_ID, INVITE_STRING, {
        fetch: captureFetch(() => jsonResponse(400, body)).fetchLike,
      });
      expect(result).toEqual({
        ok: false,
        kind: "http",
        status: 400,
        error: "missing_field",
        message,
      });
      expect(parseErrorEnvelope(body)).toEqual({
        error: "missing_field",
        message,
        reasonCode: "missing_field",
      });
    }
  });

  test("keeps invalid invite string as missing_field, never invalid_invitation", async () => {
    const body = nestedEnvelope("Bad Request", "missing_field", "invalid invite string");
    const result = await postReverseInvite(SESSION_ID, "not-an-invite", {
      fetch: captureFetch(() => jsonResponse(400, body)).fetchLike,
    });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: "missing_field",
      message: "invalid invite string",
    });
    if (!result.ok) {
      expect(result.error).not.toBe("invalid_invitation");
    }
    const parsed = parseErrorEnvelope(body);
    expect(parsed?.error).toBe("missing_field");
    expect(parsed?.reasonCode).toBe("missing_field");
    expect(parsed?.reasonCode).not.toBe("invalid_invitation");
    expect(parsed?.error).not.toBe("invalid_invitation");
  });

  test("parses nested 422 wrong_target_host", async () => {
    const body = nestedEnvelope(
      "Unprocessable Entity",
      "wrong_target_host",
      "invite sender does not match the session target host",
    );
    const result = await postReverseInvite(SESSION_ID, INVITE_STRING, {
      fetch: captureFetch(() => jsonResponse(422, body)).fetchLike,
    });
    expect(result).toEqual({
      ok: false,
      kind: "http",
      status: 422,
      error: "wrong_target_host",
      message: "invite sender does not match the session target host",
    });
    expect(parseErrorEnvelope(body)?.reasonCode).toBe("wrong_target_host");
  });

  test("parses nested 409 conflict for the backend conflict family", async () => {
    const messages = [
      "session is not active",
      "session has no bound recipient",
      "session state does not allow this step",
      "a different reverse invite is already imported",
      "session is not ready for a reverse invite",
      "invite does not match the session correlation",
    ] as const;
    for (const message of messages) {
      const body = nestedEnvelope("Conflict", "conflict", message);
      const result = await postReverseInvite(SESSION_ID, INVITE_STRING, {
        fetch: captureFetch(() => jsonResponse(409, body)).fetchLike,
      });
      expect(result).toEqual({
        ok: false,
        kind: "http",
        status: 409,
        error: "conflict",
        message,
      });
      expect(parseErrorEnvelope(body)).toEqual({
        error: "conflict",
        message,
        reasonCode: "conflict",
      });
    }
  });

  test("parses nested 502 peer_unreachable", async () => {
    const body = nestedEnvelope(
      "Bad Gateway",
      "peer_unreachable",
      "failed to complete the reverse invite exchange",
    );
    const result = await postReverseInvite(SESSION_ID, INVITE_STRING, {
      fetch: captureFetch(() => jsonResponse(502, body)).fetchLike,
    });
    expect(result).toEqual({
      ok: false,
      kind: "http",
      status: 502,
      error: "peer_unreachable",
      message: "failed to complete the reverse invite exchange",
    });
  });

  test("parses nested 404 not_found", async () => {
    const body = nestedEnvelope("Not Found", "not_found", "session not found");
    const result = await postReverseInvite(SESSION_ID, INVITE_STRING, {
      fetch: captureFetch(() => jsonResponse(404, body)).fetchLike,
    });
    expect(result).toEqual({
      ok: false,
      kind: "http",
      status: 404,
      error: "not_found",
      message: "session not found",
    });
  });

  test("parses nested 500 internal_error for load and store failures", async () => {
    const messages = ["failed to load session", "failed to store invite"] as const;
    for (const message of messages) {
      const body = nestedEnvelope("Internal Server Error", "internal_error", message);
      const result = await postReverseInvite(SESSION_ID, INVITE_STRING, {
        fetch: captureFetch(() => jsonResponse(500, body)).fetchLike,
      });
      expect(result).toEqual({
        ok: false,
        kind: "http",
        status: 500,
        error: "internal_error",
        message,
      });
    }
  });

  test("does not retry reverse POST failures, including 5xx", async () => {
    const cases: Array<[number, unknown]> = [
      [400, nestedEnvelope("Bad Request", "missing_field", "inviteString is required")],
      [400, nestedEnvelope("Bad Request", "missing_field", "invalid invite string")],
      [400, nestedEnvelope("Bad Request", "missing_field", "invalid invite sender host")],
      [422, nestedEnvelope("Unprocessable Entity", "wrong_target_host", "invite sender does not match the session target host")],
      [409, nestedEnvelope("Conflict", "conflict", "session is not active")],
      [502, nestedEnvelope("Bad Gateway", "peer_unreachable", "failed to complete the reverse invite exchange")],
      [404, nestedEnvelope("Not Found", "not_found", "session not found")],
      [500, nestedEnvelope("Internal Server Error", "internal_error", "failed to load session")],
      [500, nestedEnvelope("Internal Server Error", "internal_error", "failed to store invite")],
    ];
    for (const [status, body] of cases) {
      await assertNoRetry(
        (deps) => postReverseInvite(SESSION_ID, INVITE_STRING, deps),
        jsonResponse(status, body),
      );
    }
  });

  test("whitespace-only reverse-invite status is invalid_response", async () => {
    const result = await postReverseInvite(SESSION_ID, INVITE_STRING, {
      fetch: captureFetch(() => jsonResponse(200, { status: "   " })).fetchLike,
    });
    expect(result).toEqual({
      ok: false,
      kind: "invalid_response",
      status: 200,
      error: "invalid_response",
      message: "unexpected response body",
    });
  });

  test("malformed 200 reverse-invite bodies are invalid_response", async () => {
    const invalidBodies: unknown[] = [
      { status: "\t\n" },
      { status: "" },
      {},
      { status: 1 },
      [],
      "accepted",
      null,
    ];
    for (const body of invalidBodies) {
      const result = await postReverseInvite(SESSION_ID, INVITE_STRING, {
        fetch: captureFetch(() => jsonResponse(200, body)).fetchLike,
      });
      expect(result).toEqual({
        ok: false,
        kind: "invalid_response",
        status: 200,
        error: "invalid_response",
        message: "unexpected response body",
      });
    }
  });
});
