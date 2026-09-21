import { describe, expect, test } from "bun:test";

import { startSession, stopSession } from "@/components/validator/lib/fetch/session";
import {
  captureFetch,
  STORE_DOWN,
  trackedSleep,
} from "@/components/validator/tests/lib/fetch/helpers/test-helpers";
import { jsonResponse } from "@/components/validator/tests/helpers/fetchStub";

const SESSION_ID = "0193a0c2-7c1d-7b4a-8f2e-1a2b3c4d5e6f";

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

describe("stopSession", () => {
  test("POSTs {id} to /stop", async () => {
    const { fetchLike, calls } = captureFetch(() => jsonResponse(200, { id: SESSION_ID, state: "interrupted" }));
    const result = await stopSession(SESSION_ID, { fetch: fetchLike });
    expect(calls[0]?.url).toBe("/validator/stop");
    expect(calls[0]?.init.body).toBe(JSON.stringify({ id: SESSION_ID }));
    expect(result).toEqual({ ok: true, status: 200, data: { id: SESSION_ID, state: "interrupted" } });
  });
});
