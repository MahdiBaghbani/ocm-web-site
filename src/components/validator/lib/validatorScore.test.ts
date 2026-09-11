import { describe, expect, test } from "bun:test";

import {
  AREA_RESULT_PILL,
  CANONICAL_AREA_IDS,
  CANONICAL_AREA_LABELS,
  CANONICAL_AREA_TOTAL,
  RESULT_HEADLINE,
  areaGridEntriesFromScore,
  foldOverallSpecificationGrade,
  parseSpecificationScore,
  projectValidatorScore,
  recountCanonicalAreaGrades,
  resolveSpecificationGrade,
  resolveTerminalState,
  specificationFromReport,
  type CanonicalAreaId,
  type SpecificationAreaScore,
  type SpecificationGrade,
} from "./validatorScore";

const ZERO_TEST_COUNTS = {
  testRunCount: 0,
  distinctTestCount: 0,
  requiredTestCount: 0,
  optionalTestCount: 0,
  passedTestCount: 0,
  failedTestCount: 0,
  passWithWarningCount: 0,
} as const;

function areaRow(
  area: string,
  grade: SpecificationGrade | null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { area, grade, evidenceCount: 0, ...extra };
}

function completeAreaRow(
  area: string,
  grade: SpecificationGrade | null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return areaRow(area, grade, { ...ZERO_TEST_COUNTS, ...extra });
}

function allAreas(
  gradeFor: (id: CanonicalAreaId, index: number) => SpecificationGrade | null,
  extra: Record<string, unknown> = {},
): Record<string, unknown>[] {
  return CANONICAL_AREA_IDS.map((id, index) => areaRow(id, gradeFor(id, index), extra));
}

