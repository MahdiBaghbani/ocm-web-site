import { act } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

import ResultsShell, {
  AREA_DESCRIPTIONS,
  CACHED_SESSION_JSON_NOTE,
  CLAIM_COPY_FAILURE_TEXT,
  COPY_AGAIN_LABEL,
  COPY_INVITATION_LABEL,
  COPY_SUCCESS_TEXT,
  EVIDENCE_EMPTY_SNAPSHOT,
  EVIDENCE_NOT_SAVED,
  INITIAL_LIVE_INSTRUCTION_HOLD,
  INVITE_FIELD_LABEL,
  MAX_REVERSE_INVITE_LENGTH,
  PAGE_LINK_NOT_SAVED_NOTICE,
  REVERSE_INVITE_FIELD_LABEL,
  REVERSE_INVITE_SUBMIT_LABEL,
  REVERSE_INVITE_TOO_LONG_TEXT,
  TEST_HREF,
  VISIBILITY_NOTICE,
  areaTotals,
  bannerBody,
  liveViewReportHref,
  primaryReasonCodesByArea,
  primaryReasonsByArea,
  progressAnnouncement,
  projectResultsPage,
  resultAreaEntries,
  reverseInviteErrorCopy,
  sanitizeGuidanceRecord,
  specificationInputFromReport,
  stabilizeLiveView,
  stripBracketedMarkers,
} from "./ResultsShell";
import { RESULT_HEADLINE, type CanonicalAreaId } from "../lib/validatorScore";
import type { EvidenceItem } from "../lib/evidence/types";
import { resolveValidatorMachine } from "../lib/stateMachine";
import { ACTION_ERROR_COPY, UNKNOWN_GUIDANCE_TITLE, guidanceFor } from "../lib/validatorGuidance";
import {
  joinValidatorUrl,
  resolvePublicReportUrl,
  type ReportResponse,
  type SessionPollResponse,
  type ValidatorFailure,
} from "../lib/validatorFetch";
import {
  installDomShim,
  reactDomContainerOf,
  ShimEvent,
  ShimNode,
} from "../test-helpers/domShim";
import { requestUrl, jsonResponse } from "../test-helpers/fetchStub";
import { waitForText } from "../test-helpers/wait";
import { registerHappyDom, teardownHappyDom } from "../test-helpers/happyDom";

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

describe("result area presentation helpers", () => {
  test("uses Pass, Needs attention, and Fail pills and keeps descriptions", () => {
    const result = project({
      lastLiveReport: liveReport(specification((id) => {
        if (id === "tls") return "warn";
        if (id === "sharing") return "fail";
        return "pass";
      }, "fail")),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    const areas = resultAreaEntries(result.score.areas);
    const byId = Object.fromEntries(areas.map((entry) => [entry.area, entry]));
    expect(byId.discovery?.pillLabel).toBe("Pass");
    expect(byId.tls?.pillLabel).toBe("Needs attention");
    expect(byId.sharing?.pillLabel).toBe("Fail");
    expect(byId.discovery?.description).toBe(AREA_DESCRIPTIONS.discovery);
    const totals = areaTotals(areas);
    expect(totals.passed).toBe(6);
    expect(totals.warn).toBe(1);
    expect(totals.failed).toBe(1);
    expect(totals.rest).toBe(0);
  });

  test("result cards carry the primary reason code derived from evidence", () => {
    const result = project({
      lastLiveReport: liveReport(
        specification((id) => (id === "tls" ? "warn" : "pass"), "warn"),
        {
          evidence: [
            {
              area: "tls",
              scoreArea: "tls",
              reasonCode: "jwks_unadvertised",
              grade: "warn",
              affectsGrade: true,
            },
            {
              area: "discovery",
              scoreArea: "discovery",
              reasonCode: "discovery_probed",
              grade: "pass",
            },
          ],
        },
      ),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    const areas = resultAreaEntries(result.score.areas);
    const byId = Object.fromEntries(areas.map((entry) => [entry.area, entry]));
    expect(byId.tls?.reasonCode).toBe("jwks_unadvertised");
    expect(byId.discovery?.reasonCode).toBe("discovery_probed");
    expect(byId.jwks?.reasonCode).toBeUndefined();
  });

  test("reads specification from report.score when the nested path is absent", () => {
    const spec = specification(() => "pass");
    expect(specificationInputFromReport({
      schema: "federation_tester_report.v1",
      id: SESSION_ID,
      visibility: "session",
      score: spec,
    })).toEqual(spec);
  });

  test("bannerBody includes failModeLabel only when the score says to show it", () => {
    const result = project({
      poll: pollOf("terminal_fail", { failModeLabel: "peer closed" }),
      view: viewOf("terminal_fail"),
      terminalReport: permanentReport(specification(() => "fail", "fail")),
    });
    expect(bannerBody(result.score)).toContain("peer closed");
    expect(bannerBody(result.score)).not.toContain("Assessed");
    expect(result.score.showFailModeLabel).toBe(true);
  });
});

describe("liveViewReportHref", () => {
  test("builds the live URL with joinValidatorUrl and the encoded session id", () => {
    const href = liveViewReportHref(API_ORIGIN, SESSION_ID);
    expect(href).toBe(
      joinValidatorUrl(API_ORIGIN, `/report/${encodeURIComponent(SESSION_ID)}`),
    );
    expect(href).toBe(`${API_ORIGIN}/validator/report/${SESSION_ID}`);
  });

  test("percent-encodes reserved session id characters through joinValidatorUrl", () => {
    const reservedId = "sess ion#id?x/y%z";
    const encodedId = encodeURIComponent(reservedId);
    const href = liveViewReportHref(API_ORIGIN, reservedId);
    expect(encodedId).toContain("%20");
    expect(encodedId).toContain("%23");
    expect(href).toBe(joinValidatorUrl(API_ORIGIN, `/report/${encodedId}`));
    expect(href).toBe(`${API_ORIGIN}/validator/report/${encodedId}`);
    expect(href).toContain("%20");
    expect(href).toContain("%23");
    expect(href).not.toContain(" ");
    expect(href).not.toBe(`${API_ORIGIN}/validator/report/${reservedId}`);
    expect(href).not.toBe(`${API_ORIGIN}/report/${reservedId}`);
    expect(href).not.toBe(`${API_ORIGIN}/report/${encodedId}`);
  });

  test("hides the live URL when the origin is empty or whitespace", () => {
    expect(liveViewReportHref("", SESSION_ID)).toBeNull();
    expect(liveViewReportHref("   ", SESSION_ID)).toBeNull();
    // joinValidatorUrl would emit a relative /validator path for an empty
    // origin. The live helper must not use that fallback, and must not call
    // resolvePublicReportUrl (which also rejects an empty origin).
    expect(joinValidatorUrl("", `/report/${encodeURIComponent(SESSION_ID)}`)).toBe(
      `/validator/report/${SESSION_ID}`,
    );
    expect(resolvePublicReportUrl(`/validator/report/${SESSION_ID}`, "")).toBeNull();
  });

  test("keeps the live href distinct from a permanent public report URL", () => {
    const liveHref = liveViewReportHref(API_ORIGIN, SESSION_ID);
    const permanentHref = resolvePublicReportUrl(
      "/validator/report/public-other",
      API_ORIGIN,
    );
    expect(liveHref).not.toBeNull();
    expect(permanentHref).not.toBeNull();
    expect(liveHref).not.toBe(permanentHref);
    expect(liveHref).not.toBe(
      resolvePublicReportUrl("https://evil.example/validator/report/abc", API_ORIGIN),
    );
  });
});

describe("primary reason selection precedence", () => {
  test("affectsGrade true wins over an earlier affectsGrade false item", () => {
    const items: EvidenceItem[] = [
      { area: "discovery", scoreArea: "tls", reasonCode: "  ", grade: "pass" },
      {
        scoreArea: "tls",
        reasonCode: "discovery_probed",
        grade: "pass",
        severity: "pass",
        affectsGrade: false,
      },
      {
        scoreArea: "tls",
        reasonCode: "tls_probed",
        grade: "warn",
        severity: "warn",
        affectsGrade: true,
      },
    ];
    const codes = primaryReasonCodesByArea(items);
    const reasons = primaryReasonsByArea(items);
    expect(codes.tls).toBe("tls_probed");
    expect(reasons.tls).toEqual({ grade: "warn", severity: "warn", affectsGrade: true });
  });

  test("grade fail beats warn within the same affectsGrade tier", () => {
    const items: EvidenceItem[] = [
      {
        scoreArea: "sharing",
        reasonCode: "discovery_probed",
        grade: "warn",
        severity: "warn",
        affectsGrade: true,
      },
      {
        scoreArea: "sharing",
        reasonCode: "httpsig_probed",
        grade: "fail",
        severity: "fail",
        affectsGrade: true,
      },
    ];
    const codes = primaryReasonCodesByArea(items);
    const reasons = primaryReasonsByArea(items);
    expect(codes.sharing).toBe("httpsig_probed");
    expect(reasons.sharing).toEqual({ grade: "fail", severity: "fail", affectsGrade: true });
  });

  test("codes and outcome choose the same item", () => {
    const items: EvidenceItem[] = [
      { scoreArea: "tls", reasonCode: "discovery_probed", grade: "pass", affectsGrade: false },
      { scoreArea: "tls", reasonCode: "tls_probed", grade: "warn", affectsGrade: true },
    ];
    expect(primaryReasonCodesByArea(items).tls).toBe("tls_probed");
    expect(primaryReasonsByArea(items).tls?.grade).toBe("warn");
  });

  test("uses area when scoreArea is absent and skips non-canonical areas", () => {
    const items: EvidenceItem[] = [
      { area: "jwks", reasonCode: "jwks_unadvertised", grade: "warn", affectsGrade: true },
      { area: "not-an-area", reasonCode: "discovery_probed", grade: "pass" },
    ];
    const codes = primaryReasonCodesByArea(items);
    const reasons = primaryReasonsByArea(items);
    expect(codes.jwks).toBe("jwks_unadvertised");
    expect(reasons.jwks).toEqual({ grade: "warn", severity: undefined, affectsGrade: true });
    expect(Object.hasOwn(codes, "discovery")).toBe(false);
    expect(Object.hasOwn(reasons, "discovery")).toBe(false);
  });
});

describe("not-saved evidence copy", () => {
  test("uses the explicit not-public evidence sentence", () => {
    expect(EVIDENCE_NOT_SAVED).toBe(
      "No saved evidence is available because this report was not public.",
    );
  });

  test("uses the explicit empty session snapshot sentence", () => {
    expect(EVIDENCE_EMPTY_SNAPSHOT).toBe(
      "No evidence items were included in this session snapshot.",
    );
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

function walk(node: ShimNode, visit: (current: ShimNode) => void): void {
  visit(node);
  for (const child of node.childNodes) {
    walk(child, visit);
  }
}

function nodesByRole(root: ShimNode, role: string): ShimNode[] {
  const found: ShimNode[] = [];
  walk(root, (node) => {
    if (node.getAttribute("role") === role) {
      found.push(node);
    }
  });
  return found;
}

function nodesByTag(root: ShimNode, tagName: string): ShimNode[] {
  const upper = tagName.toUpperCase();
  const found: ShimNode[] = [];
  walk(root, (node) => {
    if (node.tagName === upper) {
      found.push(node);
    }
  });
  return found;
}

function findByExactText(root: ShimNode, tagName: string, text: string): ShimNode {
  const upper = tagName.toUpperCase();
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (found === null && node.tagName === upper && node.textContent === text) {
      found = node;
    }
  });
  if (found === null) {
    throw new Error(`missing <${tagName}> with text ${JSON.stringify(text)}`);
  }
  return found;
}

function firstByAttr(root: ShimNode, attr: string, value: string): ShimNode | null {
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (found === null && node.getAttribute(attr) === value) {
      found = node;
    }
  });
  return found;
}

function firstByHasAttr(root: ShimNode, attr: string): ShimNode | null {
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (found === null && node.hasAttribute(attr)) {
      found = node;
    }
  });
  return found;
}

function reactClick(node: ShimNode): void {
  const key = Object.getOwnPropertyNames(node).find((name) => name.startsWith("__reactProps"));
  if (key !== undefined) {
    const props = (node as unknown as Record<string, { onClick?: (event: ShimEvent) => void }>)[key];
    if (typeof props.onClick === "function") {
      props.onClick(new ShimEvent("click"));
      return;
    }
  }
  node.dispatchEvent(new ShimEvent("click"));
}

function installTerminalReportFetch(report: ReportResponse): () => void {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("config.json")) {
      return jsonResponse(200, {
        poll_interval_ms: 1,
        active_poll_interval_ms: 1,
        backoff_initial_ms: 1,
        backoff_max_ms: 1,
        request_timeout_ms: 5000,
        validator_api_origin: API_ORIGIN,
      });
    }
    if (url.includes(`/api/session/${SESSION_ID}`)) {
      return jsonResponse(200, { state: "terminal_pass", ts: 1, optInActive: false });
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(200, report);
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

function installInterruptedReportFetch(): () => void {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("config.json")) {
      return jsonResponse(200, {
        poll_interval_ms: 1,
        active_poll_interval_ms: 1,
        backoff_initial_ms: 1,
        backoff_max_ms: 1,
        request_timeout_ms: 5000,
        validator_api_origin: API_ORIGIN,
      });
    }
    if (url.includes(`/api/session/${SESSION_ID}`)) {
      return jsonResponse(200, { state: "interrupted", ts: 1, optInActive: false });
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(200, permanentReport(specification(() => "pass", null)));
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

function installClipboardWriteText(
  writeText: (value: string) => Promise<void>,
): () => void {
  const nav = globalThis.navigator as {
    clipboard?: { writeText: (value: string) => Promise<void> };
  };
  const previousClipboard = nav.clipboard;
  if (previousClipboard !== undefined) {
    const previousWrite = previousClipboard.writeText.bind(previousClipboard);
    try {
      previousClipboard.writeText = writeText;
      return () => {
        previousClipboard.writeText = previousWrite;
      };
    } catch {
      Object.defineProperty(previousClipboard, "writeText", {
        configurable: true,
        writable: true,
        value: writeText,
      });
      return () => {
        Object.defineProperty(previousClipboard, "writeText", {
          configurable: true,
          writable: true,
          value: previousWrite,
        });
      };
    }
  }
  try {
    nav.clipboard = { writeText };
  } catch {
    Object.defineProperty(nav, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  }
  return () => {
    if (nav.clipboard !== undefined && nav.clipboard.writeText === writeText) {
      delete nav.clipboard;
    }
  };
}

function installRejectedClipboard(): () => void {
  return installClipboardWriteText(() => Promise.reject(new Error("clipboard rejected")));
}

function installExecCommand(handler: () => boolean): { restore: () => void } {
  const previous = document.execCommand;
  document.execCommand = ((command: string) => {
    if (command === "copy") {
      return handler();
    }
    return previous.call(document, command);
  }) as typeof document.execCommand;
  return {
    restore: () => {
      document.execCommand = previous;
    },
  };
}

function installIsSecureContext(value: boolean): () => void {
  const previous = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    enumerable: true,
    get: () => value,
  });
  return () => {
    if (previous === undefined) {
      Reflect.deleteProperty(window, "isSecureContext");
      return;
    }
    Object.defineProperty(window, "isSecureContext", previous);
  };
}

function installNotSavedCachedFetch(): () => void {
  let deliveredRunning = false;
  let lastPoll: "running" | "terminal" = "running";
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("config.json")) {
      return jsonResponse(200, {
        poll_interval_ms: 1,
        active_poll_interval_ms: 1,
        backoff_initial_ms: 1,
        backoff_max_ms: 1,
        request_timeout_ms: 5000,
        validator_api_origin: API_ORIGIN,
      });
    }
    if (url.includes(`/api/session/${SESSION_ID}`)) {
      if (!deliveredRunning) {
        deliveredRunning = true;
        lastPoll = "running";
        return jsonResponse(200, {
          state: "passive_running",
          ts: 1,
          optInActive: false,
          nextInstruction: "wait_probe",
        });
      }
      lastPoll = "terminal";
      return jsonResponse(200, { state: "terminal_pass", ts: 2, optInActive: false });
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      if (lastPoll === "running") {
        return jsonResponse(200, liveReport(specification(() => "pass")));
      }
      return jsonResponse(404, { error: "report_not_public", message: "report is not public" });
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

function installStopInstructionFetch(calls: { stop: number; sessionGet: number }): () => void {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("config.json")) {
      return jsonResponse(200, {
        poll_interval_ms: 1,
        active_poll_interval_ms: 1,
        backoff_initial_ms: 1,
        backoff_max_ms: 1,
        request_timeout_ms: 5000,
        validator_api_origin: API_ORIGIN,
      });
    }
    if (url.includes("/stop") && method === "POST") {
      calls.stop += 1;
      return jsonResponse(200, { id: SESSION_ID, state: "interrupted" });
    }
    if (url.includes(`/api/session/${SESSION_ID}`)) {
      calls.sessionGet += 1;
      return jsonResponse(200, {
        state: "passive_complete",
        ts: 1,
        optInActive: false,
        nextInstruction: "stop",
      });
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(200, liveReport(specification(() => "pass")));
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

function setWindowHref(href: string): void {
  const host = globalThis as unknown as { window?: { location?: { href: string } } };
  if (host.window?.location !== undefined) {
    host.window.location.href = href;
  }
}

describe("ResultsShell page-link action", () => {
  test("shows the exact not-saved honesty notice on ready cached results", async () => {
    const restoreFetch = installNotSavedCachedFetch();
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);
      await waitForText(container, PAGE_LINK_NOT_SAVED_NOTICE);
      expect(container.textContent).toContain("Copy page link");
      expect(container.textContent).toContain(`Session ${SESSION_ID}`);
      expect(container.textContent).toContain(
        "Not saved. This result was not stored as a public report. A copied page link identifies the session but does not preserve these scores or evidence.",
      );
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("keeps the page-link action when a permanent public URL is invalid", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification(() => "pass"), {
        reportUrl: "https://evil.example/validator/report/abc",
      }),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);
      expect(container.textContent).toContain("Copy page link");
      expect(container.textContent).toContain(`Session ${SESSION_ID}`);
      expect(container.textContent).not.toContain("Open public report");
      expect(container.textContent).not.toContain("Copy public report link");
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("read-only live links keep GET polling and do not POST /stop", async () => {
    const calls = { stop: 0, sessionGet: 0 };
    const restoreFetch = installStopInstructionFetch(calls);
    const { document: doc, restore } = installDomShim();
    setWindowHref(`https://localhost/?host=peer.example&id=${SESSION_ID}&ro=1`);
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, "Continue or finish");
      expect(container.textContent).toContain("Copy page link");
      // The fixture returns passive_complete + "stop" on every poll. A
      // read-only view must keep GET polling past that first stop
      // instruction instead of exiting after one poll, and must never POST
      // /stop.
      await waitForDom(() => calls.sessionGet >= 2);
      expect(calls.sessionGet).toBeGreaterThanOrEqual(2);
      expect(calls.stop).toBe(0);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("shows the not-saved visibility notice beside disclosed cache evidence", async () => {
    const restoreFetch = installTerminalReportFetch(
      liveReport(specification(() => "pass"), {
        visibility: "not_saved",
        evidence: [EVIDENCE_ITEM],
      }),
    );
    const { document: doc, restore } = installDomShim();
    // A non-read-only link so this mount is unaffected by any earlier test
    // that toggled the read-only page-link parameter.
    setWindowHref(`https://localhost/?host=peer.example&id=${SESSION_ID}`);
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);

      // A terminal not_saved cache with evidence items discloses the items
      // (evidenceMode = disclosure), and the not-saved visibility notice must
      // render in the same document beside that disclosed evidence.
      expect(container.textContent).toContain(VISIBILITY_NOTICE.not_saved);
      const disclosure = firstByHasAttr(container, "data-reason-source");
      expect(disclosure).not.toBeNull();
      expect(container.textContent).toContain("1 item");
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });
});

describe("ResultsShell testHref", () => {
  test("defaults recovery links to TEST_HREF and honors a custom testHref", async () => {
    const customHref = "/ocm/validator/";
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));

      await act(() => {
        root.render(<ResultsShell />);
      });
      await waitForText(container, "Back to Test");
      const defaultBack = findByExactText(container, "a", "Back to Test");
      expect(defaultBack.getAttribute("href")).toBe(TEST_HREF);

      await act(() => {
        root.render(<ResultsShell testHref={customHref} />);
      });
      await waitForText(container, "Back to Test");
      const customBack = findByExactText(container, "a", "Back to Test");
      expect(customBack.getAttribute("href")).toBe(customHref);
      await act(() => { root.unmount(); });
    } finally {
      restore();
    }
  });

  test("uses a custom testHref on Run a new check", async () => {
    const customHref = "/ocm/validator/";
    const restoreFetch = installInterruptedReportFetch();
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(
          <ResultsShell host="peer.example" id={SESSION_ID} testHref={customHref} />,
        );
      });
      await waitForText(container, "Run a new check");
      const recovery = findByExactText(container, "a", "Run a new check");
      expect(recovery.getAttribute("href")).toBe(customHref);
      expect(recovery.getAttribute("href")).not.toBe(TEST_HREF);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });
});

