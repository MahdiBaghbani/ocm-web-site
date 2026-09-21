import { describe, expect, test } from "bun:test";

import { parseErrorEnvelope, parseRetryAfter } from "@/components/validator/lib/fetch/transport";

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
