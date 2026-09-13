import { describe, expect, test } from "bun:test";

import type { EvidenceItem } from "../evidence/types";
import {
  RETENTION_POLICY_TEXT,
  VISIBILITY_NOTICE,
  evidenceModeFor,
  projectCapability,
  projectEvidenceAvailability,
  projectPublicReportAvailability,
  projectReportVisibility,
  projectVisibilityNotice,
  type CapabilityInput,
} from "./capability";
import { EXPIRED_NOTICE } from "./sessionFailures";

const API_ORIGIN = "https://validator.example.com";
const REPORT_PATH = "/validator/report/abc";
const REPORT_URL = `${API_ORIGIN}${REPORT_PATH}`;
const EVIDENCE_ITEM: EvidenceItem = {
  area: "discovery",
  reasonCode: "discovery_probed",
  grade: "pass",
};

function capabilityInput(extra: Partial<CapabilityInput> = {}): CapabilityInput {
  return {
    status: "ready",
    visibility: "permanent",
    evidenceMode: "disclosure",
    sourceKind: "terminal",
    hasSourceReport: true,
    ...extra,
  };
}

describe("projectReportVisibility", () => {
  test("keeps live sessions on session visibility", () => {
    expect(
      projectReportVisibility({
        terminal: false,
        terminalReport: { visibility: "permanent" },
        notPublic: true,
        expired: true,
      }),
    ).toBe("session");
  });

  test("uses the terminal report visibility when a terminal report exists", () => {
    expect(
      projectReportVisibility({
        terminal: true,
        terminalReport: { visibility: "permanent" },
        notPublic: true,
        expired: true,
      }),
    ).toBe("permanent");
    expect(
      projectReportVisibility({
        terminal: true,
        terminalReport: { visibility: "session" },
        notPublic: false,
        expired: false,
      }),
    ).toBe("session");
  });

  test("falls back to not_saved, expired, then unknown without a terminal report", () => {
    expect(
      projectReportVisibility({
        terminal: true,
        terminalReport: null,
        notPublic: true,
        expired: true,
      }),
    ).toBe("not_saved");
    expect(
      projectReportVisibility({
        terminal: true,
        terminalReport: null,
        notPublic: false,
        expired: true,
      }),
    ).toBe("expired");
    expect(
      projectReportVisibility({
        terminal: true,
        terminalReport: null,
        notPublic: false,
        expired: false,
      }),
    ).toBe("unknown");
  });
});

describe("projectPublicReportAvailability", () => {
  test("resolves a same-origin permanent URL and shows public actions", () => {
    expect(
      projectPublicReportAvailability("permanent", { reportUrl: REPORT_PATH }, API_ORIGIN),
    ).toEqual({ reportUrl: REPORT_URL, showPublicActions: true });
  });

  test("hides public actions when visibility is not permanent even if a URL is present", () => {
    expect(
      projectPublicReportAvailability("session", { reportUrl: REPORT_PATH }, API_ORIGIN),
    ).toEqual({ reportUrl: null, showPublicActions: false });
    expect(
      projectPublicReportAvailability("not_saved", { reportUrl: REPORT_PATH }, API_ORIGIN),
    ).toEqual({ reportUrl: null, showPublicActions: false });
  });

  test("hides public actions when a permanent URL is missing or cross-origin", () => {
    expect(projectPublicReportAvailability("permanent", null, API_ORIGIN)).toEqual({
      reportUrl: null,
      showPublicActions: false,
    });
    expect(
      projectPublicReportAvailability(
        "permanent",
        { reportUrl: "https://evil.example/validator/report/abc" },
        API_ORIGIN,
      ),
    ).toEqual({ reportUrl: null, showPublicActions: false });
  });
});

describe("evidenceModeFor", () => {
  test("discloses permanent reports and nonempty not_saved, session, or unknown snapshots", () => {
    expect(evidenceModeFor("permanent", [])).toBe("disclosure");
    expect(evidenceModeFor("not_saved", [EVIDENCE_ITEM])).toBe("disclosure");
    expect(evidenceModeFor("session", [EVIDENCE_ITEM])).toBe("disclosure");
    expect(evidenceModeFor("unknown", [EVIDENCE_ITEM])).toBe("disclosure");
  });

  test("keeps empty not_saved and session modes and falls unknown empty to none", () => {
    expect(evidenceModeFor("expired", [EVIDENCE_ITEM])).toBe("expired");
    expect(evidenceModeFor("not_saved", [])).toBe("not_saved");
    expect(evidenceModeFor("session", [])).toBe("session");
    expect(evidenceModeFor("unknown", [])).toBe("none");
  });
});

