import React, { act } from "react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import ResultsShell, {
  CACHED_SESSION_JSON_NOTE,
  EVIDENCE_EMPTY_SNAPSHOT,
  EVIDENCE_NOT_SAVED,
  VISIBILITY_NOTICE,
} from "./ResultsShell";
import { RESULT_HEADLINE, type CanonicalAreaId } from "../lib/validatorScore";
import { type ReportResponse } from "../lib/validatorFetch";
import {
  installDomShim,
  reactDomContainerOf,
  ShimEvent,
  ShimNode,
} from "./test-helpers/resultsShell";
import { requestUrl, jsonResponse } from "../test-helpers/fetchStub";
import { waitForText } from "../test-helpers/wait";

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

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

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

function walk(node: ShimNode, visit: (current: ShimNode) => void): void {
  visit(node);
  for (const child of node.childNodes) {
    walk(child, visit);
  }
}

function nodesByRole(root: ShimNode, role: string): ShimNode[] {
  const found: ShimNode[] = [];
  walk(root, (node) => {
    if (node.getAttribute("role") === role) {
      found.push(node);
    }
  });
  return found;
}

function nodesByTag(root: ShimNode, tagName: string): ShimNode[] {
  const upper = tagName.toUpperCase();
  const found: ShimNode[] = [];
  walk(root, (node) => {
    if (node.tagName === upper) {
      found.push(node);
    }
  });
  return found;
}

function findByExactText(root: ShimNode, tagName: string, text: string): ShimNode {
  const upper = tagName.toUpperCase();
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (found === null && node.tagName === upper && node.textContent === text) {
      found = node;
    }
  });
  if (found === null) {
    throw new Error(`missing <${tagName}> with text ${JSON.stringify(text)}`);
  }
  return found;
}

