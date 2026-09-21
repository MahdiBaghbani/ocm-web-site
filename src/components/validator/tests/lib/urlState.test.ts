import { describe, expect, test } from "bun:test";

import {
  HOST_INPUT_MESSAGES,
  URL_HOST_PARAM,
  URL_ID_PARAM,
  interpretHostInput,
  normalizeHost,
  normalizeSessionId,
  parseValidatorUrlState,
  serializeValidatorUrlState,
} from "@/components/validator/lib/urlState";

const SESSION_ID = "0193a0c2-7c1d-7b4a-8f2e-1a2b3c4d5e6f";

describe("normalizeHost", () => {
  test("trims, lowercases, and strips http(s) scheme and path", () => {
    expect(normalizeHost("  HTTPS://Example.COM/apps/files?x=1#y  ")).toBe(
      "example.com",
    );
    expect(normalizeHost("peer.example:8443")).toBe("peer.example:8443");
    expect(normalizeHost("http://peer.example:8443/ocm")).toBe(
      "peer.example:8443",
    );
    expect(normalizeHost("PEER.Example:8443/ocm")).toBe("peer.example:8443");
    expect(normalizeHost("localhost:8443")).toBe("localhost:8443");
    expect(normalizeHost("Example.COM/path")).toBe("example.com");
    expect(normalizeHost("localhost")).toBe("localhost");
    expect(normalizeHost("127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeHost("https://[::1]/x")).toBe("[::1]");
    expect(normalizeHost("[::1]")).toBe("[::1]");
    expect(normalizeHost("[2001:db8::1]")).toBe("[2001:db8::1]");
    expect(normalizeHost("[::ffff:192.0.2.1]")).toBe("[::ffff:192.0.2.1]");
    expect(normalizeHost("https://[::1]:8443/x")).toBe("[::1]:8443");
    expect(normalizeHost("[::1]:8443?x=y#frag")).toBe("[::1]:8443");
    expect(normalizeHost("[2001:db8::1]:8443/path")).toBe("[2001:db8::1]:8443");
  });

  test("requires bracketed IPv6 and rejects malformed literals", () => {
    expect(normalizeHost("::1")).toBeNull();
    expect(normalizeHost("2001:db8::1")).toBeNull();
    expect(normalizeHost("[::1")).toBeNull();
    expect(normalizeHost("[2001:db8:]")).toBeNull();
    expect(normalizeHost("[:::1]")).toBeNull();
    expect(normalizeHost("[1:2:3:4:5:6:7:8:9]")).toBeNull();
    expect(normalizeHost("[gggg::1]")).toBeNull();
    expect(normalizeHost("[]")).toBeNull();
  });

  test("rejects non-hosts", () => {
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost("   ")).toBeNull();
    expect(normalizeHost("ftp://example.com")).toBeNull();
    expect(normalizeHost("https://")).toBeNull();
    expect(normalizeHost("https://user:pass@example.com")).toBeNull();
    expect(normalizeHost("not a host")).toBeNull();
    expect(normalizeHost("-bad.example")).toBeNull();
    expect(normalizeHost("example.com:0")).toBeNull();
    expect(normalizeHost("example.com:65536")).toBeNull();
    expect(normalizeHost("//example.com")).toBeNull();
    expect(normalizeHost("alice@example.com")).toBeNull();
  });

  test("rejects dangling and non-numeric ports", () => {
    expect(normalizeHost("example.com:")).toBeNull();
    expect(normalizeHost("localhost:")).toBeNull();
    expect(normalizeHost("[::1]:")).toBeNull();
    expect(normalizeHost("example.com:abc")).toBeNull();
  });
});

describe("interpretHostInput", () => {
  test("normalizes a domain to the host preview value", () => {
    const result = interpretHostInput("  Example.COM/ocm  ");
    expect(result).toEqual({ ok: true, host: "example.com" });
    expect(normalizeHost("  Example.COM/ocm  ")).toBe("example.com");
  });

  test("keeps host and port and drops a full URL path", () => {
    expect(interpretHostInput("peer.example:8443")).toEqual({
      ok: true,
      host: "peer.example:8443",
    });
    expect(interpretHostInput("https://peer.example:8443/ocm/files?x=1#y")).toEqual({
      ok: true,
      host: "peer.example:8443",
    });
  });

  test("accepts IPv4 and bracketed IPv6 with an optional port", () => {
    expect(interpretHostInput("127.0.0.1")).toEqual({ ok: true, host: "127.0.0.1" });
    expect(interpretHostInput("https://[::1]/x")).toEqual({ ok: true, host: "[::1]" });
    expect(interpretHostInput("[2001:db8::1]:8443/path")).toEqual({
      ok: true,
      host: "[2001:db8::1]:8443",
    });
  });

  test("maps empty input to the entry page message", () => {
    expect(interpretHostInput("")).toEqual({
      ok: false,
      reason: "empty",
      message: "Enter a server address.",
    });
    expect(interpretHostInput("   ")).toEqual({
      ok: false,
      reason: "empty",
      message: HOST_INPUT_MESSAGES.empty,
    });
    expect(normalizeHost("")).toBeNull();
  });

  test("maps an email-like value to the entry page message", () => {
    expect(interpretHostInput("alice@example.com")).toEqual({
      ok: false,
      reason: "email",
      message: "Enter a server address, not an email address.",
    });
    expect(normalizeHost("alice@example.com")).toBeNull();
  });

  test("maps a URL with username or password to the entry page message", () => {
    expect(interpretHostInput("https://user:pass@example.com")).toEqual({
      ok: false,
      reason: "credentials",
      message: "Remove the username and password from the address.",
    });
    expect(interpretHostInput("https://user@example.com/ocm")).toEqual({
      ok: false,
      reason: "credentials",
      message: HOST_INPUT_MESSAGES.credentials,
    });
    expect(normalizeHost("https://user:pass@example.com")).toBeNull();
  });

  test("maps an unsupported scheme to the entry page message", () => {
    expect(interpretHostInput("ftp://example.com")).toEqual({
      ok: false,
      reason: "unsupported_scheme",
      message: "Use a domain or an http/https URL.",
    });
    expect(normalizeHost("ftp://example.com")).toBeNull();
  });

  test("maps a missing or malformed host to the entry page message", () => {
    const message = "Enter a valid domain, IP address, or host with an optional port.";
    for (const value of ["https://", "not a host", "-bad.example", "example.com:0", "//example.com"]) {
      expect(interpretHostInput(value)).toEqual({
        ok: false,
        reason: "malformed_host",
        message,
      });
      expect(normalizeHost(value)).toBeNull();
    }
  });
});

describe("normalizeSessionId", () => {
  test("accepts trimmed URL-safe ids and rejects the rest", () => {
    expect(normalizeSessionId(` ${SESSION_ID} `)).toBe(SESSION_ID);
    expect(normalizeSessionId("run_1.ok")).toBe("run_1.ok");
    expect(normalizeSessionId("")).toBeNull();
    expect(normalizeSessionId("has space")).toBeNull();
    expect(normalizeSessionId("id/with/slash")).toBeNull();
  });
});

describe("parseValidatorUrlState", () => {
  test("reads host and id from query params", () => {
    const parsed = parseValidatorUrlState(
      `https://site.test/validator/results/?${URL_HOST_PARAM}=Example.COM&${URL_ID_PARAM}=${SESSION_ID}&extra=1`,
    );
    expect(parsed).toEqual({
      ok: true,
      state: { host: "example.com", id: SESSION_ID },
    });
  });

  test("reads host and id from hash when query is empty", () => {
    const hashed = parseValidatorUrlState(
      `https://site.test/validator/results/#${URL_HOST_PARAM}=peer.example&${URL_ID_PARAM}=${SESSION_ID}`,
    );
    expect(hashed).toEqual({
      ok: true,
      state: { host: "peer.example", id: SESSION_ID },
    });

    const hashedQuery = parseValidatorUrlState(
      `https://site.test/validator/results/#?${URL_HOST_PARAM}=peer.example&${URL_ID_PARAM}=${SESSION_ID}`,
    );
    expect(hashedQuery).toEqual({
      ok: true,
      state: { host: "peer.example", id: SESSION_ID },
    });
  });

  test("query wins over hash and ignores extra keys", () => {
    const parsed = parseValidatorUrlState(
      `https://site.test/r/?${URL_HOST_PARAM}=query.example&${URL_ID_PARAM}=${SESSION_ID}#${URL_HOST_PARAM}=hash.example&${URL_ID_PARAM}=other-id`,
    );
    expect(parsed).toEqual({
      ok: true,
      state: { host: "query.example", id: SESSION_ID },
    });
  });

  test("parses DNS host:port query values as the normalized host", () => {
    const parsed = parseValidatorUrlState(
      `?${URL_HOST_PARAM}=peer.example:8443&${URL_ID_PARAM}=${SESSION_ID}`,
    );
    expect(parsed).toEqual({
      ok: true,
      state: { host: "peer.example:8443", id: SESSION_ID },
    });
  });

  test("rejects missing or invalid fields", () => {
    expect(parseValidatorUrlState("https://site.test/r/")).toEqual({
      ok: false,
      reason: "missing_host",
    });
    expect(
      parseValidatorUrlState(`https://site.test/r/?${URL_HOST_PARAM}=example.com`),
    ).toEqual({ ok: false, reason: "missing_id" });
    expect(
      parseValidatorUrlState(
        `https://site.test/r/?${URL_HOST_PARAM}=not%20a%20host&${URL_ID_PARAM}=${SESSION_ID}`,
      ),
    ).toEqual({ ok: false, reason: "invalid_host" });
    expect(
      parseValidatorUrlState(
        `https://site.test/r/?${URL_HOST_PARAM}=example.com&${URL_ID_PARAM}=bad%20id`,
      ),
    ).toEqual({ ok: false, reason: "invalid_id" });
  });

  test("returns invalid_url for malformed page URLs", () => {
    expect(parseValidatorUrlState("")).toEqual({ ok: false, reason: "invalid_url" });
    expect(parseValidatorUrlState("::::")).toEqual({ ok: false, reason: "invalid_url" });
    expect(parseValidatorUrlState("http://[::1")).toEqual({ ok: false, reason: "invalid_url" });
    expect(parseValidatorUrlState("https://")).toEqual({ ok: false, reason: "invalid_url" });
  });

  test("rejects dangling and non-numeric host ports as invalid_host", () => {
    for (const host of ["example.com:", "localhost:", "[::1]:", "example.com:abc"]) {
      expect(
        parseValidatorUrlState(
          `https://site.test/r/?${URL_HOST_PARAM}=${encodeURIComponent(host)}&${URL_ID_PARAM}=${SESSION_ID}`,
        ),
      ).toEqual({ ok: false, reason: "invalid_host" });
    }
  });
});

describe("serializeValidatorUrlState", () => {
  test("roundtrips query and hash forms", () => {
    const state = { host: "HTTPS://Peer.Example/ocm", id: ` ${SESSION_ID} ` };
    const query = serializeValidatorUrlState(state);
    expect(query.ok).toBe(true);
    if (!query.ok) {
      return;
    }
    expect(query.href).toBe(`?${URL_HOST_PARAM}=peer.example&${URL_ID_PARAM}=${SESSION_ID}`);
    expect(parseValidatorUrlState(query.href)).toEqual({
      ok: true,
      state: { host: "peer.example", id: SESSION_ID },
    });

    const hash = serializeValidatorUrlState(state, { location: "hash" });
    expect(hash.ok).toBe(true);
    if (!hash.ok) {
      return;
    }
    expect(hash.href).toBe(`#${URL_HOST_PARAM}=peer.example&${URL_ID_PARAM}=${SESSION_ID}`);
    expect(parseValidatorUrlState(`https://site.test/r/${hash.href}`)).toEqual({
      ok: true,
      state: { host: "peer.example", id: SESSION_ID },
    });
  });

  test("writes only host and id onto a base URL", () => {
    const serialized = serializeValidatorUrlState(
      { host: "peer.example", id: SESSION_ID },
      {
        base: "https://site.test/validator/results/?optInActive=true&invite=secret",
      },
    );
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) {
      return;
    }
    const url = new URL(serialized.href);
    expect([...url.searchParams.keys()].sort()).toEqual([
      URL_HOST_PARAM,
      URL_ID_PARAM,
    ]);
    expect(url.searchParams.get(URL_HOST_PARAM)).toBe("peer.example");
    expect(url.searchParams.get(URL_ID_PARAM)).toBe(SESSION_ID);
    expect(serialized.href.includes("optInActive")).toBe(false);
    expect(serialized.href.includes("invite")).toBe(false);
  });

  test("serializes relative bases without leaking other params", () => {
    const serialized = serializeValidatorUrlState(
      { host: "peer.example", id: SESSION_ID },
      { base: "/validator/results/?x=1" },
    );
    expect(serialized).toEqual({
      ok: true,
      href: `/validator/results/?${URL_HOST_PARAM}=peer.example&${URL_ID_PARAM}=${SESSION_ID}`,
    });
  });

  test("round-trips DNS host:port to the same host and session id", () => {
    const state = { host: "PEER.Example:8443/ocm", id: ` ${SESSION_ID} ` };
    const query = serializeValidatorUrlState(state);
    expect(query.ok).toBe(true);
    if (!query.ok) {
      return;
    }
    expect(new URLSearchParams(query.href.slice(1)).get(URL_HOST_PARAM)).toBe(
      "peer.example:8443",
    );
    expect(parseValidatorUrlState(query.href)).toEqual({
      ok: true,
      state: { host: "peer.example:8443", id: SESSION_ID },
    });

    const hash = serializeValidatorUrlState(state, { location: "hash" });
    expect(hash.ok).toBe(true);
    if (!hash.ok) {
      return;
    }
    expect(parseValidatorUrlState(`https://site.test/r/${hash.href}`)).toEqual({
      ok: true,
      state: { host: "peer.example:8443", id: SESSION_ID },
    });
  });

  test("round-trips bracketed IPv6 host:port through query and hash", () => {
    const cases = [
      { host: "[::1]:8443?x=y#frag", normalized: "[::1]:8443" },
      { host: "[2001:db8::1]:8443/path", normalized: "[2001:db8::1]:8443" },
    ];
    for (const item of cases) {
      const state = { host: item.host, id: ` ${SESSION_ID} ` };
      const query = serializeValidatorUrlState(state);
      expect(query.ok).toBe(true);
      if (!query.ok) {
        return;
      }
      expect(new URLSearchParams(query.href.slice(1)).get(URL_HOST_PARAM)).toBe(
        item.normalized,
      );
      expect(parseValidatorUrlState(query.href)).toEqual({
        ok: true,
        state: { host: item.normalized, id: SESSION_ID },
      });

      const hash = serializeValidatorUrlState(state, { location: "hash" });
      expect(hash.ok).toBe(true);
      if (!hash.ok) {
        return;
      }
      expect(parseValidatorUrlState(`https://site.test/r/${hash.href}`)).toEqual({
        ok: true,
        state: { host: item.normalized, id: SESSION_ID },
      });
    }
  });

  test("malformed bases return invalid_url and do not throw", () => {
    const state = { host: "peer.example", id: SESSION_ID };
    for (const base of ["https://[::1", "http://", "https://", "http://[broken"]) {
      expect(serializeValidatorUrlState(state, { base })).toEqual({
        ok: false,
        reason: "invalid_url",
      });
    }
  });

  test("rejects invalid serialize input", () => {
    expect(
      serializeValidatorUrlState({ host: "not a host", id: SESSION_ID }),
    ).toEqual({ ok: false, reason: "invalid_host" });
    expect(
      serializeValidatorUrlState({ host: "example.com", id: "bad id" }),
    ).toEqual({ ok: false, reason: "invalid_id" });
  });

  test("rejects dangling and non-numeric host ports as invalid_host", () => {
    for (const host of ["example.com:", "localhost:", "[::1]:", "example.com:abc"]) {
      expect(serializeValidatorUrlState({ host, id: SESSION_ID })).toEqual({
        ok: false,
        reason: "invalid_host",
      });
    }
  });
});
