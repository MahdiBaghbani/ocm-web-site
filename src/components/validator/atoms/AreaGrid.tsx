/**
 * Canonical compatibility areas as zinc tiles.
 * Statistics keep pass-rate SummaryCards; results uses a separate article card.
 */
import React from "react";
import SummaryCard from "../../observatory/ui/SummaryCard";
import {
  CANONICAL_AREA_IDS,
  CANONICAL_AREA_LABELS,
  type CanonicalAreaId,
} from "../lib/validatorScore";
import { reasonCopyFor, type ReasonSeverity } from "../lib/validatorReasons";
import Pill, { type GradeKind, type PillKind } from "./Pill";

export const VALIDATOR_AREA_IDS = CANONICAL_AREA_IDS;
export type ValidatorAreaId = CanonicalAreaId;
export const VALIDATOR_AREA_LABELS = CANONICAL_AREA_LABELS;

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
  /** Loaded evidence rows for this area; keeps a card interactive at zero grade. */
  loadedEvidenceCount?: number;
  description?: string;
  pillLabel?: string;
  /** Primary reason slug for the area; drives warn/fail card reason copy. */
  reasonCode?: string;
  /** Outcome fields of the primary reason evidence item, matching AreaModal. */
  primaryGrade?: ReasonSeverity | null;
  primarySeverity?: string;
  primaryAffectsGrade?: boolean;
}

export interface AreaGridProps {
  areas?: readonly AreaGridEntry[];
  variant?: "statistics" | "results";
  onAreaClick?: (areaId: ValidatorAreaId) => void;
  // Currently open area, results variant only. Drives aria-expanded on each
  // card trigger so the open card reflects its dialog state.
  openArea?: CanonicalAreaId | null;
  // Registers the live trigger button for an area so the parent can restore
  // focus by area id after the detail modal closes. Called with null when the
  // trigger unmounts so the map never holds a stale node.
  registerTriggerRef?: (area: CanonicalAreaId, el: HTMLButtonElement | null) => void;
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

function areaPill(entry: ResolvedAreaEntry): React.ReactElement {
  const grade = foldGrade(entry);
  if (entry.pillLabel !== undefined) {
    return <Pill kind={pillKindFor(grade)} label={entry.pillLabel} />;
  }
  return <Pill kind={pillKindFor(grade)} />;
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

function renderStatisticsGrid(entries: ResolvedAreaEntry[]): React.ReactElement {
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
          const rate = passRateOf(entry);
          const rateLabel = rate === null ? "-" : formatRate(rate);
          return (
            <SummaryCard
              key={entry.area}
              title={areaLabel(entry)}
              badge={areaPill(entry)}
              padding="sm"
            >
              {entry.description !== undefined && entry.description !== "" ? (
                <p className="mb-2 text-sm text-zinc-300">{entry.description}</p>
              ) : null}
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

function renderResultsGrid(
  entries: ResolvedAreaEntry[],
  onAreaClick: ((areaId: ValidatorAreaId) => void) | undefined,
  openArea: CanonicalAreaId | null | undefined,
  registerTriggerRef:
    | ((area: CanonicalAreaId, el: HTMLButtonElement | null) => void)
    | undefined,
): React.ReactElement {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {entries.map((entry) => {
        const evidenceCount = countOf(entry.evidenceCount);
        const loadedEvidence = countOf(entry.loadedEvidenceCount);
        const label = areaLabel(entry);
        const selectArea = onAreaClick;
        const grade = foldGrade(entry);
        const isWarnOrFail = grade === "warn" || grade === "fail";
        // Warn and fail cards surface the primary resolved reason, but only
        // when the entry carries a real reason code. Trim first so a
        // whitespace-only code is treated as absent; without a code the card
        // shows an honest missing-reason caption instead of the slug fallback.
        const trimmedReasonCode =
          entry.reasonCode !== undefined ? entry.reasonCode.trim() : undefined;
        const hasReasonCode =
          trimmedReasonCode !== undefined && trimmedReasonCode !== "";
        // Use the primary evidence outcome exactly when any primary field is
        // present; otherwise fall back to the aggregate grade for backward
        // compatibility. The warn/fail guard stays keyed on foldGrade.
        const hasPrimary =
          entry.primaryGrade !== undefined ||
          entry.primarySeverity !== undefined ||
          entry.primaryAffectsGrade !== undefined;
        const reason =
          isWarnOrFail && hasReasonCode
            ? reasonCopyFor(
                hasPrimary
                  ? {
                      reasonCode: trimmedReasonCode,
                      grade: entry.primaryGrade ?? null,
                      severity: entry.primarySeverity,
                      affectsGrade: entry.primaryAffectsGrade ?? true,
                    }
                  : {
                      reasonCode: trimmedReasonCode,
                      grade,
                      affectsGrade: true,
                    },
              )
            : null;
        const titleId = `area-card-${entry.area}-title`;
        const actionId = `area-card-${entry.area}-action`;
        const interactive =
          selectArea !== undefined &&
          (grade !== null || evidenceCount > 0 || loadedEvidence > 0);
        return (
          <article
            key={entry.area}
            data-area-card={entry.area}
            className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/30 p-3"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 id={titleId} className="text-sm font-semibold text-zinc-100">{label}</h3>
              {areaPill(entry)}
            </div>
            {entry.description !== undefined && entry.description !== "" ? (
              <p className="mb-2 text-sm font-medium text-zinc-200">{entry.description}</p>
            ) : null}
            {reason !== null ? (
              <div className="mb-2 space-y-1" data-area-reason={entry.area}>
                <p className="text-sm font-semibold text-zinc-100">{reason.title}</p>
                <p className="text-xs text-zinc-400">{reason.why}</p>
                {reason.remedy !== undefined && reason.remedy !== "" ? (
                  <p className="text-xs text-zinc-400">{reason.remedy}</p>
                ) : null}
              </div>
            ) : isWarnOrFail ? (
              <p className="text-xs text-zinc-400" data-area-reason={entry.area}>
                Reason not provided in this report.
              </p>
            ) : null}
            <div className="mt-1 text-xs text-zinc-400">
              {evidenceCountLabel(evidenceCount)}
            </div>
            {interactive ? (
              <button
                type="button"
                id={actionId}
                ref={(el) => {
                  registerTriggerRef?.(entry.area, el);
                }}
                className="mt-3 w-full min-h-11 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
                aria-haspopup="dialog"
                aria-expanded={openArea === entry.area}
                aria-labelledby={`${titleId} ${actionId}`}
                onClick={() => selectArea(entry.area)}
              >
                {isWarnOrFail ? "Why and evidence" : "View details"}
              </button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

export default function AreaGrid({
  areas,
  variant = "statistics",
  onAreaClick,
  openArea,
  registerTriggerRef,
}: AreaGridProps): React.ReactElement {
  const entries = resolveEntries(areas);
  if (variant === "results") {
    return renderResultsGrid(entries, onAreaClick, openArea, registerTriggerRef);
  }
  return renderStatisticsGrid(entries);
}