function reactClick(node: ShimNode): void {
  const key = Object.getOwnPropertyNames(node).find((name) => name.startsWith("__reactProps"));
  if (key !== undefined) {
    const props = (node as unknown as Record<string, { onClick?: (event: ShimEvent) => void }>)[key];
    if (typeof props.onClick === "function") {
      props.onClick(new ShimEvent("click"));
      return;
    }
  }
  node.dispatchEvent(new ShimEvent("click"));
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

describe("ResultsShell hydration", () => {
  test("SSR without props matches the first client render and hides the missing-session alert", () => {
    const html = render(<ResultsShell />);
    expect(html).toContain("Loading session...");
    expect(html).not.toContain("Missing host or session id");
    expect(html).not.toContain("invalid session ID");
    expect(html).not.toContain('role="alert"');
  });

  test("SSR with host and id renders identity without reading window location", () => {
    const html = render(<ResultsShell host="Peer.Example" id={` ${SESSION_ID} `} />);
    expect(html).toContain("Result for peer.example");
    expect(html).toContain("Session");
    expect(html).toContain(SESSION_ID);
    expect(html).not.toContain("Back to Test");
    expect(html).toContain("Copy page link");
    expect(html).toContain("Loading session...");
    expect(html).not.toContain("Missing host or session id");
  });

  test("SSR with invalid props stays on the mounted-gate loading state", () => {
    const html = render(<ResultsShell host="not a host" id="has space" />);
    expect(html).toContain("Loading session...");
    expect(html).not.toContain("Missing host or session id");
    expect(html).not.toContain("invalid session ID");
  });
});

describe("ResultsShell evidence disclosure rendering", () => {
  test("terminal session report with evidence discloses the evidence slug", async () => {
    const slug = "session_terminal_evidence_slug";
    const restoreFetch = installTerminalReportFetch(
      liveReport(specification(() => "pass"), {
        evidence: [{ area: "discovery", reasonCode: slug, grade: "pass" }],
      }),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);
      expect(container.textContent).toContain(slug);
      expect(container.textContent).not.toContain(EVIDENCE_NOT_SAVED);
      expect(container.textContent).not.toContain(EVIDENCE_EMPTY_SNAPSHOT);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("terminal session report with no evidence shows the empty snapshot sentence", async () => {
    const restoreFetch = installTerminalReportFetch(
      liveReport(specification(() => "pass"), { evidence: [] }),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);
      expect(container.textContent).toContain(EVIDENCE_EMPTY_SNAPSHOT);
      expect(container.textContent).not.toContain(EVIDENCE_NOT_SAVED);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("terminal unknown report with evidence discloses the evidence slug", async () => {
    const slug = "unknown_terminal_evidence_slug";
    const restoreFetch = installTerminalReportFetch(
      liveReport(specification(() => "pass"), {
        visibility: "unknown",
        evidence: [{ area: "discovery", reasonCode: slug, grade: "pass" }],
      }),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);
      expect(container.textContent).toContain(slug);
      expect(container.textContent).not.toContain(EVIDENCE_NOT_SAVED);
      expect(container.textContent).not.toContain(EVIDENCE_EMPTY_SNAPSHOT);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("terminal unknown report with no evidence shows the empty snapshot sentence", async () => {
    const restoreFetch = installTerminalReportFetch(
      liveReport(specification(() => "pass"), {
        visibility: "unknown",
        evidence: [],
      }),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);
      expect(container.textContent).toContain(EVIDENCE_EMPTY_SNAPSHOT);
      expect(container.textContent).not.toContain(EVIDENCE_NOT_SAVED);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("cached not-public snapshot with no evidence shows the empty snapshot sentence", async () => {
    let deliveredRunning = false;
    let lastPoll: "running" | "terminal" = "running";
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
        if (!deliveredRunning) {
          deliveredRunning = true;
          lastPoll = "running";
          return jsonResponse(200, {
            state: "passive_running",
            ts: 1,
            optInActive: false,
            nextInstruction: "wait_probe",
          });
        }
        lastPoll = "terminal";
        return jsonResponse(200, { state: "terminal_pass", ts: 2, optInActive: false });
      }
      if (url.includes(`/api/report/${SESSION_ID}`)) {
        if (lastPoll === "running") {
          return jsonResponse(200, liveReport(specification(() => "pass")));
        }
        return jsonResponse(404, { error: "report_not_public", message: "report is not public" });
      }
      return jsonResponse(404, { error: "missing", message: "missing" });
    }) as typeof fetch;
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);
      expect(container.textContent).toContain(CACHED_SESSION_JSON_NOTE);
      expect(container.textContent).toContain(EVIDENCE_EMPTY_SNAPSHOT);
      expect(container.textContent).toContain(EVIDENCE_NOT_SAVED);
      await act(() => { root.unmount(); });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });

  test("live polling with session visibility does not render the empty snapshot sentence", async () => {
    const restoreFetch = installLiveSessionFetch();
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, "Scan in progress");
      await waitForText(container, VISIBILITY_NOTICE.session);
      const emptySnapshot = nodesByTag(container, "p").find(
        (node) => node.textContent === EVIDENCE_EMPTY_SNAPSHOT,
      ) ?? null;
      expect(emptySnapshot).toBeNull();
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });
});

describe("ResultsShell raw JSON disclosure and copy notice", () => {
  test("Raw JSON opens OverlayFrame inspector from the trigger", async () => {
    const envelopeMarker = "compatible_sf14_full_envelope_marker";
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification(() => "pass"), {
        envelopeMarker,
        retentionTier: envelopeMarker,
      } as unknown as Partial<ReportResponse>),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);
      expect(container.textContent).not.toContain(envelopeMarker);

      const trigger = findByExactText(container, "button", "View full report JSON");
      expect(trigger.getAttribute("type")).toBe("button");
      // Ready results use a low-emphasis footer action, not the prominent
      // action button styling reserved for the malformed terminal.
      expect(trigger.getAttribute("class")).toBe(
        "text-sm text-zinc-400 underline hover:text-zinc-200",
      );
      expect(trigger.getAttribute("class")).not.toContain("min-h-11");
      // The closed trigger advertises the dialog popup and collapsed state so
      // assistive tech announces the disclosure before it opens.
      expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      await act(() => {
        reactClick(trigger);
      });
      await waitForText(doc.body, envelopeMarker);
      expect(doc.body.textContent).toContain(envelopeMarker);
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(true);
      expect(doc.body.textContent).toContain("Raw report JSON");
      expect(nodesByRole(doc.body, "dialog").length).toBeGreaterThan(0);
      // Opening the inspector flips the trigger to the expanded state.
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("malformed report opens the modal with the full envelope", async () => {
    const envelopeMarker = "malformed_sf14_full_envelope_marker";
    const restoreFetch = installTerminalReportFetch(
      liveReport({ grade: null }, {
        envelopeMarker,
        retentionTier: envelopeMarker,
      } as unknown as Partial<ReportResponse>),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.resultUnavailable);
      expect(container.textContent).not.toContain(envelopeMarker);

      const trigger = findByExactText(container, "button", "View full report JSON");
      expect(trigger.getAttribute("type")).toBe("button");
      // The malformed terminal keeps the prominent action button styling.
      expect(trigger.getAttribute("class")).toContain("inline-flex");
      expect(trigger.getAttribute("class")).toContain("min-h-11");
      expect(trigger.getAttribute("class")).not.toContain("underline");
      // The closed trigger advertises the dialog popup and collapsed state so
      // assistive tech announces the disclosure before it opens.
      expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      await act(() => {
        reactClick(trigger);
      });
      await waitForText(doc.body, envelopeMarker);
      expect(doc.body.textContent).toContain(envelopeMarker);
      expect(doc.body.textContent).toContain("Raw report JSON");
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(true);
      // Opening the inspector flips the trigger to the expanded state.
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("no-grid ready report opens the modal with the full envelope", async () => {
    const envelopeMarker = "nogrid_sf14_full_envelope_marker";
    const restoreFetch = installTerminalReportFetch(
      permanentReport(
        specification(() => null, null),
        {
          envelopeMarker,
          retentionTier: envelopeMarker,
        } as unknown as Partial<ReportResponse>,
      ),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.noCompatibilityResult);
      expect(container.textContent).not.toContain(envelopeMarker);

      const trigger = findByExactText(container, "button", "View full report JSON");
      expect(trigger.getAttribute("type")).toBe("button");
      await act(() => {
        reactClick(trigger);
      });
      await waitForText(doc.body, envelopeMarker);
      expect(doc.body.textContent).toContain(envelopeMarker);
      expect(doc.body.textContent).toContain("Raw report JSON");
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(true);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("copy rejection never announces success", async () => {
    const COPY_FAILURE =
      "Could not copy the report link. Open the report and copy its address instead.";
    const restoreFetch = installPermanentReportFetch();
    const restoreClipboard = installRejectedClipboard();
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, "Copy public report link");

      const copyButton = findByExactText(container, "button", "Copy public report link");
      await act(() => {
        reactClick(copyButton);
      });
      await waitForText(container, COPY_FAILURE);

      const alerts = nodesByRole(container, "alert");
      expect(alerts.some((node) => node.textContent === COPY_FAILURE)).toBe(true);
      const copySuccessNotices = nodesByRole(container, "status").filter((node) => {
        return node.tagName === "P" && node.textContent === "Copied";
      });
      expect(copySuccessNotices).toEqual([]);
      expect(alerts.some((node) => node.tagName === "P" && node.textContent === "Copied")).toBe(false);
      await act(() => { root.unmount(); });
    } finally {
      restoreClipboard();
      restoreFetch();
      restore();
    }
  });
});
