/**
 * Pass/warn/fail bars from area totals or an explicit totals object.
 */
import React from "react";
import { VALIDATOR_AREA_IDS } from "../atoms/AreaGrid";
import Pill from "../atoms/Pill";
import type { ValidatorStatisticsArea } from "../lib/validatorStatistics";

const CANONICAL_AREA_IDS: ReadonlySet<string> = new Set(VALIDATOR_AREA_IDS);

type GradeArea = Pick<ValidatorStatisticsArea, "area" | "pass" | "warn" | "fail">;

export interface GradeTotals {
  pass: number;
  warn: number;
  fail: number;
}

export interface GradeDistributionProps {
  areas?: readonly GradeArea[];
  totals?: GradeTotals;
}

function countOf(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function canonicalAreas(areas: readonly GradeArea[]): GradeArea[] {
  return areas.filter((item) => CANONICAL_AREA_IDS.has(item.area));
}

function sumAreas(areas: readonly GradeArea[]): GradeTotals {
  let pass = 0;
  let warn = 0;
  let fail = 0;
  for (const area of areas) {
    pass += countOf(area.pass);
    warn += countOf(area.warn);
    fail += countOf(area.fail);
  }
  return { pass, warn, fail };
}

function resolveTotals(props: GradeDistributionProps): GradeTotals {
  if (props.areas !== undefined) {
    return sumAreas(canonicalAreas(props.areas));
  }
  if (props.totals !== undefined) {
    return {
      pass: countOf(props.totals.pass),
      warn: countOf(props.totals.warn),
      fail: countOf(props.totals.fail),
    };
  }
  return { pass: 0, warn: 0, fail: 0 };
}

function widthStyle(count: number, total: number): { width: string } | undefined {
  if (total <= 0 || count <= 0) {
    return undefined;
  }
  return { width: `${(count / total) * 100}%` };
}

export default function GradeDistribution(props: GradeDistributionProps): React.ReactElement {
  const totals = resolveTotals(props);
  const total = totals.pass + totals.warn + totals.fail;
  const segments = [
    { key: "pass", count: totals.pass, bar: "bg-emerald-700", kind: "pass" as const },
    { key: "warn", count: totals.warn, bar: "bg-amber-700", kind: "warn" as const },
    { key: "fail", count: totals.fail, bar: "bg-rose-700", kind: "fail" as const },
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-zinc-400">Area-grade totals</p>
      <div
        className="flex h-3 overflow-hidden rounded-full bg-zinc-800"
        role="img"
        aria-label={`area-grade totals: pass ${totals.pass}, warn ${totals.warn}, fail ${totals.fail}`}
      >
        {segments.map((segment) => {
          const style = widthStyle(segment.count, total);
          if (style === undefined) {
            return null;
          }
          return <div key={segment.key} className={segment.bar} style={style} />;
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {segments.map((segment) => (
          <Pill key={segment.key} kind={segment.kind} label={`${segment.key} ${segment.count}`} />
        ))}
      </div>
    </div>
  );
}
