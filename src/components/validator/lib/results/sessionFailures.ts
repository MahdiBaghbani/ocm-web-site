/**
 * Pure session-failure classification and display for the results page.
 * Inputs to outputs only: no React, refs, or session state.
 */

import { guidanceFor, type GuidanceRecord } from "../validatorGuidance";
import { stripBracketedMarkers } from "./progress";

export const NOT_SAVED_EMPTY_TITLE = "This scan was not saved";
export const NOT_SAVED_EMPTY_BODY =
  "The session finished without a saved public report, and result details are not available from this link.";

export const MALFORMED_TITLE = "Result unavailable";
export const MALFORMED_BODY =
  "The scan finished, but the validator returned result data this page could not read.";
export const MALFORMED_RETRY_LABEL = "Try loading again";

export const EXPIRED_NOTICE =
  "Report expired. The saved report is no longer available.";
export const EXPIRED_EVIDENCE_NOTE =
  "Evidence cannot be loaded because the saved report is no longer available.";

export type SessionFailureKind = "not_saved_empty" | "malformed" | "expired";

export type NotSavedEmptyDisplay = {
  kind: "not_saved_empty";
  title: string;
  body: string;
  guidance: GuidanceRecord | null;
  failModeLabel: string;
  showRetry: false;
};

export type MalformedDisplay = {
  kind: "malformed";
  title: string;
  body: string;
  showRetry: true;
  retryLabel: string;
};

export type ExpiredDisplay = {
  kind: "expired";
  notice: string;
  evidenceNote: string;
  showRetry: false;
};

export type SessionFailureDisplay =
  | NotSavedEmptyDisplay
  | MalformedDisplay
  | ExpiredDisplay;

/**
 * Classify a page status as one session-failure kind. Status is already a
 * single winner (expired before report_error before malformed before
 * not_saved_empty in projectResultsPage). Live, loading_report, ready, and
 * report_error are not session failures. Identity and session-change reset
 * stay in the caller; this mapping has no retained session state.
 */
export function classifySessionFailure(status: string): SessionFailureKind | null {
  if (status === "not_saved_empty") {
    return "not_saved_empty";
  }
  if (status === "malformed") {
    return "malformed";
  }
  if (status === "expired") {
    return "expired";
  }
  return null;
}

function sanitizeGuidanceRecord(record: GuidanceRecord | null): GuidanceRecord | null {
  if (record === null) {
    return null;
  }
  if (record.kind === "instruction") {
    return {
      ...record,
      title: stripBracketedMarkers(record.title),
      body: stripBracketedMarkers(record.body),
    };
  }
  return { ...record, body: stripBracketedMarkers(record.body) };
}

/**
 * Empty not-saved panel still uses poll state so RESULT_GUIDANCE copy and
 * the trimmed failModeLabel stay visible when report data did not survive.
 * Use only failModeLabel; do not substitute backend reason tokens.
 */
export function projectNotSavedEmptyFailure(
  pollState?: string,
  failModeLabel?: string,
): NotSavedEmptyDisplay {
  return {
    kind: "not_saved_empty",
    title: NOT_SAVED_EMPTY_TITLE,
    body: NOT_SAVED_EMPTY_BODY,
    guidance: sanitizeGuidanceRecord(guidanceFor(pollState)),
    failModeLabel: (failModeLabel ?? "").trim(),
    showRetry: false,
  };
}

export function projectMalformedFailure(): MalformedDisplay {
  return {
    kind: "malformed",
    title: MALFORMED_TITLE,
    body: MALFORMED_BODY,
    showRetry: true,
    retryLabel: MALFORMED_RETRY_LABEL,
  };
}

export function projectExpiredFailure(): ExpiredDisplay {
  return {
    kind: "expired",
    notice: EXPIRED_NOTICE,
    evidenceNote: EXPIRED_EVIDENCE_NOTE,
    showRetry: false,
  };
}

/**
 * One session-failure panel or none. Kind comes only from the current status,
 * so a later call for a new session cannot reuse a prior failure.
 */
export function projectSessionFailure(
  status: string,
  pollState?: string,
  failModeLabel?: string,
): SessionFailureDisplay | null {
  const kind = classifySessionFailure(status);
  if (kind === "not_saved_empty") {
    return projectNotSavedEmptyFailure(pollState, failModeLabel);
  }
  if (kind === "malformed") {
    return projectMalformedFailure();
  }
  if (kind === "expired") {
    return projectExpiredFailure();
  }
  return null;
}