function actionButtons(root: ShimNode): ShimNode[] {
  return nodesByTag(root, "button").filter((node) => {
    const id = node.getAttribute("id");
    return id !== null && id.startsWith("area-card-") && id.endsWith("-action");
  });
}

function actionButton(root: ShimNode, areaId: string): ShimNode | null {
  return firstByAttr(root, "id", `area-card-${areaId}-action`);
}

describe("ResultsShell area detail modal", () => {
  test("a ready results card opens the area detail modal", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification(() => "pass")),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);

      const trigger = findByExactText(container, "button", "View details");
      expect(trigger.getAttribute("id")).toBe("area-card-discovery-action");
      expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
      await act(() => {
        reactClick(trigger);
      });
      await waitForText(doc.body, "Raw JSON");

      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(true);
      expect(nodesByRole(doc.body, "dialog").length).toBeGreaterThan(0);
      expect(
        nodesByRole(doc.body, "tablist").some(
          (node) => node.getAttribute("aria-label") === "Area details",
        ),
      ).toBe(true);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("an assessed zero-evidence card opens the area detail modal", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification((id) => (id === "tls" ? "warn" : "pass"), "warn")),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatibleWithWarnings);

      const trigger = actionButton(container, "tls");
      expect(trigger).not.toBeNull();
      if (trigger === null) throw new Error("missing tls trigger");
      // A warn card surfaces the reason-forward label, not the pass label.
      expect(trigger.textContent).toBe("Why and evidence");
      await act(() => {
        reactClick(trigger);
      });
      await waitForText(doc.body, "Raw JSON");

      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(true);
      expect(
        nodesByRole(doc.body, "tablist").some(
          (node) => node.getAttribute("aria-label") === "Area details",
        ),
      ).toBe(true);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("a truly empty unassessed card has no View details button", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification((id) => (id === "jwks" ? null : "pass"))),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);

      expect(actionButton(container, "discovery")).not.toBeNull();
      expect(actionButton(container, "jwks")).toBeNull();
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("ready results use the interactive results grid, not statistics tiles", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification(() => "pass")),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);

      expect(
        nodesByTag(container, "article").some((node) => node.hasAttribute("data-area-card")),
      ).toBe(true);
      expect(actionButtons(container).length).toBeGreaterThan(0);
      expect(container.textContent).not.toContain("areas assessed");
      expect(container.textContent).not.toContain("pass rate");
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("card and area modal show the same primary reason copy for a warn card with a pass primary item", async () => {
    const remedy =
      "Publish a 200 JSON document at /.well-known/ocm with enabled true and the required apiVersion, endPoint, and resourceTypes.";
    const why =
      "The validator sent an uncached GET to /.well-known/ocm and assessed the returned JSON discovery document.";
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification((id) => (id === "discovery" ? "warn" : "pass"), "warn"), {
        evidence: [
          {
            area: "discovery",
            scoreArea: "discovery",
            reasonCode: "discovery_probed",
            grade: "pass",
            affectsGrade: true,
          },
          {
            area: "discovery",
            scoreArea: "discovery",
            reasonCode: "tls_probed",
            grade: "warn",
            affectsGrade: false,
          },
        ],
      }),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatibleWithWarnings);

      // The aggregate discovery card is warn, but the primary evidence item by
      // precedence is the grade-affecting pass discovery_probed row (the warn
      // tls_probed row does not affect the grade), so the card reason copy must
      // resolve from the primary item (no remedy) and match AreaModal exactly.
      const cardReason = firstByAttr(container, "data-area-reason", "discovery");
      expect(cardReason).not.toBeNull();
      if (cardReason === null) throw new Error("missing discovery card reason");
      expect(cardReason.textContent).toContain("Discovery endpoint checked");
      expect(cardReason.textContent).toContain(why);
      expect(cardReason.textContent).not.toContain(remedy);

      const trigger = actionButton(container, "discovery");
      expect(trigger).not.toBeNull();
      if (trigger === null) throw new Error("missing discovery View details button");
      await act(() => {
        reactClick(trigger);
      });
      await waitForText(doc.body, "Raw JSON");

      const summary = firstByAttr(doc.body, "data-area-panel", "summary");
      expect(summary).not.toBeNull();
      if (summary === null) throw new Error("missing area modal summary panel");
      expect(summary.textContent).toContain("Discovery endpoint checked");
      expect(summary.textContent).toContain(why);
      expect(summary.textContent).not.toContain(remedy);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("card and area modal agree when the primary item has a null grade", async () => {
    const remedy =
      "Publish a 200 JSON document at /.well-known/ocm with enabled true and the required apiVersion, endPoint, and resourceTypes.";
    const why =
      "The validator sent an uncached GET to /.well-known/ocm and assessed the returned JSON discovery document.";
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification((id) => (id === "discovery" ? "warn" : "pass"), "warn"), {
        evidence: [
          {
            area: "discovery",
            scoreArea: "discovery",
            reasonCode: "discovery_probed",
            grade: null,
            affectsGrade: true,
          },
        ],
      }),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatibleWithWarnings);

      // A null primary grade resolves to no remedy, and the card and modal must
      // still agree on the reason copy.
      const cardReason = firstByAttr(container, "data-area-reason", "discovery");
      expect(cardReason).not.toBeNull();
      if (cardReason === null) throw new Error("missing discovery card reason");
      expect(cardReason.textContent).toContain("Discovery endpoint checked");
      expect(cardReason.textContent).toContain(why);
      expect(cardReason.textContent).not.toContain(remedy);

      const trigger = actionButton(container, "discovery");
      expect(trigger).not.toBeNull();
      if (trigger === null) throw new Error("missing discovery trigger");
      await act(() => {
        reactClick(trigger);
      });
      await waitForText(doc.body, "Raw JSON");

      const summary = firstByAttr(doc.body, "data-area-panel", "summary");
      expect(summary).not.toBeNull();
      if (summary === null) throw new Error("missing area modal summary panel");
      expect(summary.textContent).toContain("Discovery endpoint checked");
      expect(summary.textContent).toContain(why);
      expect(summary.textContent).not.toContain(remedy);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });
});

async function waitForDom(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for a DOM condition");
    }
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
      });
    });
  }
}

