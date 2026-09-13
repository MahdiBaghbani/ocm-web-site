import { describe, expect, test } from "bun:test";

import { guidanceFor } from "../validatorGuidance";
import { stripBracketedMarkers } from "./progress";
import {
  classifySessionFailure,
  EXPIRED_EVIDENCE_NOTE,
  EXPIRED_NOTICE,
  MALFORMED_BODY,
  MALFORMED_RETRY_LABEL,
  MALFORMED_TITLE,
  NOT_SAVED_EMPTY_BODY,
  NOT_SAVED_EMPTY_TITLE,
  projectExpiredFailure,
  projectMalformedFailure,
  projectNotSavedEmptyFailure,
  projectSessionFailure,
} from "./sessionFailures";

describe("classifySessionFailure", () => {
  test("maps each session-failure status to its own exclusive kind", () => {
    expect(classifySessionFailure("not_saved_empty")).toBe("not_saved_empty");
    expect(classifySessionFailure("malformed")).toBe("malformed");
    expect(classifySessionFailure("expired")).toBe("expired");
  });

  test("does not classify live, loading, ready, or transport report_error as a session failure", () => {
    expect(classifySessionFailure("live")).toBeNull();
    expect(classifySessionFailure("loading_report")).toBeNull();
    expect(classifySessionFailure("ready")).toBeNull();
    expect(classifySessionFailure("report_error")).toBeNull();
  });
});

describe("projectNotSavedEmptyFailure", () => {
  test("keeps the not-saved title and body and hides retry", () => {
    expect(projectNotSavedEmptyFailure()).toEqual({
      kind: "not_saved_empty",
      title: NOT_SAVED_EMPTY_TITLE,
      body: NOT_SAVED_EMPTY_BODY,
      guidance: null,
      failModeLabel: "",
      showRetry: false,
    });
  });

  test("surfaces sanitized terminal poll guidance and a trimmed failModeLabel", () => {
    const raw = guidanceFor("terminal_fail");
    expect(raw).not.toBeNull();
    if (raw === null || raw.kind !== "terminal") {
      throw new Error("expected terminal_fail guidance");
    }
    const display = projectNotSavedEmptyFailure("terminal_fail", "  handshake failed  ");
    expect(display.guidance).toEqual({
      ...raw,
      body: stripBracketedMarkers(raw.body),
    });
    expect(display.failModeLabel).toBe("handshake failed");
  });

  test("surfaces sanitized instruction poll guidance by title and body", () => {
    const raw = guidanceFor("paste_s1");
    expect(raw).not.toBeNull();
    if (raw === null || raw.kind !== "instruction") {
      throw new Error("expected paste_s1 instruction guidance");
    }
    const display = projectNotSavedEmptyFailure("paste_s1");
    expect(display.guidance).toEqual({
      ...raw,
      title: stripBracketedMarkers(raw.title),
      body: stripBracketedMarkers(raw.body),
    });
  });
});

describe("projectMalformedFailure", () => {
  test("keeps retry visible and uses the exact unavailable copy", () => {
    expect(projectMalformedFailure()).toEqual({
      kind: "malformed",
      title: MALFORMED_TITLE,
      body: MALFORMED_BODY,
      showRetry: true,
      retryLabel: MALFORMED_RETRY_LABEL,
    });
  });
});

describe("projectExpiredFailure", () => {
  test("uses the expired visibility notice and evidence note without retry", () => {
    expect(projectExpiredFailure()).toEqual({
      kind: "expired",
      notice: EXPIRED_NOTICE,
      evidenceNote: EXPIRED_EVIDENCE_NOTE,
      showRetry: false,
    });
  });
});

describe("projectSessionFailure", () => {
  test("returns null when the page status is not a session failure", () => {
    expect(projectSessionFailure("live", "terminal_fail", "handshake failed")).toBeNull();
    expect(projectSessionFailure("ready")).toBeNull();
    expect(projectSessionFailure("loading_report")).toBeNull();
    expect(projectSessionFailure("report_error", undefined, "missing")).toBeNull();
  });

  test("projects exactly one panel from the current status and ignores leftover poll copy on expired", () => {
    expect(projectSessionFailure("expired", "terminal_fail", "handshake failed")).toEqual(
      projectExpiredFailure(),
    );
    expect(projectSessionFailure("malformed", "terminal_fail", "handshake failed")).toEqual(
      projectMalformedFailure(),
    );
  });

  test("does not retain a prior session failure across an independent later call", () => {
    expect(projectSessionFailure("expired")).toEqual(projectExpiredFailure());
    expect(projectSessionFailure("live")).toBeNull();
    expect(
      projectSessionFailure("not_saved_empty", "terminal_fail", "handshake failed"),
    ).toEqual(projectNotSavedEmptyFailure("terminal_fail", "handshake failed"));
  });
});
