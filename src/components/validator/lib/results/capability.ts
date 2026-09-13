/**
 * Pure public capability and availability derivation for the results page.
 * Inputs to outputs only: no React, refs, or session state.
 */

import type { EvidenceItem } from "../evidence/types";
import {
  resolvePublicReportUrl,
  type ReportResponse,
  type ReportVisibility,
} from "../validatorFetch";
import { EXPIRED_NOTICE } from "./sessionFailures";

export const VISIBILITY_NOTICE: Record<ReportVisibility, string> = {
  session: "Live session. This is not a public report.",
  permanent: "Public report. Anyone with the link can view it.",
  not_saved: "Not saved. No public report link exists.",
  expired: EXPIRED_NOTICE,
  unknown: "Report visibility is unavailable.",
};

export const RETENTION_POLICY_TEXT = "The validator retention policy applies.";

export type EvidenceMode = "disclosure" | "not_saved" | "expired" | "session" | "none";

export type VisibilityNoticeProjection =
  | { visible: true; text: string; showRetentionPolicy: boolean }
  | { visible: false };

export type EvidenceAvailabilityProjection = {
  sectionVisible: boolean;
  showDisclosure: boolean;
  showNotSaved: boolean;
  showSessionEmpty: boolean;
  showUnknownEmpty: boolean;
  showExpired: boolean;
  showCachedSessionNote: boolean;
};

export type PublicReportAvailability = {
  reportUrl: string | null;
  showPublicActions: boolean;
};

export type CapabilityInput = {
  status: string;
  visibility: ReportVisibility;
  evidenceMode: EvidenceMode;
  sourceKind: string;
  hasSourceReport: boolean;
};

export type CapabilityProjection = {
  visibilityNotice: VisibilityNoticeProjection;
  evidence: EvidenceAvailabilityProjection;
};

/**
 * Report visibility cascade from projectResultsPage. Live stays session.
 * A terminal report owns its visibility; otherwise not-public, expired,
 * then unknown.
 */
export function projectReportVisibility(input: {
  terminal: boolean;
  terminalReport: Pick<ReportResponse, "visibility"> | null;
  notPublic: boolean;
  expired: boolean;
}): ReportVisibility {
  if (!input.terminal) {
    return "session";
  }
  if (input.terminalReport !== null) {
    return input.terminalReport.visibility;
  }
  if (input.notPublic) {
    return "not_saved";
  }
  if (input.expired) {
    return "expired";
  }
  return "unknown";
}

/**
 * Permanent public-report URL and the showPublicActions flag. Non-permanent
 * visibility never resolves a URL. Cross-origin or empty candidates stay
 * hidden.
 */
export function projectPublicReportAvailability(
  visibility: ReportVisibility,
  terminalReport: Pick<ReportResponse, "reportUrl" | "url"> | null,
  validatorApiOrigin: string,
): PublicReportAvailability {
  const candidate = terminalReport?.reportUrl ?? terminalReport?.url;
  const reportUrl =
    visibility === "permanent"
      ? resolvePublicReportUrl(candidate, validatorApiOrigin)
      : null;
  return {
    reportUrl,
    showPublicActions: visibility === "permanent" && reportUrl !== null,
  };
}

/**
 * Evidence panel mode. Permanent discloses. Expired is expired. Nonempty
 * not_saved, session, or unknown discloses. Empty not_saved and session
 * keep those modes; everything else is none.
 */
export function evidenceModeFor(
  visibility: ReportVisibility,
  items: EvidenceItem[],
): EvidenceMode {
  if (visibility === "permanent") {
    return "disclosure";
  }
  if (visibility === "expired") {
    return "expired";
  }
  if (
    items.length > 0 &&
    (visibility === "not_saved" ||
      visibility === "session" ||
      visibility === "unknown")
  ) {
    return "disclosure";
  }
  if (visibility === "not_saved") {
    return "not_saved";
  }
  if (visibility === "session") {
    return "session";
  }
  return "none";
}

/**
 * Visibility notice on ready and live only. Retention copy is permanent
 * only. Other page statuses leave the notice hidden.
 */
export function projectVisibilityNotice(
  status: string,
  visibility: ReportVisibility,
): VisibilityNoticeProjection {
  if (status !== "ready" && status !== "live") {
    return { visible: false };
  }
  return {
    visible: true,
    text: VISIBILITY_NOTICE[visibility],
    showRetentionPolicy: visibility === "permanent",
  };
}

/**
 * Evidence-section flags the results renderer already branches on. Session
 * and unknown empty panels also require a source report, matching the
 * current JSX.
 */
export function projectEvidenceAvailability(
  input: CapabilityInput,
): EvidenceAvailabilityProjection {
  const sectionVisible = input.status === "ready" || input.status === "live";
  return {
    sectionVisible,
    showDisclosure: sectionVisible && input.evidenceMode === "disclosure",
    showNotSaved: sectionVisible && input.evidenceMode === "not_saved",
    showSessionEmpty:
      sectionVisible && input.evidenceMode === "session" && input.hasSourceReport,
    showUnknownEmpty:
      sectionVisible &&
      input.evidenceMode === "none" &&
      input.visibility === "unknown" &&
      input.hasSourceReport,
    showExpired: sectionVisible && input.evidenceMode === "expired",
    showCachedSessionNote: sectionVisible && input.sourceKind === "cached_session",
  };
}

/**
 * Visibility notice plus evidence-section flags. Handlers, refs, and
 * session identity stay in the caller.
 */
export function projectCapability(input: CapabilityInput): CapabilityProjection {
  return {
    visibilityNotice: projectVisibilityNotice(input.status, input.visibility),
    evidence: projectEvidenceAvailability(input),
  };
}
