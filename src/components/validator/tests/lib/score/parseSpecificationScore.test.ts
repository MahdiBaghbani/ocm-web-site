import { describe, expect, test } from "bun:test";

import {
  parseSpecificationScore,
  recountCanonicalAreaGrades,
  specificationFromReport,
} from "@/components/validator/lib/score/parse";
import {
  AREA_RESULT_PILL,
  RESULT_HEADLINE,
  areaGridEntriesFromScore,
  projectValidatorScore,
} from "@/components/validator/lib/score/project";
import { CANONICAL_AREA_IDS } from "@/components/validator/lib/score/areas";
import {
  ZERO_TEST_COUNTS,
  allAreas,
  completeAreaRow,
  specification,
} from "@/components/validator/tests/lib/score/helpers/test-helpers";

describe("parseSpecificationScore", () => {
  test("accepts a null grade and preserves zero counts", () => {
    const parsed = parseSpecificationScore(
      specification({
        grade: null,
        assessedAreas: 0,
        areas: allAreas(() => null, {
          ...ZERO_TEST_COUNTS,
          evidenceCount: 0,
          requiredEvidenceCount: 0,
          optionalEvidenceCount: 0,
        }),
      }),
    );
    expect(parsed.status).toBe("complete");
    if (parsed.status === "unusable") {
      return;
    }
    expect(parsed.score.grade).toBeNull();
    expect(parsed.score.areas[0]?.evidenceCount).toBe(0);
    expect(parsed.score.areas[0]?.testRunCount).toBe(0);
    expect(parsed.score.areas[0]?.grade).toBeNull();
  });

  test("treats absent optional evidence fields as zero without marking partial", () => {
    const parsed = parseSpecificationScore(
      specification({
        areas: [completeAreaRow("discovery", "pass"), completeAreaRow("tls", "pass")],
      }),
    );
    expect(parsed.status).toBe("complete");
    if (parsed.status === "unusable") {
      return;
    }
    expect(parsed.score.areas[0]?.evidenceCount).toBe(0);
    expect(parsed.score.areas[0]?.requiredEvidenceCount).toBe(0);
    expect(parsed.score.areas[0]?.optionalEvidenceCount).toBe(0);
  });

  test("parses when scoreArea is absent and ignores it when present", () => {
    const parsed = parseSpecificationScore(
      specification({
        areas: [
          completeAreaRow("discovery", "pass"),
          completeAreaRow("tls", "warn", { scoreArea: "sharing", mystery: 1 }),
        ],
      }),
    );
    expect(parsed.status).toBe("complete");
    if (parsed.status === "unusable") {
      return;
    }
    expect(parsed.score.areas[1]).toMatchObject({ area: "tls", grade: "warn" });
    expect(parsed.score.areas[1]).not.toHaveProperty("scoreArea");
  });

  test("ignores unknown keys on the root and area rows", () => {
    const parsed = parseSpecificationScore(
      specification({
        cachedState: "passive_complete",
        areas: [completeAreaRow("discovery", "pass", { gradedEvidenceCount: 3, foo: "bar" })],
      }),
    );
    expect(parsed.status).toBe("complete");
    if (parsed.status === "unusable") {
      return;
    }
    expect(parsed.score).not.toHaveProperty("cachedState");
    expect(parsed.score.areas[0]).not.toHaveProperty("foo");
    expect(parsed.score.areas[0]).not.toHaveProperty("gradedEvidenceCount");
  });

  test("skips a malformed area row as partial instead of crashing", () => {
    const parsed = parseSpecificationScore(
      specification({
        assessedAreas: 8,
        areas: [
          completeAreaRow("discovery", "pass"),
          { area: "tls", grade: "not-a-grade" },
          completeAreaRow("jwks", "pass"),
        ],
      }),
    );
    expect(parsed.status).toBe("partial");
    if (parsed.status !== "partial") {
      return;
    }
    expect(parsed.invalidAreaRows).toEqual([1]);
    expect(parsed.score.areas.map((row) => row.area)).toEqual(["discovery", "jwks"]);
  });

  test("marks malformed evidence as partial and keeps the row at zero", () => {
    const parsed = parseSpecificationScore(
      specification({
        areas: [completeAreaRow("discovery", "pass", { evidenceCount: "nope" })],
      }),
    );
    expect(parsed.status).toBe("partial");
    if (parsed.status !== "partial") {
      return;
    }
    expect(parsed.invalidAreaRows).toEqual([0]);
    expect(parsed.score.areas[0]?.grade).toBe("pass");
    expect(parsed.score.areas[0]?.evidenceCount).toBe(0);
  });

  test("does not invent a malformed present test-count field", () => {
    const parsed = parseSpecificationScore(
      specification({
        areas: [completeAreaRow("discovery", "pass", { testRunCount: -1 })],
      }),
    );
    expect(parsed.status).toBe("partial");
    if (parsed.status !== "partial") {
      return;
    }
    expect(parsed.invalidAreaRows).toEqual([0]);
    expect(parsed.score.areas).toEqual([]);
    const entries = areaGridEntriesFromScore(parsed);
    expect(entries[0]?.pillLabel).toBe(AREA_RESULT_PILL.notReported);
    expect(entries[0]?.area).toBe("discovery");
  });

  test("absent core test-count fields keep the row and mark the score partial", () => {
    const parsed = parseSpecificationScore(
      specification({
        areas: [
          { area: "discovery", grade: "pass", evidenceCount: 0, gradedEvidenceCount: 0 },
        ],
      }),
    );
    expect(parsed.status).toBe("partial");
    if (parsed.status !== "partial") {
      return;
    }
    expect(parsed.invalidAreaRows).toEqual([0]);
    expect(parsed.score.areas).toHaveLength(1);
    expect(parsed.score.areas[0]).toMatchObject({
      area: "discovery",
      grade: "pass",
      testRunCount: 0,
      distinctTestCount: 0,
      requiredTestCount: 0,
      optionalTestCount: 0,
      passedTestCount: 0,
      failedTestCount: 0,
      passWithWarningCount: 0,
      evidenceCount: 0,
    });
    const entries = areaGridEntriesFromScore(parsed);
    expect(entries[0]).toMatchObject({
      area: "discovery",
      grade: "pass",
      evidenceCount: 0,
    });
    expect(entries[0]?.pillLabel).not.toBe(AREA_RESULT_PILL.notReported);
    expect(projectValidatorScore({
      pollState: "terminal_pass",
      reportOk: true,
      specification: specification({
        areas: CANONICAL_AREA_IDS.map((id) => ({
          area: id,
          grade: "pass",
          evidenceCount: 0,
        })),
      }),
    }).headline).toBe(RESULT_HEADLINE.compatible);
  });

  test("keeps the last valid duplicate canonical area", () => {
    const parsed = parseSpecificationScore(
      specification({
        areas: [
          completeAreaRow("discovery", "pass", { evidenceCount: 1 }),
          completeAreaRow("discovery", "fail", { evidenceCount: 4 }),
          completeAreaRow("not-an-area", "pass"),
        ],
      }),
    );
    expect(parsed.status).toBe("complete");
    if (parsed.status === "unusable") {
      return;
    }
    expect(parsed.score.areas.map((row) => row.area)).toEqual([
      "discovery",
      "discovery",
      "not-an-area",
    ]);
    const entries = areaGridEntriesFromScore(parsed);
    expect(entries[0]).toMatchObject({
      area: "discovery",
      grade: "fail",
      evidenceCount: 4,
    });
    const areaIds: string[] = entries.map((entry) => entry.area);
    expect(areaIds.includes("not-an-area")).toBe(false);
    expect(recountCanonicalAreaGrades(parsed.score.areas)).toEqual({
      assessed: 1,
      total: 8,
    });
  });

  test("treats a malformed root as unusable", () => {
    expect(parseSpecificationScore(null).status).toBe("unusable");
    expect(parseSpecificationScore([]).status).toBe("unusable");
    expect(parseSpecificationScore("score").status).toBe("unusable");
    expect(parseSpecificationScore({ grade: "pass", state: "terminal_pass" }).status).toBe(
      "unusable",
    );
    expect(
      parseSpecificationScore({
        grade: "PASS",
        state: "terminal_pass",
        terminal: true,
        assessedAreas: 0,
        totalAreas: 8,
        areas: [],
      }).status,
    ).toBe("unusable");
  });

  test("reads report.raw.score.specification and ignores a sibling score object", () => {
    const spec = specification({ grade: null, state: "terminal_pass" });
    expect(
      specificationFromReport({
        raw: { score: { specification: spec, grade: "fail" } },
        score: { grade: "fail" },
      }),
    ).toEqual(spec);
  });
});
