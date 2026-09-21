import { describe, expect, test } from "bun:test";

import { isSameSessionId, isStaleSessionId } from "@/components/validator/lib/results/sessionIdentity";

const SESSION_A = "0193a0c2-7c1d-7b4a-8f2e-1a2b3c4d5e6f";
const SESSION_B = "0193a0c2-7c1d-7b4a-8f2e-aaaaaaaaaaaa";

describe("isSameSessionId", () => {
  test("matches only when both sides are the same session id", () => {
    expect(isSameSessionId(SESSION_A, SESSION_A)).toBe(true);
    expect(isSameSessionId(SESSION_A, SESSION_B)).toBe(false);
  });

  test("treats an unset live or lock id as not the started session", () => {
    expect(isSameSessionId(SESSION_A, null)).toBe(false);
    expect(isSameSessionId(null, SESSION_A)).toBe(false);
  });

  test("does not normalize case, whitespace, or empty string", () => {
    expect(isSameSessionId(SESSION_A, SESSION_A.toUpperCase())).toBe(false);
    expect(isSameSessionId(SESSION_A, ` ${SESSION_A} `)).toBe(false);
    expect(isSameSessionId("", null)).toBe(false);
    expect(isSameSessionId("", "")).toBe(true);
  });

  test("treats two unset ids as the same empty identity", () => {
    expect(isSameSessionId(null, null)).toBe(true);
  });
});

describe("isStaleSessionId", () => {
  test("is stale when the live session is a different id or unset", () => {
    expect(isStaleSessionId(SESSION_A, SESSION_B)).toBe(true);
    expect(isStaleSessionId(SESSION_A, null)).toBe(true);
    expect(isStaleSessionId(SESSION_A, SESSION_A)).toBe(false);
  });

  test("is the dual of isSameSessionId and holds no state across calls", () => {
    expect(isStaleSessionId(SESSION_A, SESSION_A)).toBe(
      !isSameSessionId(SESSION_A, SESSION_A),
    );
    expect(isStaleSessionId(SESSION_A, SESSION_B)).toBe(
      !isSameSessionId(SESSION_A, SESSION_B),
    );
    expect(isStaleSessionId(SESSION_A, SESSION_B)).toBe(true);
    expect(isStaleSessionId(SESSION_B, SESSION_B)).toBe(false);
    expect(isStaleSessionId(null, null)).toBe(!isSameSessionId(null, null));
  });
});
