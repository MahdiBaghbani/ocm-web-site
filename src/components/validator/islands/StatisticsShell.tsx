/**
 * STATISTICS island. Loads config and manifest, then fetches a window.
 */
import React, { useEffect, useRef, useState } from "react";
import FieldRow from "../../observatory/stack/cards/FieldRow";
import SummaryCard from "../../observatory/ui/SummaryCard";
import {
  fetchConfigSource,
  loadValidatorConfig,
  type ValidatorRuntimeConfig,
} from "../lib/validatorConfig";
import {
  fetchManifest,
  fetchStatistics,
  type ValidatorFetchDeps,
  type ValidatorManifest,
  type ValidatorStatistics,
} from "../lib/validatorFetch";
import {
  DEFAULT_STATISTICS_DAYS,
  canCommitStatisticsRequest,
  parseDaysToken,
  reconcileDaysSelector,
  statisticsSelectOptions,
  statisticsTimeframeOptions,
} from "../lib/validatorStatistics";
import AreaPassRateGrid from "./AreaPassRateGrid";
import GradeDistribution from "./GradeDistribution";

export interface StatisticsShellProps {
  initialDays?: string | number;
}

function requestDeps(
  config: ValidatorRuntimeConfig,
  signal?: AbortSignal,
): ValidatorFetchDeps {
  return {
    origin: config.validatorApiOrigin,
    timeoutMs: config.requestTimeoutMs,
    backoffInitialMs: config.backoffInitialMs,
    backoffMaxMs: config.backoffMaxMs,
    signal,
  };
}

function initialSelector(initialDays?: string | number): number {
  if (initialDays === undefined) {
    return DEFAULT_STATISTICS_DAYS;
  }
  return parseDaysToken(initialDays) ?? DEFAULT_STATISTICS_DAYS;
}

function tile(title: string, value: string): React.ReactElement {
  return (
    <SummaryCard title={title} padding="sm">
      <div className="text-lg font-semibold text-zinc-100">{value}</div>
    </SummaryCard>
  );
}

export default function StatisticsShell({
  initialDays,
}: StatisticsShellProps): React.ReactElement {
  const [config, setConfig] = useState<ValidatorRuntimeConfig | null>(null);
  const [manifest, setManifest] = useState<ValidatorManifest | null>(null);
  const [stats, setStats] = useState<ValidatorStatistics | null>(null);
  const [selector, setSelector] = useState(() => initialSelector(initialDays));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const latestRequestRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const options = statisticsSelectOptions(
    manifest?.statistics.timeframesDays,
    selector,
  );

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const loaded = await loadValidatorConfig(fetchConfigSource(fetch.bind(globalThis)));
      if (controller.signal.aborted) {
        return;
      }
      const mf = await fetchManifest(requestDeps(loaded, controller.signal));
      if (controller.signal.aborted) {
        return;
      }
      const loadedManifest = mf.ok ? mf.data : null;
      const timeframes = loadedManifest?.statistics.timeframesDays;
      const fallback = loadedManifest?.statistics.defaultDays ?? DEFAULT_STATISTICS_DAYS;
      const days = reconcileDaysSelector(
        initialDays === undefined ? fallback : initialDays,
        statisticsTimeframeOptions(timeframes),
        fallback,
      );
      setConfig(loaded);
      setManifest(loadedManifest);
      setSelector(days);
    })();
    return () => controller.abort();
  }, [initialDays]);

  useEffect(() => {
    if (config === null) {
      return;
    }
    const controller = new AbortController();
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    setLoading(true);
    setStats(null);
    setError("");
    void (async () => {
      const result = await fetchStatistics(selector, requestDeps(config, controller.signal));
      if (
        !canCommitStatisticsRequest(
          requestId,
          latestRequestRef.current,
          controller.signal.aborted,
          mountedRef.current,
        )
      ) {
        return;
      }
      setLoading(false);
      if (result.ok) {
        setStats(result.data);
        setError("");
        const timeframes = manifest?.statistics.timeframesDays;
        const fallback = manifest?.statistics.defaultDays ?? DEFAULT_STATISTICS_DAYS;
        setSelector(reconcileDaysSelector(
          result.data.window.selector,
          statisticsTimeframeOptions(timeframes),
          fallback,
        ));
        return;
      }
      if (result.kind !== "aborted") {
        setError(result.message);
      }
    })();
    return () => controller.abort();
  }, [config, selector, manifest]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="space-y-1" htmlFor="validator-stats-days">
          <div className="text-xs font-semibold text-zinc-400">Window</div>
          <select
            id="validator-stats-days"
            className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-200"
            value={selector}
            disabled={config === null}
            onChange={(event) => {
              const next = parseDaysToken(event.target.value);
              if (next !== null && next !== selector) {
                setSelector(next);
                setStats(null);
                setError("");
                setLoading(true);
              }
            }}
          >
            {options.map((days) => (
              <option key={days} value={days}>
                {days === 0 ? "all time" : `${days} days`}
              </option>
            ))}
          </select>
        </label>
        {manifest !== null ? (
          <p className="text-xs text-zinc-500">
            default {manifest.statistics.defaultDays} days
          </p>
        ) : null}
      </div>
      {error !== "" ? (
        <p className="text-sm text-zinc-500">statistics unavailable: {error}</p>
      ) : null}
      {loading && stats === null ? (
        <p className="text-sm text-zinc-400">Loading statistics...</p>
      ) : null}
      {stats !== null ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            {tile("Sessions", String(stats.totals.sessions))}
            {tile("Unique hosts", String(stats.totals.uniqueHosts))}
            {tile("Healthy", `${stats.totals.healthyPct}%`)}
          </div>
          <SummaryCard title="Platforms" padding="sm">
            <div className="space-y-2">
              {stats.platforms.length === 0 ? (
                <p className="text-sm text-zinc-400">No platform counts.</p>
              ) : (
                stats.platforms.map((item) => (
                  <FieldRow
                    key={item.platform}
                    label={item.platform}
                    fullValue={`${item.count} (${item.pct}%)`}
                    displayValue={`${item.count} (${item.pct}%)`}
                  />
                ))
              )}
            </div>
          </SummaryCard>
          <SummaryCard title="Grade distribution" padding="sm">
            <GradeDistribution areas={stats.areas} />
          </SummaryCard>
          <SummaryCard title="Area pass rates" padding="sm">
            <AreaPassRateGrid areas={stats.areas} />
          </SummaryCard>
        </div>
      ) : null}
    </div>
  );
}
