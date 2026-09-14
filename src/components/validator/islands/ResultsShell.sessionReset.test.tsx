import React, { act } from "react";
import { describe, expect, test } from "bun:test";

import ResultsShell, {
  CACHED_SESSION_JSON_NOTE,
  EVIDENCE_NOT_SAVED,
  VISIBILITY_NOTICE,
} from "./ResultsShell";
import { RESULT_HEADLINE, type CanonicalAreaId } from "../lib/validatorScore";
import type { ReportResponse } from "../lib/validatorFetch";
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

function actionButtons(root: ShimNode): ShimNode[] {
  return nodesByTag(root, "button").filter((node) => {
    const id = node.getAttribute("id");
    return id !== null && id.startsWith("area-card-") && id.endsWith("-action");
  });
}

describe("ResultsShell session change reset", () => {
  test("drops session A cache, failure, and view when the session id changes", async () => {
    const sessionB = "0193b1d3-8d2e-7c5b-9f3f-2b3c4d5e6f70";
    const cacheMarker = "session_a_cache_marker";
    let deliveredRunningA = false;
    let lastAPoll: "running" | "terminal" = "running";
    let releaseB = (): void => {};
    let bReleased = false;
    const waitForB = new Promise<void>((resolve) => {
      releaseB = () => {
        bReleased = true;
        resolve();
      };
    });
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
        });
      }
      if (url.includes(`/api/session/${SESSION_ID}`)) {
        if (!deliveredRunningA) {
          deliveredRunningA = true;
          lastAPoll = "running";
          return jsonResponse(200, {
            state: "passive_running",
            ts: 1,
            optInActive: false,
            nextInstruction: "wait_probe",
          });
        }
        lastAPoll = "terminal";
        return jsonResponse(200, { state: "terminal_pass", ts: 2, optInActive: false });
      }
      if (url.includes(`/api/report/${SESSION_ID}`)) {
        if (lastAPoll === "running") {
          return jsonResponse(200, liveReport(specification(() => "pass"), {
            evidence: [{ area: "discovery", reasonCode: cacheMarker, grade: "pass" }],
          }));
        }
        return jsonResponse(404, { error: "report_not_public", message: "report is not public" });
      }
      if (url.includes(`/api/session/${sessionB}`)) {
        if (!bReleased) {
          await waitForB;
        }
        return jsonResponse(200, { state: "terminal_pass", ts: 3, optInActive: false });
      }
      if (url.includes(`/api/report/${sessionB}`)) {
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
      expect(container.textContent).toContain(SESSION_ID);
      expect(container.textContent).toContain(CACHED_SESSION_JSON_NOTE);
      // Cached not_saved session with real evidence items now discloses the
      // evidence instead of suppressing it, so the not-public evidence notice
      // no longer stands in for the actual evidence.
      expect(container.textContent).not.toContain(EVIDENCE_NOT_SAVED);
      // The disclosed evidence surfaces the raw fixture reason slug directly.
      expect(container.textContent).toContain(cacheMarker);
      expect(container.textContent).not.toContain("Continue or finish");

      const cachedTrigger = findByExactText(container, "button", "View full report JSON");
      await act(() => {
        reactClick(cachedTrigger);
      });
      await waitForText(doc.body, cacheMarker);
      expect(doc.body.textContent).toContain(cacheMarker);
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(true);
      expect(doc.body.textContent).toContain("Last session JSON");

      await act(() => {
        root.render(<ResultsShell host="peer.example" id={sessionB} />);
      });
      expect(container.textContent).toContain(sessionB);
      // Resume/navigation must not flash the running banner before the first
      // successful poll: only "Loading session..." shows until poll and view
      // exist for the new session.
      expect(container.textContent).not.toContain("Scan in progress");
      expect(container.textContent).toContain("Loading session...");
      expect(container.textContent).not.toContain(RESULT_HEADLINE.compatible);
      expect(container.textContent).not.toContain(CACHED_SESSION_JSON_NOTE);
      expect(container.textContent).not.toContain(EVIDENCE_NOT_SAVED);
      expect(container.textContent).not.toContain(cacheMarker);
      expect(container.textContent).not.toContain("Continue or finish");
      expect(container.textContent).not.toContain("This scan was not saved");
      expect(container.textContent).not.toContain("Last session JSON");

      await act(() => {
        releaseB();
      });
      await waitForText(container, "This scan was not saved");
      expect(container.textContent).toContain(sessionB);
      expect(container.textContent).not.toContain(RESULT_HEADLINE.compatible);
      expect(container.textContent).not.toContain(CACHED_SESSION_JSON_NOTE);
      expect(container.textContent).not.toContain(cacheMarker);
      expect(container.textContent).not.toContain("Last session JSON");
      expect(container.textContent).not.toContain(EVIDENCE_NOT_SAVED);
      await act(() => { root.unmount(); });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });

  test("resets raw JSON overlay when the session id changes to a ready permanent report", async () => {
    const sessionB = "0193b1d3-8d2e-7c5b-9f3f-2b3c4d5e6f70";
    const cacheMarker = "session_a_cache_marker";
    let deliveredRunningA = false;
    let lastAPoll: "running" | "terminal" = "running";
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
        if (!deliveredRunningA) {
          deliveredRunningA = true;
          lastAPoll = "running";
          return jsonResponse(200, {
            state: "passive_running",
            ts: 1,
            optInActive: false,
            nextInstruction: "wait_probe",
          });
        }
        lastAPoll = "terminal";
        return jsonResponse(200, { state: "terminal_pass", ts: 2, optInActive: false });
      }
      if (url.includes(`/api/report/${SESSION_ID}`)) {
        if (lastAPoll === "running") {
          return jsonResponse(200, liveReport(specification(() => "pass"), {
            evidence: [{ area: "discovery", reasonCode: cacheMarker, grade: "pass" }],
          }));
        }
        return jsonResponse(404, { error: "report_not_public", message: "report is not public" });
      }
      if (url.includes(`/api/session/${sessionB}`)) {
        return jsonResponse(200, { state: "terminal_pass", ts: 3, optInActive: false });
      }
      if (url.includes(`/api/report/${sessionB}`)) {
        return jsonResponse(200, permanentReport(specification(() => "pass")));
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
      // Cached not_saved session with real evidence items discloses the
      // evidence, so the not-public evidence notice no longer appears and the
      // raw fixture reason slug is surfaced directly.
      expect(container.textContent).not.toContain(EVIDENCE_NOT_SAVED);
      expect(container.textContent).toContain(cacheMarker);

      const cachedTrigger = findByExactText(container, "button", "View full report JSON");
      await act(() => {
        reactClick(cachedTrigger);
      });
      await waitForText(doc.body, cacheMarker);
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(true);

      await act(() => {
        root.render(<ResultsShell host="peer.example" id={sessionB} />);
      });
      expect(container.textContent).toContain(sessionB);
      await waitForText(container, RESULT_HEADLINE.compatible);
      await waitForText(container, VISIBILITY_NOTICE.permanent);
      expect(container.textContent).toContain("View full report JSON");
      expect(container.textContent).not.toContain(CACHED_SESSION_JSON_NOTE);
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(false);
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 5);
        });
      });
      expect(container.textContent).toContain(RESULT_HEADLINE.compatible);
      expect(container.textContent).toContain("View full report JSON");
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(false);
      await act(() => { root.unmount(); });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });

  test("closes the area detail modal when the session id changes to a ready permanent report", async () => {
    const sessionB = "0193b1d3-8d2e-7c5b-9f3f-2b3c4d5e6f70";
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
        return jsonResponse(200, permanentReport(specification(() => "pass")));
      }
      if (url.includes(`/api/session/${sessionB}`)) {
        return jsonResponse(200, { state: "terminal_pass", ts: 3, optInActive: false });
      }
      if (url.includes(`/api/report/${sessionB}`)) {
        // Session B is a ready permanent report with a real sourceReport and its
        // own assessed areas. The warn area gives it a distinct headline so the
        // test can wait for B's report to finish loading.
        return jsonResponse(
          200,
          permanentReport(specification((id) => (id === "tls" ? "warn" : "pass"), "warn")),
        );
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

      const trigger = findByExactText(container, "button", "View details");
      expect(trigger.getAttribute("id")).toBe("area-card-discovery-action");
      expect(trigger.getAttribute("aria-labelledby")).toBe(
        "area-card-discovery-title area-card-discovery-action",
      );
      await act(() => {
        reactClick(trigger);
      });
      await waitForText(doc.body, "Raw JSON");

      // Session A: the area modal is open on the discovery card.
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(true);
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-area-modal")),
      ).toBe(true);
      expect(nodesByRole(doc.body, "dialog").length).toBeGreaterThan(0);
      expect(
        nodesByRole(doc.body, "tablist").some(
          (node) => node.getAttribute("aria-label") === "Area details",
        ),
      ).toBe(true);
      expect(doc.body.textContent).toContain("Server discovery");

      await act(() => {
        root.render(<ResultsShell host="peer.example" id={sessionB} />);
      });
      expect(container.textContent).toContain(sessionB);
      // Wait for session B's distinct terminal report so its sourceReport is
      // loaded and the results grid is interactive again. If selectedArea were
      // not reset on the session change, the modal guard (sourceReport !== null
      // and status ready) would keep the AreaModal open here, which is what
      // makes this regression non-vacuous.
      await waitForText(container, RESULT_HEADLINE.compatibleWithWarnings);
      expect(actionButtons(container).length).toBeGreaterThan(0);

      // Session B: the area modal is closed even though a valid sourceReport
      // exists, proving the session change reset selectedArea.
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(false);
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-area-modal")),
      ).toBe(false);
      expect(nodesByRole(doc.body, "dialog").length).toBe(0);
      expect(
        nodesByRole(doc.body, "tablist").some(
          (node) => node.getAttribute("aria-label") === "Area details",
        ),
      ).toBe(false);
      expect(doc.body.textContent).not.toContain("Raw JSON");
      await act(() => { root.unmount(); });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });
});
