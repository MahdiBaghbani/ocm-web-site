import { describe, expect, test } from "bun:test";

import { parseSpecificationScore } from "@/components/validator/lib/score/parse";
import {
  AREA_RESULT_PILL,
  RESULT_HEADLINE,
  areaGridEntriesFromScore,
  projectValidatorScore,
} from "@/components/validator/lib/score/project";
import {
  CANONICAL_AREA_IDS,
  CANONICAL_AREA_LABELS,
  CANONICAL_AREA_TOTAL,
} from "@/components/validator/lib/score/areas";
import {
  allAreas,
  areaRow,
  completeAreaRow,
  specification,
} from "@/components/validator/tests/lib/score/helpers/test-helpers";

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
