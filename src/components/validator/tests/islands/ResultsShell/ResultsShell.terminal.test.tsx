import { describe, expect, test } from "bun:test";

import {
  CACHED_SESSION_JSON_NOTE,
  VISIBILITY_NOTICE,
  projectResultsPage,
} from "@/components/validator/islands/ResultsShell";
import { RESULT_HEADLINE, type CanonicalAreaId } from "@/components/validator/lib/validatorScore";
import type { EvidenceItem } from "@/components/validator/lib/evidence/types";
import { resolveValidatorMachine } from "@/components/validator/lib/stateMachine";
import {
  type ReportResponse,
  type SessionPollResponse,
  type ValidatorFailure,
} from "@/components/validator/lib/validatorFetch";

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

function areaRow(area: CanonicalAreaId, grade: "pass" | "warn" | "fail" | null): Record<string, unknown> {
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
  return resolveValidatorMachine({
    state,
    optInActive: false,
    nextInstruction,
  });
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

describe("projectResultsPage private terminal completion", () => {
  test("report_not_public plus cached all-pass areas is Compatible", () => {
    const result = project({
      lastLiveReport: liveReport(specification(() => "pass")),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(result.status).toBe("ready");
    expect(result.visibility).toBe("not_saved");
    expect(result.sourceKind).toBe("cached_session");
    expect(result.score.headline).toBe(RESULT_HEADLINE.compatible);
    expect(result.bannerVerdict).toBe("pass");
    expect(result.bannerTitle).toBe(RESULT_HEADLINE.compatible);
    expect(result.showPublicActions).toBe(false);
    expect(result.rawJsonNote).toBe(CACHED_SESSION_JSON_NOTE);
    expect(result.evidenceMode).toBe("not_saved");
    expect(result.showAreas).toBe(true);
  });

  test("report_not_public plus one warn and no fail is Compatible with warnings", () => {
    const result = project({
      lastLiveReport: liveReport(specification((id) => (id === "tls" ? "warn" : "pass"), "warn")),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(result.score.headline).toBe(RESULT_HEADLINE.compatibleWithWarnings);
    expect(result.bannerVerdict).toBe("warn");
    expect(result.visibility).toBe("not_saved");
  });

  test("report_not_public plus one fail is Compatibility failed", () => {
    const result = project({
      lastLiveReport: liveReport(specification((id) => (id === "sharing" ? "fail" : "pass"), "fail")),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(result.score.headline).toBe(RESULT_HEADLINE.compatibilityFailed);
    expect(result.bannerVerdict).toBe("fail");
  });

  test("report_not_public plus malformed cache is Result unavailable, not the not-saved empty state", () => {
    const result = project({
      lastLiveReport: liveReport({ grade: null }),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(result.status).toBe("malformed");
    expect(result.status).not.toBe("not_saved_empty");
    expect(result.visibility).toBe("not_saved");
    expect(result.sourceKind).toBe("cached_session");
    expect(result.bannerVerdict).toBeNull();
    expect(result.score.headline).toBe(RESULT_HEADLINE.resultUnavailable);
    expect(result.showAreas).toBe(false);
  });

  test("report_not_public without cache is the not-saved empty state", () => {
    const result = project({
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(result.status).toBe("not_saved_empty");
    expect(result.visibility).toBe("not_saved");
    expect(result.bannerVerdict).toBeNull();
    expect(result.showAreas).toBe(false);
    expect(result.showPublicActions).toBe(false);
  });

  test("report_not_public without cache stays not-saved empty for terminal_fail", () => {
    const result = project({
      poll: pollOf("terminal_fail", { failModeLabel: "handshake failed" }),
      view: viewOf("terminal_fail"),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(result.status).toBe("not_saved_empty");
    expect(result.status).not.toBe("ready");
    expect(result.visibility).toBe("not_saved");
    expect(result.bannerVerdict).toBeNull();
    expect(result.showAreas).toBe(false);
    expect(result.showPublicActions).toBe(false);
  });

  test("unrelated 404 is a report error, not private success", () => {
    const result = project({
      lastLiveReport: liveReport(specification(() => "pass")),
      reportFailure: fail("http", "missing", { status: 404, error: "nope" }),
    });
    expect(result.status).toBe("report_error");
    expect(result.visibility).not.toBe("not_saved");
    expect(result.showPublicActions).toBe(false);
    expect(result.sourceReport).toBeNull();
  });

  test("network failure is a report error", () => {
    const result = project({
      reportFailure: fail("network", "network request failed"),
    });
    expect(result.status).toBe("report_error");
    expect(result.visibility).not.toBe("not_saved");
  });

  test("expired failure is the expired state and does not reuse cache", () => {
    const result = project({
      lastLiveReport: liveReport(specification(() => "pass")),
      reportFailure: fail("expired", "resource expired", { status: 410, error: "gone" }),
    });
    expect(result.status).toBe("expired");
    expect(result.visibility).toBe("expired");
    expect(result.sourceReport).toBeNull();
    expect(result.showAreas).toBe(false);
    expect(result.showPublicActions).toBe(false);
  });

  test("successful permanent report honors the parsed grade and validated URL", () => {
    const result = project({
      terminalReport: permanentReport(specification(() => "pass")),
    });
    expect(result.status).toBe("ready");
    expect(result.visibility).toBe("permanent");
    expect(result.sourceKind).toBe("terminal");
    expect(result.score.headline).toBe(RESULT_HEADLINE.compatible);
    expect(result.showPublicActions).toBe(true);
    expect(result.reportUrl).toBe(`https://validator.example.com/validator/report/${SESSION_ID}`);
    expect(result.rawJsonNote).toBeNull();
    expect(result.evidenceMode).toBe("disclosure");
  });

  test("hides public actions for session visibility even when a URL is present", () => {
    const result = project({
      terminalReport: liveReport(specification(() => "pass"), {
        reportUrl: `/validator/report/${SESSION_ID}`,
      }),
    });
    expect(result.visibility).toBe("session");
    expect(result.showPublicActions).toBe(false);
    expect(result.reportUrl).toBeNull();
  });

  test("hides public actions when a permanent URL is cross-origin", () => {
    const result = project({
      terminalReport: permanentReport(specification(() => "pass"), {
        reportUrl: "https://evil.example/validator/report/abc",
      }),
    });
    expect(result.visibility).toBe("permanent");
    expect(result.showPublicActions).toBe(false);
    expect(result.reportUrl).toBeNull();
  });

  test("cached terminal_pass with zero assessed is inconclusive, not a load error", () => {
    const result = project({
      lastLiveReport: liveReport(specification(() => null, null)),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(result.status).toBe("ready");
    expect(result.bannerVerdict).toBe("inconclusive");
    expect(result.score.headline).toBe(RESULT_HEADLINE.noCompatibilityResult);
    expect(result.score.coverageLabel).toBe("0 of 8");
    expect(result.visibility).toBe("not_saved");
  });

  test("malformed terminal score is Result unavailable, not Inconclusive", () => {
    const result = project({
      terminalReport: liveReport({ grade: null }),
    });
    expect(result.status).toBe("malformed");
    expect(result.bannerVerdict).toBeNull();
    expect(result.score.headline).toBe(RESULT_HEADLINE.resultUnavailable);
    expect(result.showAreas).toBe(false);
  });

  test("failModeLabel is used only for fail and interrupted copy", () => {
    const failResult = project({
      poll: pollOf("terminal_fail", { failModeLabel: "handshake failed" }),
      view: viewOf("terminal_fail"),
      lastLiveReport: liveReport(specification(() => "pass", null)),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    const interrupted = project({
      poll: pollOf("interrupted", { failModeLabel: "operator stopped" }),
      view: viewOf("interrupted"),
      lastLiveReport: liveReport(specification(() => "pass", null)),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    const pass = project({
      poll: pollOf("terminal_pass", { failModeLabel: "should not appear" }),
      lastLiveReport: liveReport(specification(() => "pass")),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(failResult.bannerMessage).toContain("handshake failed");
    expect(interrupted.bannerMessage).toContain("operator stopped");
    expect(pass.bannerMessage).not.toContain("should not appear");
    expect(pass.score.showFailModeLabel).toBe(false);
    expect(failResult.bannerMessage).not.toContain("Assessed");
    expect(interrupted.bannerMessage).not.toContain("Assessed");
    expect(pass.bannerMessage).not.toContain("Assessed");
  });

  test("keeps poll state authoritative over cached score.state", () => {
    const result = project({
      poll: pollOf("terminal_pass"),
      lastLiveReport: liveReport({
        ...specification(() => "pass"),
        state: "passive_complete",
        terminal: false,
      }),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(result.score.terminalState).toBe("terminal_pass");
    expect(result.bannerVerdict).toBe("pass");
  });

  test("live view stays running and does not expose public actions", () => {
    const result = project({
      poll: pollOf("passive_running"),
      view: viewOf("passive_running", "wait_probe"),
      lastLiveReport: liveReport(specification(() => "pass")),
    });
    expect(result.status).toBe("live");
    expect(result.visibility).toBe("session");
    expect(result.bannerVerdict).toBe("running");
    expect(result.showPublicActions).toBe(false);
    expect(result.showAreas).toBe(false);
    expect(VISIBILITY_NOTICE.session).toContain("Live session");
  });
});

const EVIDENCE_ITEM: EvidenceItem = {
  area: "discovery",
  reasonCode: "discovery_probed",
  grade: "pass",
};

describe("evidenceMode discloses anonymous and terminal-session evidence", () => {
  test("cached not_saved snapshot with items discloses instead of suppressing", () => {
    const result = project({
      lastLiveReport: liveReport(specification(() => "pass"), {
        evidence: [EVIDENCE_ITEM],
      }),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(result.visibility).toBe("not_saved");
    expect(result.sourceKind).toBe("cached_session");
    expect(result.evidence.length).toBe(1);
    expect(result.evidenceMode).toBe("disclosure");
  });

  test("cached not_saved snapshot with no items stays not_saved mode", () => {
    const result = project({
      lastLiveReport: liveReport(specification(() => "pass")),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(result.visibility).toBe("not_saved");
    expect(result.sourceKind).toBe("cached_session");
    expect(result.evidence.length).toBe(0);
    expect(result.evidenceMode).toBe("not_saved");
  });

  test("terminal session report with items discloses the evidence", () => {
    const result = project({
      terminalReport: liveReport(specification(() => "pass"), {
        evidence: [EVIDENCE_ITEM],
      }),
    });
    expect(result.visibility).toBe("session");
    expect(result.sourceKind).toBe("terminal");
    expect(result.evidence.length).toBe(1);
    expect(result.evidenceMode).toBe("disclosure");
  });

  test("terminal session report with no items stays session mode", () => {
    const result = project({
      terminalReport: liveReport(specification(() => "pass"), { evidence: [] }),
    });
    expect(result.visibility).toBe("session");
    expect(result.evidence.length).toBe(0);
    expect(result.evidenceMode).toBe("session");
  });

  test("terminal unknown report with items discloses the evidence", () => {
    const result = project({
      terminalReport: liveReport(specification(() => "pass"), {
        visibility: "unknown",
        evidence: [EVIDENCE_ITEM],
      }),
    });
    expect(result.visibility).toBe("unknown");
    expect(result.sourceKind).toBe("terminal");
    expect(result.evidence.length).toBe(1);
    expect(result.evidenceMode).toBe("disclosure");
  });

  test("terminal unknown report with no items falls back to none", () => {
    const result = project({
      terminalReport: liveReport(specification(() => "pass"), {
        visibility: "unknown",
        evidence: [],
      }),
    });
    expect(result.visibility).toBe("unknown");
    expect(result.evidence.length).toBe(0);
    expect(result.evidenceMode).toBe("none");
  });
});
