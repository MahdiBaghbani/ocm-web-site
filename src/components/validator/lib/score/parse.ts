/**
 * Score types plus defensive specification-score parsing, folding, and
 * recount helpers. Mirrors validatorcore overallSpecificationGrade; no React
 * imports.
 */

import { isRecord } from "../validatorShared";
import {
  CANONICAL_AREA_IDS,
  CANONICAL_AREA_TOTAL,
  isCanonicalAreaId,
  type CanonicalAreaId,
} from "./areas";

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

export function lastCanonicalAreaRows<T extends Pick<SpecificationAreaScore, "area" | "grade">>(
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
