import { describe, expect, test } from "bun:test";

import {
  claimInvite,
  postReverseInvite,
} from "@/components/validator/lib/fetch/invite";
import { parseErrorEnvelope } from "@/components/validator/lib/fetch/transport";
import {
  captureFetch,
  trackedSleep,
} from "@/components/validator/tests/lib/fetch/helpers/test-helpers";
import { jsonResponse } from "@/components/validator/tests/helpers/fetchStub";
import type { ValidatorFetchDeps } from "@/components/validator/lib/fetch/types";

const SESSION_ID = "0193a0c2-7c1d-7b4a-8f2e-1a2b3c4d5e6f";

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
