import { act } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import ResultsShell from "./ResultsShell";
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

function setWindowHref(href: string): void {
  const host = globalThis as unknown as { window?: { location?: { href: string } } };
  if (host.window?.location !== undefined) {
    host.window.location.href = href;
  }
}

function pageLinkButton(): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (node) => node.textContent === "Copy page link",
  );
  if (button === undefined) {
    throw new Error("missing Copy page link button");
  }
  return button;
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

function viewReportLink(): HTMLAnchorElement {
  const link = Array.from(document.querySelectorAll("a")).find(
    (node) => node.textContent === "View report",
  );
  if (link === undefined) {
    throw new Error("missing View report link");
  }
  return link;
}

function reservedSlotCounts(): {
  guidance: number;
  form: number;
  alert: number;
  cta: number;
} {
  return {
    guidance: document.querySelectorAll("[data-guidance-slot]").length,
    form: document.querySelectorAll("[data-reserved-form-slot]").length,
    alert: document.querySelectorAll("[data-reserved-alert-slot]").length,
    cta: document.querySelectorAll("[data-cta-slot]").length,
  };
}

function installGatedSessionFetch(gate: SessionPollGate): () => void {
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
    if (url.includes(`/api/session/${SESSION_ID}`)) {
      return gate.request();
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(200, liveReport(specification(() => "pass")));
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

describe("ResultsShell focus order, live regions, and reserved layout", () => {
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

  test("does not autofocus the current card on the first poll or a repeat poll", async () => {
    const gate = new SessionPollGate();
    const restoreFetch = installGatedSessionFetch(gate);
    setWindowHref(`https://localhost/?host=peer.example&id=${SESSION_ID}`);
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
      const firstCard = document.querySelector('[aria-current="step"]');
      expect(firstCard).not.toBeNull();
      expect(firstCard?.getAttribute("tabindex")).toBeNull();
      expect(document.activeElement === firstCard).toBe(false);
      expect(document.querySelector("[data-step-list]")?.hasAttribute("aria-live")).toBe(false);

      const copyButton = pageLinkButton();
      copyButton.focus();
      expect(document.activeElement).toBe(copyButton);

      await releasePoll(gate, 2, {
        state: "invite_minted",
        ts: 2,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      expect(document.activeElement).toBe(copyButton);
      const repeatCard = document.querySelector('[aria-current="step"]');
      expect(repeatCard?.getAttribute("tabindex")).toBeNull();
      expect(document.activeElement === repeatCard).toBe(false);
    } finally {
      await act(async () => {
        root.unmount();
      });
      gate.settleRemaining();
      restoreFetch();
    }
  });

  test("moves focus to the new current card only when an instruction change unmounts the focused control", async () => {
    const gate = new SessionPollGate();
    const restoreFetch = installGatedSessionFetch(gate);
    setWindowHref(`https://localhost/?host=peer.example&id=${SESSION_ID}`);
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
      const reportLink = viewReportLink();
      reportLink.focus();
      expect(document.activeElement).toBe(reportLink);

      await releasePoll(gate, 2, {
        state: "reverse_awaiting_invite",
        ts: 2,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
      const currentCard = document.querySelector('[aria-current="step"]');
      expect(currentCard).not.toBeNull();
      expect(currentCard?.textContent).toContain("Accept return invitation");
      expect(currentCard?.getAttribute("tabindex")).toBe("-1");
      expect(currentCard?.getAttribute("tabindex")).not.toBe("0");
      expect(document.activeElement).toBe(currentCard);
      expect(document.querySelectorAll('[aria-current="step"]').length).toBe(1);
    } finally {
      await act(async () => {
        root.unmount();
      });
      gate.settleRemaining();
      restoreFetch();
    }
  });

  test("does not move focus when an instruction change leaves the focused control mounted", async () => {
    const gate = new SessionPollGate();
    const restoreFetch = installGatedSessionFetch(gate);
    setWindowHref(`https://localhost/?host=peer.example&id=${SESSION_ID}`);
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
      const copyButton = pageLinkButton();
      copyButton.focus();
      expect(document.activeElement).toBe(copyButton);

      await releasePoll(gate, 2, {
        state: "reverse_awaiting_invite",
        ts: 2,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
      expect(document.activeElement).toBe(copyButton);
      const currentCard = document.querySelector('[aria-current="step"]');
      expect(currentCard).not.toBeNull();
      expect(currentCard?.getAttribute("tabindex")).toBeNull();
      expect(document.activeElement === currentCard).toBe(false);
    } finally {
      await act(async () => {
        root.unmount();
      });
      gate.settleRemaining();
      restoreFetch();
    }
  });

  test("exposes one polite atomic step status, keeps guidance outside live regions, and keeps reserved slots mounted", async () => {
    const gate = new SessionPollGate();
    const restoreFetch = installGatedSessionFetch(gate);
    setWindowHref(`https://localhost/?host=peer.example&id=${SESSION_ID}`);
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
      const firstAnnounce = document.querySelector("[data-step-status]");
      expect(firstAnnounce).not.toBeNull();
      expect(firstAnnounce?.getAttribute("role")).toBe("status");
      expect(firstAnnounce?.getAttribute("aria-live")).toBe("polite");
      expect(firstAnnounce?.getAttribute("aria-atomic")).toBe("true");
      expect(firstAnnounce?.textContent).toBe("Step 3 of 6: Paste the outgoing invite");
      expect(firstAnnounce?.textContent).not.toContain("Use Copy invitation");
      expect(document.querySelectorAll("[data-step-status]").length).toBe(1);
      expect(document.querySelector("[data-step-list]")?.closest("[aria-live]")).toBeNull();
      for (const slot of Array.from(document.querySelectorAll("[data-guidance-slot]"))) {
        expect(slot.closest("[aria-live]")).toBeNull();
      }
      for (const copy of Object.values(ACTION_ERROR_COPY)) {
        expect(firstAnnounce?.textContent).not.toContain(copy);
      }
      expect(document.querySelectorAll("textarea").length).toBe(0);
      const reservedBefore = reservedSlotCounts();
      expect(reservedBefore).toEqual({ guidance: 6, form: 1, alert: 1, cta: 6 });
      expect(document.querySelector("[data-reserved-alert-slot]")?.getAttribute("role")).toBeNull();
      expect(document.querySelector("[data-reserved-form-slot]")?.contains(
        document.querySelector("[data-reserved-alert-slot]") as Node,
      )).toBe(true);

      await releasePoll(gate, 2, {
        state: "reverse_awaiting_invite",
        ts: 2,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
      const secondAnnounce = document.querySelector("[data-step-status]");
      expect(secondAnnounce?.textContent).toBe("Step 4 of 6: Paste the reverse invite");
      expect(reservedSlotCounts()).toEqual(reservedBefore);
      expect(document.querySelectorAll('[role="alert"]').length).toBe(0);
      expect(secondAnnounce?.textContent).not.toContain("We could not");
      for (const copy of Object.values(ACTION_ERROR_COPY)) {
        expect(secondAnnounce?.textContent).not.toContain(copy);
      }
    } finally {
      await act(async () => {
        root.unmount();
      });
      gate.settleRemaining();
      restoreFetch();
    }
  });
});
