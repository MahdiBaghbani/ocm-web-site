import React, { act } from "react";
import { describe, expect, test } from "bun:test";

import ResultsShell from "@/components/validator/islands/ResultsShell";
import { RESULT_HEADLINE, type CanonicalAreaId } from "@/components/validator/lib/validatorScore";
import { type ReportResponse } from "@/components/validator/lib/validatorFetch";
import {
  installDomShim,
  reactDomContainerOf,
  ShimNode,
} from "@/components/validator/tests/islands/ResultsShell/helpers/resultsShell";
import { requestUrl, jsonResponse } from "@/components/validator/tests/helpers/fetchStub";
import { waitForText } from "@/components/validator/tests/helpers/wait";

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

function walk(node: ShimNode, visit: (current: ShimNode) => void): void {
  visit(node);
  for (const child of node.childNodes) {
    walk(child, visit);
  }
}

function firstByHasAttr(root: ShimNode, attr: string): ShimNode | null {
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (found === null && node.hasAttribute(attr)) {
      found = node;
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

function installInterruptedReportFetch(): () => void {
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
      return jsonResponse(200, { state: "interrupted", ts: 1, optInActive: false });
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(200, permanentReport(specification(() => "pass", null)));
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

describe("ResultsShell resume banner gating", () => {
  test("keeps Loading session... and hides the running banner until the first successful poll", async () => {
    let releaseFirst = (): void => {};
    const waitFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstPollDelivered = false;
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
        // Block the first poll so the resume view is exercised with a valid
        // session identity but no poll or view yet.
        if (!firstPollDelivered) {
          firstPollDelivered = true;
          await waitFirst;
        }
        return jsonResponse(200, {
          state: "passive_running",
          ts: 1,
          optInActive: false,
          nextInstruction: "wait_probe",
        });
      }
      if (url.includes(`/api/report/${SESSION_ID}`)) {
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
      // Before the first successful poll, the session identity is known but
      // poll and view do not exist yet: only the loading line shows, the
      // running banner ("Scan in progress") stays hidden, and the banner
      // region is not rendered at all.
      expect(container.textContent).toContain("Loading session...");
      expect(container.textContent).not.toContain("Scan in progress");
      expect(firstByHasAttr(container, "data-banner-region")).toBeNull();

      await act(async () => {
        releaseFirst();
        await waitFirst;
      });
      // Once poll and view exist, the running banner appears normally.
      await waitForText(container, "Scan in progress");
      expect(firstByHasAttr(container, "data-banner-region")).not.toBeNull();
      await act(() => { root.unmount(); });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });
});

describe("ResultsShell interrupted ready recovery", () => {
  test("ready interrupted results offer Run a new check without public actions", async () => {
    const restoreFetch = installInterruptedReportFetch();
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.scanInterrupted);
      expect(container.textContent).toContain("Run a new check");
      expect(container.textContent).toContain("Copy page link");
      expect(container.textContent).toContain(`Session ${SESSION_ID}`);
      expect(container.textContent).not.toContain("This scan was not saved");
      expect(container.textContent).not.toContain("Open public report");
      expect(container.textContent).not.toContain("Copy public report link");
      const recovery = findByExactText(container, "a", "Run a new check");
      expect(recovery.getAttribute("href")).toBe("/validator/");
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });
});
