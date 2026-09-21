// Statistics-specific fetch fixtures for StatisticsShell panel tests.
// Built on fetchStub (requestUrl / jsonResponse); does not install a DOM.

import { jsonResponse, requestUrl } from "./fetchStub";

export const CONFIG_BODY = {
  poll_interval_ms: 1,
  active_poll_interval_ms: 1,
  backoff_initial_ms: 1,
  backoff_max_ms: 1,
  request_timeout_ms: 5000,
};

export const AREA_IDS = [
  "discovery",
  "tls",
  "jwks",
  "httpsig",
  "sharing",
  "notification",
  "token",
  "capability",
] as const;

export function parseableManifest(): Record<string, unknown> {
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

export function zeroAreas(): Array<{ area: string; pass: number; warn: number; fail: number }> {
  return AREA_IDS.map((area) => ({ area, pass: 0, warn: 0, fail: 0 }));
}

export function emptyStatistics(): Record<string, unknown> {
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

export function readyStatistics(): Record<string, unknown> {
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

export function mockIslandFetch(statisticsStatus: number, statisticsBody: unknown): typeof fetch {
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
