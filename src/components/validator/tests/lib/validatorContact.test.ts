import { describe, expect, test } from "bun:test";

import { normalizeValidatorContact } from "@/components/validator/lib/validatorContact";

describe("normalizeValidatorContact", () => {
  test("normalizes a bare email to mailto", () => {
    const result = normalizeValidatorContact("  ops@example.com  ");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.href).toBe("mailto:ops@example.com");
    expect(result.label).toBe("ops@example.com");
  });

  test("accepts an explicit mailto contact", () => {
    const result = normalizeValidatorContact("mailto:ops@example.com");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.href).toBe("mailto:ops@example.com");
    expect(result.label).toBe("mailto:ops@example.com");
  });

  test("accepts http and https contacts", () => {
    const http = normalizeValidatorContact("http://example.com/contact");
    expect(http.ok).toBe(true);
    if (http.ok) {
      expect(http.href).toBe("http://example.com/contact");
      expect(http.label).toBe("http://example.com/contact");
    }

    const https = normalizeValidatorContact("https://example.com/contact");
    expect(https.ok).toBe(true);
    if (https.ok) {
      expect(https.href).toBe("https://example.com/contact");
      expect(https.label).toBe("https://example.com/contact");
    }
  });

  test("rejects userinfo credentials on mailto and http", () => {
    const mailto = normalizeValidatorContact("mailto:user:pass@host");
    expect(mailto.ok).toBe(false);
    if (!mailto.ok) {
      expect(mailto.reason).toMatch(/credential/i);
    }

    const http = normalizeValidatorContact("http://user:pass@host");
    expect(http.ok).toBe(false);
    if (!http.ok) {
      expect(http.reason).toMatch(/credential/i);
    }
  });

  test("rejects an invalid scheme", () => {
    const result = normalizeValidatorContact("javascript:alert(1)");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.reason).toMatch(/mailto|http|email/i);
    }
  });

  test("returns ok:false for empty or whitespace input", () => {
    for (const raw of ["", "   ", "\n\t"]) {
      const result = normalizeValidatorContact(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.length).toBeGreaterThan(0);
      }
    }
  });
});
