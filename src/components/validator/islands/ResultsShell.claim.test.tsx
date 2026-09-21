import { act } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import ResultsShell, {
  CLAIM_COPY_FAILURE_TEXT,
  COPY_AGAIN_LABEL,
  COPY_INVITATION_LABEL,
  COPY_SUCCESS_TEXT,
  INVITE_FIELD_LABEL,
} from "./ResultsShell";
import { type CanonicalAreaId } from "../lib/validatorScore";
import { ACTION_ERROR_COPY } from "../lib/validatorGuidance";
import { type ReportResponse } from "../lib/validatorFetch";
import { requestUrl, jsonResponse } from "@/components/validator/tests/helpers/fetchStub";
import { registerHappyDom, teardownHappyDom } from "@/components/validator/tests/helpers/happyDom";

const SESSION_ID = "0193a0c2-7c1d-7b4a-8f2e-1a2b3c4d5e6f";
const API_ORIGIN = "https://validator.example.com";
const AREA_IDS = [
  "discovery",
  "tls",
  "jwks",
  "httpsig",
  "sharing",
  "notification",
  "token",
  "capability",
] as const satisfies readonly CanonicalAreaId[];

function areaRow(area: CanonicalAreaId, grade: "pass" | "warn" | "fail" | null): Record<string, unknown> {
  return {
    area,
    grade,
    testRunCount: 0,
    distinctTestCount: 0,
    requiredTestCount: 0,
    optionalTestCount: 0,
    passedTestCount: 0,
    failedTestCount: 0,
    passWithWarningCount: 0,
    evidenceCount: 0,
  };
}

function specification(
  gradeFor: (id: CanonicalAreaId) => "pass" | "warn" | "fail" | null,
  grade: "pass" | "warn" | "fail" | null = "pass",
): Record<string, unknown> {
  return {
    grade,
    state: "terminal_pass",
    terminal: true,
    assessedAreas: 8,
    totalAreas: 8,
    areas: AREA_IDS.map((id) => areaRow(id, gradeFor(id))),
  };
}

function liveReport(score: unknown, extra: Partial<ReportResponse> = {}): ReportResponse {
  return {
    schema: "federation_tester_report.v1",
    id: SESSION_ID,
    visibility: "session",
    score: { specification: score },
    ...extra,
  };
}

function installClipboardWriteText(
  writeText: (value: string) => Promise<void>,
): () => void {
  const nav = globalThis.navigator as {
    clipboard?: { writeText: (value: string) => Promise<void> };
  };
  const previousClipboard = nav.clipboard;
  if (previousClipboard !== undefined) {
    const previousWrite = previousClipboard.writeText.bind(previousClipboard);
    try {
      previousClipboard.writeText = writeText;
      return () => {
        previousClipboard.writeText = previousWrite;
      };
    } catch {
      Object.defineProperty(previousClipboard, "writeText", {
        configurable: true,
        writable: true,
        value: writeText,
      });
      return () => {
        Object.defineProperty(previousClipboard, "writeText", {
          configurable: true,
          writable: true,
          value: previousWrite,
        });
      };
    }
  }
  try {
    nav.clipboard = { writeText };
  } catch {
    Object.defineProperty(nav, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  }
  return () => {
    if (nav.clipboard !== undefined && nav.clipboard.writeText === writeText) {
      delete nav.clipboard;
    }
  };
}

function installRejectedClipboard(): () => void {
  return installClipboardWriteText(() => Promise.reject(new Error("clipboard rejected")));
}

function installExecCommand(handler: () => boolean): { restore: () => void } {
  const previous = document.execCommand;
  document.execCommand = ((command: string) => {
    if (command === "copy") {
      return handler();
    }
    return previous.call(document, command);
  }) as typeof document.execCommand;
  return {
    restore: () => {
      document.execCommand = previous;
    },
  };
}

function installIsSecureContext(value: boolean): () => void {
  const previous = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    enumerable: true,
    get: () => value,
  });
  return () => {
    if (previous === undefined) {
      Reflect.deleteProperty(window, "isSecureContext");
      return;
    }
    Object.defineProperty(window, "isSecureContext", previous);
  };
}

async function waitForDom(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for a DOM condition");
    }
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
      });
    });
  }
}

