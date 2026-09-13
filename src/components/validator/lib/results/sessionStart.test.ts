import { describe, expect, test } from "bun:test";

import {
  projectSessionStart,
  sessionFromLocation,
  sessionFromProps,
  sessionLinkErrorMessage,
  SESSION_START_LOADING_TEXT,
} from "./sessionStart";

const SESSION_ID = "0193a0c2-7c1d-7b4a-8f2e-1a2b3c4d5e6f";
const HOST = "peer.example";
const IDENTITY = { host: HOST, id: SESSION_ID } as const;

function hrefWith(params: string): string {
  return `https://validator.example/results?${params}`;
}

describe("sessionFromProps", () => {
  test("returns null when host or id is omitted", () => {
    expect(sessionFromProps()).toBeNull();
    expect(sessionFromProps(HOST)).toBeNull();
    expect(sessionFromProps(undefined, SESSION_ID)).toBeNull();
  });

  test("returns null when host or id is invalid", () => {
    expect(sessionFromProps("not a host", SESSION_ID)).toBeNull();
    expect(sessionFromProps(HOST, "has space")).toBeNull();
  });

  test("normalizes a valid host and session id", () => {
    expect(sessionFromProps("Peer.Example", ` ${SESSION_ID} `)).toEqual(IDENTITY);
  });
});

describe("sessionFromLocation", () => {
  test("prefers valid props over href", () => {
    expect(
      sessionFromLocation(HOST, SESSION_ID, hrefWith("host=other.example&id=other-id")),
    ).toEqual(IDENTITY);
  });

  test("returns null when props and href are both missing", () => {
    expect(sessionFromLocation()).toBeNull();
    expect(sessionFromLocation(undefined, undefined, null)).toBeNull();
  });

  test("reads a valid session from href when props are absent", () => {
    expect(sessionFromLocation(undefined, undefined, hrefWith(`host=${HOST}&id=${SESSION_ID}`))).toEqual(
      IDENTITY,
    );
  });

  test("returns null for an unusable href when props are absent", () => {
    expect(sessionFromLocation(undefined, undefined, "https://validator.example/results")).toBeNull();
  });
});

describe("sessionLinkErrorMessage", () => {
  test("reports an incomplete link when href is missing", () => {
    expect(sessionLinkErrorMessage()).toBe("This result link is incomplete.");
    expect(sessionLinkErrorMessage(null)).toBe("This result link is incomplete.");
  });

  test("reports an incomplete link when the href already parses as a session", () => {
    expect(sessionLinkErrorMessage(hrefWith(`host=${HOST}&id=${SESSION_ID}`))).toBe(
      "This result link is incomplete.",
    );
  });

  test("reports an invalid session id for invalid_host, invalid_id, or invalid_url", () => {
    expect(sessionLinkErrorMessage(hrefWith(`host=not%20a%20host&id=${SESSION_ID}`))).toBe(
      "This result link has an invalid session ID.",
    );
    expect(sessionLinkErrorMessage(hrefWith(`host=${HOST}&id=has%20space`))).toBe(
      "This result link has an invalid session ID.",
    );
    expect(sessionLinkErrorMessage("")).toBe("This result link has an invalid session ID.");
  });

  test("reports an incomplete link for missing host or id", () => {
    expect(sessionLinkErrorMessage("https://validator.example/results")).toBe(
      "This result link is incomplete.",
    );
    expect(sessionLinkErrorMessage(hrefWith(`host=${HOST}`))).toBe(
      "This result link is incomplete.",
    );
    expect(sessionLinkErrorMessage(hrefWith(`id=${SESSION_ID}`))).toBe(
      "This result link is incomplete.",
    );
  });
});

describe("projectSessionStart", () => {
  test("projects loading while a null session has not mounted", () => {
    expect(projectSessionStart(null, false)).toEqual({
      kind: "loading",
      text: SESSION_START_LOADING_TEXT,
    });
    expect(projectSessionStart(null, false, hrefWith("host=not%20a%20host&id=bad"))).toEqual({
      kind: "loading",
      text: SESSION_START_LOADING_TEXT,
    });
  });

  test("projects failure after mount when the session is still null", () => {
    expect(projectSessionStart(null, true)).toEqual({
      kind: "failure",
      message: "This result link is incomplete.",
    });
    expect(projectSessionStart(null, true, hrefWith(`host=${HOST}&id=has%20space`))).toEqual({
      kind: "failure",
      message: "This result link has an invalid session ID.",
    });
  });

  test("projects session identity regardless of mounted or href", () => {
    expect(projectSessionStart(IDENTITY, false)).toEqual({
      kind: "identity",
      host: HOST,
      id: SESSION_ID,
    });
    expect(projectSessionStart(IDENTITY, true, "")).toEqual({
      kind: "identity",
      host: HOST,
      id: SESSION_ID,
    });
  });
});
