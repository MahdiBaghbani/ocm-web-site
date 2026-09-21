import { describe, expect, test } from "bun:test";

import {
  foldOverallSpecificationGrade,
  recountCanonicalAreaGrades,
  parseSpecificationScore,
} from "@/components/validator/lib/score/parse";
import {
  areaGridEntriesFromScore,
  AREA_RESULT_PILL,
} from "@/components/validator/lib/score/project";
import { CANONICAL_AREA_IDS } from "@/components/validator/lib/score/areas";
import {
  emptyArea,
  areaRow,
  specification,
} from "@/components/validator/tests/lib/score/helpers/test-helpers";

describe("foldOverallSpecificationGrade", () => {
  test("all-pass fold", () => {
    const areas = CANONICAL_AREA_IDS.map((id) => emptyArea({ area: id, grade: "pass" }));
    expect(foldOverallSpecificationGrade(areas, "terminal_pass")).toBe("pass");
  });

  test("warning fold", () => {
    const areas = CANONICAL_AREA_IDS.map((id, index) =>
      emptyArea({ area: id, grade: index === 1 ? "warn" : "pass" }),
    );
    expect(foldOverallSpecificationGrade(areas, "terminal_pass")).toBe("warn");
  });

  test("any-fail fold", () => {
    const areas = [
      emptyArea({ area: "discovery", grade: "pass" }),
      emptyArea({ area: "tls", grade: "fail" }),
      emptyArea({ area: "jwks", grade: "warn" }),
    ];
    expect(foldOverallSpecificationGrade(areas, "terminal_pass")).toBe("fail");
  });

  test("terminal_fail forces fail", () => {
    expect(
      foldOverallSpecificationGrade(
        [emptyArea({ area: "discovery", grade: "pass" })],
        "terminal_fail",
      ),
    ).toBe("fail");
  });

  test("terminal_pass with zero assessed returns null", () => {
    const areas = CANONICAL_AREA_IDS.map((id) => emptyArea({ area: id, grade: null }));
    expect(foldOverallSpecificationGrade(areas, "terminal_pass")).toBeNull();
  });

  test("non-terminal returns null", () => {
    expect(
      foldOverallSpecificationGrade(
        [emptyArea({ area: "discovery", grade: "pass" })],
        "passive_complete",
      ),
    ).toBeNull();
    expect(
      foldOverallSpecificationGrade(
        [emptyArea({ area: "discovery", grade: "fail" })],
        "interrupted",
      ),
    ).toBeNull();
  });
});

describe("canonical recount", () => {
  test("displays the canonical recount when backend counts disagree", () => {
    const parsed = parseSpecificationScore(
      specification({
        assessedAreas: 8,
        totalAreas: 10,
        areas: [
          areaRow("discovery", "pass"),
          areaRow("tls", "warn"),
          { area: "jwks" },
          areaRow("mystery", "fail"),
        ],
      }),
    );
    expect(parsed.status).toBe("partial");
    if (parsed.status === "unusable") {
      return;
    }
    expect(parsed.score.assessedAreas).toBe(8);
    expect(parsed.score.totalAreas).toBe(10);
    expect(recountCanonicalAreaGrades(parsed.score.areas)).toEqual({
      assessed: 2,
      total: 8,
    });
    const pills = Object.fromEntries(
      areaGridEntriesFromScore(parsed).map((entry) => [entry.area, entry.pillLabel]),
    );
    expect(pills.discovery).toBeUndefined();
    expect(pills.tls).toBeUndefined();
    expect(pills.jwks).toBe(AREA_RESULT_PILL.notReported);
    expect(pills.httpsig).toBe(AREA_RESULT_PILL.notReported);
    expect(pills.capability).toBe(AREA_RESULT_PILL.notReported);
  });
});
