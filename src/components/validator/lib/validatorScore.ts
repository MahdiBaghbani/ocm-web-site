/**
 * Defensive specification-score parser, fold, and result projection.
 * Mirrors validatorcore overallSpecificationGrade; no React imports.
 */

import { isRecord } from "./validatorShared";
import { isTerminalState, type TerminalState } from "./stateMachine";

export type SpecificationGrade = "pass" | "warn" | "fail";
export interface SpecificationAreaScore {
  area: string;
  grade: SpecificationGrade | null;
  testRunCount: number;
  distinctTestCount: number;
  requiredTestCount: number;
  optionalTestCount: number;
  passedTestCount: number;
  failedTestCount: number;
  passWithWarningCount: number;
  evidenceCount: number;
  requiredEvidenceCount: number;
  optionalEvidenceCount: number;
}
export interface SpecificationScore {
  grade: SpecificationGrade | null;
  state: string;
  terminal: boolean;
  assessedAreas: number;
  totalAreas: number;
  areas: SpecificationAreaScore[];
}
export type ParsedSpecificationScore =
  | { status: "complete"; score: SpecificationScore }
  | { status: "partial"; score: SpecificationScore; invalidAreaRows: number[] }
  | { status: "unusable" };
export const CANONICAL_AREA_IDS = [
  "discovery",
  "tls",
  "jwks",
  "httpsig",
  "sharing",
  "notification",
  "token",
  "capability",
] as const;
export type CanonicalAreaId = (typeof CANONICAL_AREA_IDS)[number];
export const CANONICAL_AREA_LABELS = {
  discovery: "Server discovery",
  tls: "Secure connection",
  jwks: "Signing keys",
  httpsig: "Request signing",
  sharing: "Share exchange",
  notification: "Notifications",
  token: "Access tokens",
  capability: "Capabilities",
} as const satisfies Record<CanonicalAreaId, string>;
export const CANONICAL_AREA_TOTAL = CANONICAL_AREA_IDS.length;
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
  description?: string;
  pillLabel?: string;
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
}

const CANONICAL_AREA_SET: ReadonlySet<string> = new Set(CANONICAL_AREA_IDS);
const TEST_COUNT_KEYS = [
  "testRunCount",
  "distinctTestCount",
  "requiredTestCount",
  "optionalTestCount",
  "passedTestCount",
  "failedTestCount",
  "passWithWarningCount",
] as const;
const EVIDENCE_COUNT_KEYS = [
  "evidenceCount",
  "requiredEvidenceCount",
  "optionalEvidenceCount",
] as const;

export function isCanonicalAreaId(value: string): value is CanonicalAreaId {
  return CANONICAL_AREA_SET.has(value);
}
export function isUsableSpecificationScore(
  parsed: ParsedSpecificationScore,
): parsed is Exclude<ParsedSpecificationScore, { status: "unusable" }> {
  return parsed.status !== "unusable";
}

/** Nested path from the plan: report.raw.score.specification. */
export function specificationFromReport(report: unknown): unknown {
  if (!isRecord(report)) {
    return undefined;
  }
  if (isRecord(report.raw) && isRecord(report.raw.score)) {
    return report.raw.score.specification;
  }
  if (isRecord(report.score) && Object.hasOwn(report.score, "specification")) {
    return report.score.specification;
  }
  return undefined;
}
function parseCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  return value >= 0 ? value : null;
}
function parseGradeField(
  row: Record<string, unknown>,
): { ok: true; grade: SpecificationGrade | null } | { ok: false } {
  if (!Object.hasOwn(row, "grade")) {
    return { ok: false };
  }
  const value = row.grade;
  if (value === null) {
    return { ok: true, grade: null };
  }
  if (value === "pass" || value === "warn" || value === "fail") {
    return { ok: true, grade: value };
  }
  return { ok: false };
}
function parseCoreCountField(
  row: Record<string, unknown>,
  key: string,
): { count: number; partial: boolean } | null {
  // Live Go rows omit the newer test-count keys. Keep a zero for projection,
  // but mark partial so a complete score is not invented.
  if (!Object.hasOwn(row, key) || row[key] === undefined) {
    return { count: 0, partial: true };
  }
  const count = parseCount(row[key]);
  return count === null ? null : { count, partial: false };
}
function parseEvidenceCountField(
  row: Record<string, unknown>,
  key: string,
): { count: number; partial: boolean } {
  if (!Object.hasOwn(row, key) || row[key] === undefined || row[key] === null) {
    return { count: 0, partial: false };
  }
  const count = parseCount(row[key]);
  return count === null ? { count: 0, partial: true } : { count, partial: false };
}
function parseAreaRow(
  value: unknown,
):
  | { kind: "ok"; area: SpecificationAreaScore }
  | { kind: "partial"; area: SpecificationAreaScore }
  | { kind: "invalid" } {
  if (!isRecord(value) || typeof value.area !== "string") {
    return { kind: "invalid" };
  }
  const gradeField = parseGradeField(value);
  if (!gradeField.ok) {
    return { kind: "invalid" };
  }
  const testCounts: number[] = [];
  let countsPartial = false;
  for (const key of TEST_COUNT_KEYS) {
    const countField = parseCoreCountField(value, key);
    if (countField === null) {
      return { kind: "invalid" };
    }
    testCounts.push(countField.count);
    if (countField.partial) {
      countsPartial = true;
    }
  }
  let evidencePartial = false;
  const evidenceCounts: number[] = [];
  for (const key of EVIDENCE_COUNT_KEYS) {
    const evidence = parseEvidenceCountField(value, key);
    evidenceCounts.push(evidence.count);
    if (evidence.partial) {
      evidencePartial = true;
    }
  }
  const area: SpecificationAreaScore = {
    area: value.area,
    grade: gradeField.grade,
    testRunCount: testCounts[0] ?? 0,
    distinctTestCount: testCounts[1] ?? 0,
    requiredTestCount: testCounts[2] ?? 0,
    optionalTestCount: testCounts[3] ?? 0,
    passedTestCount: testCounts[4] ?? 0,
    failedTestCount: testCounts[5] ?? 0,
    passWithWarningCount: testCounts[6] ?? 0,
    evidenceCount: evidenceCounts[0] ?? 0,
    requiredEvidenceCount: evidenceCounts[1] ?? 0,
    optionalEvidenceCount: evidenceCounts[2] ?? 0,
  };
  return evidencePartial || countsPartial ? { kind: "partial", area } : { kind: "ok", area };
}