describe("ResultsShell area detail modal focus restoration", () => {
  beforeAll(async () => {
    await registerHappyDom();
  });

  afterAll(() => {
    teardownHappyDom();
  });

  // Test-only focus harness for the deferred-restore ordering.
  //
  // 1. Inert focus guard: real browsers refuse focus on an element inside an
  //    [inert] subtree, but happy-dom does not enforce it. Wrapping focus so a
  //    target under [inert] is a no-op keeps the browser invariant honest and
  //    guards against a restore that lands before OverlayFrame's inert cleanup.
  //
  // 2. Zero-delay timer control: React (via act) flushes OverlayFrame's passive
  //    inert cleanup and drains microtasks before the test regains control, so a
  //    plain outcome check cannot tell a microtask restore from a setTimeout(0)
  //    restore. To expose the difference, while `captureImmediateTimers` is set
  //    we capture zero-delay timers (ResultsShell's deferred focus restore)
  //    instead of scheduling them, and run them explicitly with
  //    flushImmediateTimers(). React's scheduler uses MessageChannel, so its
  //    cleanup still runs; only the deferred focus is held. Under the old
  //    queueMicrotask timing no zero-delay timer is scheduled and the restore
  //    runs during the act() microtask drain, so the "restore has not run yet"
  //    assertions fail; the setTimeout(0) restore stays captured until flushed
  //    and passes. Non-zero timers (waitForDom, copy notices) pass through.
  //
  // The harness is installed per test and fully restored in afterEach so no
  // other describe is affected.
  let restoreFocusHarness: (() => void) | null = null;
  let captureImmediateTimers = false;
  let pendingImmediateTimers: Array<() => void> = [];

  function flushImmediateTimers(): void {
    const queued = pendingImmediateTimers;
    pendingImmediateTimers = [];
    for (const run of queued) {
      run();
    }
  }

  beforeEach(() => {
    const originalFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function guardedFocus(
      this: HTMLElement,
      options?: FocusOptions,
    ): void {
      if (this.closest("[inert]") !== null) {
        return;
      }
      originalFocus.call(this, options);
    };

    const realSetTimeout = globalThis.setTimeout;
    type TimerReturn = ReturnType<typeof globalThis.setTimeout>;
    const callRealSetTimeout = realSetTimeout as unknown as (
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => TimerReturn;
    const patchedSetTimeout = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ): TimerReturn => {
      if (captureImmediateTimers && typeof handler === "function" && (timeout ?? 0) === 0) {
        pendingImmediateTimers.push(() => {
          (handler as (...callbackArgs: unknown[]) => void)(...args);
        });
        return 0 as unknown as TimerReturn;
      }
      return callRealSetTimeout(handler, timeout, ...args);
    }) as unknown as typeof globalThis.setTimeout;
    globalThis.setTimeout = patchedSetTimeout;

    restoreFocusHarness = () => {
      HTMLElement.prototype.focus = originalFocus;
      globalThis.setTimeout = realSetTimeout;
    };
  });

  afterEach(() => {
    captureImmediateTimers = false;
    pendingImmediateTimers = [];
    restoreFocusHarness?.();
    restoreFocusHarness = null;
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
  });

  test("Escape closes the area modal and restores focus to the trigger", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification(() => "pass")),
    );
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes(RESULT_HEADLINE.compatible) === true,
      );

      const trigger = document.querySelector<HTMLButtonElement>(
        'button#area-card-discovery-action',
      );
      if (trigger === null) {
        throw new Error("missing discovery View details button");
      }
      act(() => {
        trigger.focus();
      });
      expect(document.activeElement).toBe(trigger);

      await act(() => {
        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(() => document.querySelector("[data-overlay-frame-root]") !== null);
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      if (dialog === null) {
        throw new Error("missing dialog after opening the area modal");
      }
      expect(document.activeElement === trigger).toBe(false);

      await act(() => {
        dialog.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => document.querySelector("[data-overlay-frame-root]") === null);

      expect(document.querySelector("[data-overlay-frame-root]")).toBeNull();
      // Focus restoration is deferred to a macrotask that runs after
      // OverlayFrame removes inert, so await it rather than asserting inline.
      await waitForDom(() => document.activeElement === trigger);
      expect(document.activeElement).toBe(trigger);
      // The trigger sits outside any inert subtree once OverlayFrame cleaned up.
      // A restore that fired while the body was still inert would leave the
      // trigger inside an inert ancestor, so this assertion fails for the old
      // microtask timing.
      expect(trigger.closest("[inert]")).toBeNull();
      await act(() => {
        root.unmount();
      });
    } finally {
      restoreFetch();
    }
  });

  test("ID-based restore returns focus to the area trigger after close", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification(() => "pass")),
    );
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes(RESULT_HEADLINE.compatible) === true,
      );

      const trigger = document.querySelector<HTMLButtonElement>(
        "button#area-card-discovery-action",
      );
      if (trigger === null) {
        throw new Error("missing discovery View details button");
      }

      // Focus a control other than the trigger before opening so OverlayFrame
      // captures that element as its synchronous restore target. The deferred
      // ID-based restore must still return focus to the discovery trigger by its
      // area-id ref map after OverlayFrame's cleanup, proving the deferred
      // restore wins over OverlayFrame's captured element. Without the ID-based
      // restore, focus would land on the copy button here.
      const copyButton = Array.from(
        document.querySelectorAll<HTMLButtonElement>("button"),
      ).find((node) => node.textContent === "Copy page link");
      if (copyButton === undefined) {
        throw new Error("missing Copy page link button");
      }
      act(() => {
        copyButton.focus();
      });
      expect(document.activeElement).toBe(copyButton);

      await act(() => {
        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(() => document.querySelector("[data-overlay-frame-root]") !== null);
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      if (dialog === null) {
        throw new Error("missing dialog after opening the area modal");
      }

      // Capture zero-delay timers during the close so the deferred focus restore
      // is held instead of running. React's MessageChannel-scheduled cleanup
      // still runs inside act(): it removes inert and restores its captured
      // element (the copy button).
      captureImmediateTimers = true;
      await act(() => {
        dialog.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
      });
      captureImmediateTimers = false;

      const restored = document.querySelector<HTMLButtonElement>(
        "button#area-card-discovery-action",
      );
      // The deferred setTimeout(0) restore is still captured, so focus is on
      // OverlayFrame's captured element (the copy button), not the trigger. The
      // old queueMicrotask timing would have run during the act() microtask drain
      // and already moved focus to the trigger, so these assertions fail for that
      // timing while they hold for the deferred setTimeout(0) restore. Identity
      // is compared as a boolean so a regression prints true/false rather than
      // serializing the whole happy-dom node tree.
      expect(document.querySelector("[data-overlay-frame-root]")).toBeNull();
      expect(document.activeElement === copyButton).toBe(true);
      expect(document.activeElement === trigger).toBe(false);

      // Run the deferred restore: it wins over OverlayFrame's captured element
      // and moves focus to the discovery trigger by its area-id ref map.
      flushImmediateTimers();
      await act(() => {});
      expect(document.activeElement === restored).toBe(true);
      expect(document.activeElement === copyButton).toBe(false);
      // The restored trigger is outside any inert subtree; a restore that fired
      // while the body was still inert would leave it inside an inert ancestor.
      expect(restored?.closest("[inert]") ?? null).toBeNull();
      await act(() => {
        root.unmount();
      });
    } finally {
      restoreFetch();
    }
  });

  test("grid-heading fallback focuses the heading when the trigger ref is unavailable", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification(() => "pass")),
    );
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes(RESULT_HEADLINE.compatible) === true,
      );

      const trigger = document.querySelector<HTMLButtonElement>(
        "button#area-card-discovery-action",
      );
      if (trigger === null) {
        throw new Error("missing discovery View details button");
      }
      act(() => {
        trigger.focus();
      });

      await act(() => {
        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(() => document.querySelector("[data-overlay-frame-root]") !== null);
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      if (dialog === null) {
        throw new Error("missing dialog after opening the area modal");
      }

      // Detach the discovery trigger node before close. React still holds this
      // exact node in its area-id ref map because a manual DOM removal does not
      // notify React, so on close the stored ref is present but disconnected.
      // This is how the test simulates an unavailable trigger lookup in
      // happy-dom: btn.isConnected is false, so the restore falls through to the
      // grid heading.
      trigger.remove();

      // Capture the grid heading before close so the ordering checkpoint below
      // can assert the deferred fallback focus has not run yet.
      const heading = Array.from(
        document.querySelectorAll<HTMLHeadingElement>("h2"),
      ).find((node) => node.textContent === "What was tested");
      expect(heading).not.toBeUndefined();
      if (heading === undefined) {
        throw new Error("missing grid heading");
      }

      // Capture zero-delay timers during the close so the deferred fallback
      // focus is held instead of running. The captured trigger is disconnected,
      // so OverlayFrame's cleanup restores nothing during act().
      captureImmediateTimers = true;
      await act(() => {
        dialog.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
      });
      captureImmediateTimers = false;

      // The deferred setTimeout(0) fallback is still captured, so the heading is
      // not focused yet. The old queueMicrotask timing would have focused the
      // heading during the act() microtask drain, so this ordering assertion
      // fails for that timing while it holds for the deferred setTimeout(0)
      // fallback. Identity is compared as a boolean so a regression prints
      // true/false rather than serializing the whole happy-dom node tree.
      expect(document.querySelector("[data-overlay-frame-root]")).toBeNull();
      expect(document.activeElement === heading).toBe(false);

      // Run the deferred fallback: with the trigger ref gone, focus lands on the
      // grid heading.
      flushImmediateTimers();
      await act(() => {});
      expect(document.activeElement === heading).toBe(true);
      // The heading is outside any inert subtree; a restore that fired while the
      // body was still inert would leave it inside an inert ancestor.
      expect(heading.closest("[inert]")).toBeNull();
      await act(() => {
        root.unmount();
      });
    } finally {
      restoreFetch();
    }
  });
});

function pageLinkButton(): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (node) => node.textContent === "Copy page link",
  );
  if (button === undefined) {
    throw new Error("missing Copy page link button");
  }
  return button;
}

function activeViewOf(state: string, nextInstruction?: string): ReturnType<typeof resolveValidatorMachine> {
  return resolveValidatorMachine({ state, optInActive: true, nextInstruction });
}

describe("stripBracketedMarkers", () => {
  test("removes bracketed planning markers and collapses the surrounding whitespace", () => {
    expect(stripBracketedMarkers("Paste the outgoing invite [wip]")).toBe(
      "Paste the outgoing invite",
    );
    expect(stripBracketedMarkers("[todo] Wait for the reverse invite start")).toBe(
      "Wait for the reverse invite start",
    );
    expect(stripBracketedMarkers("Keep [one] and [two] out")).toBe("Keep and out");
  });

  test("leaves marker-free copy exactly as-is", () => {
    expect(stripBracketedMarkers("No markers here")).toBe("No markers here");
  });
});

describe("sanitizeGuidanceRecord bracket stripping", () => {
  test("returns null unchanged", () => {
    expect(sanitizeGuidanceRecord(null)).toBeNull();
  });

  test("strips bracketed markers from an instruction record's title and body", () => {
    const record = guidanceFor("paste_s1");
    expect(record).not.toBeNull();
    if (record === null || record.kind !== "instruction") {
      throw new Error("expected paste_s1 instruction guidance");
    }
    const marked = {
      ...record,
      title: `[wip] ${record.title}`,
      body: `${record.body} [todo]`,
    };
    const sanitized = sanitizeGuidanceRecord(marked);
    expect(sanitized).not.toBeNull();
    if (sanitized === null || sanitized.kind !== "instruction") {
      throw new Error("expected a sanitized instruction guidance record");
    }
    expect(sanitized.title).toBe(record.title);
    expect(sanitized.body).toBe(record.body);
  });

  test("strips bracketed markers from a terminal record's body, leaving other fields alone", () => {
    const record = guidanceFor("terminal_pass");
    expect(record).not.toBeNull();
    if (record === null || record.kind !== "terminal") {
      throw new Error("expected terminal_pass terminal guidance");
    }
    const marked = { ...record, body: `[wip] ${record.body}` };
    const sanitized = sanitizeGuidanceRecord(marked);
    expect(sanitized).not.toBeNull();
    expect(sanitized?.kind).toBe("terminal");
    expect(sanitized?.body).toBe(record.body);
  });

  test("leaves marker-free guidance exactly as-is", () => {
    const record = guidanceFor("wait_probe");
    expect(record).not.toBeNull();
    expect(sanitizeGuidanceRecord(record)).toEqual(record);
  });
});

describe("progressAnnouncement title selection", () => {
  test("uses the guidance title for a known current instruction, not its body", () => {
    const view = activeViewOf("invite_minted", "paste_s1");
    const text = progressAnnouncement(view, "paste_s1");
    expect(text).toBe("Step 3 of 6: Paste the outgoing invite");
    expect(text).not.toContain("Use Copy invitation");
  });

  test("falls back to STEP_ANNOUNCE when there is no guidance for an omitted key", () => {
    const view = resolveValidatorMachine({ state: "created", optInActive: false });
    const text = progressAnnouncement(view, null);
    expect(text).toBe("Step 1 of 3: Checking server capabilities.");
  });

  test("uses the unknown-key title for a persistent raw unknown key", () => {
    const view = activeViewOf("invite_minted", "paste_s1");
    const text = progressAnnouncement(view, "not_a_real_step");
    expect(text).toBe(`Step 3 of 6: ${UNKNOWN_GUIDANCE_TITLE}`);
  });
});

describe("stabilizeLiveView one-poll hold", () => {
  test("a genuine instruction passes through as-is and becomes the new hold anchor", () => {
    const view = activeViewOf("invite_minted", "paste_s1");
    const { stabilized, hold } = stabilizeLiveView(view, "paste_s1", INITIAL_LIVE_INSTRUCTION_HOLD);
    expect(stabilized.view).toBe(view);
    expect(stabilized.guidanceKey).toBe("paste_s1");
    expect(hold).toEqual({ lastValidView: view, lastValidKey: "paste_s1", held: false });
  });

  test("the first omitted instruction after a genuine one holds the last valid view and key for one poll", () => {
    const validView = activeViewOf("invite_minted", "paste_s1");
    const seeded = stabilizeLiveView(validView, "paste_s1", INITIAL_LIVE_INSTRUCTION_HOLD).hold;
    const omittedView = activeViewOf("invite_minted");
    const { stabilized, hold } = stabilizeLiveView(omittedView, undefined, seeded);
    expect(stabilized.view).toBe(validView);
    expect(stabilized.guidanceKey).toBe("paste_s1");
    expect(hold.held).toBe(true);
    expect(hold.lastValidView).toBe(validView);
  });

  test("the first unknown instruction after a genuine one holds the same way", () => {
    const validView = activeViewOf("invite_minted", "paste_s1");
    const seeded = stabilizeLiveView(validView, "paste_s1", INITIAL_LIVE_INSTRUCTION_HOLD).hold;
    const unknownView = activeViewOf("invite_minted", "not_a_real_step");
    const { stabilized, hold } = stabilizeLiveView(unknownView, "not_a_real_step", seeded);
    expect(stabilized.view).toBe(validView);
    expect(stabilized.guidanceKey).toBe("paste_s1");
    expect(hold.held).toBe(true);
  });

  test("a following valid instruction after the hold replaces it normally instead of extending the hold", () => {
    const validView = activeViewOf("invite_minted", "paste_s1");
    const seeded = stabilizeLiveView(validView, "paste_s1", INITIAL_LIVE_INSTRUCTION_HOLD).hold;
    const held = stabilizeLiveView(activeViewOf("invite_minted"), undefined, seeded).hold;
    const nextValidView = activeViewOf("invite_accepted", "wait_reverse_start");
    const { stabilized, hold } = stabilizeLiveView(nextValidView, "wait_reverse_start", held);
    expect(stabilized.view).toBe(nextValidView);
    expect(stabilized.guidanceKey).toBe("wait_reverse_start");
    expect(hold).toEqual({
      lastValidView: nextValidView,
      lastValidKey: "wait_reverse_start",
      held: false,
    });
  });

  test("a persistent unknown string after the hold is spent shows the unknown-key fallback but keeps the last safe view and cadence", () => {
    const validView = activeViewOf("invite_minted", "paste_s1");
    const seeded = stabilizeLiveView(validView, "paste_s1", INITIAL_LIVE_INSTRUCTION_HOLD).hold;
    const unknownView = activeViewOf("invite_minted", "not_a_real_step");
    const heldOnce = stabilizeLiveView(unknownView, "not_a_real_step", seeded);
    expect(heldOnce.hold.held).toBe(true);
    const persistent = stabilizeLiveView(unknownView, "not_a_real_step", heldOnce.hold);
    expect(persistent.stabilized.view).toBe(validView);
    expect(persistent.stabilized.view.pollIntervalMs).toBe(validView.pollIntervalMs);
    expect(persistent.stabilized.guidanceKey).toBe("not_a_real_step");
    const unknownRecord = guidanceFor(persistent.stabilized.guidanceKey);
    expect(unknownRecord).not.toBeNull();
    if (unknownRecord === null || unknownRecord.kind !== "instruction") {
      throw new Error("expected the unknown-key fallback to be instruction guidance");
    }
    expect(unknownRecord.title).toBe(UNKNOWN_GUIDANCE_TITLE);
  });

  test("a persistent omitted instruction after the hold is spent has no guidance key left for STEP_ANNOUNCE to fall back on", () => {
    const validView = activeViewOf("invite_minted", "paste_s1");
    const seeded = stabilizeLiveView(validView, "paste_s1", INITIAL_LIVE_INSTRUCTION_HOLD).hold;
    const omittedView = activeViewOf("invite_minted");
    const heldOnce = stabilizeLiveView(omittedView, undefined, seeded);
    const persistent = stabilizeLiveView(omittedView, undefined, heldOnce.hold);
    expect(persistent.stabilized.view).toBe(validView);
    expect(persistent.stabilized.guidanceKey).toBeNull();
  });

  test("a terminal poll always wins immediately, even mid-hold, and clears the hold state", () => {
    const validView = activeViewOf("invite_minted", "paste_s1");
    const seeded = stabilizeLiveView(validView, "paste_s1", INITIAL_LIVE_INSTRUCTION_HOLD).hold;
    const heldOnce = stabilizeLiveView(activeViewOf("invite_minted"), undefined, seeded).hold;
    const terminalView = resolveValidatorMachine({ state: "terminal_pass", optInActive: true });
    const { stabilized, hold } = stabilizeLiveView(terminalView, undefined, heldOnce);
    expect(stabilized.view).toBe(terminalView);
    expect(stabilized.guidanceKey).toBeNull();
    expect(hold).toEqual(INITIAL_LIVE_INSTRUCTION_HOLD);
  });

  test("an omitted or unknown instruction with no prior valid instruction cannot hold and is exposed as-is", () => {
    const view = resolveValidatorMachine({ state: "created", optInActive: false });
    const { stabilized, hold } = stabilizeLiveView(view, undefined, INITIAL_LIVE_INSTRUCTION_HOLD);
    expect(stabilized.view).toBe(view);
    expect(stabilized.guidanceKey).toBeNull();
    expect(hold).toBe(INITIAL_LIVE_INSTRUCTION_HOLD);
  });

  test("keeps the raw unknown key separate from the machine view's narrowed null instruction", () => {
    const view = activeViewOf("invite_minted", "not_a_real_step");
    expect(view.instruction).toBeNull();
    const { stabilized } = stabilizeLiveView(view, "not_a_real_step", INITIAL_LIVE_INSTRUCTION_HOLD);
    expect(stabilized.guidanceKey).toBe("not_a_real_step");
    expect(stabilized.guidanceKey).not.toBe(view.instruction);
  });
});

