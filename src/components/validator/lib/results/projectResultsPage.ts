/**
 * Pure page projection for the RESULTS island. Composes the RO-1B.1 through
 * RO-1B.11 helpers into one terminal-or-live projection. Inputs to outputs
 * only: no React, hooks, refs, or session state. Terminal-report precedence
 * (SF-4.1) is delegated to selectTerminalReport; the two reports are never
 * merged.
 */

import type { EvidenceGrade, EvidenceItem } from "../evidence/types";
import {
  isReportNotPublicFailure,
  type ReportResponse,
  type ReportVisibility,
  type SessionPollResponse,
  type ValidatorFailure,
} from "../validatorFetch";
import { selectPrimaryReasonItem, type ReasonSeverity } from "../validatorReasons";
import type { MachineView } from "../stateMachine";
import {
  CANONICAL_AREA_IDS,
  isCanonicalAreaId,
  isUsableSpecificationScore,
  projectValidatorScore,
  specificationFromReport,
  type CanonicalAreaId,
  type ValidatorScoreOutcomeKind,
  type ValidatorScoreProjection,
} from "../validatorScore";
import { AREA_DESCRIPTIONS } from "../score/areas";
import { isRecord } from "../validatorShared";
import {
  evidenceModeFor,
  projectPublicReportAvailability,
  projectReportVisibility,
  type EvidenceMode,
} from "./capability";
import {
  selectTerminalReport,
  type TerminalReportSourceKind,
} from "./terminalReport";
// verdictKindFromScore is a pure verdict mapper defined in a sibling lib
// module. The VerdictBanner atom re-exports it so the banner and this
// projection share one definition and cannot diverge.
import { verdictKindFromScore, type VerdictKind } from "./verdict";

export const CACHED_SESSION_JSON_NOTE =
  "This is the last live session snapshot. The overall result above was computed from its area scores and the final session state.";

const DEFAULT_BANNER_BODY: Record<ValidatorScoreOutcomeKind, string> = {
  compatible: "This server passed all assessed OCM compatibility areas.",
  compatible_with_warnings:
    "This server supports OCM, but some assessed areas need attention.",
  compatibility_failed: "One or more required checks failed.",
  scan_interrupted: "The scan ended before a result was available.",
  inconclusive: "The scan finished, but no compatibility area could be assessed.",
  result_unavailable:
    "The scan finished, but the validator returned result data this page could not read.",
};

export type ResultsPageStatus =
  | "live"
  | "loading_report"
  | "ready"
  | "not_saved_empty"
  | "malformed"
  | "expired"
  | "report_error";

export interface ResultsPageProjection {
  status: ResultsPageStatus;
  visibility: ReportVisibility;
  score: ValidatorScoreProjection;
  sourceReport: ReportResponse | null;
  sourceKind: TerminalReportSourceKind;
  showAreas: boolean;
  reportUrl: string | null;
  showPublicActions: boolean;
  bannerVerdict: VerdictKind | null;
  bannerTitle: string;
  bannerMessage: string;
  evidenceMode: EvidenceMode;
  evidence: EvidenceItem[];
  rawJsonNote: string | null;
  rawJsonTitle: string;
  reportFailure: ValidatorFailure | null;
}

function asGrade(value: unknown): EvidenceGrade | null {
  return value === "pass" || value === "fail" || value === "warn" ? value : null;
}

function evidenceItems(value: unknown): EvidenceItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: EvidenceItem[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) {
      continue;
    }
    const item: EvidenceItem = {};
    if (typeof raw.area === "string") item.area = raw.area;
    if (typeof raw.scoreArea === "string") item.scoreArea = raw.scoreArea;
    if (typeof raw.leg === "string") item.leg = raw.leg;
    if (typeof raw.step === "string") item.step = raw.step;
    if (typeof raw.reasonCode === "string") item.reasonCode = raw.reasonCode;
    if (typeof raw.severity === "string") item.severity = raw.severity;
    if (raw.grade === null) item.grade = null;
    const grade = asGrade(raw.grade);
    if (grade !== null) item.grade = grade;
    if (typeof raw.affectsGrade === "boolean") item.affectsGrade = raw.affectsGrade;
    if (typeof raw.payloadRedacted === "boolean") {
      item.payloadRedacted = raw.payloadRedacted;
    } else if (typeof raw.payloadRedacted === "string") {
      item.payloadRedacted = raw.payloadRedacted !== "";
    }
    if (typeof raw.createdAt === "string") {
      item.createdAt = raw.createdAt;
    } else if (typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)) {
      item.createdAt = String(raw.createdAt);
    }
    items.push(item);
  }
  return items;
}

// Evidence rows scoped to one canonical area. scoreArea wins over area,
// matching AreaModal; rows with neither field are excluded.
function areaEvidenceItems(
  items: readonly EvidenceItem[],
  areaId: CanonicalAreaId,
): EvidenceItem[] {
  return items.filter((item) => (item.scoreArea ?? item.area) === areaId);
}

// Primary reason slug per canonical area. Selected with the shared precedence
// (affectsGrade true > undefined > false, then grade fail > warn > pass > null,
// source order for ties) so warn and fail cards can explain the outcome and
// stay consistent with primaryReasonsByArea and AreaModal.
export function primaryReasonCodesByArea(
  items: readonly EvidenceItem[],
): Partial<Record<CanonicalAreaId, string>> {
  const byArea: Partial<Record<CanonicalAreaId, string>> = {};
  for (const areaId of CANONICAL_AREA_IDS) {
    const primary = selectPrimaryReasonItem(areaEvidenceItems(items, areaId));
    if (primary === undefined) {
      continue;
    }
    const code = typeof primary.reasonCode === "string" ? primary.reasonCode.trim() : "";
    if (code === "") {
      continue;
    }
    byArea[areaId] = code;
  }
  return byArea;
}

