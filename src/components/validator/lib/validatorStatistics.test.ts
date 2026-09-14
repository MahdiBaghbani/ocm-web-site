import { describe, expect, test } from "bun:test";

import {
  DEFAULT_K_ANONYMITY_UNIQUE_HOSTS,
  DEFAULT_STATISTICS_DAYS,
  STATISTICS_TIMEFRAME_DAYS,
  canCommitStatisticsRequest,
  isStatisticsSuppressedOrEmpty,
  parseDaysToken,
  parseValidatorStatistics,
  reconcileDaysSelector,
  resolveKAnonymityUniqueHosts,
  statisticsDaysSelector,
  statisticsLongPanel,
  statisticsMediumEmpty,
  statisticsOptInHint,
  statisticsPanelKind,
  statisticsPlatformsEmpty,
  statisticsSelectOptions,
  statisticsShortFootnote,
  statisticsTimeframeOptions,
  type ValidatorStatistics,
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

function statisticsFixture(overrides: Partial<ValidatorStatistics> = {}): ValidatorStatistics {
  return {
    schema: "federation_tester_statistics.v1",
    window: { days: 14, from: 1, to: 2, selector: "14" },
    totals: { sessions: 10, uniqueHosts: 4, healthyPct: 50 },
    platforms: [{ platform: "nextcloud", count: 3, pct: 30 }],
    areas: [{ area: "tls", pass: 2, warn: 1, fail: 0 }],
    daily: [{ ts: 1, sessions: 2, healthyPct: 50 }],
    ...overrides,
  };
}

function emptyStatistics(overrides: Partial<ValidatorStatistics> = {}): ValidatorStatistics {
  return statisticsFixture({
    totals: { sessions: 0, uniqueHosts: 0, healthyPct: 0 },
    platforms: [],
    ...overrides,
  });
}

const LIVE_EIGHT_ZERO_AREAS: ValidatorStatistics["areas"] = [
  { area: "discovery", pass: 0, warn: 0, fail: 0 },
  { area: "tls", pass: 0, warn: 0, fail: 0 },
  { area: "jwks", pass: 0, warn: 0, fail: 0 },
  { area: "httpsig", pass: 0, warn: 0, fail: 0 },
  { area: "sharing", pass: 0, warn: 0, fail: 0 },
  { area: "notification", pass: 0, warn: 0, fail: 0 },
  { area: "token", pass: 0, warn: 0, fail: 0 },
  { area: "capability", pass: 0, warn: 0, fail: 0 },
];

const LIVE_K_ANONYMITY_UNIQUE_HOSTS = 5;
const LIVE_STORED_STATS_RAW_ROWS = 5;
const LIVE_DISTINCT_HOST_HASH = 2;

function liveSuppressedStatistics(
  extras: Partial<Pick<ValidatorStatistics, "daily" | "dailyOmitted" | "window">> = {},
): ValidatorStatistics {
  return emptyStatistics({
    areas: LIVE_EIGHT_ZERO_AREAS,
    daily: extras.daily ?? [{ ts: 1, sessions: 0, healthyPct: 0 }],
    ...extras,
  });
}

function copySamples(k: number | undefined): string[] {
  return [
    statisticsShortFootnote(k),
    statisticsMediumEmpty(k),
    statisticsLongPanel(k),
    statisticsPlatformsEmpty(k),
    statisticsOptInHint(k),
  ];
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

describe("isStatisticsSuppressedOrEmpty", () => {
  test("is true on all-zero totals and empty platforms", () => {
    expect(isStatisticsSuppressedOrEmpty(emptyStatistics())).toBe(true);
  });

  test("is false on nonzero totals", () => {
    expect(isStatisticsSuppressedOrEmpty(statisticsFixture())).toBe(false);
  });

  test("is false when uniqueHosts is 3 with zero sessions, healthyPct, and platforms", () => {
    expect(isStatisticsSuppressedOrEmpty(emptyStatistics({
      totals: { sessions: 0, uniqueHosts: 3, healthyPct: 0 },
      platforms: [],
    }))).toBe(false);
  });

  test("is true on all-zero totals when dailyOmitted is true", () => {
    expect(isStatisticsSuppressedOrEmpty(emptyStatistics({ dailyOmitted: true }))).toBe(true);
  });

  test("is true on all-zero totals with empty areas and daily", () => {
    expect(isStatisticsSuppressedOrEmpty(emptyStatistics({
      areas: [],
      daily: [],
    }))).toBe(true);
  });

  test("is true on the live eight-zero-area shape with daily zeros", () => {
    const liveDailyZeros = liveSuppressedStatistics();
    expect(liveDailyZeros.areas).toHaveLength(8);
    expect(isStatisticsSuppressedOrEmpty(liveDailyZeros)).toBe(true);
  });

  test("is true on the live eight-zero-area shape when dailyOmitted is true", () => {
    expect(isStatisticsSuppressedOrEmpty(liveSuppressedStatistics({
      daily: [],
      dailyOmitted: true,
    }))).toBe(true);
  });
});

describe("resolveKAnonymityUniqueHosts", () => {
  test("keeps a positive finite k and falls back otherwise", () => {
    expect(DEFAULT_K_ANONYMITY_UNIQUE_HOSTS).toBe(5);
    expect(resolveKAnonymityUniqueHosts(5)).toBe(5);
    expect(resolveKAnonymityUniqueHosts(7)).toBe(7);
    expect(resolveKAnonymityUniqueHosts(undefined)).toBe(5);
    expect(resolveKAnonymityUniqueHosts(0)).toBe(5);
    expect(resolveKAnonymityUniqueHosts(Number.NaN)).toBe(5);
    expect(resolveKAnonymityUniqueHosts(-1)).toBe(5);
  });
});

describe("statisticsPanelKind", () => {
  test("classifier precedence is error, then loading, then empty, then ready", () => {
    const empty = emptyStatistics();
    const ready = statisticsFixture();
    expect(statisticsPanelKind("failed", true, null)).toBe("error");
    expect(statisticsPanelKind("failed", true, empty)).toBe("error");
    expect(statisticsPanelKind("failed", false, ready)).toBe("error");
    expect(statisticsPanelKind("", true, ready)).toBe("loading");
    expect(statisticsPanelKind("", true, empty)).toBe("loading");
    expect(statisticsPanelKind("", false, empty)).toBe("empty");
    expect(statisticsPanelKind("", false, ready)).toBe("ready");
  });

  test("all-zero statistics classify as empty", () => {
    expect(statisticsPanelKind("", false, emptyStatistics())).toBe("empty");
  });

  test("nonzero statistics classify as ready", () => {
    expect(statisticsPanelKind("", false, statisticsFixture())).toBe("ready");
  });

  test("stats=null is loading when the error string is empty", () => {
    expect(statisticsPanelKind("", true, null)).toBe("loading");
    expect(statisticsPanelKind("", false, null)).toBe("loading");
  });

  test("aborted-gap stats=null with loading=false and empty error is loading", () => {
    expect(statisticsPanelKind("", false, null)).toBe("loading");
  });

  test("the live eight-zero-area shape classifies as empty, not ready", () => {
    const liveDailyZeros = liveSuppressedStatistics();
    const liveDailyOmitted = liveSuppressedStatistics({
      window: { days: 0, from: 0, to: 0, selector: "0" },
      daily: [],
      dailyOmitted: true,
    });
    expect(statisticsPanelKind("", false, liveDailyZeros)).toBe("empty");
    expect(statisticsPanelKind("", false, liveDailyZeros)).not.toBe("ready");
    expect(statisticsPanelKind("", false, liveDailyOmitted)).toBe("empty");
    expect(statisticsPanelKind("", false, liveDailyOmitted)).not.toBe("ready");
  });
});

describe("statistics copy helpers", () => {
  test("k=7 yields at least 7 unique hosts in every builder", () => {
    for (const text of copySamples(7)) {
      expect(text).toContain("at least 7 unique hosts");
    }
  });

  test("undefined k yields enough unique hosts and never 5 or at least 5", () => {
    for (const text of copySamples(undefined)) {
      expect(text).toContain("enough unique hosts");
      expect(text).not.toContain("5");
      expect(text).not.toContain("at least 5");
    }
  });

  test("malformed k uses fallback resolver and raw-k copy, not the numeric 5", () => {
    expect(resolveKAnonymityUniqueHosts(0)).toBe(DEFAULT_K_ANONYMITY_UNIQUE_HOSTS);
    expect(resolveKAnonymityUniqueHosts(Number.NaN)).toBe(DEFAULT_K_ANONYMITY_UNIQUE_HOSTS);
    expect(resolveKAnonymityUniqueHosts(-1)).toBe(DEFAULT_K_ANONYMITY_UNIQUE_HOSTS);
    for (const k of [0, Number.NaN, -1] as const) {
      for (const text of copySamples(k)) {
        expect(text).toContain("enough unique hosts");
        expect(text).not.toContain("5");
        expect(text).not.toContain("at least 5");
      }
    }
  });

  test("k-anonymity appears only in the long panel final line", () => {
    const long = statisticsLongPanel(7);
    expect(long.endsWith("This protection is sometimes called k-anonymity.")).toBe(true);
    expect(long.match(/k-anonymity/g)?.length).toBe(1);
    expect(statisticsShortFootnote(7)).not.toContain("k-anonymity");
    expect(statisticsMediumEmpty(7)).not.toContain("k-anonymity");
    expect(statisticsPlatformsEmpty(7)).not.toContain("k-anonymity");
    expect(statisticsOptInHint(7)).not.toContain("k-anonymity");
    expect(statisticsLongPanel(undefined).endsWith(
      "This protection is sometimes called k-anonymity.",
    )).toBe(true);
    expect(statisticsShortFootnote(undefined)).not.toContain("k-anonymity");
    expect(statisticsMediumEmpty(undefined)).not.toContain("k-anonymity");
    expect(statisticsPlatformsEmpty(undefined)).not.toContain("k-anonymity");
    expect(statisticsOptInHint(undefined)).not.toContain("k-anonymity");
  });
});

describe("live VPS payload shape", () => {
  test("k=5, five stored rows, and two distinct hosts stay suppressed as empty", () => {
    expect(LIVE_K_ANONYMITY_UNIQUE_HOSTS).toBe(5);
    expect(LIVE_STORED_STATS_RAW_ROWS).toBe(5);
    expect(LIVE_DISTINCT_HOST_HASH).toBe(2);
    expect(LIVE_DISTINCT_HOST_HASH < LIVE_K_ANONYMITY_UNIQUE_HOSTS).toBe(true);
    expect(resolveKAnonymityUniqueHosts(LIVE_K_ANONYMITY_UNIQUE_HOSTS)).toBe(5);

    const liveDays14 = parseValidatorStatistics({
      schema: "federation_tester_statistics.v1",
      window: { days: 14, from: 1, to: 2, selector: "14" },
      totals: { sessions: 0, uniqueHosts: 0, healthyPct: 0 },
      platforms: [],
      areas: LIVE_EIGHT_ZERO_AREAS,
      daily: [{ ts: 1, sessions: 0, healthyPct: 0 }],
    });
    const liveAllTime = parseValidatorStatistics({
      schema: "federation_tester_statistics.v1",
      window: { days: 0, from: 0, to: 0, selector: "0" },
      totals: { sessions: 0, uniqueHosts: 0, healthyPct: 0 },
      platforms: [],
      areas: LIVE_EIGHT_ZERO_AREAS,
      daily: [],
      dailyOmitted: true,
    });
    expect(liveDays14).not.toBeNull();
    expect(liveAllTime).not.toBeNull();
    if (liveDays14 === null || liveAllTime === null) {
      throw new Error("live VPS payload failed to parse");
    }
    expect(liveDays14.totals).toEqual({ sessions: 0, uniqueHosts: 0, healthyPct: 0 });
    expect(liveDays14.platforms).toEqual([]);
    expect(liveDays14.areas).toHaveLength(8);
    expect(liveDays14.areas.every((area) => (
      area.pass === 0 && area.warn === 0 && area.fail === 0
    ))).toBe(true);
    expect(isStatisticsSuppressedOrEmpty(liveDays14)).toBe(true);
    expect(isStatisticsSuppressedOrEmpty(liveAllTime)).toBe(true);
    expect(statisticsPanelKind("", false, liveDays14)).toBe("empty");
    expect(statisticsPanelKind("", false, liveAllTime)).toBe("empty");
    expect(statisticsPanelKind("", false, liveDays14)).not.toBe("ready");
    expect(statisticsPanelKind("", false, liveAllTime)).not.toBe("ready");
  });
});