function installActiveInviteFetch(options?: {
  origin?: string;
  liveReportExtra?: Partial<ReportResponse>;
}): () => void {
  const origin = options?.origin ?? API_ORIGIN;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("config.json")) {
      return jsonResponse(200, {
        poll_interval_ms: 1,
        active_poll_interval_ms: 1,
        backoff_initial_ms: 1,
        backoff_max_ms: 1,
        request_timeout_ms: 5000,
        validator_api_origin: origin,
      });
    }
    if (url.includes(`/api/session/${SESSION_ID}`)) {
      return jsonResponse(200, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(
        200,
        liveReport(specification(() => "pass"), options?.liveReportExtra ?? {}),
      );
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

/**
 * Deterministic poll-tick queue for the session polling endpoint. Each call
 * from the mocked fetch registers a pending resolver instead of returning a
 * response immediately, so the test controls exactly when each poll's data
 * is delivered. This replaces wall-clock-dependent pollCount windows and
 * waitForDom sampling with an explicit "poll tick" the test drives directly:
 * a call cannot resolve until the test releases it, so no later poll can
 * ever race ahead of an assertion about an earlier one.
 */
class SessionPollGate {
  private callCount = 0;
  private readonly pendingResolvers = new Map<number, (response: Response) => void>();
  private readonly callWaiters = new Map<number, () => void>();

  request(): Promise<Response> {
    this.callCount += 1;
    const call = this.callCount;
    return new Promise<Response>((resolve) => {
      this.pendingResolvers.set(call, resolve);
      const waiter = this.callWaiters.get(call);
      if (waiter !== undefined) {
        this.callWaiters.delete(call);
        waiter();
      }
    });
  }

  async awaitCall(n: number): Promise<void> {
    if (this.callCount >= n) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.callWaiters.set(n, resolve);
    });
  }

  respond(n: number, body: unknown, status = 200): void {
    const resolve = this.pendingResolvers.get(n);
    if (resolve === undefined) {
      throw new Error(`SessionPollGate: poll call ${n} is not pending yet`);
    }
    this.pendingResolvers.delete(n);
    resolve(jsonResponse(status, body));
  }

  /** Settle any still-pending call harmlessly so nothing is left dangling
   * after a test unmounts (and aborts the loop) with a call still gated. */
  settleRemaining(): void {
    for (const [call, resolve] of this.pendingResolvers) {
      resolve(jsonResponse(200, { state: "terminal_pass", ts: call, optInActive: false }));
    }
    this.pendingResolvers.clear();
  }

  get calls(): number {
    return this.callCount;
  }
}

/**
 * Release poll call `callNumber` with `body`, then wait for the loop to
 * reach call `callNumber + 1` before returning. Because the next call only
 * happens after this poll's state updates, any due report fetch, and the
 * cadence wait have all completed, the DOM is guaranteed settled for call
 * `callNumber` by the time this resolves (no arbitrary poll or deadline).
 */
async function releasePoll(gate: SessionPollGate, callNumber: number, body: unknown): Promise<void> {
  await act(async () => {
    await gate.awaitCall(callNumber);
    gate.respond(callNumber, body);
    await gate.awaitCall(callNumber + 1);
  });
}

/**
 * Release a poll that ends the loop (typically terminal) and that makes no
 * further session poll call. There is no next call to await, so this flushes
 * a bounded number of microtask and macrotask turns instead, giving the
 * terminal report fetch and resulting state commits room to settle. The
 * bound is a fixed step count, not a wall-clock deadline, so it cannot pass
 * or fail depending on how fast the machine is.
 */
async function releaseFinalPoll(gate: SessionPollGate, callNumber: number, body: unknown): Promise<void> {
  await act(async () => {
    await gate.awaitCall(callNumber);
    gate.respond(callNumber, body);
    for (let i = 0; i < 25; i += 1) {
      await Promise.resolve();
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 25; i += 1) {
      await Promise.resolve();
    }
  });
}

/**
 * Locate the single live status announcement by its exact role and
 * aria-live pairing, isolated from aggregate body text so an assertion here
 * can never accidentally pass because a guidance row happens to contain the
 * same words.
 */
function findAnnouncement(): Element | undefined {
  return Array.from(document.querySelectorAll('p[role="status"][aria-live="polite"]')).find(
    (el) => /^Step \d+ of \d+: /.test(el.textContent ?? ""),
  );
}

function currentGuidanceText(): string {
  return document.querySelector('[aria-current="step"] [data-guidance-slot]')?.textContent ?? "";
}

/**
 * AG-2.8 lock: paste where-copy stays provider-neutral. Host-appended
 * strings, provider names, endpoints, and planning markers must not appear
 * in the rendered guidance body (or in the reserved form/invite slots).
 */
