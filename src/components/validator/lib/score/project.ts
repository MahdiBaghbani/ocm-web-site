/**
 * Terminal/grade authority and score-to-projection mapping for the results
 * view. Pure, no React imports.
 */

import { isTerminalState, type TerminalState } from "../stateMachine";
import type { ReasonSeverity } from "../validatorReasons";
import { CANONICAL_AREA_IDS, CANONICAL_AREA_LABELS, type CanonicalAreaId } from "./areas";
import {
  foldOverallSpecificationGrade,
  isUsableSpecificationScore,
  lastCanonicalAreaRows,
  parseSpecificationScore,
  recountCanonicalAreaGrades,
  type ParsedSpecificationScore,
  type SpecificationAreaScore,
  type SpecificationGrade,
} from "./parse";

export const RESULT_HEADLINE = {
  compatible: "Compatible",
  compatibleWithWarnings: "Compatible with warnings",
  compatibilityFailed: "Compatibility failed",
  scanInterrupted: "Scan interrupted",
  noCompatibilityResult: "No compatibility result",
  resultUnavailable: "Result unavailable",
} as const;

export const AREA_RESULT_PILL = {
  notTested: "Not tested",
  notReported: "Not reported",
} as const;

export type ValidatorScoreOutcomeKind =
  | "compatible"
  | "compatible_with_warnings"
  | "compatibility_failed"
  | "scan_interrupted"
  | "inconclusive"
  | "result_unavailable";

export interface SpecificationAreaGridEntry {
  area: CanonicalAreaId;
  label: string;
  grade: SpecificationGrade | null;
  evidenceCount: number;
  // Count of evidence rows actually loaded for this area, independent of the
  // reported evidenceCount. Lets a card stay interactive when loaded evidence
  // exists even if the score reported zero.
  loadedEvidenceCount?: number;
  description?: string;
  pillLabel?: string;
  // Primary reason slug for the area, derived from its evidence. Optional so
  // existing callers that do not compute it stay backward-compatible.
  reasonCode?: string;
  // Outcome fields of the primary reason evidence item, mirroring the row
  // AreaModal selects. Optional so callers that only supply a reason code stay
  // backward-compatible and fall back to the aggregate grade.
  primaryGrade?: ReasonSeverity | null;
  primarySeverity?: string;
  primaryAffectsGrade?: boolean;
}

export interface ValidatorScoreProjection {
  outcome: ValidatorScoreOutcomeKind;
  headline: string;
  coverageLabel: string;
  assessed: number;
  total: number;
  grade: SpecificationGrade | null;
  terminalState: TerminalState | null;
  parsed: ParsedSpecificationScore;
  showFailModeLabel: boolean;
  failModeLabel?: string;
  areas: SpecificationAreaGridEntry[];
}

export interface ProjectValidatorScoreInput {
  pollState?: string | null;
  specification?: unknown;
  reportOk: boolean;
  failModeLabel?: string;
  descriptions?: Partial<Record<CanonicalAreaId, string>>;
  pillLabels?: Partial<Record<CanonicalAreaId, string>>;
  reasonCodes?: Partial<Record<CanonicalAreaId, string>>;
  primaryReasons?: Partial<
    Record<
      CanonicalAreaId,
      { grade?: ReasonSeverity | null; severity?: string; affectsGrade?: boolean }
    >
  >;
  loadedEvidenceByArea?: Partial<Record<CanonicalAreaId, number>>;
}

export function resolveTerminalState(
  pollState: string | null | undefined,
  scoreState: string | undefined,
): TerminalState | null {
  if (typeof pollState === "string" && pollState !== "") {
    return isTerminalState(pollState) ? pollState : null;
  }
  if (typeof scoreState === "string" && isTerminalState(scoreState)) {
    return scoreState;
  }
  return null;
}

export function resolveSpecificationGrade(input: {
  reportOk: boolean;
  parsed: ParsedSpecificationScore;
  terminalState: TerminalState | null;
}): SpecificationGrade | null {
  if (input.terminalState === "terminal_fail") {
    return "fail";
  }
  if (input.terminalState !== "terminal_pass" || !isUsableSpecificationScore(input.parsed)) {
    return null;
  }
  if (input.reportOk && input.parsed.score.grade !== null) {
    return input.parsed.score.grade;
  }
  return foldOverallSpecificationGrade(input.parsed.score.areas, input.terminalState);
}

export function isInconclusiveSpecification(input: {
  terminalState: TerminalState | null;
  parsed: ParsedSpecificationScore;
  grade: SpecificationGrade | null;
}): boolean {
  if (input.terminalState !== "terminal_pass") {
    return false;
  }
  if (!isUsableSpecificationScore(input.parsed) || input.grade !== null) {
    return false;
  }
  return recountCanonicalAreaGrades(input.parsed.score.areas).assessed === 0;
}

function coverageLabelOf(assessed: number, total: number): string {
  return `${assessed} of ${total}`;
}

