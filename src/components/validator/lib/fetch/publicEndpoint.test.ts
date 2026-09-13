import { describe, expect, test } from "bun:test";

import { fetchReport } from "./report";
import {
  isReportNotPublicFailure,
  normalizeReportVisibility,
  resolvePublicReportUrl,
} from "./urls";
import { captureFetch } from "./test-helpers";
import { jsonResponse } from "../../test-helpers/fetchStub";
import type { ReportResponse } from "./types";

const SESSION_ID = "0193a0c2-7c1d-7b4a-8f2e-1a2b3c4d5e6f";

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
