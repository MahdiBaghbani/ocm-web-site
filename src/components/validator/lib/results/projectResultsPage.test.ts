import { describe, expect, test } from "bun:test";

import type { EvidenceItem } from "../evidence/types";
import type {
  ReportResponse,
  SessionPollResponse,
  ValidatorFailure,
} from "../validatorFetch";
import { resolveValidatorMachine } from "../stateMachine";
import { RESULT_HEADLINE, type CanonicalAreaId } from "../validatorScore";
import {
  CACHED_SESSION_JSON_NOTE,
  bannerBody,
  loadedEvidenceCountsByArea,
  primaryReasonCodesByArea,
  primaryReasonsByArea,
  projectResultsPage,
  specificationInputFromReport,
} from "./projectResultsPage";

const SESSION_ID = "0193a0c2-7c1d-7b4a-8f2e-1a2b3c4d5e6f";
const API_ORIGIN = "https://validator.example.com";
const AREA_IDS = [
  "discovery",
  "tls",
  "jwks",
  "httpsig",
  "sharing",
  "notification",
  "token",
  "capability",
] as const satisfies readonly CanonicalAreaId[];

function areaRow(
  area: CanonicalAreaId,
  grade: "pass" | "warn" | "fail" | null,
): Record<string, unknown> {
  return {
    area,
    grade,
    testRunCount: 0,
    distinctTestCount: 0,
    requiredTestCount: 0,
    optionalTestCount: 0,
    passedTestCount: 0,
    failedTestCount: 0,
    passWithWarningCount: 0,
    evidenceCount: 0,
  };
}

function specification(
  gradeFor: (id: CanonicalAreaId) => "pass" | "warn" | "fail" | null,
  grade: "pass" | "warn" | "fail" | null = "pass",
): Record<string, unknown> {
  return {
    grade,
    state: "terminal_pass",
    terminal: true,
    assessedAreas: 8,
    totalAreas: 8,
    areas: AREA_IDS.map((id) => areaRow(id, gradeFor(id))),
  };
}

function liveReport(score: unknown, extra: Partial<ReportResponse> = {}): ReportResponse {
  return {
    schema: "federation_tester_report.v1",
    id: SESSION_ID,
    visibility: "session",
    score: { specification: score },
    ...extra,
  };
}

function permanentReport(score: unknown, extra: Partial<ReportResponse> = {}): ReportResponse {
  return {
    schema: "federation_tester_report.v1",
    id: SESSION_ID,
    visibility: "permanent",
    reportUrl: `/validator/report/${SESSION_ID}`,
    score: { specification: score },
    evidence: [],
    ...extra,
  };
}

function pollOf(state: string, extra: Partial<SessionPollResponse> = {}): SessionPollResponse {
  return { state, ts: 1, optInActive: false, ...extra };
}

function viewOf(state: string, nextInstruction?: string) {
  return resolveValidatorMachine({ state, optInActive: false, nextInstruction });
}

function fail(
  kind: ValidatorFailure["kind"],
  message: string,
  extra: Partial<ValidatorFailure> = {},
): ValidatorFailure {
  return {
    ok: false,
    kind,
    status: extra.status ?? null,
    error: extra.error ?? kind,
    message,
    ...extra,
  };
}

function reportNotPublic(): ValidatorFailure {
  return fail("http", "report is not public", { status: 404, error: "report_not_public" });
}

function project(input: Partial<Parameters<typeof projectResultsPage>[0]> = {}) {
  return projectResultsPage({
    poll: pollOf("terminal_pass"),
    view: viewOf("terminal_pass"),
    lastLiveReport: null,
    terminalReport: null,
    reportFailure: null,
    validatorApiOrigin: API_ORIGIN,
    ...input,
  });
}