// Primary reason outcome per canonical area, selected by the same precedence as
// primaryReasonCodesByArea and AreaModal so both functions choose the same item.
// Carries the grade, severity, and affectsGrade of that row so warn/fail cards
// can resolve reason copy from the primary item rather than the aggregate grade.
export function primaryReasonsByArea(
  items: readonly EvidenceItem[],
): Partial<
  Record<CanonicalAreaId, { grade: ReasonSeverity | null; severity?: string; affectsGrade?: boolean }>
> {
  const byArea: Partial<
    Record<CanonicalAreaId, { grade: ReasonSeverity | null; severity?: string; affectsGrade?: boolean }>
  > = {};
  for (const areaId of CANONICAL_AREA_IDS) {
    const primary = selectPrimaryReasonItem(areaEvidenceItems(items, areaId));
    if (primary === undefined) {
      continue;
    }
    const code = typeof primary.reasonCode === "string" ? primary.reasonCode.trim() : "";
    if (code === "") {
      continue;
    }
    byArea[areaId] = {
      grade: primary.grade ?? null,
      severity: primary.severity,
      affectsGrade: primary.affectsGrade,
    };
  }
  return byArea;
}

// Count of loaded evidence rows per canonical area. scoreArea wins over area,
// matching the primary-reason selection; lets a card stay interactive when
// loaded evidence exists even if the reported score was zero.
export function loadedEvidenceCountsByArea(
  items: readonly EvidenceItem[],
): Partial<Record<CanonicalAreaId, number>> {
  const byArea: Partial<Record<CanonicalAreaId, number>> = {};
  for (const item of items) {
    const areaId = item.scoreArea ?? item.area;
    if (areaId === undefined || !isCanonicalAreaId(areaId)) {
      continue;
    }
    byArea[areaId] = (byArea[areaId] ?? 0) + 1;
  }
  return byArea;
}

export function specificationInputFromReport(report: ReportResponse | null): unknown {
  if (report === null) {
    return undefined;
  }
  const nested = specificationFromReport(report);
  return nested !== undefined ? nested : report.score;
}

export function bannerBody(score: ValidatorScoreProjection): string {
  if (score.showFailModeLabel) {
    const label = score.failModeLabel;
    if (label !== undefined && label.trim() !== "") {
      return label;
    }
  }
  return DEFAULT_BANNER_BODY[score.outcome];
}

export function projectResultsPage(input: {
  poll: SessionPollResponse | null;
  view: MachineView | null;
  lastLiveReport: ReportResponse | null;
  terminalReport: ReportResponse | null;
  reportFailure: ValidatorFailure | null;
  validatorApiOrigin: string;
}): ResultsPageProjection {
  const pollState = input.poll?.state ?? "";
  const terminal = input.view?.terminalize === true;
  const failure = input.reportFailure;
  const notPublic = failure !== null && isReportNotPublicFailure(failure);
  const expired = failure !== null && failure.kind === "expired";
  const { sourceReport, sourceKind } = selectTerminalReport({
    terminal,
    terminalReport: input.terminalReport,
    lastLiveReport: input.lastLiveReport,
    notPublic,
  });
  const evidence = evidenceItems(sourceReport?.evidence);
  const score = projectValidatorScore({
    pollState: pollState === "" ? null : pollState,
    specification: specificationInputFromReport(sourceReport),
    reportOk: input.terminalReport !== null,
    failModeLabel: input.poll?.failModeLabel,
    descriptions: AREA_DESCRIPTIONS,
    reasonCodes: primaryReasonCodesByArea(evidence),
    primaryReasons: primaryReasonsByArea(evidence),
    loadedEvidenceByArea: loadedEvidenceCountsByArea(evidence),
  });
  const usable = isUsableSpecificationScore(score.parsed);

  const visibility = projectReportVisibility({
    terminal,
    terminalReport: input.terminalReport,
    notPublic,
    expired,
  });
  const { reportUrl, showPublicActions } = projectPublicReportAvailability(
    visibility,
    input.terminalReport,
    input.validatorApiOrigin,
  );

  let status: ResultsPageStatus;
  if (!terminal) {
    status = "live";
  } else if (input.terminalReport === null && failure === null) {
    status = "loading_report";
  } else if (expired) {
    status = "expired";
  } else if (failure !== null && !notPublic && input.terminalReport === null) {
    status = "report_error";
  } else if (
    !usable &&
    (input.terminalReport !== null || (notPublic && input.lastLiveReport !== null))
  ) {
    status = "malformed";
  } else if (notPublic && input.lastLiveReport === null) {
    status = "not_saved_empty";
  } else {
    status = "ready";
  }

  const showAreas = status === "ready" && usable;
  const live = status === "live";
  const bannerVerdict: VerdictKind | null = live
    ? "running"
    : status === "ready"
      ? verdictKindFromScore({
          grade: score.grade,
          state: score.terminalState ?? pollState,
        })
      : null;
  const bannerTitle = live ? "Scan in progress" : score.headline;
  const bannerMessage = live
    ? "The validator is still checking this server."
    : bannerBody(score);
  const cached = sourceKind === "cached_session";

  return {
    status,
    visibility,
    score,
    sourceReport,
    sourceKind,
    showAreas,
    reportUrl,
    showPublicActions,
    bannerVerdict,
    bannerTitle,
    bannerMessage,
    evidenceMode: evidenceModeFor(visibility, evidence),
    evidence,
    rawJsonNote: cached ? CACHED_SESSION_JSON_NOTE : null,
    rawJsonTitle: cached ? "Last session JSON" : "Raw report JSON",
    reportFailure: failure,
  };
}
