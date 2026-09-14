import React, { act } from "react";
import { describe, expect, test } from "bun:test";

import ResultsShell, {
  projectResultsPage,
} from "./ResultsShell";
import { RESULT_HEADLINE, type CanonicalAreaId } from "../lib/validatorScore";
import { resolveValidatorMachine } from "../lib/stateMachine";
import { guidanceFor } from "../lib/validatorGuidance";
import {
  type ReportResponse,
  type SessionPollResponse,
} from "../lib/validatorFetch";
import {
  installDomShim,
  reactDomContainerOf,
  ShimNode,
} from "../test-helpers/domShim";
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

function pollOf(state: string, extra: Partial<SessionPollResponse> = {}): SessionPollResponse {
  return { state, ts: 1, optInActive: false, ...extra };
}

function viewOf(state: string, nextInstruction?: string) {
  return resolveValidatorMachine({
    state,
    optInActive: false,
    nextInstruction,
  });
}

function project(input: Partial<Parameters<typeof projectResultsPage>[0]> = {}) {
  return projectResultsPage({
    poll: pollOf("terminal_pass"),
    view: viewOf("terminal_pass"),
    lastLiveReport: null,
    terminalReport: null,
    reportFailure: null,
    validatorApiOrigin: API_ORIGIN,
    ...input,
  });
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

function firstByHasAttr(root: ShimNode, attr: string): ShimNode | null {
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (found === null && node.hasAttribute(attr)) {
      found = node;
    }
  });
  return found;
}

function nodesByAttr(root: ShimNode, attr: string, value: string): ShimNode[] {
  const found: ShimNode[] = [];
  walk(root, (node) => {
    if (node.getAttribute(attr) === value) {
      found.push(node);
    }
  });
  return found;
}

function summaryChip(root: ShimNode, icon: string): ShimNode {
  const band = firstByHasAttr(root, "data-summary-chips");
  if (band === null) {
    throw new Error("missing data-summary-chips");
  }
  const chip = band.childNodes.find((node) => node.getAttribute("data-icon") === icon);
  if (chip === undefined) {
    throw new Error(`missing summary chip ${icon}`);
  }
  return chip;
}

function documentOrderIndex(root: ShimNode, match: (node: ShimNode) => boolean): number {
  let index = 0;
  let found = -1;
  walk(root, (node) => {
    if (found === -1 && match(node)) {
      found = index;
    }
    index += 1;
  });
  return found;
}

