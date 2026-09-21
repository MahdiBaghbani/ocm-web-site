import React, { act } from "react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import StatisticsShell from "./StatisticsShell";
import {
  DEFAULT_STATISTICS_DAYS,
  STATISTICS_TIMEFRAME_DAYS,
  parseDaysToken,
} from "../lib/validatorStatistics";
import {
  installDomShim,
  reactDomContainerOf,
  ShimNode,
} from "../test-helpers/domShim";
import { emptyStatistics, mockIslandFetch } from "../test-helpers/statisticsFetch";
import { waitForText } from "../test-helpers/wait";

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

function selectedValue(html: string): string | null {
  const onSelect = /<select[^>]* value="([^"]*)"/.exec(html);
  if (onSelect !== null) {
    return onSelect[1];
  }
  const selectedOption =
    /<option[^>]* selected[^>]* value="([^"]*)"/.exec(html) ??
    /<option[^>]* value="([^"]*)"[^>]* selected/.exec(html);
  return selectedOption === null ? null : selectedOption[1];
}

function optionValues(html: string): string[] {
  return [...html.matchAll(/<option[^>]* value="([^"]*)"/g)].map((match) => match[1]);
}

describe("StatisticsShell selector", () => {
  test("SSR uses a numeric days token and the fallback timeframe list", () => {
    const html = render(<StatisticsShell />);
    expect(typeof DEFAULT_STATISTICS_DAYS).toBe("number");
    expect(selectedValue(html)).toBe(String(DEFAULT_STATISTICS_DAYS));
    expect(optionValues(html)).toEqual(STATISTICS_TIMEFRAME_DAYS.map(String));
    expect(html).toContain('id="validator-stats-days"');
    expect(html).toContain("Loading statistics...");
    expect(html).not.toContain("Why are these zero?");
    expect(html).not.toContain("enough unique hosts");
    expect(html).not.toContain("No platform counts.");
  });

  test("SSR honors a numeric initialDays token", () => {
    const html = render(<StatisticsShell initialDays={7} />);
    expect(selectedValue(html)).toBe("7");
    expect(parseDaysToken(selectedValue(html))).toBe(7);
  });

  test("SSR parses a string initialDays token", () => {
    const html = render(<StatisticsShell initialDays="30" />);
    expect(selectedValue(html)).toBe("30");
  });
});

const TEXT_NODE = 3;
const DOCUMENT_NODE = 9;

function walk(node: ShimNode, visit: (current: ShimNode) => void): void {
  visit(node);
  for (const child of node.childNodes) {
    walk(child, visit);
  }
}

function findById(root: ShimNode, id: string): ShimNode {
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (node.id === id || node.getAttribute("id") === id) {
      found = node;
    }
  });
  if (found === null) {
    throw new Error(`missing #${id}`);
  }
  return found;
}

function findByTag(root: ShimNode, tagName: string): ShimNode {
  const upper = tagName.toUpperCase();
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (node.tagName === upper && found === null) {
      found = node;
    }
  });
  if (found === null) {
    throw new Error(`missing <${tagName}>`);
  }
  return found;
}

function htmlOf(node: ShimNode): string {
  if (node.nodeType === TEXT_NODE) {
    return node.nodeValue;
  }
  if (node.nodeType === DOCUMENT_NODE) {
    return node.childNodes.map(htmlOf).join("");
  }
  const tag = node.tagName.toLowerCase();
  const attrs = [...node.attrs.entries()]
    .map(([name, value]) => ` ${name}="${value}"`)
    .join("");
  return `<${tag}${attrs}>${node.childNodes.map(htmlOf).join("")}</${tag}>`;
}

const TILE_VALUE_CLASS = "text-lg font-semibold text-zinc-100";

function tileValue(root: ShimNode, title: string): string {
  let found = "";
  walk(root, (node) => {
    if (node.tagName !== "H3" || node.textContent !== title) {
      return;
    }
    const card = node.parentNode?.parentNode;
    if (card === undefined || card === null) {
      return;
    }
    walk(card, (current) => {
      if (current.getAttribute("class") === TILE_VALUE_CLASS) {
        found = current.textContent;
      }
    });
  });
  return found;
}

describe("StatisticsShell island panels", () => {
  test("empty branch renders explanation, dash tiles, and empty platform copy", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = mockIslandFetch(200, emptyStatistics());
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<StatisticsShell />);
      });
      await waitForText(container, "Public totals stay at zero until");
      findById(container, "validator-stats-days");
      findByTag(container, "select");
      const html = htmlOf(container);
      expect(html).toContain("Public totals stay at zero until");
      expect(html).toContain("Opted-in runs may be recorded even before they appear here.");
      expect(tileValue(container, "Sessions")).toBe("-");
      expect(tileValue(container, "Unique hosts")).toBe("-");
      expect(tileValue(container, "Healthy")).toBe("-");
      expect(html).toContain("Platform counts appear after at least 5 unique hosts");
      await act(() => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });

  test("error branch renders statistics unavailable without loading or empty copy", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = mockIslandFetch(503, {
      error: "stats_failed",
      message: "statistics unavailable now",
    });
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<StatisticsShell />);
      });
      await waitForText(container, "statistics unavailable:");
      findById(container, "validator-stats-days");
      findByTag(container, "select");
      const html = htmlOf(container);
      expect(html).toContain("statistics unavailable:");
      expect(html).not.toContain("Loading statistics...");
      expect(html).not.toContain("Public totals stay at zero until");
      await act(() => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });
});
