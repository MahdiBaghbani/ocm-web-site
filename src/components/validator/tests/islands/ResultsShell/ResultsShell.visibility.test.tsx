import React, { act } from "react";
import { describe, expect, test } from "bun:test";

import ResultsShell, {
  VISIBILITY_NOTICE,
} from "@/components/validator/islands/ResultsShell";
import { RESULT_HEADLINE, type CanonicalAreaId } from "@/components/validator/lib/validatorScore";
import {
  resolvePublicReportUrl,
  type ReportResponse,
} from "@/components/validator/lib/validatorFetch";
import {
  installDomShim,
  reactDomContainerOf,
  ShimNode,
} from "@/components/validator/tests/helpers/domShim";
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

function viewReportAnchorsFrom(root: ShimNode): ShimNode[] {
  return nodesByTag(root, "a").filter((node) => node.textContent === "View report");
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

function installNotSavedCachedFetch(): () => void {
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
  return () => {
    globalThis.fetch = previousFetch;
  };
}

function installExpiredReportFetch(): () => void {
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
      return jsonResponse(410, { error: "gone", message: "resource expired" });
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

function installReportErrorFetch(): () => void {
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
      return jsonResponse(404, { error: "nope", message: "missing" });
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

describe("ResultsShell report-link visibility", () => {
  test("permanent ready results keep the public report actions and hide the live View report link", async () => {
    const restoreFetch = installPermanentReportFetch();
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

      const open = findByExactText(container, "a", "Open public report");
      expect(open.getAttribute("href")).toBe(
        resolvePublicReportUrl(`/validator/report/${SESSION_ID}`, API_ORIGIN),
      );
      expect(open.getAttribute("href")).toBe(
        `https://validator.example.com/validator/report/${SESSION_ID}`,
      );
      expect(viewReportAnchorsFrom(container).length).toBe(0);
      expect(container.textContent).toContain("Copy public report link");
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("hides every report link for not_saved, expired, and unresolved terminals", async () => {
    const cases: Array<{ install: () => () => void; needle: string }> = [
      { install: installNotSavedCachedFetch, needle: RESULT_HEADLINE.compatible },
      { install: installExpiredReportFetch, needle: VISIBILITY_NOTICE.expired },
      { install: installReportErrorFetch, needle: "We could not load this report." },
    ];
    for (const item of cases) {
      const restoreFetch = item.install();
      const { document: doc, restore } = installDomShim();
      try {
        const { createRoot } = await import("react-dom/client");
        const container = doc.createElement("div");
        doc.body.appendChild(container);
        const root = createRoot(reactDomContainerOf(container));
        await act(() => {
          root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
        });
        await waitForText(container, item.needle);
        expect(viewReportAnchorsFrom(container).length).toBe(0);
        expect(container.textContent).not.toContain("Open public report");
        expect(container.textContent).not.toContain("Copy public report link");
        await act(() => { root.unmount(); });
      } finally {
        restoreFetch();
        restore();
      }
    }
  });

  test("successful unknown-visibility terminal hides every report link", async () => {
    const restoreFetch = installTerminalReportFetch(
      liveReport(specification(() => "pass"), { visibility: "unknown" }),
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
      expect(container.textContent).toContain(VISIBILITY_NOTICE.unknown);
      expect(container.textContent).not.toContain("We could not load this report.");
      expect(viewReportAnchorsFrom(container).length).toBe(0);
      expect(container.textContent).not.toContain("View report");
      expect(container.textContent).not.toContain("Open public report");
      expect(container.textContent).not.toContain("Copy public report link");
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });
});
