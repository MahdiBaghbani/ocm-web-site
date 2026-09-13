/**
 * Shared score-test fixtures for validator score hubs. Pure helpers only;
 * do not add fetch or DOM stubs here.
 */

import { CANONICAL_AREA_IDS, type CanonicalAreaId } from "./areas";
import type { SpecificationAreaScore, SpecificationGrade } from "./parse";

export const ZERO_TEST_COUNTS = {
  testRunCount: 0,
  distinctTestCount: 0,
  requiredTestCount: 0,
  optionalTestCount: 0,
  passedTestCount: 0,
  failedTestCount: 0,
  passWithWarningCount: 0,
} as const;

export function areaRow(
  area: string,
  grade: SpecificationGrade | null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { area, grade, evidenceCount: 0, ...extra };
}

export function completeAreaRow(
  area: string,
  grade: SpecificationGrade | null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return areaRow(area, grade, { ...ZERO_TEST_COUNTS, ...extra });
}

export function allAreas(
  gradeFor: (id: CanonicalAreaId, index: number) => SpecificationGrade | null,
  extra: Record<string, unknown> = {},
): Record<string, unknown>[] {
  return CANONICAL_AREA_IDS.map((id, index) => areaRow(id, gradeFor(id, index), extra));
}

export function specification(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const areas = allAreas(() => "pass");
  return {
    grade: "pass",
    state: "terminal_pass",
    terminal: true,
    assessedAreas: 8,
    totalAreas: 8,
    extraIgnoredRoot: true,
    areas,
    ...overrides,
  };
}

export function emptyArea(overrides: Partial<SpecificationAreaScore> = {}): SpecificationAreaScore {
  return {
    area: "discovery",
    grade: null,
    testRunCount: 0,
    distinctTestCount: 0,
    requiredTestCount: 0,
    optionalTestCount: 0,
    passedTestCount: 0,
    failedTestCount: 0,
    passWithWarningCount: 0,
    evidenceCount: 0,
    requiredEvidenceCount: 0,
    optionalEvidenceCount: 0,
    ...overrides,
  };
}
