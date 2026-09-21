import { act } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

import ResultsShell, {
  COPY_INVITATION_LABEL,
} from "@/components/validator/islands/ResultsShell";
import { RESULT_HEADLINE, type CanonicalAreaId } from "@/components/validator/lib/validatorScore";
import { UNKNOWN_GUIDANCE_TITLE, guidanceFor } from "@/components/validator/lib/validatorGuidance";
import {
  joinValidatorUrl,
  type ReportResponse,
} from "@/components/validator/lib/validatorFetch";
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

function permanentReport(score: unknown, extra: Partial<ReportResponse> = {}): ReportResponse {
  return {
    schema: "federation_tester_report.v1",
    id: SESSION_ID,
    visibility: "permanent",
    reportUrl: `/validator/report/${SESSION_ID}`,
    score: { specification: score },
    evidence: [],
    ...extra,
  };
}

function installTerminalReportFetch(report: ReportResponse): () => void {
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
      return jsonResponse(200, { state: "terminal_pass", ts: 1, optInActive: false });
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(200, report);
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

function installActiveInviteFetch(options?: {
  origin?: string;
  liveReportExtra?: Partial<ReportResponse>;
}): () => void {
  const origin = options?.origin ?? API_ORIGIN;
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
        validator_api_origin: origin,
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
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(
        200,
        liveReport(specification(() => "pass"), options?.liveReportExtra ?? {}),
      );
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

function setWindowHref(href: string): void {
  const host = globalThis as unknown as { window?: { location?: { href: string } } };
  if (host.window?.location !== undefined) {
    host.window.location.href = href;
  }
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

/**
 * Release a poll that ends the loop (typically terminal) and that makes no
 * further session poll call. There is no next call to await, so this flushes
 * a bounded number of microtask and macrotask turns instead, giving the
 * terminal report fetch and resulting state commits room to settle. The
 * bound is a fixed step count, not a wall-clock deadline, so it cannot pass
 * or fail depending on how fast the machine is.
 */
async function releaseFinalPoll(gate: SessionPollGate, callNumber: number, body: unknown): Promise<void> {
  await act(async () => {
    await gate.awaitCall(callNumber);
    gate.respond(callNumber, body);
    for (let i = 0; i < 25; i += 1) {
      await Promise.resolve();
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 25; i += 1) {
      await Promise.resolve();
    }
  });
}

/**
 * Locate the single live status announcement by its exact role and
 * aria-live pairing, isolated from aggregate body text so an assertion here
 * can never accidentally pass because a guidance row happens to contain the
 * same words.
 */
function findAnnouncement(): Element | undefined {
  return Array.from(document.querySelectorAll('p[role="status"][aria-live="polite"]')).find(
    (el) => /^Step \d+ of \d+: /.test(el.textContent ?? ""),
  );
}

function currentGuidanceText(): string {
  return document.querySelector('[aria-current="step"] [data-guidance-slot]')?.textContent ?? "";
}

/**
 * AG-2.8 lock: paste where-copy stays provider-neutral. Host-appended
 * strings, provider names, endpoints, and planning markers must not appear
 * in the rendered guidance body (or in the reserved form/invite slots).
 */
function expectProviderNeutralWhereCopy(text: string, host: string): void {
  expect(text).not.toContain("{host}");
  expect(text).not.toContain("Accept it on");
  const lower = text.toLowerCase();
  expect(lower).not.toContain(host.toLowerCase());
  expect(lower).not.toContain("nextcloud");
  expect(lower).not.toContain("owncloud");
  expect(lower).not.toContain("cernbox");
  expect(lower).not.toContain("ocis");
  expect(text).not.toMatch(/https?:\/\//);
  expect(text).not.toContain("/invite");
  expect(text).not.toContain("/ocm/");
  expect(text).not.toContain("[wip]");
  expect(text).not.toContain("[todo]");
  expect(text).not.toContain("AG-1");
  expect(text).not.toContain("AG-2");
  expect(text).not.toContain("P7");
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

describe("ResultsShell current-row guidance, announce, and reserved slots", () => {
  beforeAll(async () => {
    await registerHappyDom("http://localhost/?host=peer.example&id=" + SESSION_ID);
  });

  afterAll(async () => {
    await teardownHappyDom();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
  });

  test("renders guidance title and body only on the current row, and nothing on the others", async () => {
    const restoreFetch = installActiveInviteFetch();
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes("Paste the outgoing invite") === true,
      );

      const slots = Array.from(document.querySelectorAll("[data-guidance-slot]"));
      expect(slots.length).toBe(6);
      const currentSlot = slots.find((el) =>
        el.textContent?.includes("Paste the outgoing invite"),
      );
      expect(currentSlot).toBeDefined();
      expect(currentSlot?.textContent).toContain(
        "Use Copy invitation, then accept that invitation on the target server under test.",
      );
      const otherSlots = slots.filter((el) => el !== currentSlot);
      expect(otherSlots.length).toBe(5);
      for (const slot of otherSlots) {
        expect(slot.textContent).toBe("");
      }
    } finally {
      // Always unmount, even if an assertion above throws, so a failing run
      // cannot leave the root mounted or a poll loop running past this test.
      await act(() => {
        root.unmount();
      });
      restoreFetch();
    }
  });

  test("locks provider-neutral paste_s1 and paste_s2 where-copy on the current row", async () => {
    const host = "peer.example";
    const pasteS1 = guidanceFor("paste_s1");
    const pasteS2 = guidanceFor("paste_s2");
    expect(pasteS1).not.toBeNull();
    expect(pasteS2).not.toBeNull();
    if (pasteS1 === null || pasteS1.kind !== "instruction") {
      throw new Error("expected paste_s1 instruction guidance");
    }
    if (pasteS2 === null || pasteS2.kind !== "instruction") {
      throw new Error("expected paste_s2 instruction guidance");
    }

    const gate = new SessionPollGate();
    const restoreFetch = installGatedSessionFetch(gate);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host={host} id={SESSION_ID} />);
      });

      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      const pasteS1Text = currentGuidanceText();
      expect(pasteS1Text).toContain(pasteS1.body);
      expect(pasteS1Text).toContain("target server under test");
      expectProviderNeutralWhereCopy(pasteS1Text, host);
      expect(document.querySelector("[data-reserved-form-slot]")).not.toBeNull();
      expect(document.querySelector("[data-reserved-alert-slot]")).not.toBeNull();

      await releasePoll(gate, 2, {
        state: "reverse_awaiting_invite",
        ts: 2,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
      const pasteS2Text = currentGuidanceText();
      expect(pasteS2Text).toContain(pasteS2.body);
      expectProviderNeutralWhereCopy(pasteS2Text, host);
      expectProviderNeutralWhereCopy(
        document.querySelector("[data-reserved-form-slot]")?.textContent ?? "",
        host,
      );
      expect(document.querySelector("[data-reserved-form-slot]")).not.toBeNull();
      expect(document.querySelector("[data-reserved-alert-slot]")).not.toBeNull();
      expect(document.querySelector("[data-reverse-form]")).not.toBeNull();
    } finally {
      await act(() => {
        root.unmount();
      });
      gate.settleRemaining();
      restoreFetch();
    }
  });

  test("the single announcement renders Step N of M with the guidance title only, no body", async () => {
    const restoreFetch = installActiveInviteFetch();
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes("Paste the outgoing invite") === true,
      );

      const announce = Array.from(document.querySelectorAll('p[role="status"]')).find((el) =>
        /^Step \d+ of \d+: /.test(el.textContent ?? ""),
      );
      expect(announce).toBeDefined();
      expect(announce?.textContent).toBe("Step 3 of 6: Paste the outgoing invite");
      expect(announce?.getAttribute("aria-live")).toBe("polite");
      expect(announce?.textContent).not.toContain("Use Copy invitation");
    } finally {
      // Always unmount, even if an assertion above throws, so a failing run
      // cannot leave the root mounted or a poll loop running past this test.
      await act(() => {
        root.unmount();
      });
      restoreFetch();
    }
  });

  test("reserves the CTA column inside StepRow's own in-row slot, not a ResultsShell sibling", async () => {
    const restoreFetch = installActiveInviteFetch();
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes("Paste the outgoing invite") === true,
      );

      // No vertical CTA sibling exists; the reservation lives inside
      // StepRow's own horizontal data-cta-slot column instead.
      expect(document.querySelector("[data-reserved-cta-slot]")).toBeNull();

      const ctaSlots = Array.from(document.querySelectorAll("[data-cta-slot]"));
      expect(ctaSlots.length).toBe(6);
      const currentCard = document.querySelector('[aria-current="step"]');
      expect(currentCard).not.toBeNull();
      const currentCtaSlot = currentCard?.querySelector("[data-cta-slot]");
      expect(currentCtaSlot).not.toBeNull();
      expect(currentCtaSlot?.className).toContain("min-w-[10rem]");
      // Copy/paste actions stay unwired. The current row shows the live
      // View report secondary link when the API origin is real; other
      // rows keep the reserved empty column.
      const liveLink = Array.from(currentCtaSlot?.querySelectorAll("a") ?? []).find(
        (el) => el.textContent === "View report",
      );
      expect(liveLink).toBeDefined();
      expect(currentCtaSlot?.getAttribute("aria-hidden")).toBeNull();
      for (const slot of ctaSlots) {
        if (slot === currentCtaSlot) {
          continue;
        }
        expect(slot.getAttribute("aria-hidden")).toBe("true");
        expect(slot.textContent).toBe("");
      }
    } finally {
      // Always unmount, even if an assertion above throws, so a failing run
      // cannot leave the root mounted or a poll loop running past this test.
      await act(() => {
        root.unmount();
      });
      restoreFetch();
    }
  });

  test("always mounts a reserved form slot on the reverse card while live and active steps are visible, sized beyond min-h-10", async () => {
    const restoreFetch = installActiveInviteFetch();
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes("Paste the outgoing invite") === true,
      );

      // The invite row is current, not reverse, so this confirms the form
      // slot is mounted for the whole active phase, not only when reverse
      // itself is the current row.
      const formSlot = document.querySelector("[data-reserved-form-slot]");
      expect(formSlot).not.toBeNull();
      expect(formSlot?.getAttribute("aria-hidden")).toBe("true");
      expect(formSlot?.className).toContain("min-h-56");
      expect(formSlot?.className).not.toContain("min-h-10 ");
      expect(formSlot?.className).not.toBe("min-h-10");

      // The form slot must be mounted inside the reverse row's own card, not
      // merely present somewhere in the tree. StepRow renders formSlot as a
      // direct child of its own root card, alongside that row's
      // data-guidance-slot, so the parent of one is the parent of the other.
      const guidanceSlots = Array.from(document.querySelectorAll("[data-guidance-slot]"));
      const reverseCard = guidanceSlots
        .map((slot) => slot.parentElement)
        .find((card) => card?.textContent?.includes("Accept return invitation") === true);
      expect(reverseCard).toBeDefined();
      expect(reverseCard).not.toBeNull();
      expect(formSlot?.parentElement).toBe(reverseCard);
      expect(reverseCard?.contains(formSlot as Node)).toBe(true);

      // No other row's card mounts the form slot: it is reverse-only.
      const otherCards = guidanceSlots
        .map((slot) => slot.parentElement)
        .filter((card) => card !== reverseCard);
      expect(otherCards.length).toBe(5);
      for (const card of otherCards) {
        expect(card?.contains(formSlot as Node)).toBe(false);
      }
    } finally {
      // Always unmount, even if an assertion above throws, so a failing run
      // cannot leave the root mounted or a poll loop running past this test.
      await act(() => {
        root.unmount();
      });
      restoreFetch();
    }
  });

  test("mounts no reserved form slot or CTA slot once the result reaches a terminal state", async () => {
    const restoreFetch = installTerminalReportFetch(permanentReport(specification(() => "pass")));
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => document.body.textContent?.includes(RESULT_HEADLINE.compatible) === true);
      expect(document.querySelector("[data-reserved-form-slot]")).toBeNull();
      expect(document.querySelector("[data-reserved-cta-slot]")).toBeNull();
      expect(document.querySelector("[data-cta-slot]")).toBeNull();
    } finally {
      // Always unmount, even if an assertion above throws, so a failing run
      // cannot leave the root mounted or a poll loop running past this test.
      await act(() => {
        root.unmount();
      });
      restoreFetch();
    }
  });

  test("holds the current-row title for one poll on an omitted instruction, falls back to the unknown-key title if it persists, resumes normally, and lets terminal win immediately even mid-hold", async () => {
    const gate = new SessionPollGate();
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

    setWindowHref(`https://localhost/?host=peer.example&id=${SESSION_ID}&ro=1`);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      // Poll 1: a genuine instruction seeds the hold with a real title.
      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      const announceAfterPoll1 = findAnnouncement();
      expect(announceAfterPoll1).toBeDefined();
      expect(announceAfterPoll1?.textContent).toBe("Step 3 of 6: Paste the outgoing invite");
      expect(announceAfterPoll1?.textContent).not.toContain("Use Copy invitation");
      expect(document.body.textContent).not.toContain(UNKNOWN_GUIDANCE_TITLE);

      // Poll 2: omitted nextInstruction. Held for exactly this one poll: the
      // title must still read the last valid instruction, not fall back yet.
      await releasePoll(gate, 2, { state: "invite_minted", ts: 2, optInActive: true });
      expect(document.body.textContent).toContain("Paste the outgoing invite");
      expect(document.body.textContent).not.toContain(UNKNOWN_GUIDANCE_TITLE);

      // Poll 3: the one-poll grace is already spent, and this poll is now an
      // unrecognized key, so the current row falls back to the unknown-key
      // title while still anchored on the invite row (not reset to probe).
      await releasePoll(gate, 3, {
        state: "invite_minted",
        ts: 3,
        optInActive: true,
        nextInstruction: "not_a_real_step",
      });
      expect(document.body.textContent).toContain(UNKNOWN_GUIDANCE_TITLE);
      const slotsDuringFallback = Array.from(document.querySelectorAll("[data-guidance-slot]"));
      const activeSlot = slotsDuringFallback.find((el) =>
        el.textContent?.includes(UNKNOWN_GUIDANCE_TITLE),
      );
      expect(activeSlot).toBeDefined();

      // Poll 4: a following valid instruction replaces the fallback normally.
      await releasePoll(gate, 4, {
        state: "invite_minted",
        ts: 4,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      expect(document.body.textContent).toContain("Paste the outgoing invite");
      expect(document.body.textContent).not.toContain(UNKNOWN_GUIDANCE_TITLE);

      // Poll 5: omitted again, starting a fresh one-poll hold anchored on
      // poll 4's instruction.
      await releasePoll(gate, 5, { state: "invite_minted", ts: 5, optInActive: true });
      expect(document.body.textContent).toContain("Paste the outgoing invite");

      // Poll 6: terminal wins immediately even mid-hold (held is true from
      // poll 5) and is never held behind the stale invite guidance.
      await releaseFinalPoll(gate, 6, { state: "terminal_pass", ts: 6, optInActive: true });
      expect(document.body.textContent).not.toContain("Paste the outgoing invite");
      expect(document.body.textContent).not.toContain(UNKNOWN_GUIDANCE_TITLE);
      expect(document.body.textContent).toContain(RESULT_HEADLINE.compatible);
      expect(gate.calls).toBe(6);
    } finally {
      // Always unmount (aborting the poll loop), settle any still-gated
      // poll call, and restore fetch, even if an assertion above throws, so
      // a failing run cannot leave the loop or a dangling fetch mock running
      // past this test.
      await act(async () => {
        root.unmount();
      });
      gate.settleRemaining();
      globalThis.fetch = previousFetch;
    }
  });

  test("a live (non-read-only) session keeps polling at the last safe cadence through a persistent unknown instruction instead of halting", async () => {
    const gate = new SessionPollGate();
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

    // No ?ro=1: this is the normal, non-read-only polling path.
    setWindowHref(`https://localhost/?host=peer.example&id=${SESSION_ID}`);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      // Poll 1: a genuine instruction establishes a safe live cadence.
      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      expect(document.body.textContent).toContain("Paste the outgoing invite");

      // Poll 2: omitted. Spends the one-poll hold (title stays put).
      await releasePoll(gate, 2, { state: "invite_minted", ts: 2, optInActive: true });
      expect(document.body.textContent).toContain("Paste the outgoing invite");

      // Polls 3 and 4: a persistent unrecognized instruction. The loop must
      // keep polling through this stretch instead of halting once
      // continuePolling turns false; this alone is unreachable on a loop
      // that stops instead of falling back to the last safe live cadence.
      await releasePoll(gate, 3, {
        state: "invite_minted",
        ts: 3,
        optInActive: true,
        nextInstruction: "not_a_real_step",
      });
      const announceAfterPoll3 = findAnnouncement();
      expect(announceAfterPoll3).toBeDefined();
      expect(announceAfterPoll3?.textContent).toBe(`Step 3 of 6: ${UNKNOWN_GUIDANCE_TITLE}`);
      const currentSlotAfterPoll3 = Array.from(
        document.querySelectorAll("[data-guidance-slot]"),
      ).find((el) => el.textContent?.includes(UNKNOWN_GUIDANCE_TITLE));
      expect(currentSlotAfterPoll3).toBeDefined();
      expect(currentSlotAfterPoll3?.textContent).toContain("not recognized by this page");

      await releasePoll(gate, 4, {
        state: "invite_minted",
        ts: 4,
        optInActive: true,
        nextInstruction: "not_a_real_step",
      });
      const announceAfterPoll4 = findAnnouncement();
      expect(announceAfterPoll4).toBeDefined();
      expect(announceAfterPoll4?.textContent).toBe(`Step 3 of 6: ${UNKNOWN_GUIDANCE_TITLE}`);
      const currentSlotAfterPoll4 = Array.from(
        document.querySelectorAll("[data-guidance-slot]"),
      ).find((el) => el.textContent?.includes(UNKNOWN_GUIDANCE_TITLE));
      expect(currentSlotAfterPoll4).toBeDefined();
      expect(currentSlotAfterPoll4?.textContent).toContain("not recognized by this page");

      // Poll 5: it resumes the known instruction once the server sends one
      // again.
      await releasePoll(gate, 5, {
        state: "invite_minted",
        ts: 5,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      expect(document.body.textContent).toContain("Paste the outgoing invite");
      expect(document.body.textContent).not.toContain(UNKNOWN_GUIDANCE_TITLE);
      // releasePoll(gate, 5, ...) already confirmed the loop reached call 6
      // (poll 5's processing is fully settled); that next poll is still
      // gated and unreleased here.
      expect(gate.calls).toBe(6);
    } finally {
      // Always unmount (aborting the poll loop), settle any still-gated
      // poll call, and restore fetch, even if an assertion above throws, so
      // a failing run cannot leave the loop or a dangling fetch mock running
      // past this test.
      await act(async () => {
        root.unmount();
      });
      gate.settleRemaining();
      globalThis.fetch = previousFetch;
    }
  });

  test("a persistent omission (as opposed to an unknown key) shows no guidance and falls back to the step announcement", async () => {
    const gate = new SessionPollGate();
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

    setWindowHref(`https://localhost/?host=peer.example&id=${SESSION_ID}&ro=1`);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      // Poll 1: a genuine instruction seeds the hold.
      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      expect(document.body.textContent).toContain("Paste the outgoing invite");

      // Poll 2: first omission. Held for exactly this one poll.
      await releasePoll(gate, 2, { state: "invite_minted", ts: 2, optInActive: true });
      expect(document.body.textContent).toContain("Paste the outgoing invite");

      // Poll 3: persistent omission (not an unknown key). Unlike the
      // persistent-unknown case, an omitted instruction resolves to a null
      // guidance key once the one-poll grace is spent, so the current row's
      // guidance slot is empty and the announcement falls back to
      // STEP_ANNOUNCE for the invite step, not the unknown-key title.
      await releasePoll(gate, 3, { state: "invite_minted", ts: 3, optInActive: true });
      expect(document.body.textContent).not.toContain("Paste the outgoing invite");
      expect(document.body.textContent).not.toContain(UNKNOWN_GUIDANCE_TITLE);
      const guidanceSlots = Array.from(document.querySelectorAll("[data-guidance-slot]"));
      for (const slot of guidanceSlots) {
        expect(slot.textContent).toBe("");
      }
      const announce = Array.from(document.querySelectorAll('p[role="status"]')).find((el) =>
        /^Step \d+ of \d+: /.test(el.textContent ?? ""),
      );
      expect(announce).toBeDefined();
      expect(announce?.textContent).toBe("Step 3 of 6: Waiting for invitation steps.");

      // Poll 4: a following valid instruction replaces the fallback normally.
      await releasePoll(gate, 4, {
        state: "invite_minted",
        ts: 4,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      expect(document.body.textContent).toContain("Paste the outgoing invite");
    } finally {
      await act(async () => {
        root.unmount();
      });
      gate.settleRemaining();
      globalThis.fetch = previousFetch;
    }
  });

  test("strips bracketed markers from the visible current-row guidance and the step announcement", async () => {
    const guidanceModule = await import("@/components/validator/lib/validatorGuidance");
    const originalGuidanceFor = guidanceModule.guidanceFor;
    // Defensive stripping in ResultsShell exists for guidance content that
    // should never carry a bracketed planning marker, even though the real
    // guidance table never does. Inject one marked-up record for paste_s1
    // through a scoped module mock (restored in finally) so this proves the
    // real render path strips it, instead of only unit-testing the pure
    // stripBracketedMarkers/sanitizeGuidanceRecord helpers in isolation.
    mock.module("@/components/validator/lib/validatorGuidance", () => ({
      ...guidanceModule,
      guidanceFor: (key: string | null | undefined) => {
        const record = originalGuidanceFor(key);
        if (record === null || record.kind !== "instruction" || key !== "paste_s1") {
          return record;
        }
        return {
          ...record,
          title: `[wip] ${record.title}`,
          body: `${record.body} [todo-followup]`,
        };
      },
    }));
    const restoreFetch = installActiveInviteFetch();
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes("Paste the outgoing invite") === true,
      );

      const currentSlot = Array.from(document.querySelectorAll("[data-guidance-slot]")).find(
        (el) => el.textContent?.includes("Paste the outgoing invite"),
      );
      expect(currentSlot).toBeDefined();
      expect(currentSlot?.textContent).not.toContain("[");
      expect(currentSlot?.textContent).not.toContain("]");
      expect(currentSlot?.textContent).toContain(
        "Use Copy invitation, then accept that invitation on the target server under test.",
      );

      const announce = Array.from(document.querySelectorAll('p[role="status"]')).find((el) =>
        /^Step \d+ of \d+: /.test(el.textContent ?? ""),
      );
      expect(announce).toBeDefined();
      expect(announce?.textContent).toBe("Step 3 of 6: Paste the outgoing invite");
      expect(announce?.textContent).not.toContain("[");
    } finally {
      // Unmount, restore fetch, and restore the guidance module mock even
      // if an assertion above throws, so a failing run cannot leave the
      // loop, a dangling fetch mock, or the module mock active afterward.
      await act(() => {
        root.unmount();
      });
      restoreFetch();
      mock.module("@/components/validator/lib/validatorGuidance", () => ({
        ...guidanceModule,
        guidanceFor: originalGuidanceFor,
      }));
    }
  });

  test("wires View report only on the current live row via joinValidatorUrl and opens it in a new tab", async () => {
    const restoreFetch = installActiveInviteFetch({
      liveReportExtra: { reportUrl: "https://evil.example/validator/report/abc" },
    });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes("Paste the outgoing invite") === true,
      );

      const expectedHref = joinValidatorUrl(
        API_ORIGIN,
        `/report/${encodeURIComponent(SESSION_ID)}`,
      );
      const links = Array.from(document.querySelectorAll("a")).filter(
        (el) => el.textContent === "View report",
      );
      expect(links.length).toBe(1);
      expect(links[0]?.getAttribute("href")).toBe(expectedHref);
      expect(links[0]?.getAttribute("target")).toBe("_blank");
      expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer");

      const currentCard = document.querySelector('[aria-current="step"]');
      expect(currentCard?.contains(links[0] as Node)).toBe(true);
      const otherCards = Array.from(document.querySelectorAll("[data-guidance-slot]"))
        .map((slot) => slot.parentElement)
        .filter((card) => card !== currentCard);
      for (const card of otherCards) {
        expect(card?.textContent).not.toContain("View report");
      }
      expect(document.body.textContent).not.toContain("Open public report");
      expect(document.body.textContent).not.toContain("Copy public report link");
    } finally {
      await act(() => {
        root.unmount();
      });
      restoreFetch();
    }
  });

  test("hides the live View report link when validatorApiOrigin is empty", async () => {
    const restoreFetch = installActiveInviteFetch({ origin: "" });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes("Paste the outgoing invite") === true,
      );

      const links = Array.from(document.querySelectorAll("a")).filter(
        (el) => el.textContent === "View report",
      );
      expect(links.length).toBe(0);
      const currentCard = document.querySelector('[aria-current="step"]');
      const currentCtaSlot = currentCard?.querySelector("[data-cta-slot]");
      expect(currentCtaSlot).not.toBeNull();
      expect(currentCtaSlot?.className).toContain("min-w-[10rem]");
      // AG-1.4 wires the primary claim CTA on the paste_s1 row, so the slot
      // stays visible (not aria-hidden) even when the empty origin hides the
      // secondary View report link.
      const claimCta = Array.from(currentCtaSlot?.querySelectorAll("button") ?? []).find(
        (el) => el.textContent === COPY_INVITATION_LABEL,
      );
      expect(claimCta).toBeDefined();
      expect(currentCtaSlot?.getAttribute("aria-hidden")).toBeNull();
      expect(document.querySelector("[data-reserved-cta-slot]")).toBeNull();
    } finally {
      await act(() => {
        root.unmount();
      });
      restoreFetch();
    }
  });
});
