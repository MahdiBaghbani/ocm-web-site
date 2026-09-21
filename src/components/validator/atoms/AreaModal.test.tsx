import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import React, { act, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";

import AreaModal, { AreaModalContent } from "./AreaModal";
import type { EvidenceItem } from "./EvidenceDisclosure";
import type { CanonicalAreaId } from "../lib/validatorScore";
import { VALIDATOR_REASONS } from "../lib/validatorReasons";
import { registerHappyDom, teardownHappyDom } from "@/components/validator/tests/helpers/happyDom";

const DISCOVERY: CanonicalAreaId = "discovery";

// scoreArea match, area match, other-area, and a neither-field row. The
// neither-field row must be excluded from Summary and Evidence but kept in the
// full Raw JSON report.
const ITEMS: readonly EvidenceItem[] = [
  {
    scoreArea: "discovery",
    step: "SCOREMATCHSTEP",
    reasonCode: "discovery_probed",
    grade: "pass",
    affectsGrade: true,
  },
  { area: "discovery", step: "AREAMATCHSTEP", reasonCode: "tls_probed", grade: "warn" },
  { area: "tls", step: "OTHERSTEP" },
  { step: "NEITHERSTEP" },
];

function openingTag(html: string, marker: string): string {
  const idx = html.indexOf(marker);
  if (idx === -1) throw new Error(`marker not found: ${marker}`);
  const start = html.lastIndexOf("<", idx);
  const end = html.indexOf(">", idx);
  if (start === -1 || end === -1) throw new Error(`unreadable tag for ${marker}`);
  return html.slice(start, end + 1);
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`));
  return match === null ? null : (match[1] ?? null);
}

function count(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length;
}

// Region from one panel marker up to the next panel marker (or end). Lets a
// test assert content presence/absence scoped to a single tab panel.
function panelRegion(html: string, key: string): string {
  const order = ["summary", "evidence", "rawjson"];
  const start = html.indexOf(`data-area-panel="${key}"`);
  if (start === -1) throw new Error(`panel not found: ${key}`);
  const nextKey = order[order.indexOf(key) + 1];
  const end = nextKey === undefined ? -1 : html.indexOf(`data-area-panel="${nextKey}"`);
  return html.slice(start, end === -1 ? html.length : end);
}

describe("AreaModalContent SSR structure", () => {
  test("renders a tablist and three pre-mounted tab panels", () => {
    const html = renderToStaticMarkup(
      <AreaModalContent
        area={DISCOVERY}
        areaLabel="Server discovery"
        items={ITEMS}
        sourceReport={{ marker: "SSRMARKER" }}
      />,
    );

    expect(html).toContain('data-area-modal');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Area details"');
    expect(count(html, /role="tab"/g)).toBe(3);
    expect(count(html, /role="tabpanel"/g)).toBe(3);
    expect(html).toContain("Summary");
    expect(html).toContain("Evidence");
    expect(html).toContain("Raw JSON");
  });

  test("marks the selected tab and rolls tabIndex across the others", () => {
    const html = renderToStaticMarkup(
      <AreaModalContent
        area={DISCOVERY}
        areaLabel="Server discovery"
        items={ITEMS}
        sourceReport={{}}
      />,
    );

    const summaryTab = openingTag(html, 'data-area-tab="summary"');
    const evidenceTab = openingTag(html, 'data-area-tab="evidence"');
    const rawTab = openingTag(html, 'data-area-tab="rawjson"');

    expect(summaryTab).toContain('type="button"');
    expect(summaryTab).toContain('role="tab"');
    expect(attr(summaryTab, "aria-selected")).toBe("true");
    expect(attr(summaryTab, "tabindex")).toBe("0");
    expect(attr(evidenceTab, "aria-selected")).toBe("false");
    expect(attr(evidenceTab, "tabindex")).toBe("-1");
    expect(attr(rawTab, "aria-selected")).toBe("false");
    expect(attr(rawTab, "tabindex")).toBe("-1");
  });

  test("wires aria-controls and aria-labelledby between tabs and panels", () => {
    const html = renderToStaticMarkup(
      <AreaModalContent
        area={DISCOVERY}
        areaLabel="Server discovery"
        items={ITEMS}
        sourceReport={{}}
      />,
    );

    const summaryTab = openingTag(html, 'data-area-tab="summary"');
    const summaryPanel = openingTag(html, 'data-area-panel="summary"');
    const controls = attr(summaryTab, "aria-controls");
    const tabId = attr(summaryTab, "id");
    const panelId = attr(summaryPanel, "id");

    expect(controls).not.toBeNull();
    expect(controls).toBe(panelId);
    expect(attr(summaryPanel, "aria-labelledby")).toBe(tabId);
  });

  test("keeps every panel mounted with hidden and tabIndex on the inactive ones", () => {
    const html = renderToStaticMarkup(
      <AreaModalContent
        area={DISCOVERY}
        areaLabel="Server discovery"
        items={ITEMS}
        sourceReport={{}}
      />,
    );

    const summaryPanel = openingTag(html, 'data-area-panel="summary"');
    const evidencePanel = openingTag(html, 'data-area-panel="evidence"');
    const rawPanel = openingTag(html, 'data-area-panel="rawjson"');

    expect(summaryPanel).toContain('role="tabpanel"');
    expect(attr(summaryPanel, "tabindex")).toBe("0");
    expect(summaryPanel).not.toContain('hidden=""');

    expect(attr(evidencePanel, "tabindex")).toBe("0");
    expect(evidencePanel).toContain('hidden=""');
    expect(attr(rawPanel, "tabindex")).toBe("0");
    expect(rawPanel).toContain('hidden=""');
  });
});

describe("AreaModalContent evidence filtering and Raw JSON", () => {
  test("filters evidence by scoreArea and area while keeping the full report in Raw JSON", () => {
    const html = renderToStaticMarkup(
      <AreaModalContent
        area={DISCOVERY}
        areaLabel="Server discovery"
        items={ITEMS}
        sourceReport={{ fullReport: "FULLREPORTMARKER", evidence: ITEMS }}
      />,
    );

    const evidenceRegion = panelRegion(html, "evidence");
    const rawRegion = panelRegion(html, "rawjson");

    // Both matching rows appear; the other-area and neither-field rows do not.
    expect(evidenceRegion).toContain("SCOREMATCHSTEP");
    expect(evidenceRegion).toContain("AREAMATCHSTEP");
    expect(evidenceRegion).not.toContain("OTHERSTEP");
    expect(evidenceRegion).not.toContain("NEITHERSTEP");

    // The Raw JSON tab retains the neither-field row and the full report body.
    expect(rawRegion).toContain("NEITHERSTEP");
    expect(rawRegion).toContain("OTHERSTEP");
    expect(rawRegion).toContain("FULLREPORTMARKER");
  });

  test("Raw JSON shows the whole source report, not an area slice", () => {
    const html = renderToStaticMarkup(
      <AreaModalContent
        area={DISCOVERY}
        areaLabel="Server discovery"
        items={ITEMS}
        sourceReport={{ fullReport: "FULLREPORTMARKER", evidence: ITEMS }}
      />,
    );

    const rawRegion = panelRegion(html, "rawjson");
    expect(rawRegion).toContain("FULLREPORTMARKER");
    expect(rawRegion).toContain("NEITHERSTEP");
    expect(rawRegion).toContain("OTHERSTEP");
  });

  test("shows the empty evidence state when no rows match the area", () => {
    const html = renderToStaticMarkup(
      <AreaModalContent
        area="jwks"
        areaLabel="Signing keys"
        items={ITEMS}
        sourceReport={{}}
      />,
    );

    const evidenceRegion = panelRegion(html, "evidence");
    expect(evidenceRegion).toContain("No evidence.");
    expect(evidenceRegion).not.toContain("SCOREMATCHSTEP");
  });

  test("states reported and available counts separately when they differ", () => {
    const html = renderToStaticMarkup(
      <AreaModalContent
        area={DISCOVERY}
        areaLabel="Server discovery"
        items={ITEMS}
        sourceReport={{}}
        evidenceCount={5}
        loadedEvidenceCount={2}
      />,
    );

    const summaryRegion = panelRegion(html, "summary");
    expect(summaryRegion).toContain("Reported evidence: 5");
    expect(summaryRegion).toContain("Available evidence: 2");
  });
});

describe("AreaModalContent Summary grade pill", () => {
  test("shows the friendly pillLabel in the Summary pill when provided", () => {
    const html = renderToStaticMarkup(
      <AreaModalContent
        area={DISCOVERY}
        areaLabel="Server discovery"
        items={ITEMS}
        sourceReport={{}}
        grade="warn"
        pillLabel="Needs attention"
      />,
    );

    const summaryRegion = panelRegion(html, "summary");
    expect(summaryRegion).toContain('data-pill-kind="warn"');
    // Matches the friendly label the results card shows, not the raw "warn".
    expect(summaryRegion).toContain("Needs attention");
    expect(summaryRegion).not.toContain(">warn<");
  });

  test("falls back to the default pill label when no pillLabel is provided", () => {
    const html = renderToStaticMarkup(
      <AreaModalContent
        area={DISCOVERY}
        areaLabel="Server discovery"
        items={ITEMS}
        sourceReport={{}}
        grade="warn"
      />,
    );

    const summaryRegion = panelRegion(html, "summary");
    expect(summaryRegion).toContain('data-pill-kind="warn"');
    // With no pillLabel the pill keeps the raw DEFAULT_LABEL text.
    expect(summaryRegion).toContain(">warn<");
    expect(summaryRegion).not.toContain("Needs attention");
  });
});

describe("AreaModalContent Summary reason copy", () => {
  test("renders the resolved reason title, why, and remedy in the Summary panel", () => {
    // jwks_unadvertised is grade-specific (warn), so reasonCopyFor resolves a
    // fixed warn outcome and includes the remedy for the Summary panel.
    const reasonItems: readonly EvidenceItem[] = [
      { scoreArea: "jwks", step: "JWKSREASONSTEP", reasonCode: "jwks_unadvertised" },
    ];

    const html = renderToStaticMarkup(
      <AreaModalContent
        area="jwks"
        areaLabel="Signing keys"
        items={reasonItems}
        sourceReport={{}}
      />,
    );

    const summaryRegion = panelRegion(html, "summary");
    const reason = VALIDATOR_REASONS.jwks_unadvertised;
    if (reason === undefined) throw new Error("missing jwks_unadvertised reason entry");

    expect(summaryRegion).toContain(reason.title);
    expect(summaryRegion).toContain(reason.why);
    expect(reason.remedy).not.toBeUndefined();
    expect(summaryRegion).toContain(reason.remedy ?? "");
  });
});

let root: Root | null = null;

beforeAll(async () => {
  await registerHappyDom("http://localhost/", "AreaModal.test.tsx");
});

afterAll(() => {
  teardownHappyDom();
});

afterEach(() => {
  if (root !== null) {
    const current = root;
    act(() => {
      current.unmount();
    });
    root = null;
  }
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
});

function mount(ui: ReactElement): void {
  act(() => {
    root = createRoot(document.body);
    root.render(ui);
  });
}

function must<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (el === null) throw new Error(`Element not found: ${selector}`);
  return el;
}

function fireKeyDown(target: EventTarget, key: string): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

describe("AreaModal keyboard navigation", () => {
  test("ArrowRight, ArrowLeft, Home, and End move and focus the selected tab", () => {
    mount(
      <AreaModal
        area={DISCOVERY}
        areaLabel="Server discovery"
        items={ITEMS}
        sourceReport={{}}
        onClose={() => undefined}
      />,
    );

    const summaryTab = must<HTMLButtonElement>('[data-area-tab="summary"]');
    const evidenceTab = must<HTMLButtonElement>('[data-area-tab="evidence"]');
    const rawTab = must<HTMLButtonElement>('[data-area-tab="rawjson"]');

    act(() => {
      summaryTab.focus();
    });
    expect(document.activeElement).toBe(summaryTab);

    fireKeyDown(summaryTab, "ArrowRight");
    expect(document.activeElement).toBe(evidenceTab);
    expect(evidenceTab.getAttribute("aria-selected")).toBe("true");
    expect(evidenceTab.getAttribute("tabindex")).toBe("0");
    expect(summaryTab.getAttribute("aria-selected")).toBe("false");
    expect(summaryTab.getAttribute("tabindex")).toBe("-1");

    fireKeyDown(evidenceTab, "ArrowRight");
    expect(document.activeElement).toBe(rawTab);
    expect(rawTab.getAttribute("aria-selected")).toBe("true");

    // End keeps the last tab selected and focused.
    fireKeyDown(rawTab, "End");
    expect(document.activeElement).toBe(rawTab);
    expect(rawTab.getAttribute("aria-selected")).toBe("true");

    // Home returns to the first tab.
    fireKeyDown(rawTab, "Home");
    expect(document.activeElement).toBe(summaryTab);
    expect(summaryTab.getAttribute("aria-selected")).toBe("true");

    // ArrowLeft wraps from the first tab to the last.
    fireKeyDown(summaryTab, "ArrowLeft");
    expect(document.activeElement).toBe(rawTab);
    expect(rawTab.getAttribute("aria-selected")).toBe("true");
  });
});