function expectProviderNeutralWhereCopy(text: string, host: string): void {
  expect(text).not.toContain("{host}");
  expect(text).not.toContain("Accept it on");
  const lower = text.toLowerCase();
  expect(lower).not.toContain(host.toLowerCase());
  expect(lower).not.toContain("nextcloud");
  expect(lower).not.toContain("owncloud");
  expect(lower).not.toContain("cernbox");
  expect(lower).not.toContain("ocis");
  expect(text).not.toMatch(/https?:\/\//);
  expect(text).not.toContain("/invite");
  expect(text).not.toContain("/ocm/");
  expect(text).not.toContain("[wip]");
  expect(text).not.toContain("[todo]");
  expect(text).not.toContain("AG-1");
  expect(text).not.toContain("AG-2");
  expect(text).not.toContain("P7");
}

describe("ResultsShell current-row guidance, announce, and reserved slots", () => {
  beforeAll(async () => {
    await registerHappyDom("http://localhost/?host=peer.example&id=" + SESSION_ID);
  });

  afterAll(() => {
    teardownHappyDom();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
  });

  test("renders guidance title and body only on the current row, and nothing on the others", async () => {
    const restoreFetch = installActiveInviteFetch();
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes("Paste the outgoing invite") === true,
      );

      const slots = Array.from(document.querySelectorAll("[data-guidance-slot]"));
      expect(slots.length).toBe(6);
      const currentSlot = slots.find((el) =>
        el.textContent?.includes("Paste the outgoing invite"),
      );
      expect(currentSlot).toBeDefined();
      expect(currentSlot?.textContent).toContain(
        "Use Copy invitation, then accept that invitation on the target server under test.",
      );
      const otherSlots = slots.filter((el) => el !== currentSlot);
      expect(otherSlots.length).toBe(5);
      for (const slot of otherSlots) {
        expect(slot.textContent).toBe("");
      }
    } finally {
      // Always unmount, even if an assertion above throws, so a failing run
      // cannot leave the root mounted or a poll loop running past this test.
      await act(() => {
        root.unmount();
      });
      restoreFetch();
    }
  });

  test("locks provider-neutral paste_s1 and paste_s2 where-copy on the current row", async () => {
    const host = "peer.example";
    const pasteS1 = guidanceFor("paste_s1");
    const pasteS2 = guidanceFor("paste_s2");
    expect(pasteS1).not.toBeNull();
    expect(pasteS2).not.toBeNull();
    if (pasteS1 === null || pasteS1.kind !== "instruction") {
      throw new Error("expected paste_s1 instruction guidance");
    }
    if (pasteS2 === null || pasteS2.kind !== "instruction") {
      throw new Error("expected paste_s2 instruction guidance");
    }

    const gate = new SessionPollGate();
    const restoreFetch = installGatedSessionFetch(gate);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host={host} id={SESSION_ID} />);
      });

      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      const pasteS1Text = currentGuidanceText();
      expect(pasteS1Text).toContain(pasteS1.body);
      expect(pasteS1Text).toContain("target server under test");
      expectProviderNeutralWhereCopy(pasteS1Text, host);
      expect(document.querySelector("[data-reserved-form-slot]")).not.toBeNull();
      expect(document.querySelector("[data-reserved-alert-slot]")).not.toBeNull();

      await releasePoll(gate, 2, {
        state: "reverse_awaiting_invite",
        ts: 2,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
      const pasteS2Text = currentGuidanceText();
      expect(pasteS2Text).toContain(pasteS2.body);
      expectProviderNeutralWhereCopy(pasteS2Text, host);
      expectProviderNeutralWhereCopy(
        document.querySelector("[data-reserved-form-slot]")?.textContent ?? "",
        host,
      );
      expect(document.querySelector("[data-reserved-form-slot]")).not.toBeNull();
      expect(document.querySelector("[data-reserved-alert-slot]")).not.toBeNull();
      expect(document.querySelector("[data-reverse-form]")).not.toBeNull();
    } finally {
      await act(() => {
        root.unmount();
      });
      gate.settleRemaining();
      restoreFetch();
    }
  });

  test("the single announcement renders Step N of M with the guidance title only, no body", async () => {
    const restoreFetch = installActiveInviteFetch();
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes("Paste the outgoing invite") === true,
      );

      const announce = Array.from(document.querySelectorAll('p[role="status"]')).find((el) =>
        /^Step \d+ of \d+: /.test(el.textContent ?? ""),
      );
      expect(announce).toBeDefined();
      expect(announce?.textContent).toBe("Step 3 of 6: Paste the outgoing invite");
      expect(announce?.getAttribute("aria-live")).toBe("polite");
      expect(announce?.textContent).not.toContain("Use Copy invitation");
    } finally {
      // Always unmount, even if an assertion above throws, so a failing run
      // cannot leave the root mounted or a poll loop running past this test.
      await act(() => {
        root.unmount();
      });
      restoreFetch();
    }
  });

  test("reserves the CTA column inside StepRow's own in-row slot, not a ResultsShell sibling", async () => {
    const restoreFetch = installActiveInviteFetch();
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes("Paste the outgoing invite") === true,
      );

      // No vertical CTA sibling exists; the reservation lives inside
      // StepRow's own horizontal data-cta-slot column instead.
      expect(document.querySelector("[data-reserved-cta-slot]")).toBeNull();

      const ctaSlots = Array.from(document.querySelectorAll("[data-cta-slot]"));
      expect(ctaSlots.length).toBe(6);
      const currentCard = document.querySelector('[aria-current="step"]');
      expect(currentCard).not.toBeNull();
      const currentCtaSlot = currentCard?.querySelector("[data-cta-slot]");
      expect(currentCtaSlot).not.toBeNull();
      expect(currentCtaSlot?.className).toContain("min-w-[10rem]");
      // Copy/paste actions stay unwired. The current row shows the live
      // View report secondary link when the API origin is real; other
      // rows keep the reserved empty column.
      const liveLink = Array.from(currentCtaSlot?.querySelectorAll("a") ?? []).find(
        (el) => el.textContent === "View report",
      );
      expect(liveLink).toBeDefined();
      expect(currentCtaSlot?.getAttribute("aria-hidden")).toBeNull();
      for (const slot of ctaSlots) {
        if (slot === currentCtaSlot) {
          continue;
        }
        expect(slot.getAttribute("aria-hidden")).toBe("true");
        expect(slot.textContent).toBe("");
      }
    } finally {
      // Always unmount, even if an assertion above throws, so a failing run
      // cannot leave the root mounted or a poll loop running past this test.
      await act(() => {
        root.unmount();
      });
      restoreFetch();
    }
  });

  test("always mounts a reserved form slot on the reverse card while live and active steps are visible, sized beyond min-h-10", async () => {
    const restoreFetch = installActiveInviteFetch();
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes("Paste the outgoing invite") === true,
      );

      // The invite row is current, not reverse, so this confirms the form
      // slot is mounted for the whole active phase, not only when reverse
      // itself is the current row.
      const formSlot = document.querySelector("[data-reserved-form-slot]");
      expect(formSlot).not.toBeNull();
      expect(formSlot?.getAttribute("aria-hidden")).toBe("true");
      expect(formSlot?.className).toContain("min-h-56");
      expect(formSlot?.className).not.toContain("min-h-10 ");
      expect(formSlot?.className).not.toBe("min-h-10");

      // The form slot must be mounted inside the reverse row's own card, not
      // merely present somewhere in the tree. StepRow renders formSlot as a
      // direct child of its own root card, alongside that row's
      // data-guidance-slot, so the parent of one is the parent of the other.
      const guidanceSlots = Array.from(document.querySelectorAll("[data-guidance-slot]"));
      const reverseCard = guidanceSlots
        .map((slot) => slot.parentElement)
        .find((card) => card?.textContent?.includes("Accept return invitation") === true);
      expect(reverseCard).toBeDefined();
      expect(reverseCard).not.toBeNull();
      expect(formSlot?.parentElement).toBe(reverseCard);
      expect(reverseCard?.contains(formSlot as Node)).toBe(true);

      // No other row's card mounts the form slot: it is reverse-only.
      const otherCards = guidanceSlots
        .map((slot) => slot.parentElement)
        .filter((card) => card !== reverseCard);
      expect(otherCards.length).toBe(5);
      for (const card of otherCards) {
        expect(card?.contains(formSlot as Node)).toBe(false);
      }
    } finally {
      // Always unmount, even if an assertion above throws, so a failing run
      // cannot leave the root mounted or a poll loop running past this test.
      await act(() => {
        root.unmount();
      });
      restoreFetch();
    }
  });

  test("mounts no reserved form slot or CTA slot once the result reaches a terminal state", async () => {
    const restoreFetch = installTerminalReportFetch(permanentReport(specification(() => "pass")));
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => document.body.textContent?.includes(RESULT_HEADLINE.compatible) === true);
      expect(document.querySelector("[data-reserved-form-slot]")).toBeNull();
      expect(document.querySelector("[data-reserved-cta-slot]")).toBeNull();
      expect(document.querySelector("[data-cta-slot]")).toBeNull();
    } finally {
      // Always unmount, even if an assertion above throws, so a failing run
      // cannot leave the root mounted or a poll loop running past this test.
      await act(() => {
        root.unmount();
      });
      restoreFetch();
    }
  });

  test("holds the current-row title for one poll on an omitted instruction, falls back to the unknown-key title if it persists, resumes normally, and lets terminal win immediately even mid-hold", async () => {
    const gate = new SessionPollGate();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("config.json")) {
        return jsonResponse(200, {
          poll_interval_ms: 1,
          active_poll_interval_ms: 1,
          backoff_initial_ms: 1,
          backoff_max_ms: 1,
          request_timeout_ms: 5000,
          validator_api_origin: API_ORIGIN,
        });
      }
      if (url.includes(`/api/session/${SESSION_ID}`)) {
        return gate.request();
      }
      if (url.includes(`/api/report/${SESSION_ID}`)) {
        return jsonResponse(200, liveReport(specification(() => "pass")));
      }
      return jsonResponse(404, { error: "missing", message: "missing" });
    }) as typeof fetch;

    setWindowHref(`https://localhost/?host=peer.example&id=${SESSION_ID}&ro=1`);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      // Poll 1: a genuine instruction seeds the hold with a real title.
      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      const announceAfterPoll1 = findAnnouncement();
      expect(announceAfterPoll1).toBeDefined();
      expect(announceAfterPoll1?.textContent).toBe("Step 3 of 6: Paste the outgoing invite");
      expect(announceAfterPoll1?.textContent).not.toContain("Use Copy invitation");
      expect(document.body.textContent).not.toContain(UNKNOWN_GUIDANCE_TITLE);

      // Poll 2: omitted nextInstruction. Held for exactly this one poll: the
      // title must still read the last valid instruction, not fall back yet.
      await releasePoll(gate, 2, { state: "invite_minted", ts: 2, optInActive: true });
      expect(document.body.textContent).toContain("Paste the outgoing invite");
      expect(document.body.textContent).not.toContain(UNKNOWN_GUIDANCE_TITLE);

      // Poll 3: the one-poll grace is already spent, and this poll is now an
      // unrecognized key, so the current row falls back to the unknown-key
      // title while still anchored on the invite row (not reset to probe).
      await releasePoll(gate, 3, {
        state: "invite_minted",
        ts: 3,
        optInActive: true,
        nextInstruction: "not_a_real_step",
      });
      expect(document.body.textContent).toContain(UNKNOWN_GUIDANCE_TITLE);
      const slotsDuringFallback = Array.from(document.querySelectorAll("[data-guidance-slot]"));
      const activeSlot = slotsDuringFallback.find((el) =>
        el.textContent?.includes(UNKNOWN_GUIDANCE_TITLE),
      );
      expect(activeSlot).toBeDefined();

      // Poll 4: a following valid instruction replaces the fallback normally.
      await releasePoll(gate, 4, {
        state: "invite_minted",
        ts: 4,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      expect(document.body.textContent).toContain("Paste the outgoing invite");
      expect(document.body.textContent).not.toContain(UNKNOWN_GUIDANCE_TITLE);

      // Poll 5: omitted again, starting a fresh one-poll hold anchored on
      // poll 4's instruction.
      await releasePoll(gate, 5, { state: "invite_minted", ts: 5, optInActive: true });
      expect(document.body.textContent).toContain("Paste the outgoing invite");

      // Poll 6: terminal wins immediately even mid-hold (held is true from
      // poll 5) and is never held behind the stale invite guidance.
      await releaseFinalPoll(gate, 6, { state: "terminal_pass", ts: 6, optInActive: true });
      expect(document.body.textContent).not.toContain("Paste the outgoing invite");
      expect(document.body.textContent).not.toContain(UNKNOWN_GUIDANCE_TITLE);
      expect(document.body.textContent).toContain(RESULT_HEADLINE.compatible);
      expect(gate.calls).toBe(6);
    } finally {
      // Always unmount (aborting the poll loop), settle any still-gated
      // poll call, and restore fetch, even if an assertion above throws, so
      // a failing run cannot leave the loop or a dangling fetch mock running
      // past this test.
      await act(async () => {
        root.unmount();
      });
      gate.settleRemaining();
      globalThis.fetch = previousFetch;
    }
  });

  test("a live (non-read-only) session keeps polling at the last safe cadence through a persistent unknown instruction instead of halting", async () => {
    const gate = new SessionPollGate();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("config.json")) {
        return jsonResponse(200, {
          poll_interval_ms: 1,
          active_poll_interval_ms: 1,
          backoff_initial_ms: 1,
          backoff_max_ms: 1,
          request_timeout_ms: 5000,
          validator_api_origin: API_ORIGIN,
        });
      }
      if (url.includes(`/api/session/${SESSION_ID}`)) {
        return gate.request();
      }
      if (url.includes(`/api/report/${SESSION_ID}`)) {
        return jsonResponse(200, liveReport(specification(() => "pass")));
      }
      return jsonResponse(404, { error: "missing", message: "missing" });
    }) as typeof fetch;

    // No ?ro=1: this is the normal, non-read-only polling path.
    setWindowHref(`https://localhost/?host=peer.example&id=${SESSION_ID}`);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      // Poll 1: a genuine instruction establishes a safe live cadence.
      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      expect(document.body.textContent).toContain("Paste the outgoing invite");

      // Poll 2: omitted. Spends the one-poll hold (title stays put).
      await releasePoll(gate, 2, { state: "invite_minted", ts: 2, optInActive: true });
      expect(document.body.textContent).toContain("Paste the outgoing invite");

      // Polls 3 and 4: a persistent unrecognized instruction. The loop must
      // keep polling through this stretch instead of halting once
      // continuePolling turns false; this alone is unreachable on a loop
      // that stops instead of falling back to the last safe live cadence.
      await releasePoll(gate, 3, {
        state: "invite_minted",
        ts: 3,
        optInActive: true,
        nextInstruction: "not_a_real_step",
      });
      const announceAfterPoll3 = findAnnouncement();
      expect(announceAfterPoll3).toBeDefined();
      expect(announceAfterPoll3?.textContent).toBe(`Step 3 of 6: ${UNKNOWN_GUIDANCE_TITLE}`);
      const currentSlotAfterPoll3 = Array.from(
        document.querySelectorAll("[data-guidance-slot]"),
      ).find((el) => el.textContent?.includes(UNKNOWN_GUIDANCE_TITLE));
      expect(currentSlotAfterPoll3).toBeDefined();
      expect(currentSlotAfterPoll3?.textContent).toContain("not recognized by this page");

      await releasePoll(gate, 4, {
        state: "invite_minted",
        ts: 4,
        optInActive: true,
        nextInstruction: "not_a_real_step",
      });
      const announceAfterPoll4 = findAnnouncement();
      expect(announceAfterPoll4).toBeDefined();
      expect(announceAfterPoll4?.textContent).toBe(`Step 3 of 6: ${UNKNOWN_GUIDANCE_TITLE}`);
      const currentSlotAfterPoll4 = Array.from(
        document.querySelectorAll("[data-guidance-slot]"),
      ).find((el) => el.textContent?.includes(UNKNOWN_GUIDANCE_TITLE));
      expect(currentSlotAfterPoll4).toBeDefined();
      expect(currentSlotAfterPoll4?.textContent).toContain("not recognized by this page");

      // Poll 5: it resumes the known instruction once the server sends one
      // again.
      await releasePoll(gate, 5, {
        state: "invite_minted",
        ts: 5,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      expect(document.body.textContent).toContain("Paste the outgoing invite");
      expect(document.body.textContent).not.toContain(UNKNOWN_GUIDANCE_TITLE);
      // releasePoll(gate, 5, ...) already confirmed the loop reached call 6
      // (poll 5's processing is fully settled); that next poll is still
      // gated and unreleased here.
      expect(gate.calls).toBe(6);
    } finally {
      // Always unmount (aborting the poll loop), settle any still-gated
      // poll call, and restore fetch, even if an assertion above throws, so
      // a failing run cannot leave the loop or a dangling fetch mock running
      // past this test.
      await act(async () => {
        root.unmount();
      });
      gate.settleRemaining();
      globalThis.fetch = previousFetch;
    }
  });

  test("a persistent omission (as opposed to an unknown key) shows no guidance and falls back to the step announcement", async () => {
    const gate = new SessionPollGate();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("config.json")) {
        return jsonResponse(200, {
          poll_interval_ms: 1,
          active_poll_interval_ms: 1,
          backoff_initial_ms: 1,
          backoff_max_ms: 1,
          request_timeout_ms: 5000,
          validator_api_origin: API_ORIGIN,
        });
      }
      if (url.includes(`/api/session/${SESSION_ID}`)) {
        return gate.request();
      }
      if (url.includes(`/api/report/${SESSION_ID}`)) {
        return jsonResponse(200, liveReport(specification(() => "pass")));
      }
      return jsonResponse(404, { error: "missing", message: "missing" });
    }) as typeof fetch;

    setWindowHref(`https://localhost/?host=peer.example&id=${SESSION_ID}&ro=1`);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      // Poll 1: a genuine instruction seeds the hold.
      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      expect(document.body.textContent).toContain("Paste the outgoing invite");

      // Poll 2: first omission. Held for exactly this one poll.
      await releasePoll(gate, 2, { state: "invite_minted", ts: 2, optInActive: true });
      expect(document.body.textContent).toContain("Paste the outgoing invite");

      // Poll 3: persistent omission (not an unknown key). Unlike the
      // persistent-unknown case, an omitted instruction resolves to a null
      // guidance key once the one-poll grace is spent, so the current row's
      // guidance slot is empty and the announcement falls back to
      // STEP_ANNOUNCE for the invite step, not the unknown-key title.
      await releasePoll(gate, 3, { state: "invite_minted", ts: 3, optInActive: true });
      expect(document.body.textContent).not.toContain("Paste the outgoing invite");
      expect(document.body.textContent).not.toContain(UNKNOWN_GUIDANCE_TITLE);
      const guidanceSlots = Array.from(document.querySelectorAll("[data-guidance-slot]"));
      for (const slot of guidanceSlots) {
        expect(slot.textContent).toBe("");
      }
      const announce = Array.from(document.querySelectorAll('p[role="status"]')).find((el) =>
        /^Step \d+ of \d+: /.test(el.textContent ?? ""),
      );
      expect(announce).toBeDefined();
      expect(announce?.textContent).toBe("Step 3 of 6: Waiting for invitation steps.");

      // Poll 4: a following valid instruction replaces the fallback normally.
      await releasePoll(gate, 4, {
        state: "invite_minted",
        ts: 4,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      expect(document.body.textContent).toContain("Paste the outgoing invite");
    } finally {
      await act(async () => {
        root.unmount();
      });
      gate.settleRemaining();
      globalThis.fetch = previousFetch;
    }
  });

  test("strips bracketed markers from the visible current-row guidance and the step announcement", async () => {
    const guidanceModule = await import("../lib/validatorGuidance");
    const originalGuidanceFor = guidanceModule.guidanceFor;
    // Defensive stripping in ResultsShell exists for guidance content that
    // should never carry a bracketed planning marker, even though the real
    // guidance table never does. Inject one marked-up record for paste_s1
    // through a scoped module mock (restored in finally) so this proves the
    // real render path strips it, instead of only unit-testing the pure
    // stripBracketedMarkers/sanitizeGuidanceRecord helpers in isolation.
    mock.module("../lib/validatorGuidance", () => ({
      ...guidanceModule,
      guidanceFor: (key: string | null | undefined) => {
        const record = originalGuidanceFor(key);
        if (record === null || record.kind !== "instruction" || key !== "paste_s1") {
          return record;
        }
        return {
          ...record,
          title: `[wip] ${record.title}`,
          body: `${record.body} [todo-followup]`,
        };
      },
    }));
    const restoreFetch = installActiveInviteFetch();
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes("Paste the outgoing invite") === true,
      );

      const currentSlot = Array.from(document.querySelectorAll("[data-guidance-slot]")).find(
        (el) => el.textContent?.includes("Paste the outgoing invite"),
      );
      expect(currentSlot).toBeDefined();
      expect(currentSlot?.textContent).not.toContain("[");
      expect(currentSlot?.textContent).not.toContain("]");
      expect(currentSlot?.textContent).toContain(
        "Use Copy invitation, then accept that invitation on the target server under test.",
      );

      const announce = Array.from(document.querySelectorAll('p[role="status"]')).find((el) =>
        /^Step \d+ of \d+: /.test(el.textContent ?? ""),
      );
      expect(announce).toBeDefined();
      expect(announce?.textContent).toBe("Step 3 of 6: Paste the outgoing invite");
      expect(announce?.textContent).not.toContain("[");
    } finally {
      // Unmount, restore fetch, and restore the guidance module mock even
      // if an assertion above throws, so a failing run cannot leave the
      // loop, a dangling fetch mock, or the module mock active afterward.
      await act(() => {
        root.unmount();
      });
      restoreFetch();
      mock.module("../lib/validatorGuidance", () => ({
        ...guidanceModule,
        guidanceFor: originalGuidanceFor,
      }));
    }
  });

  test("wires View report only on the current live row via joinValidatorUrl and opens it in a new tab", async () => {
    const restoreFetch = installActiveInviteFetch({
      liveReportExtra: { reportUrl: "https://evil.example/validator/report/abc" },
    });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes("Paste the outgoing invite") === true,
      );

      const expectedHref = joinValidatorUrl(
        API_ORIGIN,
        `/report/${encodeURIComponent(SESSION_ID)}`,
      );
      const links = Array.from(document.querySelectorAll("a")).filter(
        (el) => el.textContent === "View report",
      );
      expect(links.length).toBe(1);
      expect(links[0]?.getAttribute("href")).toBe(expectedHref);
      expect(links[0]?.getAttribute("target")).toBe("_blank");
      expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer");

      const currentCard = document.querySelector('[aria-current="step"]');
      expect(currentCard?.contains(links[0] as Node)).toBe(true);
      const otherCards = Array.from(document.querySelectorAll("[data-guidance-slot]"))
        .map((slot) => slot.parentElement)
        .filter((card) => card !== currentCard);
      for (const card of otherCards) {
        expect(card?.textContent).not.toContain("View report");
      }
      expect(document.body.textContent).not.toContain("Open public report");
      expect(document.body.textContent).not.toContain("Copy public report link");
    } finally {
      await act(() => {
        root.unmount();
      });
      restoreFetch();
    }
  });

  test("hides the live View report link when validatorApiOrigin is empty", async () => {
    const restoreFetch = installActiveInviteFetch({ origin: "" });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes("Paste the outgoing invite") === true,
      );

      const links = Array.from(document.querySelectorAll("a")).filter(
        (el) => el.textContent === "View report",
      );
      expect(links.length).toBe(0);
      const currentCard = document.querySelector('[aria-current="step"]');
      const currentCtaSlot = currentCard?.querySelector("[data-cta-slot]");
      expect(currentCtaSlot).not.toBeNull();
      expect(currentCtaSlot?.className).toContain("min-w-[10rem]");
      // AG-1.4 wires the primary claim CTA on the paste_s1 row, so the slot
      // stays visible (not aria-hidden) even when the empty origin hides the
      // secondary View report link.
      const claimCta = Array.from(currentCtaSlot?.querySelectorAll("button") ?? []).find(
        (el) => el.textContent === COPY_INVITATION_LABEL,
      );
      expect(claimCta).toBeDefined();
      expect(currentCtaSlot?.getAttribute("aria-hidden")).toBeNull();
      expect(document.querySelector("[data-reserved-cta-slot]")).toBeNull();
    } finally {
      await act(() => {
        root.unmount();
      });
      restoreFetch();
    }
  });
});

function viewReportLink(): HTMLAnchorElement {
  const link = Array.from(document.querySelectorAll("a")).find(
    (node) => node.textContent === "View report",
  );
  if (link === undefined) {
    throw new Error("missing View report link");
  }
  return link;
}

function reservedSlotCounts(): {
  guidance: number;
  form: number;
  alert: number;
  cta: number;
} {
  return {
    guidance: document.querySelectorAll("[data-guidance-slot]").length,
    form: document.querySelectorAll("[data-reserved-form-slot]").length,
    alert: document.querySelectorAll("[data-reserved-alert-slot]").length,
    cta: document.querySelectorAll("[data-cta-slot]").length,
  };
}

