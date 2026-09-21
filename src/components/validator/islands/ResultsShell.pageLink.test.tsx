import { act } from "react";
import { describe, expect, test } from "bun:test";

import ResultsShell, {
  PAGE_LINK_NOT_SAVED_NOTICE,
  TEST_HREF,
  VISIBILITY_NOTICE,
} from "./ResultsShell";
import { RESULT_HEADLINE, type CanonicalAreaId } from "../lib/validatorScore";
import type { EvidenceItem } from "../lib/evidence/types";
import { type ReportResponse } from "../lib/validatorFetch";
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

const EVIDENCE_ITEM: EvidenceItem = {
  area: "discovery",
  reasonCode: "discovery_probed",
  grade: "pass",
};

function walk(node: ShimNode, visit: (current: ShimNode) => void): void {
  visit(node);
  for (const child of node.childNodes) {
    walk(child, visit);
  }
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

function firstByHasAttr(root: ShimNode, attr: string): ShimNode | null {
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (found === null && node.hasAttribute(attr)) {
      found = node;
    }
  });
  return found;
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

function installStopInstructionFetch(calls: { stop: number; sessionGet: number }): () => void {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = (init?.method ?? "GET").toUpperCase();
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
    if (url.includes("/stop") && method === "POST") {
      calls.stop += 1;
      return jsonResponse(200, { id: SESSION_ID, state: "interrupted" });
    }
    if (url.includes(`/api/session/${SESSION_ID}`)) {
      calls.sessionGet += 1;
      return jsonResponse(200, {
        state: "passive_complete",
        ts: 1,
        optInActive: false,
        nextInstruction: "stop",
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

describe("ResultsShell page-link action", () => {
  test("shows the exact not-saved honesty notice on ready cached results", async () => {
    const restoreFetch = installNotSavedCachedFetch();
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
      await waitForText(container, PAGE_LINK_NOT_SAVED_NOTICE);
      expect(container.textContent).toContain("Copy page link");
      expect(container.textContent).toContain(`Session ${SESSION_ID}`);
      expect(container.textContent).toContain(
        "Not saved. This result was not stored as a public report. A copied page link identifies the session but does not preserve these scores or evidence.",
      );
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("keeps the page-link action when a permanent public URL is invalid", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification(() => "pass"), {
        reportUrl: "https://evil.example/validator/report/abc",
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
      expect(container.textContent).toContain("Copy page link");
      expect(container.textContent).toContain(`Session ${SESSION_ID}`);
      expect(container.textContent).not.toContain("Open public report");
      expect(container.textContent).not.toContain("Copy public report link");
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("read-only live links keep GET polling and do not POST /stop", async () => {
    const calls = { stop: 0, sessionGet: 0 };
    const restoreFetch = installStopInstructionFetch(calls);
    const { document: doc, restore } = installDomShim();
    setWindowHref(`https://localhost/?host=peer.example&id=${SESSION_ID}&ro=1`);
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, "Continue or finish");
      expect(container.textContent).toContain("Copy page link");
      // The fixture returns passive_complete + "stop" on every poll. A
      // read-only view must keep GET polling past that first stop
      // instruction instead of exiting after one poll, and must never POST
      // /stop.
      await waitForDom(() => calls.sessionGet >= 2);
      expect(calls.sessionGet).toBeGreaterThanOrEqual(2);
      expect(calls.stop).toBe(0);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("shows the not-saved visibility notice beside disclosed cache evidence", async () => {
    const restoreFetch = installTerminalReportFetch(
      liveReport(specification(() => "pass"), {
        visibility: "not_saved",
        evidence: [EVIDENCE_ITEM],
      }),
    );
    const { document: doc, restore } = installDomShim();
    // A non-read-only link so this mount is unaffected by any earlier test
    // that toggled the read-only page-link parameter.
    setWindowHref(`https://localhost/?host=peer.example&id=${SESSION_ID}`);
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);

      // A terminal not_saved cache with evidence items discloses the items
      // (evidenceMode = disclosure), and the not-saved visibility notice must
      // render in the same document beside that disclosed evidence.
      expect(container.textContent).toContain(VISIBILITY_NOTICE.not_saved);
      const disclosure = firstByHasAttr(container, "data-reason-source");
      expect(disclosure).not.toBeNull();
      expect(container.textContent).toContain("1 item");
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });
});

describe("ResultsShell testHref", () => {
  test("defaults recovery links to TEST_HREF and honors a custom testHref", async () => {
    const customHref = "/ocm/validator/";
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));

      await act(() => {
        root.render(<ResultsShell />);
      });
      await waitForText(container, "Back to Test");
      const defaultBack = findByExactText(container, "a", "Back to Test");
      expect(defaultBack.getAttribute("href")).toBe(TEST_HREF);

      await act(() => {
        root.render(<ResultsShell testHref={customHref} />);
      });
      await waitForText(container, "Back to Test");
      const customBack = findByExactText(container, "a", "Back to Test");
      expect(customBack.getAttribute("href")).toBe(customHref);
      await act(() => { root.unmount(); });
    } finally {
      restore();
    }
  });

  test("uses a custom testHref on Run a new check", async () => {
    const customHref = "/ocm/validator/";
    const restoreFetch = installInterruptedReportFetch();
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(
          <ResultsShell host="peer.example" id={SESSION_ID} testHref={customHref} />,
        );
      });
      await waitForText(container, "Run a new check");
      const recovery = findByExactText(container, "a", "Run a new check");
      expect(recovery.getAttribute("href")).toBe(customHref);
      expect(recovery.getAttribute("href")).not.toBe(TEST_HREF);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });
});
