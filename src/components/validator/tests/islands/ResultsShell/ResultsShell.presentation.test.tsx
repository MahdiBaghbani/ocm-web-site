import { describe, expect, test } from "bun:test";

import {
  AREA_DESCRIPTIONS,
  EVIDENCE_EMPTY_SNAPSHOT,
  EVIDENCE_NOT_SAVED,
  areaTotals,
  bannerBody,
  liveViewReportHref,
  primaryReasonCodesByArea,
  primaryReasonsByArea,
  progressAnnouncement,
  projectResultsPage,
  resultAreaEntries,
  sanitizeGuidanceRecord,
  specificationInputFromReport,
  stripBracketedMarkers,
} from "@/components/validator/islands/ResultsShell";
import { type CanonicalAreaId } from "@/components/validator/lib/validatorScore";
import type { EvidenceItem } from "@/components/validator/lib/evidence/types";
import { resolveValidatorMachine } from "@/components/validator/lib/stateMachine";
import { UNKNOWN_GUIDANCE_TITLE, guidanceFor } from "@/components/validator/lib/validatorGuidance";
import {
  joinValidatorUrl,
  resolvePublicReportUrl,
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
