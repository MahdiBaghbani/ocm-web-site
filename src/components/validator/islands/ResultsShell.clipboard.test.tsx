import React, { act } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import ResultsShell, {
  COPY_SUCCESS_TEXT,
  copyText,
} from "./ResultsShell";
import { type CanonicalAreaId } from "../lib/validatorScore";
import type { ReportResponse } from "../lib/validatorFetch";
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

function installPermanentReportFetch(): () => void {
  return installTerminalReportFetch(permanentReport(specification(() => "pass")));
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

function installCapturedClipboard(): { copied: string[]; restore: () => void } {
  const copied: string[] = [];
  const restore = installClipboardWriteText(async (value: string) => {
    copied.push(value);
  });
  return { copied, restore };
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

function installCapturedTimeouts(delayMs: number): {
  flushPending: () => void;
  pendingCount: () => number;
  restore: () => void;
} {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const previousSet = globalThis.setTimeout;
  const previousClear = globalThis.clearTimeout;
  const callRealSetTimeout = previousSet as unknown as (
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ) => ReturnType<typeof setTimeout>;
  globalThis.setTimeout = ((
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ): ReturnType<typeof setTimeout> => {
    if (timeout === delayMs && typeof handler === "function") {
      const id = nextId;
      nextId += 1;
      pending.set(id, () => {
        (handler as (...callbackArgs: unknown[]) => void)(...args);
      });
      return id as unknown as ReturnType<typeof setTimeout>;
    }
    return callRealSetTimeout(handler, timeout, ...args);
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id?: ReturnType<typeof setTimeout>) => {
    if (typeof id === "number" && pending.has(id)) {
      pending.delete(id);
      return;
    }
    previousClear(id);
  }) as unknown as typeof clearTimeout;
  return {
    pendingCount: () => pending.size,
    flushPending: () => {
      const queued = [...pending.values()];
      pending.clear();
      for (const run of queued) {
        run();
      }
    },
    restore: () => {
      globalThis.setTimeout = previousSet;
      globalThis.clearTimeout = previousClear;
    },
  };
}

function installLiveSessionFetch(): () => void {
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
      return jsonResponse(200, {
        state: "passive_running",
        ts: 1,
        optInActive: false,
        nextInstruction: "wait_probe",
      });
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

function pageLinkButton(): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (node) => node.textContent === "Copy page link",
  );
  if (button === undefined) {
    throw new Error("missing Copy page link button");
  }
  return button;
}

describe("ResultsShell page-link clipboard", () => {
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

  test("Clipboard API copies window.location.href, not the session id", async () => {
    const restoreFetch = installPermanentReportFetch();
    const restoreSecure = installIsSecureContext(true);
    const clipboard = installCapturedClipboard();
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => document.body.textContent?.includes("Copy page link") === true);
      const href = window.location.href;
      await act(() => {
        pageLinkButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(() => document.body.textContent?.includes(COPY_SUCCESS_TEXT) === true);
      expect(clipboard.copied).toEqual([href]);
      expect(clipboard.copied[0]).toBe(window.location.href);
      expect(clipboard.copied[0]).not.toBe(SESSION_ID);
      expect(document.querySelector("[data-copy-fallback]")).toBeNull();
      expect(document.getElementById("results-copy-notice")).not.toBeNull();
      await act(() => {
        root.unmount();
      });
    } finally {
      clipboard.restore();
      restoreSecure();
      restoreFetch();
    }
  });

  test("repeat copy within 2 seconds re-announces by clearing the live region first", async () => {
    const restoreFetch = installPermanentReportFetch();
    const restoreSecure = installIsSecureContext(true);
    const clipboard = installCapturedClipboard();
    const timers = installCapturedTimeouts(2000);
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => document.body.textContent?.includes("Copy page link") === true);

      await act(() => {
        pageLinkButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(
        () => document.getElementById("results-copy-notice")?.textContent === COPY_SUCCESS_TEXT,
      );
      expect(document.getElementById("results-copy-notice")?.textContent).toBe(COPY_SUCCESS_TEXT);
      expect(clipboard.copied.length).toBe(1);
      expect(timers.pendingCount()).toBe(1);

      const zeroDelayTimers = installCapturedTimeouts(0);
      try {
        await act(() => {
          pageLinkButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });
        await waitForDom(() => clipboard.copied.length === 2);
        // The empty live-region tick is committed; the deferred success
        // macrotask is held. The old batched clear-then-set left this still
        // "Copied", so screen readers would not re-announce.
        const notice = document.getElementById("results-copy-notice");
        expect(notice).not.toBeNull();
        expect(notice?.getAttribute("role")).toBe("status");
        expect(notice?.getAttribute("aria-live")).toBe("polite");
        expect(notice?.textContent).toBe("");
        expect(zeroDelayTimers.pendingCount()).toBe(1);
        // clearCopyTimer emptied copyTimerRef before this 0ms tick. The new
        // 2000ms fade is created only after the deferred callback below.
        expect(timers.pendingCount()).toBe(0);

        await act(() => {
          zeroDelayTimers.flushPending();
        });
        expect(document.getElementById("results-copy-notice")?.textContent).toBe(
          COPY_SUCCESS_TEXT,
        );
        expect(timers.pendingCount()).toBe(1);
      } finally {
        zeroDelayTimers.restore();
      }
      expect(clipboard.copied.length).toBe(2);
      await act(() => {
        root.unmount();
      });
    } finally {
      clipboard.restore();
      restoreSecure();
      timers.restore();
      restoreFetch();
    }
  });

  test("rejected Clipboard API falls back to a successful execCommand", async () => {
    const restoreFetch = installPermanentReportFetch();
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installRejectedClipboard();
    const copied: string[] = [];
    const seenStyles: Array<{
      display: string;
      opacity: string;
      position: string;
      width: string;
      height: string;
      left: string;
      top: string;
      padding: string;
      border: string;
      overflow: string;
    }> = [];
    const restoreExec = installExecCommand(() => {
      const areas = document.body.querySelectorAll("textarea");
      const last = areas[areas.length - 1];
      if (last !== undefined) {
        copied.push(last.value);
        seenStyles.push({
          display: last.style.display,
          opacity: last.style.opacity,
          position: last.style.position,
          width: last.style.width,
          height: last.style.height,
          left: last.style.left,
          top: last.style.top,
          padding: last.style.padding,
          border: last.style.border,
          overflow: last.style.overflow,
        });
      }
      return true;
    });
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => document.body.textContent?.includes("Copy page link") === true);
      const href = window.location.href;
      await act(() => {
        pageLinkButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(() => document.body.textContent?.includes(COPY_SUCCESS_TEXT) === true);
      expect(copied).toEqual([href]);
      expect(copied[0]).not.toBe(SESSION_ID);
      expect(document.body.textContent).not.toContain("Could not copy the page link.");
      expect(document.querySelector("[data-copy-fallback]")).toBeNull();
      expect(document.body.querySelector("textarea")).toBeNull();
      expect(seenStyles.length).toBe(1);
      const styles = seenStyles[0];
      expect(styles).toBeDefined();
      if (styles !== undefined) {
        expect(styles.display).not.toBe("none");
        expect(styles.opacity).not.toBe("0");
        expect(styles.position).toBe("absolute");
        expect(styles.left).toBe("-9999px");
        expect(["0", "0px"]).toContain(styles.top);
        expect(styles.width).toBe("1px");
        expect(styles.height).toBe("1px");
        expect(["0", "0px"]).toContain(styles.padding);
        expect(styles.border === "0" || styles.border.startsWith("0px")).toBe(true);
        expect(styles.overflow).toBe("hidden");
      }
      await act(() => {
        root.unmount();
      });
    } finally {
      restoreExec.restore();
      restoreClipboard();
      restoreSecure();
      restoreFetch();
    }
  });

  test("both programmatic tiers failing expose a visible unfocused selectable input", async () => {
    const restoreFetch = installPermanentReportFetch();
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installRejectedClipboard();
    const restoreExec = installExecCommand(() => false);
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => document.body.textContent?.includes("Copy page link") === true);
      const href = window.location.href;
      await act(() => {
        pageLinkButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(() => document.querySelector("[data-copy-fallback]") !== null);
      const fallback = document.querySelector<HTMLInputElement>("[data-copy-fallback]");
      expect(fallback).not.toBeNull();
      if (fallback === null) {
        throw new Error("missing copy fallback input");
      }
      expect(fallback.tagName).toBe("INPUT");
      expect(fallback.readOnly).toBe(true);
      expect(fallback.value).toBe(href);
      expect(fallback.value).not.toBe(SESSION_ID);
      expect(fallback.hasAttribute("autofocus")).toBe(false);
      expect(fallback.hasAttribute("autoFocus")).toBe(false);
      expect(document.activeElement === fallback).toBe(false);
      expect(document.body.textContent).toContain("Could not copy the page link.");
      expect(document.body.textContent).not.toContain(COPY_SUCCESS_TEXT);
      expect(fallback.getAttribute("aria-describedby")).toBe("results-copy-failure");
      const alerts = Array.from(document.querySelectorAll('[role="alert"]'));
      expect(alerts.some((node) => node.textContent === "Could not copy the page link.")).toBe(true);
      const successNotice = document.getElementById("results-copy-notice");
      expect(successNotice).not.toBeNull();
      expect(successNotice?.getAttribute("role")).toBe("status");
      expect(successNotice?.textContent).toBe("");
      await act(() => {
        root.unmount();
      });
    } finally {
      restoreExec.restore();
      restoreClipboard();
      restoreSecure();
      restoreFetch();
    }
  });

  test("a live page link appends the read-only query parameter", async () => {
    const restoreFetch = installLiveSessionFetch();
    const restoreSecure = installIsSecureContext(true);
    const clipboard = installCapturedClipboard();
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => document.body.textContent?.includes("Copy page link") === true);
      await act(() => {
        pageLinkButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(() => clipboard.copied.length > 0);
      const copied = clipboard.copied[0];
      expect(copied).toBeDefined();
      if (copied === undefined) {
        throw new Error("missing copied page link");
      }
      const parsed = new URL(copied);
      expect(parsed.searchParams.get("ro")).toBe("1");
      expect(copied).not.toBe(SESSION_ID);
      expect(copied).not.toBe(window.location.href);
      expect(copied.startsWith(window.location.origin)).toBe(true);
      await act(() => {
        root.unmount();
      });
    } finally {
      clipboard.restore();
      restoreSecure();
      restoreFetch();
    }
  });

  test("insecure context skips the Clipboard API and uses execCommand", async () => {
    const restoreFetch = installPermanentReportFetch();
    const restoreSecure = installIsSecureContext(false);
    const clipboard = installCapturedClipboard();
    const copied: string[] = [];
    const restoreExec = installExecCommand(() => {
      const areas = document.body.querySelectorAll("textarea");
      const last = areas[areas.length - 1];
      if (last !== undefined) {
        copied.push(last.value);
      }
      return true;
    });
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => document.body.textContent?.includes("Copy page link") === true);
      const href = window.location.href;
      await act(() => {
        pageLinkButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(() => document.body.textContent?.includes(COPY_SUCCESS_TEXT) === true);
      expect(clipboard.copied).toEqual([]);
      expect(copied).toEqual([href]);
      expect(document.querySelector("[data-copy-fallback]")).toBeNull();
      await act(() => {
        root.unmount();
      });
    } finally {
      restoreExec.restore();
      clipboard.restore();
      restoreSecure();
      restoreFetch();
    }
  });

  test("tier 2 restores prior focus, uses preventScroll, and cleans up the textarea", async () => {
    const restoreSecure = installIsSecureContext(false);
    const focusCalls: Array<{ tag: string; preventScroll: boolean | undefined }> = [];
    const originalFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function guardedFocus(
      this: HTMLElement,
      options?: FocusOptions,
    ): void {
      focusCalls.push({ tag: this.tagName, preventScroll: options?.preventScroll });
      originalFocus.call(this, options);
    };
    const restoreExec = installExecCommand(() => true);
    try {
      const prior = document.createElement("button");
      prior.type = "button";
      prior.textContent = "prior-focus";
      document.body.appendChild(prior);
      prior.focus();
      expect(document.activeElement).toBe(prior);
      const ok = await copyText("https://example.test/page-link");
      expect(ok).toBe(true);
      expect(document.activeElement).toBe(prior);
      expect(document.body.querySelector("textarea")).toBeNull();
      const textareaFocus = focusCalls.find((entry) => entry.tag === "TEXTAREA");
      expect(textareaFocus).toBeDefined();
      expect(textareaFocus?.preventScroll).toBe(true);
      expect(focusCalls).toContainEqual({ tag: "BUTTON", preventScroll: true });
    } finally {
      HTMLElement.prototype.focus = originalFocus;
      restoreExec.restore();
      restoreSecure();
    }
  });

  test("tier 2 try/finally still removes the textarea when execCommand throws", async () => {
    const restoreSecure = installIsSecureContext(false);
    const restoreExec = installExecCommand(() => {
      throw new Error("execCommand failed");
    });
    try {
      const prior = document.createElement("button");
      prior.type = "button";
      prior.textContent = "prior-focus";
      document.body.appendChild(prior);
      prior.focus();
      const ok = await copyText("https://example.test/page-link");
      expect(ok).toBe(false);
      expect(document.activeElement).toBe(prior);
      expect(document.body.querySelector("textarea")).toBeNull();
    } finally {
      restoreExec.restore();
      restoreSecure();
    }
  });

  test("failure alert and fallback persist after the 2-second timer and clear on later success", async () => {
    const restoreFetch = installPermanentReportFetch();
    const restoreSecure = installIsSecureContext(true);
    const timers = installCapturedTimeouts(2000);
    let restoreClipboard = installRejectedClipboard();
    const restoreExec = installExecCommand(() => false);
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => document.body.textContent?.includes("Copy page link") === true);
      const href = window.location.href;
      await act(() => {
        pageLinkButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(() => document.querySelector("[data-copy-fallback]") !== null);
      expect(timers.pendingCount()).toBe(0);
      await act(() => {
        timers.flushPending();
      });
      const fallback = document.querySelector<HTMLInputElement>("[data-copy-fallback]");
      expect(fallback).not.toBeNull();
      expect(fallback?.value).toBe(href);
      expect(document.body.textContent).toContain("Could not copy the page link.");
      expect(document.getElementById("results-copy-notice")).not.toBeNull();

      restoreClipboard();
      const clipboard = installCapturedClipboard();
      restoreClipboard = clipboard.restore;
      await act(() => {
        pageLinkButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(() => document.body.textContent?.includes(COPY_SUCCESS_TEXT) === true);
      expect(clipboard.copied).toEqual([href]);
      expect(document.querySelector("[data-copy-fallback]")).toBeNull();
      expect(document.body.textContent).not.toContain("Could not copy the page link.");
      expect(timers.pendingCount()).toBe(1);
      await act(() => {
        timers.flushPending();
      });
      const successNotice = document.getElementById("results-copy-notice");
      expect(successNotice).not.toBeNull();
      expect(successNotice?.getAttribute("role")).toBe("status");
      expect(successNotice?.textContent).toBe("");
      expect(document.body.textContent).not.toContain(COPY_SUCCESS_TEXT);
      await act(() => {
        root.unmount();
      });
    } finally {
      restoreClipboard();
      restoreExec.restore();
      restoreSecure();
      timers.restore();
      restoreFetch();
    }
  });

  test("identity reset clears the failure alert and fallback input", async () => {
    const sessionB = "0193b1d3-8d2e-7c5b-9f3f-2b3c4d5e6f70";
    const restoreFetch = installPermanentReportFetch();
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installRejectedClipboard();
    const restoreExec = installExecCommand(() => false);
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => document.body.textContent?.includes("Copy page link") === true);
      await act(() => {
        pageLinkButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(() => document.querySelector("[data-copy-fallback]") !== null);
      expect(document.body.textContent).toContain("Could not copy the page link.");
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={sessionB} />);
      });
      await waitForDom(() => document.querySelector("[data-copy-fallback]") === null);
      expect(document.querySelector("[data-copy-fallback]")).toBeNull();
      expect(document.body.textContent).not.toContain("Could not copy the page link.");
      const successNotice = document.getElementById("results-copy-notice");
      expect(successNotice).not.toBeNull();
      expect(successNotice?.textContent).toBe("");
      await act(() => {
        root.unmount();
      });
    } finally {
      restoreExec.restore();
      restoreClipboard();
      restoreSecure();
      restoreFetch();
    }
  });

  test("unmount before the deferred 0ms success callback is a no-op via copyMountedRef", async () => {
    // Keep a copy of the deferred 0ms callback so we can invoke it after
    // unmount cleanup clears copyTimerRef. copyMountedRef must skip
    // setCopyNotice and the 2000ms fade.
    const restoreFetch = installPermanentReportFetch();
    const restoreSecure = installIsSecureContext(true);
    const clipboard = installCapturedClipboard();
    const fadeTimers = installCapturedTimeouts(2000);
    const deferredTimers = installCapturedTimeouts(0);
    const keptDeferred: Array<() => void> = [];
    const previousSet = globalThis.setTimeout;
    const callPreviousSet = previousSet as unknown as (
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => ReturnType<typeof setTimeout>;
    globalThis.setTimeout = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ): ReturnType<typeof setTimeout> => {
      if (timeout === 0 && typeof handler === "function") {
        keptDeferred.push(() => {
          (handler as (...callbackArgs: unknown[]) => void)(...args);
        });
      }
      return callPreviousSet(handler, timeout, ...args);
    }) as unknown as typeof setTimeout;
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => document.body.textContent?.includes("Copy page link") === true);
      const keptBeforeClick = keptDeferred.length;
      await act(() => {
        pageLinkButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(() => clipboard.copied.length === 1);
      expect(document.getElementById("results-copy-notice")?.textContent).toBe("");
      expect(document.body.textContent).not.toContain(COPY_SUCCESS_TEXT);
      expect(deferredTimers.pendingCount()).toBe(1);
      expect(fadeTimers.pendingCount()).toBe(0);
      expect(keptDeferred.length).toBe(keptBeforeClick + 1);
      const deferredSuccess = keptDeferred[keptDeferred.length - 1];
      if (deferredSuccess === undefined) {
        throw new Error("missing deferred 0ms success callback");
      }

      await act(() => {
        root.unmount();
      });
      expect(deferredTimers.pendingCount()).toBe(0);
      await act(() => {
        deferredSuccess();
      });
      expect(document.body.textContent ?? "").not.toContain(COPY_SUCCESS_TEXT);
      expect(fadeTimers.pendingCount()).toBe(0);
    } finally {
      globalThis.setTimeout = previousSet;
      deferredTimers.restore();
      fadeTimers.restore();
      clipboard.restore();
      restoreSecure();
      restoreFetch();
    }
  });

  test("unmount clears a pending copy success timer", async () => {
    // Failure does not schedule a timer. The success path stores a 2000ms
    // clear in copyTimerRef; unmount cleanup must clearTimeout that ref.
    const restoreFetch = installPermanentReportFetch();
    const restoreSecure = installIsSecureContext(true);
    const clipboard = installCapturedClipboard();
    const timers = installCapturedTimeouts(2000);
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => document.body.textContent?.includes("Copy page link") === true);
      await act(() => {
        pageLinkButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(() => document.body.textContent?.includes(COPY_SUCCESS_TEXT) === true);
      expect(timers.pendingCount()).toBe(1);
      await act(() => {
        root.unmount();
      });
      expect(timers.pendingCount()).toBe(0);
    } finally {
      clipboard.restore();
      restoreSecure();
      timers.restore();
      restoreFetch();
    }
  });

  test("identity reset clears a pending copy success timer", async () => {
    const sessionB = "0193b1d3-8d2e-7c5b-9f3f-2b3c4d5e6f70";
    const restoreFetch = installPermanentReportFetch();
    const restoreSecure = installIsSecureContext(true);
    const clipboard = installCapturedClipboard();
    const timers = installCapturedTimeouts(2000);
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => document.body.textContent?.includes("Copy page link") === true);
      await act(() => {
        pageLinkButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(() => document.body.textContent?.includes(COPY_SUCCESS_TEXT) === true);
      expect(timers.pendingCount()).toBe(1);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={sessionB} />);
      });
      expect(timers.pendingCount()).toBe(0);
      await act(() => {
        root.unmount();
      });
    } finally {
      clipboard.restore();
      restoreSecure();
      timers.restore();
      restoreFetch();
    }
  });
});
