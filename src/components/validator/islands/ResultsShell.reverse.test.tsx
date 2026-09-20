import { act } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import ResultsShell, {
  MAX_REVERSE_INVITE_LENGTH,
  REVERSE_INVITE_FIELD_LABEL,
  REVERSE_INVITE_SUBMIT_LABEL,
  REVERSE_INVITE_TOO_LONG_TEXT,
  reverseInviteErrorCopy,
} from "./ResultsShell";
import { type CanonicalAreaId } from "../lib/validatorScore";
import { ACTION_ERROR_COPY } from "../lib/validatorGuidance";
import { type ReportResponse, type ValidatorFailure } from "../lib/validatorFetch";
import { requestUrl, jsonResponse } from "../test-helpers/fetchStub";
import { registerHappyDom, teardownHappyDom } from "../test-helpers/happyDom";

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

function httpFailure(status: number, error: string, message: string): ValidatorFailure {
  return { ok: false, kind: "http", status, error, message };
}

describe("reverseInviteErrorCopy", () => {
  test("maps wrong_target_host, conflict, and missing_field reasonCodes to the shared paste_* guidance copy", () => {
    expect(
      reverseInviteErrorCopy(
        httpFailure(422, "wrong_target_host", "invite sender does not match the session target host"),
      ),
    ).toBe(ACTION_ERROR_COPY.paste_422_wrong_target_host);
    expect(
      reverseInviteErrorCopy(httpFailure(409, "conflict", "a different reverse invite is already imported")),
    ).toBe(ACTION_ERROR_COPY.paste_409_conflict);
    expect(reverseInviteErrorCopy(httpFailure(400, "missing_field", "invalid invite string"))).toBe(
      ACTION_ERROR_COPY.paste_400_invalid_invitation,
    );
  });

  test("falls back to the backend message for peer_unreachable, not_found, and internal_error", () => {
    expect(
      reverseInviteErrorCopy(
        httpFailure(502, "peer_unreachable", "failed to complete the reverse invite exchange"),
      ),
    ).toBe("failed to complete the reverse invite exchange");
    expect(reverseInviteErrorCopy(httpFailure(404, "not_found", "session not found"))).toBe(
      "session not found",
    );
    expect(reverseInviteErrorCopy(httpFailure(500, "internal_error", "failed to store invite"))).toBe(
      "failed to store invite",
    );
  });

  test("falls back to a generic message when the backend message is empty", () => {
    expect(reverseInviteErrorCopy(httpFailure(500, "internal_error", ""))).toBe(
      "Could not import the return invitation.",
    );
  });
});

// AG-1.5 reverse-invite form helpers.

function reverseTextarea(): HTMLTextAreaElement | null {
  return document.querySelector("[data-reverse-invite-field]");
}

function reverseSubmitButton(): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (node) => node.textContent === REVERSE_INVITE_SUBMIT_LABEL,
  );
  if (button === undefined) {
    throw new Error(`missing <button> with text ${JSON.stringify(REVERSE_INVITE_SUBMIT_LABEL)}`);
  }
  return button;
}

function reverseErrorEl(): HTMLElement | null {
  return document.querySelector("[data-post-error]");
}

