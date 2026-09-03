import { describe, expect, test } from "bun:test";

import {
  DEFAULT_STATISTICS_DAYS,
  STATISTICS_TIMEFRAME_DAYS,
  canCommitStatisticsRequest,
  parseDaysToken,
  parseValidatorStatistics,
  reconcileDaysSelector,
  statisticsDaysSelector,
  statisticsSelectOptions,
  statisticsTimeframeOptions,
} from "./validatorStatistics";

function validStatistics(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "federation_tester_statistics.v1",
    extraIgnored: true,
    window: { days: 14, from: 1, to: 2, selector: "14" },
    totals: { sessions: 10, uniqueHosts: 4, healthyPct: 50 },
    platforms: [{ platform: "nextcloud", count: 3, pct: 30 }],
    areas: [{ area: "tls", pass: 2, warn: 1, fail: 0 }],
    daily: [{ ts: 1, sessions: 2, healthyPct: 50 }],
    ...overrides,
  };
}

describe("statisticsDaysSelector", () => {
  test("defaults empty input to 14 and stringifies custom tokens", () => {
    expect(DEFAULT_STATISTICS_DAYS).toBe(14);
    expect(statisticsDaysSelector()).toBe("14");
    expect(statisticsDaysSelector("")).toBe("14");
    expect(statisticsDaysSelector(7)).toBe("7");
    expect(statisticsDaysSelector("30")).toBe("30");
    expect(statisticsDaysSelector(0)).toBe("0");
  });
});

describe("days token helpers", () => {
  test("parseDaysToken accepts finite numbers and numeric strings", () => {
    expect(parseDaysToken(14)).toBe(14);
    expect(parseDaysToken(0)).toBe(0);
    expect(parseDaysToken("7")).toBe(7);
    expect(parseDaysToken(" 30 ")).toBe(30);
    expect(parseDaysToken("")).toBeNull();
    expect(parseDaysToken("14days")).toBeNull();
    expect(parseDaysToken(Number.NaN)).toBeNull();
    expect(parseDaysToken(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseDaysToken(null)).toBeNull();
  });

  test("timeframe options use the manifest list or the built-in fallback", () => {
    expect(statisticsTimeframeOptions([7, 21])).toEqual([7, 21]);
    expect(statisticsTimeframeOptions([])).toEqual([...STATISTICS_TIMEFRAME_DAYS]);
    expect(statisticsTimeframeOptions(undefined)).toEqual([...STATISTICS_TIMEFRAME_DAYS]);
  });

  test("reconcileDaysSelector keeps advertised tokens and falls back otherwise", () => {
    expect(reconcileDaysSelector(30, [7, 14, 30], 14)).toBe(30);
    expect(reconcileDaysSelector("7", [7, 14, 30], 14)).toBe(7);
    expect(reconcileDaysSelector("21", [7, 14, 30], 14)).toBe(14);
    expect(reconcileDaysSelector("bad", [7, 30], 14)).toBe(7);
    expect(reconcileDaysSelector(undefined, [], 14)).toBe(14);
  });

  test("select options keep a temporary token until it is reconciled", () => {
    expect(statisticsSelectOptions([7, 14], 14)).toEqual([7, 14]);
    expect(statisticsSelectOptions([7, 14], 21)).toEqual([7, 14, 21]);
    expect(statisticsSelectOptions(undefined, 14)).toEqual([...STATISTICS_TIMEFRAME_DAYS]);
  });

  test("canCommitStatisticsRequest ignores stale, aborted, or unmounted replies", () => {
    expect(canCommitStatisticsRequest(2, 2, false)).toBe(true);
    expect(canCommitStatisticsRequest(1, 2, false)).toBe(false);
    expect(canCommitStatisticsRequest(2, 2, true)).toBe(false);
    expect(canCommitStatisticsRequest(2, 2, false, false)).toBe(false);
  });
});

describe("parseValidatorStatistics", () => {
  test("accepts a complete payload and ignores extra keys", () => {
    expect(parseValidatorStatistics(validStatistics())).toEqual({
      schema: "federation_tester_statistics.v1",
      window: { days: 14, from: 1, to: 2, selector: "14" },
      totals: { sessions: 10, uniqueHosts: 4, healthyPct: 50 },
      platforms: [{ platform: "nextcloud", count: 3, pct: 30 }],
      areas: [{ area: "tls", pass: 2, warn: 1, fail: 0 }],
      daily: [{ ts: 1, sessions: 2, healthyPct: 50 }],
    });
  });

  test("keeps optional dailyOmitted when boolean and ignores other types", () => {
    expect(parseValidatorStatistics(validStatistics({ dailyOmitted: true }))?.dailyOmitted).toBe(true);
    expect(parseValidatorStatistics(validStatistics({ dailyOmitted: false }))?.dailyOmitted).toBe(false);
    const ignored = parseValidatorStatistics(validStatistics({ dailyOmitted: "yes" }));
    expect(ignored).not.toBeNull();
    expect(ignored?.dailyOmitted).toBeUndefined();
  });

  test("accepts empty collections and a zero-day all-time window", () => {
    expect(parseValidatorStatistics(validStatistics({
      window: { days: 0, from: 0, to: 0, selector: "0" },
      platforms: [],
      areas: [],
      daily: [],
    }))).toEqual({
      schema: "federation_tester_statistics.v1",
      window: { days: 0, from: 0, to: 0, selector: "0" },
      totals: { sessions: 10, uniqueHosts: 4, healthyPct: 50 },
      platforms: [],
      areas: [],
      daily: [],
    });
  });

  test("rejects invalid and boundary-bad inputs", () => {
    expect(parseValidatorStatistics(null)).toBeNull();
    expect(parseValidatorStatistics([])).toBeNull();
    expect(parseValidatorStatistics("stats")).toBeNull();
    expect(parseValidatorStatistics(validStatistics({ schema: 1 }))).toBeNull();
    expect(parseValidatorStatistics(validStatistics({
      window: { days: Number.NaN, from: 1, to: 2, selector: "14" },
    }))).toBeNull();
    expect(parseValidatorStatistics(validStatistics({
      totals: { sessions: 10, uniqueHosts: 4 },
    }))).toBeNull();
    expect(parseValidatorStatistics(validStatistics({
      areas: [{ area: "tls", pass: 1, warn: 0 }],
    }))).toBeNull();
    expect(parseValidatorStatistics(validStatistics({
      daily: [{ ts: 1, sessions: "2", healthyPct: 50 }],
    }))).toBeNull();
    const missingWindow = validStatistics();
    delete missingWindow.window;
    expect(parseValidatorStatistics(missingWindow)).toBeNull();
  });
});