function installGatedSessionFetch(gate: SessionPollGate): () => void {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("config.json")) {
      return jsonResponse(200, {
        poll_interval_ms: 1,
        active_poll_interval_ms: 1,
        backoff_initial_ms: 1,
        backoff_max_ms: 1,
        request_timeout_ms: 5000,
        validator_api_origin: API_ORIGIN,
      });
    }
    if (url.includes(`/api/session/${SESSION_ID}`)) {
      return gate.request();
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(200, liveReport(specification(() => "pass")));
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

describe("ResultsShell focus order, live regions, and reserved layout", () => {
  beforeAll(async () => {
    await registerHappyDom("http://localhost/?host=peer.example&id=" + SESSION_ID);
  });

  afterAll(() => {
    teardownHappyDom();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
  });

  test("does not autofocus the current card on the first poll or a repeat poll", async () => {
    const gate = new SessionPollGate();
    const restoreFetch = installGatedSessionFetch(gate);
    setWindowHref(`https://localhost/?host=peer.example&id=${SESSION_ID}`);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      const firstCard = document.querySelector('[aria-current="step"]');
      expect(firstCard).not.toBeNull();
      expect(firstCard?.getAttribute("tabindex")).toBeNull();
      expect(document.activeElement === firstCard).toBe(false);
      expect(document.querySelector("[data-step-list]")?.hasAttribute("aria-live")).toBe(false);

      const copyButton = pageLinkButton();
      copyButton.focus();
      expect(document.activeElement).toBe(copyButton);

      await releasePoll(gate, 2, {
        state: "invite_minted",
        ts: 2,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      expect(document.activeElement).toBe(copyButton);
      const repeatCard = document.querySelector('[aria-current="step"]');
      expect(repeatCard?.getAttribute("tabindex")).toBeNull();
      expect(document.activeElement === repeatCard).toBe(false);
    } finally {
      await act(async () => {
        root.unmount();
      });
      gate.settleRemaining();
      restoreFetch();
    }
  });

  test("moves focus to the new current card only when an instruction change unmounts the focused control", async () => {
    const gate = new SessionPollGate();
    const restoreFetch = installGatedSessionFetch(gate);
    setWindowHref(`https://localhost/?host=peer.example&id=${SESSION_ID}`);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      const reportLink = viewReportLink();
      reportLink.focus();
      expect(document.activeElement).toBe(reportLink);

      await releasePoll(gate, 2, {
        state: "reverse_awaiting_invite",
        ts: 2,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
      const currentCard = document.querySelector('[aria-current="step"]');
      expect(currentCard).not.toBeNull();
      expect(currentCard?.textContent).toContain("Accept return invitation");
      expect(currentCard?.getAttribute("tabindex")).toBe("-1");
      expect(currentCard?.getAttribute("tabindex")).not.toBe("0");
      expect(document.activeElement).toBe(currentCard);
      expect(document.querySelectorAll('[aria-current="step"]').length).toBe(1);
    } finally {
      await act(async () => {
        root.unmount();
      });
      gate.settleRemaining();
      restoreFetch();
    }
  });

  test("does not move focus when an instruction change leaves the focused control mounted", async () => {
    const gate = new SessionPollGate();
    const restoreFetch = installGatedSessionFetch(gate);
    setWindowHref(`https://localhost/?host=peer.example&id=${SESSION_ID}`);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      const copyButton = pageLinkButton();
      copyButton.focus();
      expect(document.activeElement).toBe(copyButton);

      await releasePoll(gate, 2, {
        state: "reverse_awaiting_invite",
        ts: 2,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
      expect(document.activeElement).toBe(copyButton);
      const currentCard = document.querySelector('[aria-current="step"]');
      expect(currentCard).not.toBeNull();
      expect(currentCard?.getAttribute("tabindex")).toBeNull();
      expect(document.activeElement === currentCard).toBe(false);
    } finally {
      await act(async () => {
        root.unmount();
      });
      gate.settleRemaining();
      restoreFetch();
    }
  });

  test("exposes one polite atomic step status, keeps guidance outside live regions, and keeps reserved slots mounted", async () => {
    const gate = new SessionPollGate();
    const restoreFetch = installGatedSessionFetch(gate);
    setWindowHref(`https://localhost/?host=peer.example&id=${SESSION_ID}`);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      const firstAnnounce = document.querySelector("[data-step-status]");
      expect(firstAnnounce).not.toBeNull();
      expect(firstAnnounce?.getAttribute("role")).toBe("status");
      expect(firstAnnounce?.getAttribute("aria-live")).toBe("polite");
      expect(firstAnnounce?.getAttribute("aria-atomic")).toBe("true");
      expect(firstAnnounce?.textContent).toBe("Step 3 of 6: Paste the outgoing invite");
      expect(firstAnnounce?.textContent).not.toContain("Use Copy invitation");
      expect(document.querySelectorAll("[data-step-status]").length).toBe(1);
      expect(document.querySelector("[data-step-list]")?.closest("[aria-live]")).toBeNull();
      for (const slot of Array.from(document.querySelectorAll("[data-guidance-slot]"))) {
        expect(slot.closest("[aria-live]")).toBeNull();
      }
      for (const copy of Object.values(ACTION_ERROR_COPY)) {
        expect(firstAnnounce?.textContent).not.toContain(copy);
      }
      expect(document.querySelectorAll("textarea").length).toBe(0);
      const reservedBefore = reservedSlotCounts();
      expect(reservedBefore).toEqual({ guidance: 6, form: 1, alert: 1, cta: 6 });
      expect(document.querySelector("[data-reserved-alert-slot]")?.getAttribute("role")).toBeNull();
      expect(document.querySelector("[data-reserved-form-slot]")?.contains(
        document.querySelector("[data-reserved-alert-slot]") as Node,
      )).toBe(true);

      await releasePoll(gate, 2, {
        state: "reverse_awaiting_invite",
        ts: 2,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
      const secondAnnounce = document.querySelector("[data-step-status]");
      expect(secondAnnounce?.textContent).toBe("Step 4 of 6: Paste the reverse invite");
      expect(reservedSlotCounts()).toEqual(reservedBefore);
      expect(document.querySelectorAll('[role="alert"]').length).toBe(0);
      expect(secondAnnounce?.textContent).not.toContain("We could not");
      for (const copy of Object.values(ACTION_ERROR_COPY)) {
        expect(secondAnnounce?.textContent).not.toContain(copy);
      }
    } finally {
      await act(async () => {
        root.unmount();
      });
      gate.settleRemaining();
      restoreFetch();
    }
  });
});

const INVITE_STRING = "https://peer.example/ocm/invite/abc123";
const STORED_INVITE = "https://peer.example/ocm/invite/stored456";

function claimSuccessBody(invite: string = INVITE_STRING): Record<string, unknown> {
  return {
    inviteString: invite,
    issuerFqdn: "peer.example",
    pasteTargetOrigin: "https://peer.example",
    pasteTargetHost: "peer.example",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

// Live paste_s1 fetch with a controllable claim (POST /invite) responder. The
// session poll keeps returning invite_minted/paste_s1, so the invite row stays
// current and any claim cache must persist across the repeated polls.
function installClaimFetch(handleInvite: () => Promise<Response> | Response): {
  restore: () => void;
  inviteCalls: () => number;
} {
  let inviteCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("config.json")) {
      return jsonResponse(200, {
        poll_interval_ms: 1,
        active_poll_interval_ms: 1,
        backoff_initial_ms: 1,
        backoff_max_ms: 1,
        request_timeout_ms: 5000,
        validator_api_origin: API_ORIGIN,
      });
    }
    if (url.includes(`/api/session/${SESSION_ID}/invite`)) {
      inviteCalls += 1;
      return handleInvite();
    }
    if (url.includes(`/api/session/${SESSION_ID}`)) {
      return jsonResponse(200, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(200, liveReport(specification(() => "pass")));
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = previousFetch;
    },
    inviteCalls: () => inviteCalls,
  };
}

function installGatedClaimFetch(
  gate: SessionPollGate,
  handleInvite: () => Promise<Response> | Response,
): { restore: () => void; inviteCalls: () => number } {
  let inviteCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("config.json")) {
      return jsonResponse(200, {
        poll_interval_ms: 1,
        active_poll_interval_ms: 1,
        backoff_initial_ms: 1,
        backoff_max_ms: 1,
        request_timeout_ms: 5000,
        validator_api_origin: API_ORIGIN,
      });
    }
    if (url.includes(`/api/session/${SESSION_ID}/invite`)) {
      inviteCalls += 1;
      return handleInvite();
    }
    if (url.includes(`/api/session/${SESSION_ID}`)) {
      return gate.request();
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(200, liveReport(specification(() => "pass")));
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = previousFetch;
    },
    inviteCalls: () => inviteCalls,
  };
}

function claimButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (node) => node.textContent === label,
  );
  if (button === undefined) {
    throw new Error(`missing <button> with text ${JSON.stringify(label)}`);
  }
  return button;
}

function hasClaimButton(label: string): boolean {
  return Array.from(document.querySelectorAll("button")).some(
    (node) => node.textContent === label,
  );
}

function inviteField(): HTMLInputElement | null {
  return document.querySelector("[data-invite-field]");
}

describe("ResultsShell paste_s1 claim invitation", () => {
  beforeAll(async () => {
    await registerHappyDom("http://localhost/?host=peer.example&id=" + SESSION_ID);
  });

  afterAll(() => {
    teardownHappyDom();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
    window.sessionStorage.clear();
  });

  test("a 200 claim caches the invite before the clipboard attempt and renders a labeled read-only field", async () => {
    const order: string[] = [];
    const copied: string[] = [];
    const claim = installClaimFetch(() => jsonResponse(200, claimSuccessBody()));
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async (value: string) => {
      order.push("clipboard");
      copied.push(value);
    });
    const store = window.sessionStorage;
    const originalSetItem = store.setItem.bind(store);
    Object.defineProperty(store, "setItem", {
      configurable: true,
      writable: true,
      value: (key: string, value: string) => {
        order.push("store");
        originalSetItem(key, value);
      },
    });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => hasClaimButton(COPY_AGAIN_LABEL));

      // Exactly one claim POST; the invite was cached (state + storage) before
      // the clipboard write ran.
      expect(claim.inviteCalls()).toBe(1);
      expect(order).toEqual(["store", "clipboard"]);
      expect(copied).toEqual([INVITE_STRING]);

      const field = inviteField();
      expect(field).not.toBeNull();
      expect(field?.tagName).toBe("INPUT");
      expect(field?.readOnly).toBe(true);
      expect(field?.value).toBe(INVITE_STRING);
      expect(store.getItem(`validator:invite:${SESSION_ID}`)).toBe(INVITE_STRING);

      // The field is labeled for accessibility.
      const label = Array.from(document.querySelectorAll("label")).find(
        (node) => node.textContent === INVITE_FIELD_LABEL,
      );
      expect(label).toBeDefined();
      expect(label?.getAttribute("for")).toBe(field?.getAttribute("id"));
    } finally {
      Reflect.deleteProperty(store, "setItem");
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });

  test("a fast double click issues exactly one invite POST and disables the button while pending", async () => {
    let releaseInvite: (response: Response) => void = () => {};
    const invitePending = new Promise<Response>((resolve) => {
      releaseInvite = resolve;
    });
    const claim = installClaimFetch(() => invitePending);
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async () => {});
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      // Two synchronous clicks before the pending POST resolves. The ref lock
      // must collapse them into a single claim.
      await act(() => {
        const button = claimButton(COPY_INVITATION_LABEL);
        button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });

      expect(claim.inviteCalls()).toBe(1);
      expect(claimButton(COPY_INVITATION_LABEL).disabled).toBe(true);

      await act(async () => {
        releaseInvite(jsonResponse(200, claimSuccessBody()));
        await invitePending;
      });
      await waitForDom(() => hasClaimButton(COPY_AGAIN_LABEL));

      expect(claim.inviteCalls()).toBe(1);
      expect(inviteField()?.value).toBe(INVITE_STRING);
      expect(claimButton(COPY_AGAIN_LABEL).disabled).toBe(false);
    } finally {
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });

  test("Copy again copies the cached value and never re-POSTs the claim", async () => {
    const copied: string[] = [];
    const claim = installClaimFetch(() => jsonResponse(200, claimSuccessBody()));
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async (value: string) => {
      copied.push(value);
    });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => hasClaimButton(COPY_AGAIN_LABEL));
      expect(claim.inviteCalls()).toBe(1);
      expect(copied).toEqual([INVITE_STRING]);

      await act(() => {
        claimButton(COPY_AGAIN_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => copied.length === 2);

      // Still one POST; both copies read the same cached value.
      expect(claim.inviteCalls()).toBe(1);
      expect(copied).toEqual([INVITE_STRING, INVITE_STRING]);
      expect(inviteField()?.value).toBe(INVITE_STRING);
    } finally {
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });

  test("a 410 with a cached invite uses the cached field and local copy path without re-POSTing", async () => {
    const copied: string[] = [];
    window.sessionStorage.setItem(`validator:invite:${SESSION_ID}`, STORED_INVITE);
    const claim = installClaimFetch(() =>
      jsonResponse(410, { error: "INVITE_ALREADY_CLAIMED", message: "invite already claimed" }),
    );
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async (value: string) => {
      copied.push(value);
    });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => hasClaimButton(COPY_AGAIN_LABEL));

      // One POST only; the 410 fell back to the stored cache and copied it.
      expect(claim.inviteCalls()).toBe(1);
      expect(copied).toEqual([STORED_INVITE]);
      expect(inviteField()?.value).toBe(STORED_INVITE);
      expect(document.body.textContent).not.toContain(
        ACTION_ERROR_COPY.claim_410_no_cache,
      );
    } finally {
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });

  test("a 410 without a cached invite shows the locked claim_410_no_cache copy", async () => {
    const claim = installClaimFetch(() =>
      jsonResponse(410, { error: "INVITE_ALREADY_CLAIMED", message: "invite already claimed" }),
    );
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async () => {});
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() =>
        document.body.textContent?.includes(ACTION_ERROR_COPY.claim_410_no_cache) === true,
      );

      expect(claim.inviteCalls()).toBe(1);
      expect(inviteField()).toBeNull();
      const alert = document.querySelector("[data-post-error]");
      expect(alert?.getAttribute("role")).toBe("alert");
      expect(alert?.textContent).toBe(ACTION_ERROR_COPY.claim_410_no_cache);
      // Still on the claim CTA; no cache means no "Copy again".
      expect(hasClaimButton(COPY_AGAIN_LABEL)).toBe(false);
    } finally {
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });

  test("a 409 session-not-ready claim shows the locked claim_409_session_not_ready copy", async () => {
    const claim = installClaimFetch(() =>
      jsonResponse(409, { error: "SESSION_NOT_READY", message: "session not ready" }),
    );
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async () => {});
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() =>
        document.body.textContent?.includes(
          ACTION_ERROR_COPY.claim_409_session_not_ready,
        ) === true,
      );

      expect(claim.inviteCalls()).toBe(1);
      expect(inviteField()).toBeNull();
      expect(document.querySelector("[data-post-error]")?.textContent).toBe(
        ACTION_ERROR_COPY.claim_409_session_not_ready,
      );
    } finally {
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });

  test("a sessionStorage write failure is non-fatal and the in-memory cache stays usable", async () => {
    const copied: string[] = [];
    const claim = installClaimFetch(() => jsonResponse(200, claimSuccessBody()));
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async (value: string) => {
      copied.push(value);
    });
    const store = window.sessionStorage;
    Object.defineProperty(store, "setItem", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("storage quota exceeded");
      },
    });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => hasClaimButton(COPY_AGAIN_LABEL));

      // The storage write threw, but the in-memory cache still holds and the
      // field renders and copies.
      expect(claim.inviteCalls()).toBe(1);
      expect(inviteField()?.value).toBe(INVITE_STRING);
      expect(copied).toEqual([INVITE_STRING]);

      await act(() => {
        claimButton(COPY_AGAIN_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => copied.length === 2);
      expect(claim.inviteCalls()).toBe(1);
      expect(copied).toEqual([INVITE_STRING, INVITE_STRING]);
    } finally {
      Reflect.deleteProperty(store, "setItem");
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });

  test("a clipboard failure keeps the cached invite field visible with the manual-copy notice", async () => {
    const claim = installClaimFetch(() => jsonResponse(200, claimSuccessBody()));
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installRejectedClipboard();
    const execCommand = installExecCommand(() => false);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(
        () => document.body.textContent?.includes(CLAIM_COPY_FAILURE_TEXT) === true,
      );

      // The dedicated cached field stays visible after the copy failed.
      expect(inviteField()?.value).toBe(INVITE_STRING);
      expect(hasClaimButton(COPY_AGAIN_LABEL)).toBe(true);
      // Existing copy-notice fallback semantics are reused.
      const fallback = document.querySelector("[data-copy-fallback]") as
        | HTMLInputElement
        | null;
      expect(fallback).not.toBeNull();
      expect(fallback?.value).toBe(INVITE_STRING);
      expect(document.getElementById("results-copy-failure")?.textContent).toBe(
        CLAIM_COPY_FAILURE_TEXT,
      );
    } finally {
      await act(() => {
        root.unmount();
      });
      execCommand.restore();
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });

  test("a claim POST for session A that resolves after navigation to session B never writes B state", async () => {
    const sessionB = "0193b1d3-8d2e-7c5b-9f3f-2b3c4d5e6f70";
    const inviteA = "https://peer.example/ocm/invite/AAA_stale";
    const inviteB = "https://peer.example/ocm/invite/BBB_live";
    let releaseA: (response: Response) => void = () => {};
    const pendingA = new Promise<Response>((resolve) => {
      releaseA = resolve;
    });
    let releaseB: (response: Response) => void = () => {};
    const pendingB = new Promise<Response>((resolve) => {
      releaseB = resolve;
    });
    let aInviteCalls = 0;
    let bInviteCalls = 0;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("config.json")) {
        return jsonResponse(200, {
          poll_interval_ms: 1,
          active_poll_interval_ms: 1,
          backoff_initial_ms: 1,
          backoff_max_ms: 1,
          request_timeout_ms: 5000,
          validator_api_origin: API_ORIGIN,
        });
      }
      // Invite (POST) routes are checked before the general session GET route
      // because the invite path contains the session path as a prefix.
      if (url.includes(`/api/session/${sessionB}/invite`)) {
        bInviteCalls += 1;
        return pendingB;
      }
      if (url.includes(`/api/session/${SESSION_ID}/invite`)) {
        aInviteCalls += 1;
        return pendingA;
      }
      if (url.includes(`/api/session/${sessionB}`)) {
        return jsonResponse(200, {
          state: "invite_minted",
          ts: 1,
          optInActive: true,
          nextInstruction: "paste_s1",
        });
      }
      if (url.includes(`/api/session/${SESSION_ID}`)) {
        return jsonResponse(200, {
          state: "invite_minted",
          ts: 1,
          optInActive: true,
          nextInstruction: "paste_s1",
        });
      }
      if (url.includes(`/api/report/${sessionB}`)) {
        return jsonResponse(200, liveReport(specification(() => "pass")));
      }
      if (url.includes(`/api/report/${SESSION_ID}`)) {
        return jsonResponse(200, liveReport(specification(() => "pass")));
      }
      return jsonResponse(404, { error: "missing", message: "missing" });
    }) as typeof fetch;
    const restoreSecure = installIsSecureContext(true);
    const copied: string[] = [];
    const restoreClipboard = installClipboardWriteText(async (value: string) => {
      copied.push(value);
    });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      // Session A: start a claim POST and leave it pending.
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));
      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      expect(aInviteCalls).toBe(1);
      expect(claimButton(COPY_INVITATION_LABEL).disabled).toBe(true);

      // Navigate to session B before A resolves, then start B's own claim so B
      // owns the shared lock and busy state.
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={sessionB} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));
      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      expect(bInviteCalls).toBe(1);
      expect(claimButton(COPY_INVITATION_LABEL).disabled).toBe(true);

      // Resolve A's stale POST. Its result must be ignored entirely.
      await act(async () => {
        releaseA(jsonResponse(200, claimSuccessBody(inviteA)));
        await pendingA;
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
      });

      // B remains untouched: no cache field, still pending on its own claim,
      // no copy notice, and neither session's storage was written by A.
      expect(inviteField()).toBeNull();
      expect(hasClaimButton(COPY_AGAIN_LABEL)).toBe(false);
      expect(claimButton(COPY_INVITATION_LABEL).disabled).toBe(true);
      expect(document.body.textContent).not.toContain(inviteA);
      expect(document.body.textContent).not.toContain(COPY_SUCCESS_TEXT);
      expect(copied).toEqual([]);
      expect(window.sessionStorage.getItem(`validator:invite:${sessionB}`)).toBeNull();
      expect(window.sessionStorage.getItem(`validator:invite:${SESSION_ID}`)).toBeNull();

      // B's own claim still resolves normally and independently, caching B's
      // invite (in-memory) and never A's stale value.
      await act(async () => {
        releaseB(jsonResponse(200, claimSuccessBody(inviteB)));
        await pendingB;
      });
      await waitForDom(() => hasClaimButton(COPY_AGAIN_LABEL));
      expect(bInviteCalls).toBe(1);
      expect(inviteField()?.value).toBe(inviteB);
      expect(document.body.textContent).not.toContain(inviteA);
    } finally {
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      globalThis.fetch = previousFetch;
    }
  });

  test("an uncached 410 lock survives a repeat click without issuing a second POST", async () => {
    const claim = installClaimFetch(() =>
      jsonResponse(410, { error: "INVITE_ALREADY_CLAIMED", message: "invite already claimed" }),
    );
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async () => {});
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(
        () => document.body.textContent?.includes(ACTION_ERROR_COPY.claim_410_no_cache) === true,
      );

      // Terminally locked: error shown and CTA disabled after busy cleared.
      expect(claim.inviteCalls()).toBe(1);
      expect(claimButton(COPY_INVITATION_LABEL).disabled).toBe(true);

      // A second click must not re-POST and the CTA stays disabled.
      await act(async () => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
      });
      expect(claim.inviteCalls()).toBe(1);
      expect(claimButton(COPY_INVITATION_LABEL).disabled).toBe(true);
      expect(hasClaimButton(COPY_AGAIN_LABEL)).toBe(false);
      expect(document.querySelector("[data-post-error]")?.textContent).toBe(
        ACTION_ERROR_COPY.claim_410_no_cache,
      );
    } finally {
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });

  test("ignores a late claim POST result once polling has left paste_s1, and a 410 INVITE_ALREADY_CLAIMED does not write the shared post-error channel", async () => {
    const gate = new SessionPollGate();
    let releaseClaim: (response: Response) => void = () => {};
    const claimPending = new Promise<Response>((resolve) => {
      releaseClaim = resolve;
    });
    const claim = installGatedClaimFetch(gate, () => claimPending);
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async () => {});
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      expect(claim.inviteCalls()).toBe(1);

      // Poll moves past paste_s1 while the claim POST is still pending.
      await releasePoll(gate, 2, {
        state: "reverse_awaiting_invite",
        ts: 2,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
      expect(hasClaimButton(COPY_INVITATION_LABEL)).toBe(false);

      // The pending claim POST now resolves with a 410 INVITE_ALREADY_CLAIMED;
      // it must not write the shared post-error channel on the new instruction.
      await act(async () => {
        releaseClaim(
          jsonResponse(410, { error: "INVITE_ALREADY_CLAIMED", message: "invite already claimed" }),
        );
        await claimPending;
      });
      expect(document.querySelector("[data-post-error]")).toBeNull();
      expect(document.body.textContent).not.toContain(ACTION_ERROR_COPY.claim_410_no_cache);

      await releasePoll(gate, 3, {
        state: "reverse_awaiting_invite",
        ts: 3,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
      expect(reverseTextarea()).not.toBeNull();
    } finally {
      await act(() => {
        root.unmount();
      });
      gate.settleRemaining();
      claim.restore();
      restoreClipboard();
      restoreSecure();
    }
  });

  test("clears the shared post-error channel when polling advances from paste_s1 to paste_s2", async () => {
    const gate = new SessionPollGate();
    const claim = installGatedClaimFetch(gate, () =>
      jsonResponse(409, { error: "SESSION_NOT_READY", message: "session not ready" }),
    );
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async () => {});
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() =>
        document.body.textContent?.includes(
          ACTION_ERROR_COPY.claim_409_session_not_ready,
        ) === true,
      );
      expect(claim.inviteCalls()).toBe(1);
      expect(document.querySelector("[data-post-error]")?.textContent).toBe(
        ACTION_ERROR_COPY.claim_409_session_not_ready,
      );

      // Poll advances past paste_s1; the render-phase clear must remove the
      // visible post-error from the shared channel.
      await releasePoll(gate, 2, {
        state: "reverse_awaiting_invite",
        ts: 2,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
      await waitForDom(() => document.querySelector("[data-post-error]") === null);
      expect(document.querySelector("[data-post-error]")).toBeNull();
      expect(document.body.textContent).not.toContain(
        ACTION_ERROR_COPY.claim_409_session_not_ready,
      );
      expect(reverseTextarea()).not.toBeNull();
    } finally {
      await act(() => {
        root.unmount();
      });
      gate.settleRemaining();
      claim.restore();
      restoreClipboard();
      restoreSecure();
    }
  });

  test("does not match a 410 claim response by HTTP status when the flat error code differs", async () => {
    const gate = new SessionPollGate();
    const claim = installGatedClaimFetch(gate, () =>
      jsonResponse(410, { error: "GONE", message: "invite gone" }),
    );
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async () => {});
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => document.querySelector("[data-post-error]") !== null);

      // A 410 whose flat error code is NOT INVITE_ALREADY_CLAIMED must not
      // trigger the claim-locked copy or lock; matching is by result.error,
      // not HTTP status. The generic fallthrough still surfaces the backend
      // message, proving the claim-specific branch did not run.
      expect(document.body.textContent).not.toContain(
        ACTION_ERROR_COPY.claim_410_no_cache,
      );
      expect(document.querySelector("[data-post-error]")?.textContent ?? "").toContain(
        "invite gone",
      );
    } finally {
      await act(() => {
        root.unmount();
      });
      gate.settleRemaining();
      claim.restore();
      restoreClipboard();
      restoreSecure();
    }
  });

  test("a claim succeeds when sessionStorage access throws and stays usable once storage returns", async () => {
    const copied: string[] = [];
    const claim = installClaimFetch(() => jsonResponse(200, claimSuccessBody()));
    const restoreSecure = installIsSecureContext(true);
    const restoreClipboard = installClipboardWriteText(async (value: string) => {
      copied.push(value);
    });
    // Simulate sessionStorage being unavailable: any access throws. Both
    // readStoredInvite and writeStoredInvite must swallow this and rely on the
    // in-memory cache instead.
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("sessionStorage unavailable");
      },
    });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => hasClaimButton(COPY_INVITATION_LABEL));

      await act(() => {
        claimButton(COPY_INVITATION_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => hasClaimButton(COPY_AGAIN_LABEL));

      // The claim succeeded and cached in component memory despite storage
      // access throwing; the labeled read-only field renders and copied.
      expect(claim.inviteCalls()).toBe(1);
      const field = inviteField();
      expect(field?.tagName).toBe("INPUT");
      expect(field?.readOnly).toBe(true);
      expect(field?.value).toBe(INVITE_STRING);
      const label = Array.from(document.querySelectorAll("label")).find(
        (node) => node.textContent === INVITE_FIELD_LABEL,
      );
      expect(label?.getAttribute("for")).toBe(field?.getAttribute("id"));
      expect(copied).toEqual([INVITE_STRING]);
      // No fatal error surfaced.
      expect(document.querySelector("[data-post-error]")).toBeNull();

      // Restore storage availability; the in-memory cache remains usable and a
      // Copy again still reads it without a second POST.
      if (originalDescriptor === undefined) {
        Reflect.deleteProperty(window, "sessionStorage");
      } else {
        Object.defineProperty(window, "sessionStorage", originalDescriptor);
      }
      await act(() => {
        claimButton(COPY_AGAIN_LABEL).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => copied.length === 2);
      expect(claim.inviteCalls()).toBe(1);
      expect(copied).toEqual([INVITE_STRING, INVITE_STRING]);
      expect(inviteField()?.value).toBe(INVITE_STRING);
    } finally {
      if (originalDescriptor === undefined) {
        Reflect.deleteProperty(window, "sessionStorage");
      } else {
        Object.defineProperty(window, "sessionStorage", originalDescriptor);
      }
      await act(() => {
        root.unmount();
      });
      restoreClipboard();
      restoreSecure();
      claim.restore();
    }
  });
});