describe("projectVisibilityNotice", () => {
  test("shows the existing visibility reason text on ready and live only", () => {
    expect(projectVisibilityNotice("ready", "session")).toEqual({
      visible: true,
      text: VISIBILITY_NOTICE.session,
      showRetentionPolicy: false,
    });
    expect(projectVisibilityNotice("live", "not_saved")).toEqual({
      visible: true,
      text: VISIBILITY_NOTICE.not_saved,
      showRetentionPolicy: false,
    });
    expect(projectVisibilityNotice("malformed", "permanent")).toEqual({ visible: false });
    expect(projectVisibilityNotice("expired", "expired")).toEqual({ visible: false });
  });

  test("keeps every visibility reason string and shows retention only for permanent", () => {
    expect(VISIBILITY_NOTICE.session).toBe("Live session. This is not a public report.");
    expect(VISIBILITY_NOTICE.permanent).toBe(
      "Public report. Anyone with the link can view it.",
    );
    expect(VISIBILITY_NOTICE.not_saved).toBe("Not saved. No public report link exists.");
    expect(VISIBILITY_NOTICE.expired).toBe(EXPIRED_NOTICE);
    expect(VISIBILITY_NOTICE.unknown).toBe("Report visibility is unavailable.");
    expect(projectVisibilityNotice("ready", "permanent")).toEqual({
      visible: true,
      text: VISIBILITY_NOTICE.permanent,
      showRetentionPolicy: true,
    });
    expect(RETENTION_POLICY_TEXT).toBe("The validator retention policy applies.");
  });
});

describe("projectEvidenceAvailability", () => {
  test("shows disclosure, not_saved, session, unknown-empty, and expired panels only on ready or live", () => {
    expect(projectEvidenceAvailability(capabilityInput()).showDisclosure).toBe(true);
    expect(
      projectEvidenceAvailability(capabilityInput({ evidenceMode: "not_saved" })).showNotSaved,
    ).toBe(true);
    expect(
      projectEvidenceAvailability(capabilityInput({ evidenceMode: "session" })).showSessionEmpty,
    ).toBe(true);
    expect(
      projectEvidenceAvailability(
        capabilityInput({ evidenceMode: "none", visibility: "unknown" }),
      ).showUnknownEmpty,
    ).toBe(true);
    expect(
      projectEvidenceAvailability(
        capabilityInput({ evidenceMode: "expired", visibility: "expired" }),
      ).showExpired,
    ).toBe(true);

    const hidden = projectEvidenceAvailability(capabilityInput({ status: "malformed" }));
    expect(hidden.sectionVisible).toBe(false);
    expect(hidden.showDisclosure).toBe(false);
    expect(hidden.showNotSaved).toBe(false);
    expect(hidden.showSessionEmpty).toBe(false);
    expect(hidden.showUnknownEmpty).toBe(false);
    expect(hidden.showExpired).toBe(false);
  });

  test("hides session and unknown empty panels without a source report", () => {
    expect(
      projectEvidenceAvailability(
        capabilityInput({ evidenceMode: "session", hasSourceReport: false }),
      ).showSessionEmpty,
    ).toBe(false);
    expect(
      projectEvidenceAvailability(
        capabilityInput({
          evidenceMode: "none",
          visibility: "unknown",
          hasSourceReport: false,
        }),
      ).showUnknownEmpty,
    ).toBe(false);
    expect(
      projectEvidenceAvailability(capabilityInput({ sourceKind: "cached_session" }))
        .showCachedSessionNote,
    ).toBe(true);
    expect(
      projectEvidenceAvailability(capabilityInput({ sourceKind: "terminal" }))
        .showCachedSessionNote,
    ).toBe(false);
  });
});

describe("projectCapability", () => {
  test("combines the notice and evidence flags the renderer reads", () => {
    const ready = projectCapability(capabilityInput());
    expect(ready.visibilityNotice).toEqual({
      visible: true,
      text: VISIBILITY_NOTICE.permanent,
      showRetentionPolicy: true,
    });
    expect(ready.evidence.showDisclosure).toBe(true);
    expect(ready.evidence.sectionVisible).toBe(true);

    const live = projectCapability(
      capabilityInput({
        status: "live",
        visibility: "session",
        evidenceMode: "session",
        sourceKind: "none",
        hasSourceReport: false,
      }),
    );
    expect(live.visibilityNotice).toEqual({
      visible: true,
      text: VISIBILITY_NOTICE.session,
      showRetentionPolicy: false,
    });
    expect(live.evidence.showSessionEmpty).toBe(false);
    expect(live.evidence.showDisclosure).toBe(false);
  });
});
