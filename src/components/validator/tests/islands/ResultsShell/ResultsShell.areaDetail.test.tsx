import { act } from "react";
import { describe, expect, test } from "bun:test";

import ResultsShell from "@/components/validator/islands/ResultsShell";
import { RESULT_HEADLINE, type CanonicalAreaId } from "@/components/validator/lib/validatorScore";
import { type ReportResponse } from "@/components/validator/lib/validatorFetch";
import {
  installDomShim,
  reactDomContainerOf,
  ShimEvent,
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

function firstByAttr(root: ShimNode, attr: string, value: string): ShimNode | null {
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (found === null && node.getAttribute(attr) === value) {
      found = node;
    }
  });
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

function actionButtons(root: ShimNode): ShimNode[] {
  return nodesByTag(root, "button").filter((node) => {
    const id = node.getAttribute("id");
    return id !== null && id.startsWith("area-card-") && id.endsWith("-action");
  });
}

function actionButton(root: ShimNode, areaId: string): ShimNode | null {
  return firstByAttr(root, "id", `area-card-${areaId}-action`);
}

describe("ResultsShell area detail modal", () => {
  test("a ready results card opens the area detail modal", async () => {
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

      const trigger = findByExactText(container, "button", "View details");
      expect(trigger.getAttribute("id")).toBe("area-card-discovery-action");
      expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
      await act(() => {
        reactClick(trigger);
      });
      await waitForText(doc.body, "Raw JSON");

      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(true);
      expect(nodesByRole(doc.body, "dialog").length).toBeGreaterThan(0);
      expect(
        nodesByRole(doc.body, "tablist").some(
          (node) => node.getAttribute("aria-label") === "Area details",
        ),
      ).toBe(true);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("an assessed zero-evidence card opens the area detail modal", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification((id) => (id === "tls" ? "warn" : "pass"), "warn")),
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
      await waitForText(container, RESULT_HEADLINE.compatibleWithWarnings);

      const trigger = actionButton(container, "tls");
      expect(trigger).not.toBeNull();
      if (trigger === null) throw new Error("missing tls trigger");
      // A warn card surfaces the reason-forward label, not the pass label.
      expect(trigger.textContent).toBe("Why and evidence");
      await act(() => {
        reactClick(trigger);
      });
      await waitForText(doc.body, "Raw JSON");

      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(true);
      expect(
        nodesByRole(doc.body, "tablist").some(
          (node) => node.getAttribute("aria-label") === "Area details",
        ),
      ).toBe(true);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("a truly empty unassessed card has no View details button", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification((id) => (id === "jwks" ? null : "pass"))),
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

      expect(actionButton(container, "discovery")).not.toBeNull();
      expect(actionButton(container, "jwks")).toBeNull();
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("ready results use the interactive results grid, not statistics tiles", async () => {
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

      expect(
        nodesByTag(container, "article").some((node) => node.hasAttribute("data-area-card")),
      ).toBe(true);
      expect(actionButtons(container).length).toBeGreaterThan(0);
      expect(container.textContent).not.toContain("areas assessed");
      expect(container.textContent).not.toContain("pass rate");
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("card and area modal show the same primary reason copy for a warn card with a pass primary item", async () => {
    const remedy =
      "Publish a 200 JSON document at /.well-known/ocm with enabled true and the required apiVersion, endPoint, and resourceTypes.";
    const why =
      "The validator sent an uncached GET to /.well-known/ocm and assessed the returned JSON discovery document.";
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification((id) => (id === "discovery" ? "warn" : "pass"), "warn"), {
        evidence: [
          {
            area: "discovery",
            scoreArea: "discovery",
            reasonCode: "discovery_probed",
            grade: "pass",
            affectsGrade: true,
          },
          {
            area: "discovery",
            scoreArea: "discovery",
            reasonCode: "tls_probed",
            grade: "warn",
            affectsGrade: false,
          },
        ],
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
      await waitForText(container, RESULT_HEADLINE.compatibleWithWarnings);

      // The aggregate discovery card is warn, but the primary evidence item by
      // precedence is the grade-affecting pass discovery_probed row (the warn
      // tls_probed row does not affect the grade), so the card reason copy must
      // resolve from the primary item (no remedy) and match AreaModal exactly.
      const cardReason = firstByAttr(container, "data-area-reason", "discovery");
      expect(cardReason).not.toBeNull();
      if (cardReason === null) throw new Error("missing discovery card reason");
      expect(cardReason.textContent).toContain("Discovery endpoint checked");
      expect(cardReason.textContent).toContain(why);
      expect(cardReason.textContent).not.toContain(remedy);

      const trigger = actionButton(container, "discovery");
      expect(trigger).not.toBeNull();
      if (trigger === null) throw new Error("missing discovery View details button");
      await act(() => {
        reactClick(trigger);
      });
      await waitForText(doc.body, "Raw JSON");

      const summary = firstByAttr(doc.body, "data-area-panel", "summary");
      expect(summary).not.toBeNull();
      if (summary === null) throw new Error("missing area modal summary panel");
      expect(summary.textContent).toContain("Discovery endpoint checked");
      expect(summary.textContent).toContain(why);
      expect(summary.textContent).not.toContain(remedy);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("card and area modal agree when the primary item has a null grade", async () => {
    const remedy =
      "Publish a 200 JSON document at /.well-known/ocm with enabled true and the required apiVersion, endPoint, and resourceTypes.";
    const why =
      "The validator sent an uncached GET to /.well-known/ocm and assessed the returned JSON discovery document.";
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification((id) => (id === "discovery" ? "warn" : "pass"), "warn"), {
        evidence: [
          {
            area: "discovery",
            scoreArea: "discovery",
            reasonCode: "discovery_probed",
            grade: null,
            affectsGrade: true,
          },
        ],
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
      await waitForText(container, RESULT_HEADLINE.compatibleWithWarnings);

      // A null primary grade resolves to no remedy, and the card and modal must
      // still agree on the reason copy.
      const cardReason = firstByAttr(container, "data-area-reason", "discovery");
      expect(cardReason).not.toBeNull();
      if (cardReason === null) throw new Error("missing discovery card reason");
      expect(cardReason.textContent).toContain("Discovery endpoint checked");
      expect(cardReason.textContent).toContain(why);
      expect(cardReason.textContent).not.toContain(remedy);

      const trigger = actionButton(container, "discovery");
      expect(trigger).not.toBeNull();
      if (trigger === null) throw new Error("missing discovery trigger");
      await act(() => {
        reactClick(trigger);
      });
      await waitForText(doc.body, "Raw JSON");

      const summary = firstByAttr(doc.body, "data-area-panel", "summary");
      expect(summary).not.toBeNull();
      if (summary === null) throw new Error("missing area modal summary panel");
      expect(summary.textContent).toContain("Discovery endpoint checked");
      expect(summary.textContent).toContain(why);
      expect(summary.textContent).not.toContain(remedy);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });
});