// React tracks a controlled textarea's DOM value on the node instance to
// detect whether a later `input` event reflects a real change, and this
// suite's full run mounts and unmounts hundreds of live ResultsShell
// instances before this describe block, each running its own fast (1ms)
// session poll loop. That history leaves React's native "input"-event
// change-detection path for a freshly rendered textarea unreliable by the
// time this describe block runs, even though the same textarea's "click"
// delegation keeps working. Setting the value through the prototype's own
// setter (bypassing the instance-level tracker) is still correct for a
// realistic DOM value, but the change is committed by calling the
// textarea's own current `onChange` prop directly (via the `__reactProps$`
// key React stores on every host DOM node) rather than only dispatching a
// native "input" event, so this helper does not depend on that fragile
// native delegation path.
function setReverseTextareaValueSync(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (setter !== undefined) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
  const propsKey = Object.keys(el).find((key) => key.startsWith("__reactProps$"));
  if (propsKey !== undefined) {
    const props = (el as unknown as Record<string, { onChange?: (e: unknown) => void }>)[
      propsKey
    ];
    props.onChange?.({ target: el });
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function typeAndClickReverseSubmit(
  el: HTMLTextAreaElement,
  value: string,
  clicks = 1,
): Promise<void> {
  await act(() => {
    setReverseTextareaValueSync(el, value);
  });
  await act(() => {
    const button = reverseSubmitButton();
    for (let i = 0; i < clicks; i += 1) {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
  });
}

function nestedError(reasonCode: string, message: string): Record<string, unknown> {
  return { error: { code: reasonCode, reasonCode, message } };
}

// Fixed live paste_s2 fetch: the session poll always returns
// reverse_awaiting_invite/paste_s2, so the reverse row stays current across
// repeated polls while a test drives one or more reverse-invite submits.
function installFixedReverseFetch(handleReverse: () => Promise<Response> | Response): {
  restore: () => void;
  reverseCalls: () => number;
  reverseBodies: () => string[];
} {
  let reverseCalls = 0;
  const bodies: string[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
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
    if (url.includes(`/api/session/${SESSION_ID}/reverse-invite`)) {
      reverseCalls += 1;
      if (typeof init?.body === "string") {
        bodies.push(init.body);
      }
      return handleReverse();
    }
    if (url.includes(`/api/session/${SESSION_ID}`)) {
      return jsonResponse(200, {
        state: "reverse_awaiting_invite",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s2",
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
    reverseCalls: () => reverseCalls,
    reverseBodies: () => bodies,
  };
}

// Gated live fetch: the session poll route is driven explicitly through a
// SessionPollGate (see releasePoll) so a test can move the instruction past
// paste_s2 while a reverse-invite POST is still in flight, with no
// wall-clock race.
function installGatedReverseFetch(
  gate: SessionPollGate,
  handleReverse: () => Promise<Response> | Response,
): { restore: () => void; reverseCalls: () => number } {
  let reverseCalls = 0;
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
    if (url.includes(`/api/session/${SESSION_ID}/reverse-invite`)) {
      reverseCalls += 1;
      return handleReverse();
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
    reverseCalls: () => reverseCalls,
  };
}

const VALID_REVERSE_INVITE = "dG9rZW5AcGVlci5leGFtcGxl";

describe("ResultsShell paste_s2 reverse invite", () => {
  beforeAll(async () => {
    await registerHappyDom("http://localhost/?host=peer.example&id=" + SESSION_ID);
  });

  afterAll(() => {
    teardownHappyDom();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
  });

  test("renders the form only while the current instruction is exactly paste_s2, and a previous 422 does not latch it open once polling advances", async () => {
    const gate = new SessionPollGate();
    const reverse = installGatedReverseFetch(gate, () =>
      jsonResponse(
        422,
        nestedError("wrong_target_host", "invite sender does not match the session target host"),
      ),
    );
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
      expect(reverseTextarea()).toBeNull();

      await releasePoll(gate, 2, {
        state: "reverse_awaiting_invite",
        ts: 2,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
      const textarea = reverseTextarea();
      expect(textarea).not.toBeNull();
      expect(textarea?.tagName).toBe("TEXTAREA");
      const label = Array.from(document.querySelectorAll("label")).find(
        (node) => node.textContent === REVERSE_INVITE_FIELD_LABEL,
      );
      expect(label).toBeDefined();
      expect(label?.getAttribute("for")).toBe(textarea?.getAttribute("id"));

      await typeAndClickReverseSubmit(textarea as HTMLTextAreaElement, VALID_REVERSE_INVITE);
      await waitForDom(
        () => reverseErrorEl()?.textContent === ACTION_ERROR_COPY.paste_422_wrong_target_host,
      );
      expect(reverseErrorEl()?.getAttribute("role")).toBe("alert");
      expect(reverse.reverseCalls()).toBe(1);

      await releasePoll(gate, 3, {
        state: "reverse_invite_accepted",
        ts: 3,
        optInActive: true,
        nextInstruction: "wait_forward_share",
      });
      expect(reverseTextarea()).toBeNull();
      expect(document.body.textContent).not.toContain(
        ACTION_ERROR_COPY.paste_422_wrong_target_host,
      );
    } finally {
      await act(() => {
        root.unmount();
      });
      gate.settleRemaining();
      reverse.restore();
    }
  });

  test("trims only surrounding whitespace on submit, preserving inner content, and a 200 never optimistically advances the UI", async () => {
    const reverse = installFixedReverseFetch(() => jsonResponse(200, { status: "accepted" }));
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => reverseTextarea() !== null);

      const raw = "  token@peer.example  is   ok  ";
      await typeAndClickReverseSubmit(reverseTextarea() as HTMLTextAreaElement, raw);
      await waitForDom(() => reverse.reverseCalls() === 1);

      // Leading/trailing whitespace is gone; the internal double/triple
      // spaces the user typed survive untouched.
      expect(reverse.reverseBodies()).toEqual([JSON.stringify({ inviteString: raw.trim() })]);
      expect(reverse.reverseBodies()[0]).toContain("is   ok");

      // A 200 never advances the UI on its own: the reverse row is still
      // current and its form is still mounted, because only the poll
      // leaving paste_s2 is authoritative.
      expect(document.querySelector('[aria-current="step"]')?.textContent).toContain(
        "Accept return invitation",
      );
      expect(reverseTextarea()).not.toBeNull();
      expect(reverseErrorEl()).toBeNull();
    } finally {
      await act(() => {
        root.unmount();
      });
      reverse.restore();
    }
  });

  test("rejects input over MAX_REVERSE_INVITE_LENGTH without a POST and shows an accessible error", async () => {
    const reverse = installFixedReverseFetch(() => jsonResponse(200, { status: "accepted" }));
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => reverseTextarea() !== null);

      const overLong = "a".repeat(MAX_REVERSE_INVITE_LENGTH + 1);
      await typeAndClickReverseSubmit(reverseTextarea() as HTMLTextAreaElement, overLong);
      await waitForDom(() => reverseErrorEl() !== null);

      expect(reverse.reverseCalls()).toBe(0);
      const alert = reverseErrorEl();
      expect(alert?.getAttribute("role")).toBe("alert");
      expect(alert?.textContent).toBe(REVERSE_INVITE_TOO_LONG_TEXT);
    } finally {
      await act(() => {
        root.unmount();
      });
      reverse.restore();
    }
  });

  test("a fast double click issues exactly one reverse POST and disables the submit button while busy", async () => {
    let releaseReverse: (response: Response) => void = () => {};
    const reversePending = new Promise<Response>((resolve) => {
      releaseReverse = resolve;
    });
    const reverse = installFixedReverseFetch(() => reversePending);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => reverseTextarea() !== null);

      // Two synchronous clicks before the pending POST resolves. The ref
      // lock must collapse them into a single submit.
      await typeAndClickReverseSubmit(
        reverseTextarea() as HTMLTextAreaElement,
        VALID_REVERSE_INVITE,
        2,
      );

      expect(reverse.reverseCalls()).toBe(1);
      expect(reverseSubmitButton().disabled).toBe(true);

      await act(async () => {
        releaseReverse(jsonResponse(200, { status: "accepted" }));
        await reversePending;
      });
      await waitForDom(() => reverseSubmitButton().disabled === false);

      expect(reverse.reverseCalls()).toBe(1);
    } finally {
      await act(() => {
        root.unmount();
      });
      reverse.restore();
    }
  });

  test("ignores a late reverse POST result once polling has left paste_s2, and a 502 peer_unreachable does not latch the form or halt polling", async () => {
    const gate = new SessionPollGate();
    let releaseReverse: (response: Response) => void = () => {};
    const reversePending = new Promise<Response>((resolve) => {
      releaseReverse = resolve;
    });
    const reverse = installGatedReverseFetch(gate, () => reversePending);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      await releasePoll(gate, 1, {
        state: "reverse_awaiting_invite",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
      const textarea = reverseTextarea();
      expect(textarea).not.toBeNull();
      await typeAndClickReverseSubmit(textarea as HTMLTextAreaElement, VALID_REVERSE_INVITE);
      expect(reverse.reverseCalls()).toBe(1);
      expect(reverseSubmitButton().disabled).toBe(true);

      // Poll moves past paste_s2 while the POST is still pending.
      await releasePoll(gate, 2, {
        state: "reverse_invite_accepted",
        ts: 2,
        optInActive: true,
        nextInstruction: "wait_forward_share",
      });
      expect(reverseTextarea()).toBeNull();

      // The pending POST now resolves with a 502; it must not resurrect the
      // form, show an error, or otherwise disrupt continued polling.
      await act(async () => {
        releaseReverse(
          jsonResponse(502, nestedError("peer_unreachable", "failed to complete the reverse invite exchange")),
        );
        await reversePending;
      });
      expect(reverseTextarea()).toBeNull();
      expect(document.body.textContent).not.toContain(
        "failed to complete the reverse invite exchange",
      );
      expect(document.body.textContent).not.toContain("We could not update this scan.");

      await releasePoll(gate, 3, {
        state: "forward_share_sent",
        ts: 3,
        optInActive: true,
        nextInstruction: "open_forward_file",
      });
      expect(document.body.textContent).toContain("Open the forwarded file");
    } finally {
      await act(() => {
        root.unmount();
      });
      gate.settleRemaining();
      reverse.restore();
    }
  });

  test("maps backend 409 conflict and 400 missing_field reasonCodes to the shared guidance copy across repeat submits", async () => {
    let nextResponse = jsonResponse(
      409,
      nestedError("conflict", "a different reverse invite is already imported"),
    );
    const reverse = installFixedReverseFetch(() => nextResponse);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => reverseTextarea() !== null);

      await typeAndClickReverseSubmit(reverseTextarea() as HTMLTextAreaElement, VALID_REVERSE_INVITE);
      await waitForDom(
        () => reverseErrorEl()?.textContent === ACTION_ERROR_COPY.paste_409_conflict,
      );

      nextResponse = jsonResponse(400, nestedError("missing_field", "invalid invite string"));
      await act(() => {
        reverseSubmitButton().dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(
        () => reverseErrorEl()?.textContent === ACTION_ERROR_COPY.paste_400_invalid_invitation,
      );

      expect(reverse.reverseCalls()).toBe(2);
    } finally {
      await act(() => {
        root.unmount();
      });
      reverse.restore();
    }
  });

  test("a reverse POST for session A that resolves after navigation to session B never writes B state", async () => {
    const sessionB = "0193b1d3-8d2e-7c5b-9f3f-2b3c4d5e6f70";
    let releaseA: (response: Response) => void = () => {};
    const pendingA = new Promise<Response>((resolve) => {
      releaseA = resolve;
    });
    let aReverseCalls = 0;
    let bReverseCalls = 0;
    const bBodies: string[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
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
      // Reverse-invite (POST) routes are checked before the general session
      // GET route because the invite path contains the session path as a
      // prefix.
      if (url.includes(`/api/session/${sessionB}/reverse-invite`)) {
        bReverseCalls += 1;
        if (typeof init?.body === "string") {
          bBodies.push(init.body);
        }
        return jsonResponse(200, { status: "accepted" });
      }
      if (url.includes(`/api/session/${SESSION_ID}/reverse-invite`)) {
        aReverseCalls += 1;
        return pendingA;
      }
      if (url.includes(`/api/session/${sessionB}`)) {
        return jsonResponse(200, {
          state: "reverse_awaiting_invite",
          ts: 1,
          optInActive: true,
          nextInstruction: "paste_s2",
        });
      }
      if (url.includes(`/api/session/${SESSION_ID}`)) {
        return jsonResponse(200, {
          state: "reverse_awaiting_invite",
          ts: 1,
          optInActive: true,
          nextInstruction: "paste_s2",
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
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      // Session A: reach paste_s2 and start a reverse-invite POST, then
      // leave it pending.
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => reverseTextarea() !== null);
      await typeAndClickReverseSubmit(
        reverseTextarea() as HTMLTextAreaElement,
        VALID_REVERSE_INVITE,
      );
      expect(aReverseCalls).toBe(1);
      expect(reverseSubmitButton().disabled).toBe(true);

      // Navigate to session B before A resolves. The session-change reset
      // clears the shared ref lock and busy state, so B renders its own
      // fresh, enabled form.
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={sessionB} />);
      });
      await waitForDom(() => reverseTextarea() !== null);
      expect(reverseTextarea()?.value).toBe("");
      expect(reverseSubmitButton().disabled).toBe(false);
      expect(reverseErrorEl()).toBeNull();

      // Resolve A's stale POST with an error. Its result must be ignored
      // entirely: it must not surface on B's screen, and it must not be
      // attributed to B's own reverse-invite call count.
      await act(async () => {
        releaseA(
          jsonResponse(
            502,
            nestedError("peer_unreachable", "failed to complete the reverse invite exchange"),
          ),
        );
        await pendingA;
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
      });

      // B remains untouched: no error, form still present and enabled, and
      // B's own call count is still zero.
      expect(reverseErrorEl()).toBeNull();
      expect(document.body.textContent).not.toContain(
        "failed to complete the reverse invite exchange",
      );
      expect(bReverseCalls).toBe(0);
      const textareaB = reverseTextarea();
      expect(textareaB).not.toBeNull();
      expect(textareaB?.tagName).toBe("TEXTAREA");
      expect(textareaB?.disabled).toBe(false);
      expect(reverseSubmitButton().disabled).toBe(false);

      // B's own submit still works normally and independently, posting only
      // B's invite string, never A's.
      await typeAndClickReverseSubmit(textareaB as HTMLTextAreaElement, VALID_REVERSE_INVITE);
      await waitForDom(() => bReverseCalls === 1);
      expect(bBodies).toEqual([JSON.stringify({ inviteString: VALID_REVERSE_INVITE })]);
      expect(reverseErrorEl()).toBeNull();
      expect(document.body.textContent).not.toContain(
        "failed to complete the reverse invite exchange",
      );
    } finally {
      await act(() => {
        root.unmount();
      });
      globalThis.fetch = previousFetch;
    }
  });
});
