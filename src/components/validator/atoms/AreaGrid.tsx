/**
 * Canonical compatibility areas as zinc tiles with grade pills and pass rates.
 */
import React from "react";
import SummaryCard from "../../observatory/ui/SummaryCard";
import Pill, { type GradeKind, type PillKind } from "./Pill";

export const VALIDATOR_AREA_IDS = [
  "discovery",
  "tls",
  "jwks",
  "httpsig",
  "sharing",
  "notification",
  "token",
  "capability",
] as const;

export type ValidatorAreaId = (typeof VALIDATOR_AREA_IDS)[number];

export const VALIDATOR_AREA_LABELS = {
  discovery: "Discovery",
  tls: "TLS",
  jwks: "JWKS",
  httpsig: "HTTPSig",
  sharing: "Sharing",
  notification: "Notification",
  token: "Token",
  capability: "Capability",
} as const satisfies Record<ValidatorAreaId, string>;

const AREA_ID_SET: ReadonlySet<string> = new Set(VALIDATOR_AREA_IDS);

export interface AreaGridEntry {
  area: string;
  label?: string;
  grade?: GradeKind | null;
  pass?: number;
  warn?: number;
  fail?: number;
  /** Fraction in [0, 1]. Wins over pass/warn/fail counts when set. */
  passRate?: number | null;
  evidenceCount?: number;
}

export interface AreaGridProps {
  areas?: readonly AreaGridEntry[];
}

function countOf(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clampPassRate(rate: number): number {
  if (rate < 0) return 0;
  if (rate > 1) return 1;
  return rate;
}

function passRateOf(entry: AreaGridEntry): number | null {
  if (typeof entry.passRate === "number" && Number.isFinite(entry.passRate)) {
    return clampPassRate(entry.passRate);
  }
  const hasCounts =
    typeof entry.pass === "number" ||
    typeof entry.warn === "number" ||
    typeof entry.fail === "number";
  if (!hasCounts) {
    return null;
  }
  const denom = countOf(entry.pass) + countOf(entry.warn) + countOf(entry.fail);
  if (denom <= 0) {
    return null;
  }
  return clampPassRate(countOf(entry.pass) / denom);
}

function evidenceCountLabel(count: number): string {
  return count === 1 ? "1 evidence item" : `${count} evidence items`;
}

function foldGrade(entry: AreaGridEntry): GradeKind | null {
  if (entry.grade === "pass" || entry.grade === "fail" || entry.grade === "warn") {
    return entry.grade;
  }
  const fail = countOf(entry.fail);
  const warn = countOf(entry.warn);
  const pass = countOf(entry.pass);
  if (fail > 0) return "fail";
  if (warn > 0) return "warn";
  if (pass > 0) return "pass";
  return null;
}

function pillKindFor(grade: GradeKind | null): PillKind {
  return grade === null ? "unassessed" : grade;
}

function isValidatorAreaId(value: string): value is ValidatorAreaId {
  return AREA_ID_SET.has(value);
}

type ResolvedAreaEntry = AreaGridEntry & { area: ValidatorAreaId };

function areaLabel(entry: ResolvedAreaEntry): string {
  if (entry.label !== undefined && entry.label !== "") {
    return entry.label;
  }
  return VALIDATOR_AREA_LABELS[entry.area];
}

function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function indexAreas(
  areas: readonly AreaGridEntry[] | undefined,
): Map<ValidatorAreaId, AreaGridEntry> {
  const map = new Map<ValidatorAreaId, AreaGridEntry>();
  if (areas === undefined) {
    return map;
  }
  for (const entry of areas) {
    if (isValidatorAreaId(entry.area)) {
      map.set(entry.area, entry);
    }
  }
  return map;
}

function resolveEntries(
  areas: readonly AreaGridEntry[] | undefined,
): ResolvedAreaEntry[] {
  const byId = indexAreas(areas);
  return VALIDATOR_AREA_IDS.map((area) => {
    const overlay = byId.get(area);
    return overlay !== undefined ? { ...overlay, area } : { area };
  });
}

function evidenceCaption(count: number | undefined): string {
  if (typeof count !== "number" || !Number.isFinite(count)) {
    return "pass rate";
  }
  return evidenceCountLabel(count);
}

export default function AreaGrid({ areas }: AreaGridProps): React.ReactElement {
  const entries = resolveEntries(areas);
  let assessed = 0;
  for (const entry of entries) {
    if (foldGrade(entry) !== null || passRateOf(entry) !== null) {
      assessed += 1;
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-4 md:grid-cols-2">
        {entries.map((entry) => {
          const grade = foldGrade(entry);
          const rate = passRateOf(entry);
          const rateLabel = rate === null ? "-" : formatRate(rate);
          return (
            <SummaryCard
              key={entry.area}
              title={areaLabel(entry)}
              badge={<Pill kind={pillKindFor(grade)} />}
              padding="sm"
            >
              <div className="text-lg font-semibold text-zinc-100">{rateLabel}</div>
              <div className="mt-1 text-xs text-zinc-400">
                {evidenceCaption(entry.evidenceCount)}
              </div>
            </SummaryCard>
          );
        })}
      </div>
      <p className="text-xs text-zinc-500">
        {assessed}/{entries.length} areas assessed
      </p>
    </div>
  );
}