function documentOrderIndices(root: ShimNode, match: (node: ShimNode) => boolean): number[] {
  let index = 0;
  const found: number[] = [];
  walk(root, (node) => {
    if (match(node)) {
      found.push(index);
    }
    index += 1;
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

function installNotSavedEmptyFetch(extraPoll: Partial<SessionPollResponse> = {}): () => void {
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
        state: "terminal_pass",
        ts: 1,
        optInActive: false,
        ...extraPoll,
      });
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(404, { error: "report_not_public", message: "report is not public" });
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

function viewReportAnchorsFrom(root: ShimNode): ShimNode[] {
  return nodesByTag(root, "a").filter((node) => node.textContent === "View report");
}

describe("ResultsShell ready results IA", () => {
  test("reserves the chip band, shows coverage beside the grid, and keeps public actions after it", async () => {
    const spec = specification(() => "pass");
    const expectedCoverage = project({
      terminalReport: permanentReport(spec),
    }).score.coverageLabel;
    const coverageLine = `${expectedCoverage} areas tested`;
    const restoreFetch = installTerminalReportFetch(permanentReport(spec));
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
      await waitForText(container, coverageLine);

      const chips = firstByHasAttr(container, "data-summary-chips");
      expect(chips).not.toBeNull();
      if (chips === null) {
        throw new Error("missing data-summary-chips");
      }
      expect(chips.childNodes.length).toBe(4);
      expect(summaryChip(container, "pass").textContent).toContain("8");
      expect(summaryChip(container, "warn").textContent).toContain("0");
      expect(summaryChip(container, "fail").textContent).toContain("0");
      expect(summaryChip(container, "not-tested").textContent).toContain("0");

      const banner = firstByHasAttr(container, "data-banner-region");
      expect(banner).not.toBeNull();
      if (banner === null) {
        throw new Error("missing data-banner-region");
      }
      expect(banner.textContent).not.toContain(expectedCoverage);
      expect(banner.textContent).not.toContain("areas tested");
      expect(banner.textContent).not.toContain(coverageLine);

      const headingIndex = documentOrderIndex(
        container,
        (node) => node.tagName === "H2" && node.textContent === "What was tested",
      );
      const chipsIndex = documentOrderIndex(container, (node) => node.hasAttribute("data-summary-chips"));
      const coverageIndex = documentOrderIndex(
        container,
        (node) => node.tagName === "P" && node.textContent === coverageLine,
      );
      const cardIndices = documentOrderIndices(
        container,
        (node) => node.hasAttribute("data-area-card"),
      );
      const firstCardIndex = cardIndices[0] ?? -1;
      const lastCardIndex = cardIndices[cardIndices.length - 1] ?? -1;
      const openIndex = documentOrderIndex(
        container,
        (node) => node.tagName === "A" && node.textContent === "Open public report",
      );
      const copyIndex = documentOrderIndex(
        container,
        (node) => node.tagName === "BUTTON" && node.textContent === "Copy public report link",
      );
      const bannerIndex = documentOrderIndex(container, (node) => node.hasAttribute("data-banner-region"));
      expect(bannerIndex).toBeGreaterThan(-1);
      expect(chipsIndex).toBeGreaterThan(bannerIndex);
      expect(coverageIndex).toBeGreaterThan(chipsIndex);
      expect(headingIndex).toBeGreaterThan(coverageIndex);
      expect(cardIndices.length).toBe(AREA_IDS.length);
      expect(firstCardIndex).toBeGreaterThan(headingIndex);
      expect(lastCardIndex).toBeGreaterThan(firstCardIndex);
      // Action row must follow every grid card. Comparing only the first card
      // would still pass if the row were moved between cards; these checks fail
      // if Open/Copy appear before any data-area-card.
      for (const cardIndex of cardIndices) {
        expect(openIndex).toBeGreaterThan(cardIndex);
        expect(copyIndex).toBeGreaterThan(cardIndex);
      }
      expect(container.textContent).toContain(coverageLine);
      expect(container.textContent).toContain("What was tested");
      expect(container.textContent).toContain("Copy page link");
      expect(container.textContent).toContain(`Session ${SESSION_ID}`);
      expect(container.textContent).toContain("Open public report");
      expect(container.textContent).toContain("Copy public report link");
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("host kicker appears before the verdict banner", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification(() => "pass")),
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

      const hostIndex = documentOrderIndex(
        container,
        (node) => node.tagName === "P" && node.textContent === "Result for peer.example",
      );
      const bannerIndex = documentOrderIndex(
        container,
        (node) => node.hasAttribute("data-banner-region"),
      );
      expect(hostIndex).toBeGreaterThan(-1);
      expect(bannerIndex).toBeGreaterThan(-1);
      // Host kicker must precede VerdictBanner. This fails if host is moved
      // after the banner region.
      expect(hostIndex).toBeLessThan(bannerIndex);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("renders one chip per grade with lucide icons, visible N/8, and one sr-only sentence", async () => {
    const spec = specification(() => "pass");
    const expectedCoverage = project({
      terminalReport: permanentReport(spec),
    }).score.coverageLabel;
    const coverageLine = `${expectedCoverage} areas tested`;
    const sentence = "8 of 8 areas tested: 8 pass, 0 warn, 0 fail, 0 not tested";
    const restoreFetch = installTerminalReportFetch(permanentReport(spec));
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
      await waitForText(container, coverageLine);

      const icons = ["pass", "warn", "fail", "not-tested"] as const;
      const expectedCounts = { pass: "8", warn: "0", fail: "0", "not-tested": "0" };
      for (const icon of icons) {
        const chip = summaryChip(container, icon);
        expect(chip.getAttribute("data-icon")).toBe(icon);
        expect(chip.getAttribute("aria-hidden")).toBe("true");
        expect(chip.textContent).toContain(expectedCounts[icon]);
        const svgs = nodesByTag(chip, "svg");
        expect(svgs.length).toBe(1);
        const svg = svgs[0];
        if (svg === undefined) {
          throw new Error(`missing lucide svg on ${icon} chip`);
        }
        expect(svg.getAttribute("aria-hidden")).toBe("true");
        expect(svg.getAttribute("width")).toBe("16");
        expect(svg.getAttribute("height")).toBe("16");
      }

      const coverage = firstByHasAttr(container, "data-summary-coverage");
      expect(coverage).not.toBeNull();
      if (coverage === null) {
        throw new Error("missing data-summary-coverage");
      }
      expect(coverage.tagName).toBe("P");
      expect(coverage.textContent).toBe(coverageLine);
      expect(coverage.getAttribute("class") ?? "").not.toContain("sr-only");

      const srNodes = nodesByAttr(container, "data-summary-sr", "");
      expect(srNodes.length).toBe(1);
      const sr = srNodes[0];
      if (sr === undefined) {
        throw new Error("missing data-summary-sr");
      }
      expect(sr.textContent).toBe(sentence);
      expect(sr.getAttribute("class") ?? "").toContain("sr-only");

      const banner = firstByHasAttr(container, "data-banner-region");
      expect(banner).not.toBeNull();
      if (banner === null) {
        throw new Error("missing data-banner-region");
      }
      expect(banner.textContent).not.toContain("Assessed");
      expect(banner.textContent).not.toContain(expectedCoverage);
      expect(container.textContent).toContain(coverageLine);
      expect(container.textContent).toContain(sentence);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("counts mixed grades including not-tested areas on the summary chips", async () => {
    const spec = specification((id) => {
      if (id === "discovery" || id === "tls" || id === "jwks") {
        return "pass";
      }
      if (id === "httpsig" || id === "sharing") {
        return "warn";
      }
      if (id === "notification") {
        return "fail";
      }
      return null;
    }, "fail");
    const projected = project({ terminalReport: permanentReport(spec) });
    expect(projected.score.assessed).toBe(6);
    expect(projected.score.total).toBe(8);
    const coverageLine = `${projected.score.coverageLabel} areas tested`;
    const sentence = "6 of 8 areas tested: 3 pass, 2 warn, 1 fail, 2 not tested";
    const restoreFetch = installTerminalReportFetch(permanentReport(spec));
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, coverageLine);
      expect(summaryChip(container, "pass").getAttribute("data-icon")).toBe("pass");
      expect(summaryChip(container, "pass").textContent).toContain("3");
      expect(summaryChip(container, "warn").getAttribute("data-icon")).toBe("warn");
      expect(summaryChip(container, "warn").textContent).toContain("2");
      expect(summaryChip(container, "fail").getAttribute("data-icon")).toBe("fail");
      expect(summaryChip(container, "fail").textContent).toContain("1");
      expect(summaryChip(container, "not-tested").getAttribute("data-icon")).toBe("not-tested");
      expect(summaryChip(container, "not-tested").textContent).toContain("2");
      const coverage = firstByHasAttr(container, "data-summary-coverage");
      expect(coverage?.textContent).toBe(coverageLine);
      const srNodes = nodesByAttr(container, "data-summary-sr", "");
      expect(srNodes.length).toBe(1);
      expect(srNodes[0]?.textContent).toBe(sentence);
      const banner = firstByHasAttr(container, "data-banner-region");
      expect(banner?.textContent).not.toContain("Assessed");
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("treats null area grades as not-tested and keeps a single sr-only sentence", async () => {
    const spec = specification(() => null, null);
    const projected = project({ terminalReport: permanentReport(spec) });
    expect(projected.showAreas).toBe(true);
    expect(projected.score.assessed).toBe(0);
    const coverageLine = `${projected.score.coverageLabel} areas tested`;
    const sentence = "0 of 8 areas tested: 0 pass, 0 warn, 0 fail, 8 not tested";
    const restoreFetch = installTerminalReportFetch(permanentReport(spec));
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, coverageLine);
      expect(summaryChip(container, "pass").textContent).toContain("0");
      expect(summaryChip(container, "warn").textContent).toContain("0");
      expect(summaryChip(container, "fail").textContent).toContain("0");
      expect(summaryChip(container, "not-tested").textContent).toContain("8");
      expect(nodesByAttr(container, "data-summary-sr", "").length).toBe(1);
      expect(nodesByAttr(container, "data-summary-sr", "")[0]?.textContent).toBe(sentence);
      const coverage = firstByHasAttr(container, "data-summary-coverage");
      expect(coverage?.textContent).toBe(coverageLine);
      expect(coverage?.getAttribute("class") ?? "").not.toContain("sr-only");
      const banner = firstByHasAttr(container, "data-banner-region");
      expect(banner?.textContent).not.toContain("Assessed");
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });
});

describe("ResultsShell not-saved empty JSON action", () => {
  test("not_saved_empty offers no full report JSON action and opens no overlay", async () => {
    const restoreFetch = installNotSavedEmptyFetch();
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, "This scan was not saved");

      // No source report exists, so there is no JSON action and no modal.
      expect(container.textContent).toContain(`Session ${SESSION_ID}`);
      expect(container.textContent).not.toContain("Copy page link");
      expect(container.textContent).not.toContain("View full report JSON");
      expect(container.textContent).not.toContain("View raw report JSON");
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(false);
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-area-modal")),
      ).toBe(false);
      expect(nodesByRole(doc.body, "dialog").length).toBe(0);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("not_saved_empty still renders poll-state guidance and the trimmed failModeLabel", async () => {
    const restoreFetch = installNotSavedEmptyFetch({
      state: "terminal_fail",
      failModeLabel: "  handshake failed  ",
    });
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, "This scan was not saved");

      const guidance = guidanceFor("terminal_fail");
      expect(guidance).not.toBeNull();
      if (guidance === null) {
        throw new Error("expected terminal_fail guidance");
      }
      expect(container.textContent).toContain(guidance.body);
      expect(container.textContent).toContain("handshake failed");
      expect(container.textContent).not.toContain("  handshake failed  ");
      expect(container.textContent).not.toContain("reverse_share_timeout");
      expect(container.textContent).not.toContain("reverse_invite_timeout");
      expect(viewReportAnchorsFrom(container).length).toBe(0);
      expect(container.textContent).not.toContain("Open public report");
      expect(container.textContent).not.toContain("Copy public report link");
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });
});