function specification(
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

function emptyArea(overrides: Partial<SpecificationAreaScore> = {}): SpecificationAreaScore {
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

describe("state and grade authority", () => {
  test("uses a known terminal poll state over cached score state", () => {
    expect(resolveTerminalState("terminal_pass", "passive_complete")).toBe("terminal_pass");
    expect(resolveTerminalState("passive_complete", "terminal_pass")).toBeNull();
    expect(resolveTerminalState(undefined, "terminal_fail")).toBe("terminal_fail");
    expect(resolveTerminalState("", "interrupted")).toBe("interrupted");
    expect(resolveTerminalState(null, "created")).toBeNull();
  });

  test("honors an explicit successful terminal grade", () => {
    const parsed = parseSpecificationScore(specification({ grade: "warn" }));
    expect(
      resolveSpecificationGrade({
        reportOk: true,
        parsed,
        terminalState: "terminal_pass",
      }),
    ).toBe("warn");
  });

  test("folds when the parsed grade is null and terminal_pass is known", () => {
    const parsed = parseSpecificationScore(
      specification({
        grade: null,
        areas: allAreas((id) => (id === "tls" ? "fail" : "pass")),
      }),
    );
    expect(
      resolveSpecificationGrade({
        reportOk: true,
        parsed,
        terminalState: "terminal_pass",
      }),
    ).toBe("fail");
  });
});

describe("projectValidatorScore verdicts", () => {
  test("private terminal_pass plus all pass areas is Compatible", () => {
    const projected = projectValidatorScore({
      pollState: "terminal_pass",
      reportOk: true,
      specification: specification(),
      failModeLabel: "peer closed",
    });
    expect(projected.headline).toBe(RESULT_HEADLINE.compatible);
    expect(projected.outcome).toBe("compatible");
    expect(projected.showFailModeLabel).toBe(false);
    expect(projected.failModeLabel).toBeUndefined();
    expect(projected.coverageLabel).toBe("8 of 8");
  });

  test("private terminal_pass plus one warn and no fail is Compatible with warnings", () => {
    const projected = projectValidatorScore({
      pollState: "terminal_pass",
      reportOk: true,
      specification: specification({
        grade: "warn",
        areas: allAreas((id) => (id === "token" ? "warn" : "pass")),
      }),
    });
    expect(projected.headline).toBe(RESULT_HEADLINE.compatibleWithWarnings);
    expect(projected.showFailModeLabel).toBe(false);
  });

  test("private terminal_pass plus one fail is Compatibility failed", () => {
    const projected = projectValidatorScore({
      pollState: "terminal_pass",
      reportOk: true,
      specification: specification({
        grade: "fail",
        areas: allAreas((id) => (id === "sharing" ? "fail" : "pass")),
        failModeLabel: "unused",
      }),
      failModeLabel: "share rejected",
    });
    expect(projected.headline).toBe(RESULT_HEADLINE.compatibilityFailed);
    expect(projected.showFailModeLabel).toBe(true);
    expect(projected.failModeLabel).toBe("share rejected");
  });

  test("private terminal_fail plus stale null cached grade is Compatibility failed", () => {
    const projected = projectValidatorScore({
      pollState: "terminal_fail",
      reportOk: true,
      specification: specification({
        grade: null,
        state: "passive_complete",
        terminal: false,
        areas: allAreas(() => "pass"),
      }),
      failModeLabel: "handshake failed",
    });
    expect(projected.headline).toBe(RESULT_HEADLINE.compatibilityFailed);
    expect(projected.grade).toBe("fail");
    expect(projected.showFailModeLabel).toBe(true);
    expect(projected.failModeLabel).toBe("handshake failed");
  });

  test("interrupted plus stale null cached grade is Scan interrupted", () => {
    const projected = projectValidatorScore({
      pollState: "interrupted",
      reportOk: true,
      specification: specification({
        grade: null,
        state: "passive_complete",
        areas: allAreas(() => "pass"),
      }),
      failModeLabel: "operator stopped",
    });
    expect(projected.headline).toBe(RESULT_HEADLINE.scanInterrupted);
    expect(projected.showFailModeLabel).toBe(true);
    expect(projected.failModeLabel).toBe("operator stopped");
  });

  test("terminal_pass plus 0 assessed is No compatibility result, 0 of 8", () => {
    const projected = projectValidatorScore({
      pollState: "terminal_pass",
      reportOk: true,
      specification: specification({
        grade: null,
        assessedAreas: 0,
        areas: allAreas(() => null),
      }),
      failModeLabel: "should not appear",
    });
    expect(projected.outcome).toBe("inconclusive");
    expect(projected.headline).toBe(RESULT_HEADLINE.noCompatibilityResult);
    expect(projected.coverageLabel).toBe("0 of 8");
    expect(projected.assessed).toBe(0);
    expect(projected.total).toBe(CANONICAL_AREA_TOTAL);
    expect(projected.showFailModeLabel).toBe(false);
    expect(projected.failModeLabel).toBeUndefined();
  });

  test("malformed score is Result unavailable, not Inconclusive", () => {
    const projected = projectValidatorScore({
      pollState: "terminal_pass",
      reportOk: true,
      specification: { grade: null },
    });
    expect(projected.outcome).toBe("result_unavailable");
    expect(projected.headline).toBe(RESULT_HEADLINE.resultUnavailable);
    expect(projected.headline).not.toBe(RESULT_HEADLINE.noCompatibilityResult);
    expect(projected.outcome).not.toBe("inconclusive");
  });

  test("poll terminal state overrides cached passive_complete", () => {
    const projected = projectValidatorScore({
      pollState: "terminal_pass",
      reportOk: true,
      specification: specification({
        state: "passive_complete",
        terminal: false,
      }),
    });
    expect(projected.terminalState).toBe("terminal_pass");
    expect(projected.headline).toBe(RESULT_HEADLINE.compatible);
  });

  test("explicit successful terminal grade is honored over a conflicting fold", () => {
    const projected = projectValidatorScore({
      pollState: "terminal_pass",
      reportOk: true,
      specification: specification({
        grade: "warn",
        areas: allAreas(() => "pass"),
      }),
    });
    expect(projected.grade).toBe("warn");
    expect(projected.headline).toBe(RESULT_HEADLINE.compatibleWithWarnings);
  });

  test("failModeLabel appears for fail and interrupted and nowhere else", () => {
    const label = "mode label";
    const fail = projectValidatorScore({
      pollState: "terminal_fail",
      reportOk: true,
      specification: specification({ grade: null, areas: allAreas(() => null) }),
      failModeLabel: label,
    });
    const interrupted = projectValidatorScore({
      pollState: "interrupted",
      reportOk: true,
      specification: specification({ grade: null }),
      failModeLabel: label,
    });
    const pass = projectValidatorScore({
      pollState: "terminal_pass",
      reportOk: true,
      specification: specification(),
      failModeLabel: label,
    });
    const warn = projectValidatorScore({
      pollState: "terminal_pass",
      reportOk: true,
      specification: specification({ grade: "warn" }),
      failModeLabel: label,
    });
    const inconclusive = projectValidatorScore({
      pollState: "terminal_pass",
      reportOk: true,
      specification: specification({ grade: null, areas: allAreas(() => null) }),
      failModeLabel: label,
    });
    const unavailable = projectValidatorScore({
      pollState: "terminal_pass",
      reportOk: true,
      specification: null,
      failModeLabel: label,
    });
    expect(fail.showFailModeLabel).toBe(true);
    expect(fail.failModeLabel).toBe(label);
    expect(interrupted.showFailModeLabel).toBe(true);
    expect(interrupted.failModeLabel).toBe(label);
    expect(pass.showFailModeLabel).toBe(false);
    expect(pass.failModeLabel).toBeUndefined();
    expect(warn.showFailModeLabel).toBe(false);
    expect(inconclusive.showFailModeLabel).toBe(false);
    expect(unavailable.showFailModeLabel).toBe(false);
  });
});

describe("projectValidatorScore reportOk false authority", () => {
  test("reportOk false plus terminal_fail is Compatibility failed despite all-pass areas", () => {
    const projected = projectValidatorScore({
      pollState: "terminal_fail",
      reportOk: false,
      specification: specification({
        grade: "pass",
        state: "terminal_pass",
        terminal: true,
        areas: CANONICAL_AREA_IDS.map((id) => completeAreaRow(id, "pass")),
      }),
      failModeLabel: "handshake failed",
    });
    expect(projected.grade).toBe("fail");
    expect(projected.outcome).toBe("compatibility_failed");
    expect(projected.headline).toBe(RESULT_HEADLINE.compatibilityFailed);
    expect(projected.terminalState).toBe("terminal_fail");
    expect(projected.showFailModeLabel).toBe(true);
    expect(projected.failModeLabel).toBe("handshake failed");
  });

  test("reportOk false projection preserves complete, partial, and unusable parser status", () => {
    const complete = projectValidatorScore({
      pollState: "terminal_pass",
      reportOk: false,
      specification: specification({
        areas: CANONICAL_AREA_IDS.map((id) => completeAreaRow(id, "pass")),
      }),
    });
    expect(complete.parsed.status).toBe("complete");
    expect(complete.grade).toBe("pass");
    expect(complete.outcome).toBe("compatible");
    expect(complete.headline).toBe(RESULT_HEADLINE.compatible);
    expect(complete.coverageLabel).toBe("8 of 8");

    const partial = projectValidatorScore({
      pollState: "terminal_pass",
      reportOk: false,
      specification: specification({
        areas: CANONICAL_AREA_IDS.map((id) =>
          id === "tls" ? { area: "tls", grade: "not-a-grade" } : completeAreaRow(id, "pass"),
        ),
      }),
    });
    expect(partial.parsed.status).toBe("partial");
    expect(partial.grade).toBe("pass");
    expect(partial.outcome).toBe("compatible");
    expect(partial.headline).toBe(RESULT_HEADLINE.compatible);
    expect(partial.coverageLabel).toBe("7 of 8");
    expect(partial.areas.find((entry) => entry.area === "tls")?.pillLabel).toBe(
      AREA_RESULT_PILL.notReported,
    );

    const unusable = projectValidatorScore({
      pollState: "terminal_pass",
      reportOk: false,
      specification: { grade: null },
    });
    expect(unusable.parsed.status).toBe("unusable");
    expect(unusable.grade).toBeNull();
    expect(unusable.outcome).toBe("result_unavailable");
    expect(unusable.headline).toBe(RESULT_HEADLINE.resultUnavailable);
    expect(unusable.outcome).not.toBe("inconclusive");
  });

  test("reportOk true honors a cached grade while reportOk false folds the areas", () => {
    const specificationInput = specification({
      grade: "warn",
      areas: CANONICAL_AREA_IDS.map((id) => completeAreaRow(id, "pass")),
    });
    const honored = projectValidatorScore({
      pollState: "terminal_pass",
      reportOk: true,
      specification: specificationInput,
    });
    const folded = projectValidatorScore({
      pollState: "terminal_pass",
      reportOk: false,
      specification: specificationInput,
    });
    expect(honored.grade).toBe("warn");
    expect(honored.outcome).toBe("compatible_with_warnings");
    expect(honored.headline).toBe(RESULT_HEADLINE.compatibleWithWarnings);
    expect(folded.grade).toBe("pass");
    expect(folded.outcome).toBe("compatible");
    expect(folded.headline).toBe(RESULT_HEADLINE.compatible);
    expect(honored.grade).not.toBe(folded.grade);
    expect(honored.outcome).not.toBe(folded.outcome);
  });
});

describe("area adapter", () => {
  test("keeps eight canonical areas and locked order", () => {
    const entries = areaGridEntriesFromScore(parseSpecificationScore(specification()));
    expect(entries.map((entry) => entry.area)).toEqual([...CANONICAL_AREA_IDS]);
    expect(entries.map((entry) => entry.label)).toEqual(
      CANONICAL_AREA_IDS.map((id) => CANONICAL_AREA_LABELS[id]),
    );
  });

  test("applies custom descriptions and result pill labels", () => {
    const entries = areaGridEntriesFromScore(parseSpecificationScore(specification()), {
      descriptions: { discovery: "Plain discovery copy" },
      pillLabels: { discovery: "Custom pass pill" },
    });
    expect(entries[0]?.description).toBe("Plain discovery copy");
    expect(entries[0]?.pillLabel).toBe("Custom pass pill");
    expect(entries[0]?.label).toBe("Server discovery");
  });

  test("present null grade is Not tested and absent or malformed is Not reported", () => {
    const parsed = parseSpecificationScore(
      specification({
        grade: null,
        areas: [areaRow("discovery", null), { area: "tls", grade: 1 }],
      }),
    );
    const byId = Object.fromEntries(
      areaGridEntriesFromScore(parsed).map((entry) => [entry.area, entry]),
    );
    expect(byId.discovery?.pillLabel).toBe(AREA_RESULT_PILL.notTested);
    expect(byId.tls?.pillLabel).toBe(AREA_RESULT_PILL.notReported);
    expect(byId.jwks?.pillLabel).toBe(AREA_RESULT_PILL.notReported);
    expect(byId.discovery?.grade).toBeNull();
    expect(byId.tls?.grade).toBeNull();
  });

  test("zero evidence counts remain zero", () => {
    const parsed = parseSpecificationScore(
      specification({
        areas: [areaRow("discovery", "pass", { evidenceCount: 0 })],
      }),
    );
    expect(areaGridEntriesFromScore(parsed)[0]?.evidenceCount).toBe(0);
  });
});