describe("specificationInputFromReport", () => {
  test("returns undefined for a null report", () => {
    expect(specificationInputFromReport(null)).toBeUndefined();
  });

  test("prefers the nested specification when present", () => {
    const spec = specification(() => "pass");
    const report = liveReport(spec);
    expect(specificationInputFromReport(report)).toBe(spec);
  });

  test("falls back to report.score when no nested specification exists", () => {
    const score = { grade: "pass" };
    const report: ReportResponse = {
      schema: "federation_tester_report.v1",
      id: SESSION_ID,
      visibility: "session",
      score,
    };
    expect(specificationInputFromReport(report)).toBe(score);
  });
});

describe("primary reason and evidence-count helpers", () => {
  const items: EvidenceItem[] = [
    { scoreArea: "tls", reasonCode: "tls_probed", grade: "warn", affectsGrade: true },
    { area: "tls", reasonCode: "tls_secondary", grade: "pass" },
    { scoreArea: "sharing", reasonCode: "  ", grade: "fail" },
    { area: "discovery", reasonCode: "discovery_ok", grade: "pass" },
  ];

  test("primaryReasonCodesByArea picks the graded winner and trims", () => {
    const codes = primaryReasonCodesByArea(items);
    expect(codes.tls).toBe("tls_probed");
    expect(codes.discovery).toBe("discovery_ok");
    // Blank reason codes are excluded even when a row exists.
    expect(codes.sharing).toBeUndefined();
  });

  test("primaryReasonsByArea carries grade, severity, and affectsGrade of the same winner", () => {
    const reasons = primaryReasonsByArea(items);
    expect(reasons.tls?.grade).toBe("warn");
    expect(reasons.tls?.affectsGrade).toBe(true);
    expect(reasons.sharing).toBeUndefined();
  });

  test("loadedEvidenceCountsByArea counts rows per canonical area, scoreArea first", () => {
    const counts = loadedEvidenceCountsByArea(items);
    expect(counts.tls).toBe(2);
    expect(counts.sharing).toBe(1);
    expect(counts.discovery).toBe(1);
  });

  test("loadedEvidenceCountsByArea ignores non-canonical or missing areas", () => {
    const counts = loadedEvidenceCountsByArea([
      { area: "not-an-area", reasonCode: "x" },
      { reasonCode: "no-area" },
    ]);
    expect(Object.keys(counts)).toHaveLength(0);
  });
});

describe("bannerBody", () => {
  test("uses the fail-mode label when the score says to show it", () => {
    const result = project({
      poll: pollOf("terminal_fail", { failModeLabel: "peer closed the connection" }),
      view: viewOf("terminal_fail"),
      terminalReport: permanentReport(specification(() => "fail", "fail"), {
        visibility: "permanent",
      }),
    });
    expect(bannerBody(result.score)).toContain("peer closed the connection");
  });

  test("falls back to the default outcome copy when no label is shown", () => {
    const result = project({
      terminalReport: permanentReport(specification(() => "pass")),
    });
    expect(bannerBody(result.score)).toBe(
      "This server passed all assessed OCM compatibility areas.",
    );
  });
});

describe("projectResultsPage live status", () => {
  test("non-terminal view is live with a running verdict and no source report", () => {
    const result = project({
      poll: pollOf("passive_running"),
      view: viewOf("passive_running", "wait_probe"),
    });
    expect(result.status).toBe("live");
    expect(result.bannerVerdict).toBe("running");
    expect(result.bannerTitle).toBe("Scan in progress");
    expect(result.bannerMessage).toBe("The validator is still checking this server.");
    expect(result.sourceReport).toBeNull();
    expect(result.showAreas).toBe(false);
    expect(result.rawJsonNote).toBeNull();
  });
});