function httpFailure(status: number, error: string, message: string): ValidatorFailure {
  return { ok: false, kind: "http", status, error, message };
}

describe("reverseInviteErrorCopy", () => {
  test("maps wrong_target_host, conflict, and missing_field reasonCodes to the shared paste_* guidance copy", () => {
    expect(
      reverseInviteErrorCopy(
        httpFailure(422, "wrong_target_host", "invite sender does not match the session target host"),
      ),
    ).toBe(ACTION_ERROR_COPY.paste_422_wrong_target_host);
    expect(
      reverseInviteErrorCopy(httpFailure(409, "conflict", "a different reverse invite is already imported")),
    ).toBe(ACTION_ERROR_COPY.paste_409_conflict);
    expect(reverseInviteErrorCopy(httpFailure(400, "missing_field", "invalid invite string"))).toBe(
      ACTION_ERROR_COPY.paste_400_invalid_invitation,
    );
  });

  test("falls back to the backend message for peer_unreachable, not_found, and internal_error", () => {
    expect(
      reverseInviteErrorCopy(
        httpFailure(502, "peer_unreachable", "failed to complete the reverse invite exchange"),
      ),
    ).toBe("failed to complete the reverse invite exchange");
    expect(reverseInviteErrorCopy(httpFailure(404, "not_found", "session not found"))).toBe(
      "session not found",
    );
    expect(reverseInviteErrorCopy(httpFailure(500, "internal_error", "failed to store invite"))).toBe(
      "failed to store invite",
    );
  });

  test("falls back to a generic message when the backend message is empty", () => {
    expect(reverseInviteErrorCopy(httpFailure(500, "internal_error", ""))).toBe(
      "Could not import the return invitation.",
    );
  });
});

// AG-1.5 reverse-invite form helpers.

function reverseTextarea(): HTMLTextAreaElement | null {
  return document.querySelector("[data-reverse-invite-field]");
}

function reverseSubmitButton(): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (node) => node.textContent === REVERSE_INVITE_SUBMIT_LABEL,
  );
  if (button === undefined) {
    throw new Error(`missing <button> with text ${JSON.stringify(REVERSE_INVITE_SUBMIT_LABEL)}`);
  }
  return button;
}

function reverseErrorEl(): HTMLElement | null {
  return document.querySelector("[data-post-error]");
}