export function parseSpecificationScore(input: unknown): ParsedSpecificationScore {
  if (!isRecord(input)) {
    return { status: "unusable" };
  }
  const gradeField = parseGradeField(input);
  if (!gradeField.ok) {
    return { status: "unusable" };
  }
  if (typeof input.state !== "string" || typeof input.terminal !== "boolean") {
    return { status: "unusable" };
  }
  const assessedAreas = parseCount(input.assessedAreas);
  const totalAreas = parseCount(input.totalAreas);
  if (assessedAreas === null || totalAreas === null || !Array.isArray(input.areas)) {
    return { status: "unusable" };
  }
  const areas: SpecificationAreaScore[] = [];
  const invalidAreaRows: number[] = [];
  for (const [index, raw] of input.areas.entries()) {
    const parsed = parseAreaRow(raw);
    if (parsed.kind === "invalid") {
      invalidAreaRows.push(index);
      continue;
    }
    if (parsed.kind === "partial") {
      invalidAreaRows.push(index);
    }
    areas.push(parsed.area);
  }
  const score: SpecificationScore = {
    grade: gradeField.grade,
    state: input.state,
    terminal: input.terminal,
    assessedAreas,
    totalAreas,
    areas,
  };
  if (invalidAreaRows.length > 0) {
    return { status: "partial", score, invalidAreaRows };
  }
  return { status: "complete", score };
}

export function foldOverallSpecificationGrade(
  areas: SpecificationAreaScore[],
  state: string,
): SpecificationGrade | null {
  if (state === "terminal_fail") return "fail";
  if (state !== "terminal_pass") return null;
  let assessed = false;
  let warning = false;
  for (const area of areas) {
    if (area.grade === "fail") return "fail";
    if (area.grade === "warn") {
      assessed = true;
      warning = true;
    } else if (area.grade === "pass") {
      assessed = true;
    }
  }
  if (!assessed) return null;
  return warning ? "warn" : "pass";
}

function lastCanonicalAreaRows<T extends Pick<SpecificationAreaScore, "area" | "grade">>(
  areas: readonly T[],
): Map<CanonicalAreaId, T> {
  const byId = new Map<CanonicalAreaId, T>();
  for (const row of areas) {
    if (isCanonicalAreaId(row.area)) {
      byId.set(row.area, row);
    }
  }
  return byId;
}

export function recountCanonicalAreaGrades(
  areas: readonly Pick<SpecificationAreaScore, "area" | "grade">[],
): { assessed: number; total: number } {
  const byId = lastCanonicalAreaRows(areas);
  let assessed = 0;
  for (const id of CANONICAL_AREA_IDS) {
    const row = byId.get(id);
    if (row !== undefined && row.grade !== null) {
      assessed += 1;
    }
  }
  return { assessed, total: CANONICAL_AREA_TOTAL };
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
    };
    if (description !== undefined) {
      entry.description = description;
    }
    if (pillLabel !== undefined) {
      entry.pillLabel = pillLabel;
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
    }),
  };
  if (showFailModeLabel && input.failModeLabel !== undefined) {
    projection.failModeLabel = input.failModeLabel;
  }
  return projection;
}
