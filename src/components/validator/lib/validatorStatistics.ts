/**
 * Typed federation_tester_statistics.v1 payload. Extra keys are ignored.
 */

import { isRecord } from "./validatorShared";

export const DEFAULT_STATISTICS_DAYS = 14;

export const STATISTICS_TIMEFRAME_DAYS = [7, 14, 30, 60, 90, 365, 0] as const;

export interface ValidatorStatisticsWindow {
  days: number;
  from: number;
  to: number;
  selector: string;
}

export interface ValidatorStatisticsTotals {
  sessions: number;
  uniqueHosts: number;
  healthyPct: number;
}

export interface ValidatorStatisticsPlatform {
  platform: string;
  count: number;
  pct: number;
}

export interface ValidatorStatisticsArea {
  area: string;
  pass: number;
  warn: number;
  fail: number;
}

export interface ValidatorStatisticsDaily {
  ts: number;
  sessions: number;
  healthyPct: number;
}

export interface ValidatorStatistics {
  schema: string;
  window: ValidatorStatisticsWindow;
  totals: ValidatorStatisticsTotals;
  platforms: ValidatorStatisticsPlatform[];
  areas: ValidatorStatisticsArea[];
  daily: ValidatorStatisticsDaily[];
  dailyOmitted?: boolean;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readWindow(value: unknown): ValidatorStatisticsWindow | null {
  if (!isRecord(value)) {
    return null;
  }
  const days = readFiniteNumber(value.days);
  const from = readFiniteNumber(value.from);
  const to = readFiniteNumber(value.to);
  const selector = readString(value.selector);
  return days === null || from === null || to === null || selector === null
    ? null
    : { days, from, to, selector };
}

function readTotals(value: unknown): ValidatorStatisticsTotals | null {
  if (!isRecord(value)) {
    return null;
  }
  const sessions = readFiniteNumber(value.sessions);
  const uniqueHosts = readFiniteNumber(value.uniqueHosts);
  const healthyPct = readFiniteNumber(value.healthyPct);
  return sessions === null || uniqueHosts === null || healthyPct === null
    ? null
    : { sessions, uniqueHosts, healthyPct };
}

function readPlatforms(value: unknown): ValidatorStatisticsPlatform[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const platforms: ValidatorStatisticsPlatform[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }
    const platform = readString(item.platform);
    const count = readFiniteNumber(item.count);
    const pct = readFiniteNumber(item.pct);
    if (platform === null || count === null || pct === null) {
      return null;
    }
    platforms.push({ platform, count, pct });
  }
  return platforms;
}

function readAreas(value: unknown): ValidatorStatisticsArea[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const areas: ValidatorStatisticsArea[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }
    const area = readString(item.area);
    const pass = readFiniteNumber(item.pass);
    const warn = readFiniteNumber(item.warn);
    const fail = readFiniteNumber(item.fail);
    if (area === null || pass === null || warn === null || fail === null) {
      return null;
    }
    areas.push({ area, pass, warn, fail });
  }
  return areas;
}

function readDaily(value: unknown): ValidatorStatisticsDaily[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const daily: ValidatorStatisticsDaily[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }
    const ts = readFiniteNumber(item.ts);
    const sessions = readFiniteNumber(item.sessions);
    const healthyPct = readFiniteNumber(item.healthyPct);
    if (ts === null || sessions === null || healthyPct === null) {
      return null;
    }
    daily.push({ ts, sessions, healthyPct });
  }
  return daily;
}

/** Map a days selector to the statistics query value. Empty uses 14. */
export function statisticsDaysSelector(daysSelector?: string | number): string {
  if (daysSelector === undefined || daysSelector === "") {
    return String(DEFAULT_STATISTICS_DAYS);
  }
  return String(daysSelector);
}

/** Parse a finite numeric days token from a selector value. */
export function parseDaysToken(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Manifest timeframes, or the built-in window list when none are advertised. */
export function statisticsTimeframeOptions(
  timeframesDays: readonly number[] | undefined,
): number[] {
  if (timeframesDays !== undefined && timeframesDays.length > 0) {
    return [...timeframesDays];
  }
  return [...STATISTICS_TIMEFRAME_DAYS];
}

/**
 * Keep the controlled selector in the advertised list. Unknown server tokens
 * fall back to defaultDays, then the first advertised window.
 */
export function reconcileDaysSelector(
  candidate: unknown,
  options: readonly number[],
  fallback: number = DEFAULT_STATISTICS_DAYS,
): number {
  const parsed = parseDaysToken(candidate);
  if (parsed !== null && options.includes(parsed)) {
    return parsed;
  }
  if (options.includes(fallback)) {
    return fallback;
  }
  return options[0] ?? fallback;
}

/** Options for the window select, plus the current token when it is temporary. */
export function statisticsSelectOptions(
  timeframesDays: readonly number[] | undefined,
  selector: number,
): number[] {
  const base = statisticsTimeframeOptions(timeframesDays);
  return base.includes(selector) ? base : [...base, selector];
}

/** Ignore stale, aborted, or unmounted statistics responses. */
export function canCommitStatisticsRequest(
  requestId: number,
  latestRequestId: number,
  aborted: boolean,
  mounted = true,
): boolean {
  return mounted && !aborted && requestId === latestRequestId;
}

/** Narrow an /api/statistics JSON body. Returns null when required fields fail. */
export function parseValidatorStatistics(body: unknown): ValidatorStatistics | null {
  if (!isRecord(body)) {
    return null;
  }
  const schema = readString(body.schema);
  const window = readWindow(body.window);
  const totals = readTotals(body.totals);
  const platforms = readPlatforms(body.platforms);
  const areas = readAreas(body.areas);
  const daily = readDaily(body.daily);
  if (
    schema === null ||
    window === null ||
    totals === null ||
    platforms === null ||
    areas === null ||
    daily === null
  ) {
    return null;
  }
  const parsed: ValidatorStatistics = { schema, window, totals, platforms, areas, daily };
  if (typeof body.dailyOmitted === "boolean") {
    parsed.dailyOmitted = body.dailyOmitted;
  }
  return parsed;
}