describe("projectResultsPage SF-4.1 terminal precedence", () => {
  test("terminalReport wins over lastLiveReport and the two are never merged", () => {
    const terminal = permanentReport(specification(() => "pass"), {
      evidence: [{ area: "discovery", reasonCode: "terminal_only" }],
    });
    const live = liveReport(specification(() => "fail", "fail"), {
      evidence: [{ area: "tls", reasonCode: "live_only" }],
    });
    const result = project({
      terminalReport: terminal,
      lastLiveReport: live,
      reportFailure: reportNotPublic(),
    });
    expect(result.sourceReport).toBe(terminal);
    expect(result.sourceKind).toBe("terminal");
    expect(result.evidence).toEqual([{ area: "discovery", reasonCode: "terminal_only" }]);
  });

  test("lastLiveReport is only the not-public fallback and yields the cached note", () => {
    const result = project({
      lastLiveReport: liveReport(specification(() => "pass")),
      reportFailure: reportNotPublic(),
    });
    expect(result.status).toBe("ready");
    expect(result.sourceKind).toBe("cached_session");
    expect(result.visibility).toBe("not_saved");
    expect(result.bannerVerdict).toBe("pass");
    expect(result.rawJsonNote).toBe(CACHED_SESSION_JSON_NOTE);
    expect(result.rawJsonTitle).toBe("Last session JSON");
    expect(result.showPublicActions).toBe(false);
  });

  test("lastLiveReport is ignored without the not-public failure", () => {
    const result = project({
      lastLiveReport: liveReport(specification(() => "pass")),
      reportFailure: null,
      terminalReport: null,
    });
    // Terminal, no terminalReport, no failure -> still loading the report.
    expect(result.status).toBe("loading_report");
    expect(result.sourceReport).toBeNull();
    expect(result.sourceKind).toBe("none");
  });
});

describe("projectResultsPage terminal statuses", () => {
  test("permanent terminal report is ready with a verdict and public actions", () => {
    const result = project({
      terminalReport: permanentReport(specification(() => "pass")),
    });
    expect(result.status).toBe("ready");
    expect(result.visibility).toBe("permanent");
    expect(result.sourceKind).toBe("terminal");
    expect(result.bannerVerdict).toBe("pass");
    expect(result.bannerTitle).toBe(RESULT_HEADLINE.compatible);
    expect(result.showPublicActions).toBe(true);
    expect(result.reportUrl).not.toBeNull();
    expect(result.showAreas).toBe(true);
    expect(result.rawJsonNote).toBeNull();
    expect(result.rawJsonTitle).toBe("Raw report JSON");
  });

  test("loading_report when terminal with no report and no failure", () => {
    const result = project({ terminalReport: null, reportFailure: null });
    expect(result.status).toBe("loading_report");
    expect(result.bannerVerdict).toBeNull();
  });

  test("expired failure yields the expired status", () => {
    const result = project({
      reportFailure: fail("expired", "report expired"),
    });
    expect(result.status).toBe("expired");
    expect(result.visibility).toBe("expired");
    expect(result.bannerVerdict).toBeNull();
  });

  test("non-not-public transport failure without a report is report_error", () => {
    const result = project({
      reportFailure: fail("http", "server error", { status: 500, error: "internal_error" }),
    });
    expect(result.status).toBe("report_error");
    expect(result.bannerVerdict).toBeNull();
  });

  test("not-public with a malformed cache is malformed with a null verdict", () => {
    const result = project({
      lastLiveReport: liveReport({ grade: null }),
      reportFailure: reportNotPublic(),
    });
    expect(result.status).toBe("malformed");
    expect(result.sourceKind).toBe("cached_session");
    expect(result.bannerVerdict).toBeNull();
    expect(result.score.headline).toBe(RESULT_HEADLINE.resultUnavailable);
    expect(result.showAreas).toBe(false);
  });

  test("not-public without a cache is the not-saved empty state", () => {
    const result = project({ reportFailure: reportNotPublic() });
    expect(result.status).toBe("not_saved_empty");
    expect(result.sourceReport).toBeNull();
    expect(result.bannerVerdict).toBeNull();
  });
});

describe("CACHED_SESSION_JSON_NOTE", () => {
  test("stays a stable ASCII snapshot note", () => {
    expect(CACHED_SESSION_JSON_NOTE).toContain("last live session snapshot");
  });
});