/**
 * Deterministic poll-tick queue for the session polling endpoint. Each call
 * from the mocked fetch registers a pending resolver instead of returning a
 * response immediately, so the test controls exactly when each poll's data
 * is delivered. This replaces wall-clock-dependent pollCount windows and
 * waitForDom sampling with an explicit "poll tick" the test drives directly:
 * a call cannot resolve until the test releases it, so no later poll can
 * ever race ahead of an assertion about an earlier one.
 */
class SessionPollGate {
  private callCount = 0;
  private readonly pendingResolvers = new Map<number, (response: Response) => void>();
  private readonly callWaiters = new Map<number, () => void>();

  request(): Promise<Response> {
    this.callCount += 1;
    const call = this.callCount;
    return new Promise<Response>((resolve) => {
      this.pendingResolvers.set(call, resolve);
      const waiter = this.callWaiters.get(call);
      if (waiter !== undefined) {
        this.callWaiters.delete(call);
        waiter();
      }
    });
  }

  async awaitCall(n: number): Promise<void> {
    if (this.callCount >= n) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.callWaiters.set(n, resolve);
    });
  }

  respond(n: number, body: unknown, status = 200): void {
    const resolve = this.pendingResolvers.get(n);
    if (resolve === undefined) {
      throw new Error(`SessionPollGate: poll call ${n} is not pending yet`);
    }
    this.pendingResolvers.delete(n);
    resolve(jsonResponse(status, body));
  }

  /** Settle any still-pending call harmlessly so nothing is left dangling
   * after a test unmounts (and aborts the loop) with a call still gated. */
  settleRemaining(): void {
    for (const [call, resolve] of this.pendingResolvers) {
      resolve(jsonResponse(200, { state: "terminal_pass", ts: call, optInActive: false }));
    }
    this.pendingResolvers.clear();
  }

  get calls(): number {
    return this.callCount;
  }
}

/**
 * Release poll call `callNumber` with `body`, then wait for the loop to
 * reach call `callNumber + 1` before returning. Because the next call only
 * happens after this poll's state updates, any due report fetch, and the
 * cadence wait have all completed, the DOM is guaranteed settled for call
 * `callNumber` by the time this resolves (no arbitrary poll or deadline).
 */
async function releasePoll(gate: SessionPollGate, callNumber: number, body: unknown): Promise<void> {
  await act(async () => {
    await gate.awaitCall(callNumber);
    gate.respond(callNumber, body);
    await gate.awaitCall(callNumber + 1);
  });
}

const INVITE_STRING = "https://peer.example/ocm/invite/abc123";
const STORED_INVITE = "https://peer.example/ocm/invite/stored456";

function claimSuccessBody(invite: string = INVITE_STRING): Record<string, unknown> {
  return {
    inviteString: invite,
    issuerFqdn: "peer.example",
    pasteTargetOrigin: "https://peer.example",
    pasteTargetHost: "peer.example",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

// Live paste_s1 fetch with a controllable claim (POST /invite) responder. The
// session poll keeps returning invite_minted/paste_s1, so the invite row stays
// current and any claim cache must persist across the repeated polls.
function installClaimFetch(handleInvite: () => Promise<Response> | Response): {
  restore: () => void;
  inviteCalls: () => number;
} {
  let inviteCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("config.json")) {
      return jsonResponse(200, {
        poll_interval_ms: 1,
        active_poll_interval_ms: 1,
        backoff_initial_ms: 1,
        backoff_max_ms: 1,
        request_timeout_ms: 5000,
        validator_api_origin: API_ORIGIN,
      });
    }
    if (url.includes(`/api/session/${SESSION_ID}/invite`)) {
      inviteCalls += 1;
      return handleInvite();
    }
    if (url.includes(`/api/session/${SESSION_ID}`)) {
      return jsonResponse(200, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(200, liveReport(specification(() => "pass")));
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = previousFetch;
    },
    inviteCalls: () => inviteCalls,
  };
}

function installGatedClaimFetch(
  gate: SessionPollGate,
  handleInvite: () => Promise<Response> | Response,
): { restore: () => void; inviteCalls: () => number } {
  let inviteCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("config.json")) {
      return jsonResponse(200, {
        poll_interval_ms: 1,
        active_poll_interval_ms: 1,
        backoff_initial_ms: 1,
        backoff_max_ms: 1,
        request_timeout_ms: 5000,
        validator_api_origin: API_ORIGIN,
      });
    }
    if (url.includes(`/api/session/${SESSION_ID}/invite`)) {
      inviteCalls += 1;
      return handleInvite();
    }
    if (url.includes(`/api/session/${SESSION_ID}`)) {
      return gate.request();
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(200, liveReport(specification(() => "pass")));
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = previousFetch;
    },
    inviteCalls: () => inviteCalls,
  };
}

function claimButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (node) => node.textContent === label,
  );
  if (button === undefined) {
    throw new Error(`missing <button> with text ${JSON.stringify(label)}`);
  }
  return button;
}

function hasClaimButton(label: string): boolean {
  return Array.from(document.querySelectorAll("button")).some(
    (node) => node.textContent === label,
  );
}

function inviteField(): HTMLInputElement | null {
  return document.querySelector("[data-invite-field]");
}

function reverseTextarea(): HTMLTextAreaElement | null {
  return document.querySelector("[data-reverse-invite-field]");
}

describe("ResultsShell paste_s1 claim invitation", () => {
  beforeAll(async () => {
    await registerHappyDom("http://localhost/?host=peer.example&id=" + SESSION_ID);
  });

  afterAll(() => {
    teardownHappyDom();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
    window.sessionStorage.clear();
  });

  test("a 200 claim caches the invite before the clipboard attempt and renders a labeled read-only field", async () => {
    const order: string[] = [];
    const copied: string[] = [];
    const claim = installClaimFetch(() => jsonResponse(200, claimSuccessBody()));
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async (value: string) => {
      order.push("clipboard");
      copied.push(value);
    });
    const store = window.sessionStorage;
    const originalSetItem = store.setItem.bind(store);
    Object.defineProperty(store, "setItem", {
      configurable: true,
      writable: true,
      value: (key: string, value: string) => {
        order.push("store");
        originalSetItem(key, value);
      },
    });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => hasClaimButton(COPY_AGAIN_LABEL));

      // Exactly one claim POST; the invite was cached (state + storage) before
      // the clipboard write ran.
      expect(claim.inviteCalls()).toBe(1);
      expect(order).toEqual(["store", "clipboard"]);
      expect(copied).toEqual([INVITE_STRING]);

      const field = inviteField();
      expect(field).not.toBeNull();
      expect(field?.tagName).toBe("INPUT");
      expect(field?.readOnly).toBe(true);
      expect(field?.value).toBe(INVITE_STRING);
      expect(store.getItem(`validator:invite:${SESSION_ID}`)).toBe(INVITE_STRING);

      // The field is labeled for accessibility.
      const label = Array.from(document.querySelectorAll("label")).find(
        (node) => node.textContent === INVITE_FIELD_LABEL,
      );
      expect(label).toBeDefined();
      expect(label?.getAttribute("for")).toBe(field?.getAttribute("id"));
    } finally {
      Reflect.deleteProperty(store, "setItem");
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });

  test("a fast double click issues exactly one invite POST and disables the button while pending", async () => {
    let releaseInvite: (response: Response) => void = () => {};
    const invitePending = new Promise<Response>((resolve) => {
      releaseInvite = resolve;
    });
    const claim = installClaimFetch(() => invitePending);
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async () => {});
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      // Two synchronous clicks before the pending POST resolves. The ref lock
      // must collapse them into a single claim.
      await act(() => {
        const button = claimButton(COPY_INVITATION_LABEL);
        button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });

      expect(claim.inviteCalls()).toBe(1);
      expect(claimButton(COPY_INVITATION_LABEL).disabled).toBe(true);

      await act(async () => {
        releaseInvite(jsonResponse(200, claimSuccessBody()));
        await invitePending;
      });
      await waitForDom(() => hasClaimButton(COPY_AGAIN_LABEL));

      expect(claim.inviteCalls()).toBe(1);
      expect(inviteField()?.value).toBe(INVITE_STRING);
      expect(claimButton(COPY_AGAIN_LABEL).disabled).toBe(false);
    } finally {
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });

  test("Copy again copies the cached value and never re-POSTs the claim", async () => {
    const copied: string[] = [];
    const claim = installClaimFetch(() => jsonResponse(200, claimSuccessBody()));
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async (value: string) => {
      copied.push(value);
    });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => hasClaimButton(COPY_AGAIN_LABEL));
      expect(claim.inviteCalls()).toBe(1);
      expect(copied).toEqual([INVITE_STRING]);

      await act(() => {
        claimButton(COPY_AGAIN_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => copied.length === 2);

      // Still one POST; both copies read the same cached value.
      expect(claim.inviteCalls()).toBe(1);
      expect(copied).toEqual([INVITE_STRING, INVITE_STRING]);
      expect(inviteField()?.value).toBe(INVITE_STRING);
    } finally {
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });

  test("a 410 with a cached invite uses the cached field and local copy path without re-POSTing", async () => {
    const copied: string[] = [];
    window.sessionStorage.setItem(`validator:invite:${SESSION_ID}`, STORED_INVITE);
    const claim = installClaimFetch(() =>
      jsonResponse(410, { error: "INVITE_ALREADY_CLAIMED", message: "invite already claimed" }),
    );
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async (value: string) => {
      copied.push(value);
    });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => hasClaimButton(COPY_AGAIN_LABEL));

      // One POST only; the 410 fell back to the stored cache and copied it.
      expect(claim.inviteCalls()).toBe(1);
      expect(copied).toEqual([STORED_INVITE]);
      expect(inviteField()?.value).toBe(STORED_INVITE);
      expect(document.body.textContent).not.toContain(
        ACTION_ERROR_COPY.claim_410_no_cache,
      );
    } finally {
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });

  test("a 410 without a cached invite shows the locked claim_410_no_cache copy", async () => {
    const claim = installClaimFetch(() =>
      jsonResponse(410, { error: "INVITE_ALREADY_CLAIMED", message: "invite already claimed" }),
    );
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async () => {});
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() =>
        document.body.textContent?.includes(ACTION_ERROR_COPY.claim_410_no_cache) === true,
      );

      expect(claim.inviteCalls()).toBe(1);
      expect(inviteField()).toBeNull();
      const alert = document.querySelector("[data-post-error]");
      expect(alert?.getAttribute("role")).toBe("alert");
      expect(alert?.textContent).toBe(ACTION_ERROR_COPY.claim_410_no_cache);
      // Still on the claim CTA; no cache means no "Copy again".
      expect(hasClaimButton(COPY_AGAIN_LABEL)).toBe(false);
    } finally {
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });

  test("a 409 session-not-ready claim shows the locked claim_409_session_not_ready copy", async () => {
    const claim = installClaimFetch(() =>
      jsonResponse(409, { error: "SESSION_NOT_READY", message: "session not ready" }),
    );
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async () => {});
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() =>
        document.body.textContent?.includes(
          ACTION_ERROR_COPY.claim_409_session_not_ready,
        ) === true,
      );

      expect(claim.inviteCalls()).toBe(1);
      expect(inviteField()).toBeNull();
      expect(document.querySelector("[data-post-error]")?.textContent).toBe(
        ACTION_ERROR_COPY.claim_409_session_not_ready,
      );
    } finally {
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });

  test("a sessionStorage write failure is non-fatal and the in-memory cache stays usable", async () => {
    const copied: string[] = [];
    const claim = installClaimFetch(() => jsonResponse(200, claimSuccessBody()));
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async (value: string) => {
      copied.push(value);
    });
    const store = window.sessionStorage;
    Object.defineProperty(store, "setItem", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("storage quota exceeded");
      },
    });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => hasClaimButton(COPY_AGAIN_LABEL));

      // The storage write threw, but the in-memory cache still holds and the
      // field renders and copies.
      expect(claim.inviteCalls()).toBe(1);
      expect(inviteField()?.value).toBe(INVITE_STRING);
      expect(copied).toEqual([INVITE_STRING]);

      await act(() => {
        claimButton(COPY_AGAIN_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => copied.length === 2);
      expect(claim.inviteCalls()).toBe(1);
      expect(copied).toEqual([INVITE_STRING, INVITE_STRING]);
    } finally {
      Reflect.deleteProperty(store, "setItem");
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });

  test("a clipboard failure keeps the cached invite field visible with the manual-copy notice", async () => {
    const claim = installClaimFetch(() => jsonResponse(200, claimSuccessBody()));
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installRejectedClipboard();
    const execCommand = installExecCommand(() => false);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(
        () => document.body.textContent?.includes(CLAIM_COPY_FAILURE_TEXT) === true,
      );

      // The dedicated cached field stays visible after the copy failed.
      expect(inviteField()?.value).toBe(INVITE_STRING);
      expect(hasClaimButton(COPY_AGAIN_LABEL)).toBe(true);
      // Existing copy-notice fallback semantics are reused.
      const fallback = document.querySelector("[data-copy-fallback]") as
        | HTMLInputElement
        | null;
      expect(fallback).not.toBeNull();
      expect(fallback?.value).toBe(INVITE_STRING);
      expect(document.getElementById("results-copy-failure")?.textContent).toBe(
        CLAIM_COPY_FAILURE_TEXT,
      );
    } finally {
      await act(() => {
        root.unmount();
      });
      execCommand.restore();
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });

  test("a claim POST for session A that resolves after navigation to session B never writes B state", async () => {
    const sessionB = "0193b1d3-8d2e-7c5b-9f3f-2b3c4d5e6f70";
    const inviteA = "https://peer.example/ocm/invite/AAA_stale";
    const inviteB = "https://peer.example/ocm/invite/BBB_live";
    let releaseA: (response: Response) => void = () => {};
    const pendingA = new Promise<Response>((resolve) => {
      releaseA = resolve;
    });
    let releaseB: (response: Response) => void = () => {};
    const pendingB = new Promise<Response>((resolve) => {
      releaseB = resolve;
    });
    let aInviteCalls = 0;
    let bInviteCalls = 0;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("config.json")) {
        return jsonResponse(200, {
          poll_interval_ms: 1,
          active_poll_interval_ms: 1,
          backoff_initial_ms: 1,
          backoff_max_ms: 1,
          request_timeout_ms: 5000,
          validator_api_origin: API_ORIGIN,
        });
      }
      // Invite (POST) routes are checked before the general session GET route
      // because the invite path contains the session path as a prefix.
      if (url.includes(`/api/session/${sessionB}/invite`)) {
        bInviteCalls += 1;
        return pendingB;
      }
      if (url.includes(`/api/session/${SESSION_ID}/invite`)) {
        aInviteCalls += 1;
        return pendingA;
      }
      if (url.includes(`/api/session/${sessionB}`)) {
        return jsonResponse(200, {
          state: "invite_minted",
          ts: 1,
          optInActive: true,
          nextInstruction: "paste_s1",
        });
      }
      if (url.includes(`/api/session/${SESSION_ID}`)) {
        return jsonResponse(200, {
          state: "invite_minted",
          ts: 1,
          optInActive: true,
          nextInstruction: "paste_s1",
        });
      }
      if (url.includes(`/api/report/${sessionB}`)) {
        return jsonResponse(200, liveReport(specification(() => "pass")));
      }
      if (url.includes(`/api/report/${SESSION_ID}`)) {
        return jsonResponse(200, liveReport(specification(() => "pass")));
      }
      return jsonResponse(404, { error: "missing", message: "missing" });
    }) as typeof fetch;
    const restoreSecure = installIsSecureContext(true);
    const copied: string[] = [];
    const restoreClipboard = installClipboardWriteText(async (value: string) => {
      copied.push(value);
    });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      // Session A: start a claim POST and leave it pending.
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));
      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      expect(aInviteCalls).toBe(1);
      expect(claimButton(COPY_INVITATION_LABEL).disabled).toBe(true);

      // Navigate to session B before A resolves, then start B's own claim so B
      // owns the shared lock and busy state.
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={sessionB} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));
      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      expect(bInviteCalls).toBe(1);
      expect(claimButton(COPY_INVITATION_LABEL).disabled).toBe(true);

      // Resolve A's stale POST. Its result must be ignored entirely.
      await act(async () => {
        releaseA(jsonResponse(200, claimSuccessBody(inviteA)));
        await pendingA;
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
      });

      // B remains untouched: no cache field, still pending on its own claim,
      // no copy notice, and neither session's storage was written by A.
      expect(inviteField()).toBeNull();
      expect(hasClaimButton(COPY_AGAIN_LABEL)).toBe(false);
      expect(claimButton(COPY_INVITATION_LABEL).disabled).toBe(true);
      expect(document.body.textContent).not.toContain(inviteA);
      expect(document.body.textContent).not.toContain(COPY_SUCCESS_TEXT);
      expect(copied).toEqual([]);
      expect(window.sessionStorage.getItem(`validator:invite:${sessionB}`)).toBeNull();
      expect(window.sessionStorage.getItem(`validator:invite:${SESSION_ID}`)).toBeNull();

      // B's own claim still resolves normally and independently, caching B's
      // invite (in-memory) and never A's stale value.
      await act(async () => {
        releaseB(jsonResponse(200, claimSuccessBody(inviteB)));
        await pendingB;
      });
      await waitForDom(() => hasClaimButton(COPY_AGAIN_LABEL));
      expect(bInviteCalls).toBe(1);
      expect(inviteField()?.value).toBe(inviteB);
      expect(document.body.textContent).not.toContain(inviteA);
    } finally {
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      globalThis.fetch = previousFetch;
    }
  });

  test("an uncached 410 lock survives a repeat click without issuing a second POST", async () => {
    const claim = installClaimFetch(() =>
      jsonResponse(410, { error: "INVITE_ALREADY_CLAIMED", message: "invite already claimed" }),
    );
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async () => {});
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(
        () => document.body.textContent?.includes(ACTION_ERROR_COPY.claim_410_no_cache) === true,
      );

      // Terminally locked: error shown and CTA disabled after busy cleared.
      expect(claim.inviteCalls()).toBe(1);
      expect(claimButton(COPY_INVITATION_LABEL).disabled).toBe(true);

      // A second click must not re-POST and the CTA stays disabled.
      await act(async () => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
      });
      expect(claim.inviteCalls()).toBe(1);
      expect(claimButton(COPY_INVITATION_LABEL).disabled).toBe(true);
      expect(hasClaimButton(COPY_AGAIN_LABEL)).toBe(false);
      expect(document.querySelector("[data-post-error]")?.textContent).toBe(
        ACTION_ERROR_COPY.claim_410_no_cache,
      );
    } finally {
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });

  test("ignores a late claim POST result once polling has left paste_s1, and a 410 INVITE_ALREADY_CLAIMED does not write the shared post-error channel", async () => {
    const gate = new SessionPollGate();
    let releaseClaim: (response: Response) => void = () => {};
    const claimPending = new Promise<Response>((resolve) => {
      releaseClaim = resolve;
    });
    const claim = installGatedClaimFetch(gate, () => claimPending);
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async () => {});
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      expect(claim.inviteCalls()).toBe(1);

      // Poll moves past paste_s1 while the claim POST is still pending.
      await releasePoll(gate, 2, {
        state: "reverse_awaiting_invite",
        ts: 2,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
      expect(hasClaimButton(COPY_INVITATION_LABEL)).toBe(false);

      // The pending claim POST now resolves with a 410 INVITE_ALREADY_CLAIMED;
      // it must not write the shared post-error channel on the new instruction.
      await act(async () => {
        releaseClaim(
          jsonResponse(410, { error: "INVITE_ALREADY_CLAIMED", message: "invite already claimed" }),
        );
        await claimPending;
      });
      expect(document.querySelector("[data-post-error]")).toBeNull();
      expect(document.body.textContent).not.toContain(ACTION_ERROR_COPY.claim_410_no_cache);

      await releasePoll(gate, 3, {
        state: "reverse_awaiting_invite",
        ts: 3,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
      expect(reverseTextarea()).not.toBeNull();
    } finally {
      await act(() => {
        root.unmount();
      });
      gate.settleRemaining();
      claim.restore();
      restoreClipboard();
      restoreSecure();
    }
  });

  test("clears the shared post-error channel when polling advances from paste_s1 to paste_s2", async () => {
    const gate = new SessionPollGate();
    const claim = installGatedClaimFetch(gate, () =>
      jsonResponse(409, { error: "SESSION_NOT_READY", message: "session not ready" }),
    );
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async () => {});
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() =>
        document.body.textContent?.includes(
          ACTION_ERROR_COPY.claim_409_session_not_ready,
        ) === true,
      );
      expect(claim.inviteCalls()).toBe(1);
      expect(document.querySelector("[data-post-error]")?.textContent).toBe(
        ACTION_ERROR_COPY.claim_409_session_not_ready,
      );

      // Poll advances past paste_s1; the render-phase clear must remove the
      // visible post-error from the shared channel.
      await releasePoll(gate, 2, {
        state: "reverse_awaiting_invite",
        ts: 2,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
      await waitForDom(() => document.querySelector("[data-post-error]") === null);
      expect(document.querySelector("[data-post-error]")).toBeNull();
      expect(document.body.textContent).not.toContain(
        ACTION_ERROR_COPY.claim_409_session_not_ready,
      );
      expect(reverseTextarea()).not.toBeNull();
    } finally {
      await act(() => {
        root.unmount();
      });
      gate.settleRemaining();
      claim.restore();
      restoreClipboard();
      restoreSecure();
    }
  });

  test("does not match a 410 claim response by HTTP status when the flat error code differs", async () => {
    const gate = new SessionPollGate();
    const claim = installGatedClaimFetch(gate, () =>
      jsonResponse(410, { error: "GONE", message: "invite gone" }),
    );
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async () => {});
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => document.querySelector("[data-post-error]") !== null);

      // A 410 whose flat error code is NOT INVITE_ALREADY_CLAIMED must not
      // trigger the claim-locked copy or lock; matching is by result.error,
      // not HTTP status. The generic fallthrough still surfaces the backend
      // message, proving the claim-specific branch did not run.
      expect(document.body.textContent).not.toContain(
        ACTION_ERROR_COPY.claim_410_no_cache,
      );
      expect(document.querySelector("[data-post-error]")?.textContent ?? "").toContain(
        "invite gone",
      );
    } finally {
      await act(() => {
        root.unmount();
      });
      gate.settleRemaining();
      claim.restore();
      restoreClipboard();
      restoreSecure();
    }
  });

  test("a claim succeeds when sessionStorage access throws and stays usable once storage returns", async () => {
    const copied: string[] = [];
    const claim = installClaimFetch(() => jsonResponse(200, claimSuccessBody()));
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async (value: string) => {
      copied.push(value);
    });
    // Simulate sessionStorage being unavailable: any access throws. Both
    // readStoredInvite and writeStoredInvite must swallow this and rely on the
    // in-memory cache instead.
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("sessionStorage unavailable");
      },
    });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => hasClaimButton(COPY_AGAIN_LABEL));

      // The claim succeeded and cached in component memory despite storage
      // access throwing; the labeled read-only field renders and copied.
      expect(claim.inviteCalls()).toBe(1);
      const field = inviteField();
      expect(field?.tagName).toBe("INPUT");
      expect(field?.readOnly).toBe(true);
      expect(field?.value).toBe(INVITE_STRING);
      const label = Array.from(document.querySelectorAll("label")).find(
        (node) => node.textContent === INVITE_FIELD_LABEL,
      );
      expect(label?.getAttribute("for")).toBe(field?.getAttribute("id"));
      expect(copied).toEqual([INVITE_STRING]);
      // No fatal error surfaced.
      expect(document.querySelector("[data-post-error]")).toBeNull();

      // Restore storage availability; the in-memory cache remains usable and a
      // Copy again still reads it without a second POST.
      if (originalDescriptor === undefined) {
        Reflect.deleteProperty(window, "sessionStorage");
      } else {
        Object.defineProperty(window, "sessionStorage", originalDescriptor);
      }
      await act(() => {
        claimButton(COPY_AGAIN_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => copied.length === 2);
      expect(claim.inviteCalls()).toBe(1);
      expect(copied).toEqual([INVITE_STRING, INVITE_STRING]);
      expect(inviteField()?.value).toBe(INVITE_STRING);
    } finally {
      if (originalDescriptor === undefined) {
        Reflect.deleteProperty(window, "sessionStorage");
      } else {
        Object.defineProperty(window, "sessionStorage", originalDescriptor);
      }
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });
});
