import { act } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import ResultsShell from "@/components/validator/islands/ResultsShell";
import { RESULT_HEADLINE, type CanonicalAreaId } from "@/components/validator/lib/validatorScore";
import { type ReportResponse } from "@/components/validator/lib/validatorFetch";
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

describe("ResultsShell area detail modal focus restoration", () => {
  beforeAll(async () => {
    await registerHappyDom();
  });

  afterAll(async () => {
    await teardownHappyDom();
  });

  // Test-only focus harness for the deferred-restore ordering.
  //
  // 1. Inert focus guard: real browsers refuse focus on an element inside an
  //    [inert] subtree, but happy-dom does not enforce it. Wrapping focus so a
  //    target under [inert] is a no-op keeps the browser invariant honest and
  //    guards against a restore that lands before OverlayFrame's inert cleanup.
  //
  // 2. Zero-delay timer control: React (via act) flushes OverlayFrame's passive
  //    inert cleanup and drains microtasks before the test regains control, so a
  //    plain outcome check cannot tell a microtask restore from a setTimeout(0)
  //    restore. To expose the difference, while `captureImmediateTimers` is set
  //    we capture zero-delay timers (ResultsShell's deferred focus restore)
  //    instead of scheduling them, and run them explicitly with
  //    flushImmediateTimers(). React's scheduler uses MessageChannel, so its
  //    cleanup still runs; only the deferred focus is held. Under the old
  //    queueMicrotask timing no zero-delay timer is scheduled and the restore
  //    runs during the act() microtask drain, so the "restore has not run yet"
  //    assertions fail; the setTimeout(0) restore stays captured until flushed
  //    and passes. Non-zero timers (waitForDom, copy notices) pass through.
  //
  // The harness is installed per test and fully restored in afterEach so no
  // other describe is affected.
  let restoreFocusHarness: (() => void) | null = null;
  let captureImmediateTimers = false;
  let pendingImmediateTimers: Array<() => void> = [];

  function flushImmediateTimers(): void {
    const queued = pendingImmediateTimers;
    pendingImmediateTimers = [];
    for (const run of queued) {
      run();
    }
  }

  beforeEach(() => {
    const originalFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function guardedFocus(
      this: HTMLElement,
      options?: FocusOptions,
    ): void {
      if (this.closest("[inert]") !== null) {
        return;
      }
      originalFocus.call(this, options);
    };

    const realSetTimeout = globalThis.setTimeout;
    type TimerReturn = ReturnType<typeof globalThis.setTimeout>;
    const callRealSetTimeout = realSetTimeout as unknown as (
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => TimerReturn;
    const patchedSetTimeout = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ): TimerReturn => {
      if (captureImmediateTimers && typeof handler === "function" && (timeout ?? 0) === 0) {
        pendingImmediateTimers.push(() => {
          (handler as (...callbackArgs: unknown[]) => void)(...args);
        });
        return 0 as unknown as TimerReturn;
      }
      return callRealSetTimeout(handler, timeout, ...args);
    }) as unknown as typeof globalThis.setTimeout;
    globalThis.setTimeout = patchedSetTimeout;

    restoreFocusHarness = () => {
      HTMLElement.prototype.focus = originalFocus;
      globalThis.setTimeout = realSetTimeout;
    };
  });

  afterEach(() => {
    captureImmediateTimers = false;
    pendingImmediateTimers = [];
    restoreFocusHarness?.();
    restoreFocusHarness = null;
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
  });

  test("Escape closes the area modal and restores focus to the trigger", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification(() => "pass")),
    );
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes(RESULT_HEADLINE.compatible) === true,
      );

      const trigger = document.querySelector<HTMLButtonElement>(
        'button#area-card-discovery-action',
      );
      if (trigger === null) {
        throw new Error("missing discovery View details button");
      }
      act(() => {
        trigger.focus();
      });
      expect(document.activeElement).toBe(trigger);

      await act(() => {
        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(() => document.querySelector("[data-overlay-frame-root]") !== null);
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      if (dialog === null) {
        throw new Error("missing dialog after opening the area modal");
      }
      expect(document.activeElement === trigger).toBe(false);

      await act(() => {
        dialog.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => document.querySelector("[data-overlay-frame-root]") === null);

      expect(document.querySelector("[data-overlay-frame-root]")).toBeNull();
      // Focus restoration is deferred to a macrotask that runs after
      // OverlayFrame removes inert, so await it rather than asserting inline.
      await waitForDom(() => document.activeElement === trigger);
      expect(document.activeElement).toBe(trigger);
      // The trigger sits outside any inert subtree once OverlayFrame cleaned up.
      // A restore that fired while the body was still inert would leave the
      // trigger inside an inert ancestor, so this assertion fails for the old
      // microtask timing.
      expect(trigger.closest("[inert]")).toBeNull();
      await act(() => {
        root.unmount();
      });
    } finally {
      restoreFetch();
    }
  });

  test("ID-based restore returns focus to the area trigger after close", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification(() => "pass")),
    );
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes(RESULT_HEADLINE.compatible) === true,
      );

      const trigger = document.querySelector<HTMLButtonElement>(
        "button#area-card-discovery-action",
      );
      if (trigger === null) {
        throw new Error("missing discovery View details button");
      }

      // Focus a control other than the trigger before opening so OverlayFrame
      // captures that element as its synchronous restore target. The deferred
      // ID-based restore must still return focus to the discovery trigger by its
      // area-id ref map after OverlayFrame's cleanup, proving the deferred
      // restore wins over OverlayFrame's captured element. Without the ID-based
      // restore, focus would land on the copy button here.
      const copyButton = Array.from(
        document.querySelectorAll<HTMLButtonElement>("button"),
      ).find((node) => node.textContent === "Copy page link");
      if (copyButton === undefined) {
        throw new Error("missing Copy page link button");
      }
      act(() => {
        copyButton.focus();
      });
      expect(document.activeElement).toBe(copyButton);

      await act(() => {
        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(() => document.querySelector("[data-overlay-frame-root]") !== null);
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      if (dialog === null) {
        throw new Error("missing dialog after opening the area modal");
      }

      // Capture zero-delay timers during the close so the deferred focus restore
      // is held instead of running. React's MessageChannel-scheduled cleanup
      // still runs inside act(): it removes inert and restores its captured
      // element (the copy button).
      captureImmediateTimers = true;
      await act(() => {
        dialog.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
      });
      captureImmediateTimers = false;

      const restored = document.querySelector<HTMLButtonElement>(
        "button#area-card-discovery-action",
      );
      // The deferred setTimeout(0) restore is still captured, so focus is on
      // OverlayFrame's captured element (the copy button), not the trigger. The
      // old queueMicrotask timing would have run during the act() microtask drain
      // and already moved focus to the trigger, so these assertions fail for that
      // timing while they hold for the deferred setTimeout(0) restore. Identity
      // is compared as a boolean so a regression prints true/false rather than
      // serializing the whole happy-dom node tree.
      expect(document.querySelector("[data-overlay-frame-root]")).toBeNull();
      expect(document.activeElement === copyButton).toBe(true);
      expect(document.activeElement === trigger).toBe(false);

      // Run the deferred restore: it wins over OverlayFrame's captured element
      // and moves focus to the discovery trigger by its area-id ref map.
      flushImmediateTimers();
      await act(() => {});
      expect(document.activeElement === restored).toBe(true);
      expect(document.activeElement === copyButton).toBe(false);
      // The restored trigger is outside any inert subtree; a restore that fired
      // while the body was still inert would leave it inside an inert ancestor.
      expect(restored?.closest("[inert]") ?? null).toBeNull();
      await act(() => {
        root.unmount();
      });
    } finally {
      restoreFetch();
    }
  });

  test("grid-heading fallback focuses the heading when the trigger ref is unavailable", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification(() => "pass")),
    );
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes(RESULT_HEADLINE.compatible) === true,
      );

      const trigger = document.querySelector<HTMLButtonElement>(
        "button#area-card-discovery-action",
      );
      if (trigger === null) {
        throw new Error("missing discovery View details button");
      }
      act(() => {
        trigger.focus();
      });

      await act(() => {
        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(() => document.querySelector("[data-overlay-frame-root]") !== null);
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      if (dialog === null) {
        throw new Error("missing dialog after opening the area modal");
      }

      // Detach the discovery trigger node before close. React still holds this
      // exact node in its area-id ref map because a manual DOM removal does not
      // notify React, so on close the stored ref is present but disconnected.
      // This is how the test simulates an unavailable trigger lookup in
      // happy-dom: btn.isConnected is false, so the restore falls through to the
      // grid heading.
      trigger.remove();

      // Capture the grid heading before close so the ordering checkpoint below
      // can assert the deferred fallback focus has not run yet.
      const heading = Array.from(
        document.querySelectorAll<HTMLHeadingElement>("h2"),
      ).find((node) => node.textContent === "What was tested");
      expect(heading).not.toBeUndefined();
      if (heading === undefined) {
        throw new Error("missing grid heading");
      }

      // Capture zero-delay timers during the close so the deferred fallback
      // focus is held instead of running. The captured trigger is disconnected,
      // so OverlayFrame's cleanup restores nothing during act().
      captureImmediateTimers = true;
      await act(() => {
        dialog.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
      });
      captureImmediateTimers = false;

      // The deferred setTimeout(0) fallback is still captured, so the heading is
      // not focused yet. The old queueMicrotask timing would have focused the
      // heading during the act() microtask drain, so this ordering assertion
      // fails for that timing while it holds for the deferred setTimeout(0)
      // fallback. Identity is compared as a boolean so a regression prints
      // true/false rather than serializing the whole happy-dom node tree.
      expect(document.querySelector("[data-overlay-frame-root]")).toBeNull();
      expect(document.activeElement === heading).toBe(false);

      // Run the deferred fallback: with the trigger ref gone, focus lands on the
      // grid heading.
      flushImmediateTimers();
      await act(() => {});
      expect(document.activeElement === heading).toBe(true);
      // The heading is outside any inert subtree; a restore that fired while the
      // body was still inert would leave it inside an inert ancestor.
      expect(heading.closest("[inert]")).toBeNull();
      await act(() => {
        root.unmount();
      });
    } finally {
      restoreFetch();
    }
  });
});
