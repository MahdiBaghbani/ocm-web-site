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

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

async function waitForText(container: ShimNode, needle: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!container.textContent.includes(needle)) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${JSON.stringify(needle)} in: ${container.textContent}`);
    }
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
      });
    });
  }
}

const CONFIG_BODY = {
  poll_interval_ms: 1,
  active_poll_interval_ms: 1,
  backoff_initial_ms: 1,
  backoff_max_ms: 1,
  request_timeout_ms: 5000,
};

const AREA_IDS = [
  "discovery",
  "tls",
  "jwks",
  "httpsig",
  "sharing",
  "notification",
  "token",
  "capability",
] as const;

function parseableManifest(): Record<string, unknown> {
  return {
    schema: "federation_tester_manifest.v1",
    apiVersion: "v1",
    servicePrefix: "/validator",
    optIn: {
      default: "off",
      start: {
        optInStats: { type: "boolean", default: false },
        optInPermanent: { type: "boolean", default: false },
      },
      scan: { statsQuery: "stats", permanentQuery: "permanent", optInValue: "1" },
    },
    retention: {
      tiers: ["ephemeral", "permanent"],
      defaultTier: "ephemeral",
      clock: "utc",
      patchPath: "/retention",
      lockPath: "/lock",
    },
    report: { htmlPath: "/report/{id}", apiPath: "/api/report/{id}" },
    statistics: {
      schema: "federation_tester_statistics.v1",
      timeframesDays: [7, 14, 30, 60, 90, 365, 0],
      defaultDays: 14,
      kAnonymityUniqueHosts: 5,
      unknownPlatformExempt: true,
    },
    routes: [{ method: "GET", fullPath: "/api/manifest" }],
    reverseInvite: { available: true },
    platform: { available: true },
    tlsSummary: { available: true },
    sessionKind: { supported: ["passive"], scanDefault: "passive" },
    nextInstruction: { created: "wait_probe" },
  };
}

function zeroAreas(): Array<{ area: string; pass: number; warn: number; fail: number }> {
  return AREA_IDS.map((area) => ({ area, pass: 0, warn: 0, fail: 0 }));
}

function emptyStatistics(): Record<string, unknown> {
  return {
    schema: "federation_tester_statistics.v1",
    window: { days: 14, from: 0, to: 0, selector: "14" },
    totals: { sessions: 0, uniqueHosts: 0, healthyPct: 0 },
    platforms: [],
    areas: zeroAreas(),
    daily: [],
    dailyOmitted: true,
  };
}

function readyStatistics(): Record<string, unknown> {
  const areas = zeroAreas();
  areas[0] = { area: "discovery", pass: 8, warn: 1, fail: 1 };
  return {
    schema: "federation_tester_statistics.v1",
    window: { days: 14, from: 1, to: 2, selector: "14" },
    totals: { sessions: 10, uniqueHosts: 6, healthyPct: 80 },
    platforms: [
      { platform: "nextcloud", count: 5, pct: 50 },
      { platform: "opencloud", count: 5, pct: 50 },
    ],
    areas,
    daily: [{ ts: 1, sessions: 1, healthyPct: 100 }],
  };
}

function mockIslandFetch(statisticsStatus: number, statisticsBody: unknown): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("config.json")) {
      return jsonResponse(200, CONFIG_BODY);
    }
    if (url.includes("/api/manifest")) {
      return jsonResponse(200, parseableManifest());
    }
    if (url.includes("/api/statistics")) {
      return jsonResponse(statisticsStatus, statisticsBody);
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
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
  test("empty branch renders explanation, dash tiles, and no grade distribution", async () => {
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
      expect(html).not.toContain("Area-grade totals");
      expect(html).toContain("0/8 areas assessed");
      await act(() => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });

  test("ready branch renders numeric tiles, platforms, and area-grade totals", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = mockIslandFetch(200, readyStatistics());
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<StatisticsShell />);
      });
      await waitForText(container, "80%");
      findById(container, "validator-stats-days");
      findByTag(container, "select");
      const html = htmlOf(container);
      expect(tileValue(container, "Sessions")).toBe("10");
      expect(tileValue(container, "Unique hosts")).toBe("6");
      expect(tileValue(container, "Healthy")).toBe("80%");
      expect(html).toContain("nextcloud");
      expect(html).toContain("opencloud");
      expect(html).toContain("Area-grade totals");
      expect(html).toContain("Server discovery");
      expect(html).toContain("1/8 areas assessed");
      expect(html).not.toContain("Public totals stay at zero until");
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