// React tracks a controlled textarea's DOM value on the node instance to
// detect whether a later `input` event reflects a real change, and this
// suite's full run mounts and unmounts hundreds of live ResultsShell
// instances before this describe block, each running its own fast (1ms)
// session poll loop. That history leaves React's native "input"-event
// change-detection path for a freshly rendered textarea unreliable by the
// time this describe block runs, even though the same textarea's "click"
// delegation keeps working. Setting the value through the prototype's own
// setter (bypassing the instance-level tracker) is still correct for a
// realistic DOM value, but the change is committed by calling the
// textarea's own current `onChange` prop directly (via the `__reactProps$`
// key React stores on every host DOM node) rather than only dispatching a
// native "input" event, so this helper does not depend on that fragile
// native delegation path.
function setReverseTextareaValueSync(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (setter !== undefined) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
  const propsKey = Object.keys(el).find((key) => key.startsWith("__reactProps$"));
  if (propsKey !== undefined) {
    const props = (el as unknown as Record<string, { onChange?: (e: unknown) => void }>)[
      propsKey
    ];
    props.onChange?.({ target: el });
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function typeAndClickReverseSubmit(
  el: HTMLTextAreaElement,
  value: string,
  clicks = 1,
): Promise<void> {
  await act(() => {
    setReverseTextareaValueSync(el, value);
  });
  await act(() => {
    const button = reverseSubmitButton();
    for (let i = 0; i < clicks; i += 1) {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
  });
}

function nestedError(reasonCode: string, message: string): Record<string, unknown> {
  return { error: { code: reasonCode, reasonCode, message } };
}

// Fixed live paste_s2 fetch: the session poll always returns
// reverse_awaiting_invite/paste_s2, so the reverse row stays current across
// repeated polls while a test drives one or more reverse-invite submits.
function installFixedReverseFetch(handleReverse: () => Promise<Response> | Response): {
  restore: () => void;
  reverseCalls: () => number;
  reverseBodies: () => string[];
} {
  let reverseCalls = 0;
  const bodies: string[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.includes("config.json")) {
      return jsonResponse(200, {
        poll_interval_ms: 1,
        active_poll_interval_ms: 1,
        backoff_initial_ms: 1,
        backoff_max_ms: 1,
        request_timeout_ms: 5000,
        validator_api_origin: API_ORIGIN,
      });
    }
    if (url.includes(`/api/session/${SESSION_ID}/reverse-invite`)) {
      reverseCalls += 1;
      if (typeof init?.body === "string") {
        bodies.push(init.body);
      }
      return handleReverse();
    }
    if (url.includes(`/api/session/${SESSION_ID}`)) {
      return jsonResponse(200, {
        state: "reverse_awaiting_invite",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(200, liveReport(specification(() => "pass")));
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = previousFetch;
    },
    reverseCalls: () => reverseCalls,
    reverseBodies: () => bodies,
  };
}

// Gated live fetch: the session poll route is driven explicitly through a
// SessionPollGate (see releasePoll) so a test can move the instruction past
// paste_s2 while a reverse-invite POST is still in flight, with no
// wall-clock race.
function installGatedReverseFetch(
  gate: SessionPollGate,
  handleReverse: () => Promise<Response> | Response,
): { restore: () => void; reverseCalls: () => number } {
  let reverseCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("config.json")) {
      return jsonResponse(200, {
        poll_interval_ms: 1,
        active_poll_interval_ms: 1,
        backoff_initial_ms: 1,
        backoff_max_ms: 1,
        request_timeout_ms: 5000,
        validator_api_origin: API_ORIGIN,
      });
    }
    if (url.includes(`/api/session/${SESSION_ID}/reverse-invite`)) {
      reverseCalls += 1;
      return handleReverse();
    }
    if (url.includes(`/api/session/${SESSION_ID}`)) {
      return gate.request();
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(200, liveReport(specification(() => "pass")));
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = previousFetch;
    },
    reverseCalls: () => reverseCalls,
  };
}

const VALID_REVERSE_INVITE = "dG9rZW5AcGVlci5leGFtcGxl";

describe("ResultsShell paste_s2 reverse invite", () => {
  beforeAll(async () => {
    await registerHappyDom("http://localhost/?host=peer.example&id=" + SESSION_ID);
  });

  afterAll(() => {
    teardownHappyDom();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
  });

  test("renders the form only while the current instruction is exactly paste_s2, and a previous 422 does not latch it open once polling advances", async () => {
    const gate = new SessionPollGate();
    const reverse = installGatedReverseFetch(gate, () =>
      jsonResponse(
        422,
        nestedError("wrong_target_host", "invite sender does not match the session target host"),
      ),
    );
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      await releasePoll(gate, 1, {
        state: "invite_minted",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s1",
      });
      expect(reverseTextarea()).toBeNull();

      await releasePoll(gate, 2, {
        state: "reverse_awaiting_invite",
        ts: 2,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
      const textarea = reverseTextarea();
      expect(textarea).not.toBeNull();
      expect(textarea?.tagName).toBe("TEXTAREA");
      const label = Array.from(document.querySelectorAll("label")).find(
        (node) => node.textContent === REVERSE_INVITE_FIELD_LABEL,
      );
      expect(label).toBeDefined();
      expect(label?.getAttribute("for")).toBe(textarea?.getAttribute("id"));

      await typeAndClickReverseSubmit(textarea as HTMLTextAreaElement, VALID_REVERSE_INVITE);
      await waitForDom(
        () => reverseErrorEl()?.textContent === ACTION_ERROR_COPY.paste_422_wrong_target_host,
      );
      expect(reverseErrorEl()?.getAttribute("role")).toBe("alert");
      expect(reverse.reverseCalls()).toBe(1);

      await releasePoll(gate, 3, {
        state: "reverse_invite_accepted",
        ts: 3,
        optInActive: true,
        nextInstruction: "wait_forward_share",
      });
      expect(reverseTextarea()).toBeNull();
      expect(document.body.textContent).not.toContain(
        ACTION_ERROR_COPY.paste_422_wrong_target_host,
      );
    } finally {
      await act(() => {
        root.unmount();
      });
      gate.settleRemaining();
      reverse.restore();
    }
  });

  test("trims only surrounding whitespace on submit, preserving inner content, and a 200 never optimistically advances the UI", async () => {
    const reverse = installFixedReverseFetch(() => jsonResponse(200, { status: "accepted" }));
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => reverseTextarea() !== null);

      const raw = "  token@peer.example  is   ok  ";
      await typeAndClickReverseSubmit(reverseTextarea() as HTMLTextAreaElement, raw);
      await waitForDom(() => reverse.reverseCalls() === 1);

      // Leading/trailing whitespace is gone; the internal double/triple
      // spaces the user typed survive untouched.
      expect(reverse.reverseBodies()).toEqual([JSON.stringify({ inviteString: raw.trim() })]);
      expect(reverse.reverseBodies()[0]).toContain("is   ok");

      // A 200 never advances the UI on its own: the reverse row is still
      // current and its form is still mounted, because only the poll
      // leaving paste_s2 is authoritative.
      expect(document.querySelector('[aria-current="step"]')?.textContent).toContain(
        "Accept return invitation",
      );
      expect(reverseTextarea()).not.toBeNull();
      expect(reverseErrorEl()).toBeNull();
    } finally {
      await act(() => {
        root.unmount();
      });
      reverse.restore();
    }
  });

  test("rejects input over MAX_REVERSE_INVITE_LENGTH without a POST and shows an accessible error", async () => {
    const reverse = installFixedReverseFetch(() => jsonResponse(200, { status: "accepted" }));
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => reverseTextarea() !== null);

      const overLong = "a".repeat(MAX_REVERSE_INVITE_LENGTH + 1);
      await typeAndClickReverseSubmit(reverseTextarea() as HTMLTextAreaElement, overLong);
      await waitForDom(() => reverseErrorEl() !== null);

      expect(reverse.reverseCalls()).toBe(0);
      const alert = reverseErrorEl();
      expect(alert?.getAttribute("role")).toBe("alert");
      expect(alert?.textContent).toBe(REVERSE_INVITE_TOO_LONG_TEXT);
    } finally {
      await act(() => {
        root.unmount();
      });
      reverse.restore();
    }
  });

  test("a fast double click issues exactly one reverse POST and disables the submit button while busy", async () => {
    let releaseReverse: (response: Response) => void = () => {};
    const reversePending = new Promise<Response>((resolve) => {
      releaseReverse = resolve;
    });
    const reverse = installFixedReverseFetch(() => reversePending);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => reverseTextarea() !== null);

      // Two synchronous clicks before the pending POST resolves. The ref
      // lock must collapse them into a single submit.
      await typeAndClickReverseSubmit(
        reverseTextarea() as HTMLTextAreaElement,
        VALID_REVERSE_INVITE,
        2,
      );

      expect(reverse.reverseCalls()).toBe(1);
      expect(reverseSubmitButton().disabled).toBe(true);

      await act(async () => {
        releaseReverse(jsonResponse(200, { status: "accepted" }));
        await reversePending;
      });
      await waitForDom(() => reverseSubmitButton().disabled === false);

      expect(reverse.reverseCalls()).toBe(1);
    } finally {
      await act(() => {
        root.unmount();
      });
      reverse.restore();
    }
  });

  test("ignores a late reverse POST result once polling has left paste_s2, and a 502 peer_unreachable does not latch the form or halt polling", async () => {
    const gate = new SessionPollGate();
    let releaseReverse: (response: Response) => void = () => {};
    const reversePending = new Promise<Response>((resolve) => {
      releaseReverse = resolve;
    });
    const reverse = installGatedReverseFetch(gate, () => reversePending);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });

      await releasePoll(gate, 1, {
        state: "reverse_awaiting_invite",
        ts: 1,
        optInActive: true,
        nextInstruction: "paste_s2",
      });
      const textarea = reverseTextarea();
      expect(textarea).not.toBeNull();
      await typeAndClickReverseSubmit(textarea as HTMLTextAreaElement, VALID_REVERSE_INVITE);
      expect(reverse.reverseCalls()).toBe(1);
      expect(reverseSubmitButton().disabled).toBe(true);

      // Poll moves past paste_s2 while the POST is still pending.
      await releasePoll(gate, 2, {
        state: "reverse_invite_accepted",
        ts: 2,
        optInActive: true,
        nextInstruction: "wait_forward_share",
      });
      expect(reverseTextarea()).toBeNull();

      // The pending POST now resolves with a 502; it must not resurrect the
      // form, show an error, or otherwise disrupt continued polling.
      await act(async () => {
        releaseReverse(
          jsonResponse(502, nestedError("peer_unreachable", "failed to complete the reverse invite exchange")),
        );
        await reversePending;
      });
      expect(reverseTextarea()).toBeNull();
      expect(document.body.textContent).not.toContain(
        "failed to complete the reverse invite exchange",
      );
      expect(document.body.textContent).not.toContain("We could not update this scan.");

      await releasePoll(gate, 3, {
        state: "forward_share_sent",
        ts: 3,
        optInActive: true,
        nextInstruction: "open_forward_file",
      });
      expect(document.body.textContent).toContain("Open the forwarded file");
    } finally {
      await act(() => {
        root.unmount();
      });
      gate.settleRemaining();
      reverse.restore();
    }
  });

  test("maps backend 409 conflict and 400 missing_field reasonCodes to the shared guidance copy across repeat submits", async () => {
    let nextResponse = jsonResponse(
      409,
      nestedError("conflict", "a different reverse invite is already imported"),
    );
    const reverse = installFixedReverseFetch(() => nextResponse);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => reverseTextarea() !== null);

      await typeAndClickReverseSubmit(reverseTextarea() as HTMLTextAreaElement, VALID_REVERSE_INVITE);
      await waitForDom(
        () => reverseErrorEl()?.textContent === ACTION_ERROR_COPY.paste_409_conflict,
      );

      nextResponse = jsonResponse(400, nestedError("missing_field", "invalid invite string"));
      await act(() => {
        reverseSubmitButton().dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(
        () => reverseErrorEl()?.textContent === ACTION_ERROR_COPY.paste_400_invalid_invitation,
      );

      expect(reverse.reverseCalls()).toBe(2);
    } finally {
      await act(() => {
        root.unmount();
      });
      reverse.restore();
    }
  });

  test("a reverse POST for session A that resolves after navigation to session B never writes B state", async () => {
    const sessionB = "0193b1d3-8d2e-7c5b-9f3f-2b3c4d5e6f70";
    let releaseA: (response: Response) => void = () => {};
    const pendingA = new Promise<Response>((resolve) => {
      releaseA = resolve;
    });
    let aReverseCalls = 0;
    let bReverseCalls = 0;
    const bBodies: string[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes("config.json")) {
        return jsonResponse(200, {
          poll_interval_ms: 1,
          active_poll_interval_ms: 1,
          backoff_initial_ms: 1,
          backoff_max_ms: 1,
          request_timeout_ms: 5000,
          validator_api_origin: API_ORIGIN,
        });
      }
      // Reverse-invite (POST) routes are checked before the general session
      // GET route because the invite path contains the session path as a
      // prefix.
      if (url.includes(`/api/session/${sessionB}/reverse-invite`)) {
        bReverseCalls += 1;
        if (typeof init?.body === "string") {
          bBodies.push(init.body);
        }
        return jsonResponse(200, { status: "accepted" });
      }
      if (url.includes(`/api/session/${SESSION_ID}/reverse-invite`)) {
        aReverseCalls += 1;
        return pendingA;
      }
      if (url.includes(`/api/session/${sessionB}`)) {
        return jsonResponse(200, {
          state: "reverse_awaiting_invite",
          ts: 1,
          optInActive: true,
          nextInstruction: "paste_s2",
        });
      }
      if (url.includes(`/api/session/${SESSION_ID}`)) {
        return jsonResponse(200, {
          state: "reverse_awaiting_invite",
          ts: 1,
          optInActive: true,
          nextInstruction: "paste_s2",
        });
      }
      if (url.includes(`/api/report/${sessionB}`)) {
        return jsonResponse(200, liveReport(specification(() => "pass")));
      }
      if (url.includes(`/api/report/${SESSION_ID}`)) {
        return jsonResponse(200, liveReport(specification(() => "pass")));
      }
      return jsonResponse(404, { error: "missing", message: "missing" });
    }) as typeof fetch;
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.body);
    try {
      // Session A: reach paste_s2 and start a reverse-invite POST, then
      // leave it pending.
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(() => reverseTextarea() !== null);
      await typeAndClickReverseSubmit(
        reverseTextarea() as HTMLTextAreaElement,
        VALID_REVERSE_INVITE,
      );
      expect(aReverseCalls).toBe(1);
      expect(reverseSubmitButton().disabled).toBe(true);

      // Navigate to session B before A resolves. The session-change reset
      // clears the shared ref lock and busy state, so B renders its own
      // fresh, enabled form.
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={sessionB} />);
      });
      await waitForDom(() => reverseTextarea() !== null);
      expect(reverseTextarea()?.value).toBe("");
      expect(reverseSubmitButton().disabled).toBe(false);
      expect(reverseErrorEl()).toBeNull();

      // Resolve A's stale POST with an error. Its result must be ignored
      // entirely: it must not surface on B's screen, and it must not be
      // attributed to B's own reverse-invite call count.
      await act(async () => {
        releaseA(
          jsonResponse(
            502,
            nestedError("peer_unreachable", "failed to complete the reverse invite exchange"),
          ),
        );
        await pendingA;
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
      });

      // B remains untouched: no error, form still present and enabled, and
      // B's own call count is still zero.
      expect(reverseErrorEl()).toBeNull();
      expect(document.body.textContent).not.toContain(
        "failed to complete the reverse invite exchange",
      );
      expect(bReverseCalls).toBe(0);
      const textareaB = reverseTextarea();
      expect(textareaB).not.toBeNull();
      expect(textareaB?.tagName).toBe("TEXTAREA");
      expect(textareaB?.disabled).toBe(false);
      expect(reverseSubmitButton().disabled).toBe(false);

      // B's own submit still works normally and independently, posting only
      // B's invite string, never A's.
      await typeAndClickReverseSubmit(textareaB as HTMLTextAreaElement, VALID_REVERSE_INVITE);
      await waitForDom(() => bReverseCalls === 1);
      expect(bBodies).toEqual([JSON.stringify({ inviteString: VALID_REVERSE_INVITE })]);
      expect(reverseErrorEl()).toBeNull();
      expect(document.body.textContent).not.toContain(
        "failed to complete the reverse invite exchange",
      );
    } finally {
      await act(() => {
        root.unmount();
      });
      globalThis.fetch = previousFetch;
    }
  });
});
