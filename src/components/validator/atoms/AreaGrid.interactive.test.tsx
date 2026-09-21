import React, { act } from "react";
import { describe, expect, test } from "bun:test";

import {
  installDomShim,
  reactDomContainerOf,
  ShimEvent,
} from "@/components/validator/tests/helpers/domShim";
import AreaGrid, { VALIDATOR_AREA_IDS, type ValidatorAreaId } from "./AreaGrid";
import {
  actionButtonIds,
  actionButtonLabelledby,
  areaResultCardHtml,
  countAttr,
  findNode,
  render,
} from "./test-helpers";

describe("AreaGrid interactive", () => {
  test("results interactive trigger appears only when openable", () => {
    const html = render(
      <AreaGrid
        variant="results"
        onAreaClick={() => undefined}
        areas={[
          { area: "discovery", grade: "pass", evidenceCount: 2 },
          { area: "tls", grade: null, evidenceCount: 0 },
        ]}
      />,
    );
    const discovery = areaResultCardHtml(html, "discovery");
    const tls = areaResultCardHtml(html, "tls");
    expect(discovery).toContain(">Server discovery</h3>");
    expect(discovery).toContain("View details");
    expect(discovery).toContain('id="area-card-discovery-action"');
    expect(discovery).toContain('aria-haspopup="dialog"');
    expect(discovery).toContain('id="area-card-discovery-title"');
    expect(tls).toContain(">Secure connection</h3>");
    expect(tls).not.toContain("View details");
    expect(tls).not.toContain("area-card-tls-action");
    expect(countAttr(html, ">View details</")).toBe(1);
    expect(actionButtonIds(html)).toEqual(["area-card-discovery-action"]);
    expect(actionButtonLabelledby(html, "discovery")).toBe(
      "area-card-discovery-title area-card-discovery-action",
    );
    expect(html).not.toContain("This area checks");
    expect(html).not.toContain("areas assessed");
    expect(html).not.toContain("pass rate");
    expect(html).not.toContain("text-lg font-semibold text-zinc-100");
  });

  test("loaded-evidence-only card stays interactive without a grade or reported evidence", () => {
    // foldGrade(entry) is null here: no explicit grade and no pass/warn/fail
    // counts. evidenceCount is undefined (countOf -> 0), so the only clause that
    // can make the card interactive is loadedEvidenceCount > 0. This proves the
    // loadedEvidence clause: if it were removed from the interactive predicate,
    // the trigger button would not render and this assertion would fail.
    const html = render(
      <AreaGrid
        variant="results"
        onAreaClick={() => undefined}
        areas={[{ area: "discovery", loadedEvidenceCount: 2 }]}
      />,
    );
    const card = areaResultCardHtml(html, "discovery");
    expect(card).toContain('id="area-card-discovery-action"');
    expect(actionButtonIds(html)).toEqual(["area-card-discovery-action"]);
  });

  test("card with no grade and no reported or loaded evidence renders no trigger", () => {
    const html = render(
      <AreaGrid
        variant="results"
        onAreaClick={() => undefined}
        areas={[{ area: "discovery" }]}
      />,
    );
    const card = areaResultCardHtml(html, "discovery");
    expect(card).not.toContain("area-card-discovery-action");
    expect(actionButtonIds(html)).toEqual([]);
  });

  test("warn and fail result triggers read Why and evidence, pass reads View details", () => {
    const html = render(
      <AreaGrid
        variant="results"
        onAreaClick={() => undefined}
        areas={[
          { area: "discovery", grade: "pass", evidenceCount: 1 },
          { area: "tls", grade: "warn", evidenceCount: 1 },
          { area: "jwks", grade: "fail", evidenceCount: 1 },
        ]}
      />,
    );
    const discovery = areaResultCardHtml(html, "discovery");
    const tls = areaResultCardHtml(html, "tls");
    const jwks = areaResultCardHtml(html, "jwks");
    expect(discovery).toContain(">View details</button>");
    expect(tls).toContain(">Why and evidence</button>");
    expect(jwks).toContain(">Why and evidence</button>");
  });

  test("card trigger reflects openArea through aria-expanded", () => {
    const html = render(
      <AreaGrid
        variant="results"
        onAreaClick={() => undefined}
        openArea="tls"
        areas={[
          { area: "discovery", grade: "pass", evidenceCount: 1 },
          { area: "tls", grade: "warn", evidenceCount: 1 },
        ]}
      />,
    );
    const discovery = areaResultCardHtml(html, "discovery");
    const tls = areaResultCardHtml(html, "tls");
    expect(discovery).toContain('aria-expanded="false"');
    expect(tls).toContain('aria-expanded="true"');
  });

  test("results triggers have unique ids and resolve accessible names via labelledby", () => {
    const html = render(
      <AreaGrid
        variant="results"
        onAreaClick={() => undefined}
        areas={VALIDATOR_AREA_IDS.map((area) => ({
          area,
          grade: "pass" as const,
          evidenceCount: 1,
        }))}
      />,
    );
    const ids = actionButtonIds(html);
    expect(ids).toEqual(VALIDATOR_AREA_IDS.map((area) => `area-card-${area}-action`));
    expect(new Set(ids).size).toBe(8);
    for (const area of VALIDATOR_AREA_IDS) {
      expect(actionButtonLabelledby(html, area)).toBe(
        `area-card-${area}-title area-card-${area}-action`,
      );
      expect(html).toContain(`id="area-card-${area}-title"`);
    }
    expect(countAttr(html, ">View details</")).toBe(8);
    expect(html).not.toContain("This area checks");
    expect(html).not.toContain("<h3 class=\"text-sm font-semibold text-zinc-100\"><button");
  });

  test("results View details click reports the area ID", async () => {
    const seen: ValidatorAreaId[] = [];
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(
          <AreaGrid
            variant="results"
            onAreaClick={(areaId) => { seen.push(areaId); }}
            areas={[{ area: "discovery", grade: "pass", evidenceCount: 2 }]}
          />,
        );
      });
      const card = findNode(container, (node) => node.getAttribute("data-area-card") === "discovery");
      expect(card).not.toBeNull();
      if (card === null) throw new Error("missing data-area-card: discovery");
      const button = findNode(card, (node) => {
        return node.tagName === "BUTTON" &&
          node.getAttribute("id") === "area-card-discovery-action";
      });
      expect(button).not.toBeNull();
      if (button === null) throw new Error("missing discovery View details button");
      await act(() => { button.dispatchEvent(new ShimEvent("click")); });
      expect(seen).toEqual(["discovery"]);
      await act(() => { root.unmount(); });
    } finally {
      restore();
    }
  });

  test("results trigger opens for an unassessed card with evidence", async () => {
    const seen: ValidatorAreaId[] = [];
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(
          <AreaGrid
            variant="results"
            onAreaClick={(areaId) => { seen.push(areaId); }}
            areas={[{ area: "discovery", grade: null, evidenceCount: 1 }]}
          />,
        );
      });
      const card = findNode(container, (node) => node.getAttribute("data-area-card") === "discovery");
      expect(card).not.toBeNull();
      if (card === null) throw new Error("missing data-area-card: discovery");
      const button = findNode(card, (node) => {
        return node.tagName === "BUTTON" &&
          node.getAttribute("id") === "area-card-discovery-action";
      });
      expect(button).not.toBeNull();
      if (button === null) throw new Error("missing discovery View details button");
      await act(() => { button.dispatchEvent(new ShimEvent("click")); });
      expect(seen).toEqual(["discovery"]);
      await act(() => { root.unmount(); });
    } finally {
      restore();
    }
  });

  test("statistics cards stay noninteractive when onAreaClick is set", () => {
    const html = render(
      <AreaGrid
        areas={[{ area: "discovery", grade: "pass", evidenceCount: 3 }]}
        onAreaClick={() => undefined}
      />,
    );
    expect(html).not.toContain("View details");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("data-area-card");
    expect(html).toContain(`1/${VALIDATOR_AREA_IDS.length} areas assessed`);
  });
});