function headlineFor(outcome: ValidatorScoreOutcomeKind): string {
  switch (outcome) {
    case "compatible":
      return RESULT_HEADLINE.compatible;
    case "compatible_with_warnings":
      return RESULT_HEADLINE.compatibleWithWarnings;
    case "compatibility_failed":
      return RESULT_HEADLINE.compatibilityFailed;
    case "scan_interrupted":
      return RESULT_HEADLINE.scanInterrupted;
    case "inconclusive":
      return RESULT_HEADLINE.noCompatibilityResult;
    case "result_unavailable":
      return RESULT_HEADLINE.resultUnavailable;
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

function outcomeFor(input: {
  terminalState: TerminalState | null;
  parsed: ParsedSpecificationScore;
  grade: SpecificationGrade | null;
}): ValidatorScoreOutcomeKind {
  if (input.terminalState === "interrupted") {
    return "scan_interrupted";
  }
  if (input.terminalState === "terminal_fail") {
    return "compatibility_failed";
  }
  if (isInconclusiveSpecification(input)) {
    return "inconclusive";
  }
  if (input.grade === "pass") {
    return "compatible";
  }
  if (input.grade === "warn") {
    return "compatible_with_warnings";
  }
  if (input.grade === "fail") {
    return "compatibility_failed";
  }
  return "result_unavailable";
}

export function areaGridEntriesFromScore(
  parsed: ParsedSpecificationScore,
  options: {
    descriptions?: Partial<Record<CanonicalAreaId, string>>;
    pillLabels?: Partial<Record<CanonicalAreaId, string>>;
    reasonCodes?: Partial<Record<CanonicalAreaId, string>>;
    primaryReasons?: Partial<
      Record<
        CanonicalAreaId,
        { grade?: ReasonSeverity | null; severity?: string; affectsGrade?: boolean }
      >
    >;
    loadedEvidenceByArea?: Partial<Record<CanonicalAreaId, number>>;
  } = {},
): SpecificationAreaGridEntry[] {
  const byId: Map<CanonicalAreaId, SpecificationAreaScore> = isUsableSpecificationScore(parsed)
    ? lastCanonicalAreaRows(parsed.score.areas)
    : new Map();
  return CANONICAL_AREA_IDS.map((id) => {
    const row = byId.get(id);
    const grade = row === undefined ? null : row.grade;
    const reported = row !== undefined;
    const customPill = options.pillLabels?.[id];
    const description = options.descriptions?.[id];
    const reasonCode = options.reasonCodes?.[id];
    const pillLabel =
      customPill !== undefined
        ? customPill
        : reported
          ? grade === null
            ? AREA_RESULT_PILL.notTested
            : undefined
          : AREA_RESULT_PILL.notReported;
    const entry: SpecificationAreaGridEntry = {
      area: id,
      label: CANONICAL_AREA_LABELS[id],
      grade,
      evidenceCount: row?.evidenceCount ?? 0,
      loadedEvidenceCount: options.loadedEvidenceByArea?.[id] ?? 0,
    };
    if (description !== undefined) {
      entry.description = description;
    }
    if (pillLabel !== undefined) {
      entry.pillLabel = pillLabel;
    }
    if (reasonCode !== undefined && reasonCode !== "") {
      entry.reasonCode = reasonCode;
    }
    const primaryReason = options.primaryReasons?.[id];
    if (primaryReason !== undefined) {
      if (primaryReason.grade !== undefined) {
        entry.primaryGrade = primaryReason.grade;
      }
      if (primaryReason.severity !== undefined) {
        entry.primarySeverity = primaryReason.severity;
      }
      if (primaryReason.affectsGrade !== undefined) {
        entry.primaryAffectsGrade = primaryReason.affectsGrade;
      }
    }
    return entry;
  });
}

export function projectValidatorScore(
  input: ProjectValidatorScoreInput,
): ValidatorScoreProjection {
  const parsed = parseSpecificationScore(input.specification);
  const scoreState = isUsableSpecificationScore(parsed) ? parsed.score.state : undefined;
  const terminalState = resolveTerminalState(input.pollState, scoreState);
  const grade = resolveSpecificationGrade({
    reportOk: input.reportOk,
    parsed,
    terminalState,
  });
  const areas = isUsableSpecificationScore(parsed) ? parsed.score.areas : [];
  const coverage = recountCanonicalAreaGrades(areas);
  const outcome = outcomeFor({ terminalState, parsed, grade });
  const showFailModeLabel =
    outcome === "compatibility_failed" || outcome === "scan_interrupted";
  const projection: ValidatorScoreProjection = {
    outcome,
    headline: headlineFor(outcome),
    coverageLabel: coverageLabelOf(coverage.assessed, coverage.total),
    assessed: coverage.assessed,
    total: coverage.total,
    grade,
    terminalState,
    parsed,
    showFailModeLabel,
    areas: areaGridEntriesFromScore(parsed, {
      descriptions: input.descriptions,
      pillLabels: input.pillLabels,
      reasonCodes: input.reasonCodes,
      primaryReasons: input.primaryReasons,
      loadedEvidenceByArea: input.loadedEvidenceByArea,
    }),
  };
  if (showFailModeLabel && input.failModeLabel !== undefined) {
    projection.failModeLabel = input.failModeLabel;
  }
  return projection;
}
