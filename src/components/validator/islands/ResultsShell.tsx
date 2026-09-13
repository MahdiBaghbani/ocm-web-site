/**
 * RESULTS island. Polls a session, caches the last live report, and projects
 * a private or public terminal result without treating report_not_public as a
 * load error.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, CircleMinus, CircleX, TriangleAlert } from "lucide-react";
import AreaGrid from "../atoms/AreaGrid";
import AreaModal from "../atoms/AreaModal";
import EvidenceDisclosure, { type EvidenceItem } from "../atoms/EvidenceDisclosure";
import ReportJsonModal from "../atoms/ReportJsonModal";
import StepRow from "../atoms/StepRow";
import VerdictBanner, {
  verdictKindFromScore,
  type VerdictKind,
} from "../atoms/VerdictBanner";
import type { GradeKind } from "../atoms/Pill";
import {
  fetchConfigSource,
  loadValidatorConfig,
  type ValidatorRuntimeConfig,
} from "../lib/validatorConfig";
import {
  isReportNotPublicFailure,
  joinValidatorUrl,
  resolvePublicReportUrl,
  type ReportResponse,
  type ReportVisibility,
  type SessionPollResponse,
  type ValidatorFailure,
  type ValidatorFetchDeps,
} from "../lib/validatorFetch";
import { selectPrimaryReasonItem, type ReasonSeverity } from "../lib/validatorReasons";
import { runResultsPollLoop } from "../lib/resultsPoll";
import {
  USER_STEPS,
  type MachineView,
  type NextInstruction,
  type UserStep,
} from "../lib/stateMachine";
import { guidanceFor, type GuidanceRecord } from "../lib/validatorGuidance";
import {
  normalizeHost,
  normalizeSessionId,
  parseValidatorUrlState,
  type ValidatorUrlState,
} from "../lib/urlState";
import { isRecord } from "../lib/validatorShared";
import {
  CANONICAL_AREA_IDS,
  isCanonicalAreaId,
  isUsableSpecificationScore,
  projectValidatorScore,
  specificationFromReport,
  type CanonicalAreaId,
  type SpecificationAreaGridEntry,
  type ValidatorScoreOutcomeKind,
  type ValidatorScoreProjection,
} from "../lib/validatorScore";

export interface ResultsShellProps {
  host?: string;
  id?: string;
  testHref?: string;
}

export const TEST_HREF = "/validator/";

export const AREA_DESCRIPTIONS: Record<CanonicalAreaId, string> = {
  discovery: "Can other servers find this server's OCM endpoint?",
  tls: "Can the validator connect securely over HTTPS?",
  jwks: "Does the server publish a usable JWKS document?",
  httpsig: "Do HTTP signatures validate as the specification requires?",
  sharing: "Does it expose the expected remote sharing operations?",
  notification: "Does it send and accept the required notifications?",
  token: "Can it issue and accept the required access tokens?",
  capability: "Does the server advertise the required sharing features?",
};

export const VISIBILITY_NOTICE: Record<ReportVisibility, string> = {
  session: "Live session. This is not a public report.",
  permanent: "Public report. Anyone with the link can view it.",
  not_saved: "Not saved. No public report link exists.",
  expired: "Report expired. The saved report is no longer available.",
  unknown: "Report visibility is unavailable.",
};

export const CACHED_SESSION_JSON_NOTE =
  "This is the last live session snapshot. The overall result above was computed from its area scores and the final session state.";

export const EVIDENCE_NOT_SAVED =
  "No saved evidence is available because this report was not public.";

export const EVIDENCE_EMPTY_SNAPSHOT =
  "No evidence items were included in this session snapshot.";

export const EVIDENCE_EXPIRED =
  "Evidence cannot be loaded because the saved report is no longer available.";

export const PAGE_LINK_NOT_SAVED_NOTICE =
  "Not saved. This result was not stored as a public report. A copied page link identifies the session but does not preserve these scores or evidence.";

const PAGE_LINK_READONLY_PARAM = "ro";
const PAGE_LINK_READONLY_VALUE = "1";

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

const STEP_ANNOUNCE: Record<UserStep, string> = {
  probe: "Checking server capabilities.",
  queue_or_rest: "Continuing or finishing the scan.",
  invite: "Waiting for invitation steps.",
  reverse: "Waiting for the return invitation.",
  share: "Testing sharing.",
  result: "Preparing the result.",
};

const ACTION_BTN =
  "inline-flex min-h-11 items-center rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800";

// AG-2.2 reserved the in-row `data-cta-slot` column StepRow already
// renders for every row (sized for "Copy invitation", "Copy again", and
// the secondary report link). AG-2.3 wires only the live "View report"
// secondary link on the current row. Copy/paste actions stay unwired.
// The reverse form slot is sized for a label, textarea, submit button,
// and one alert line, so wiring those later does not shift this layout.
// The form slot mounts inside the reverse row's own StepRow card (via
// its formSlot prop), not as a sibling element.
const RESERVED_REVERSE_FORM_CLASS = "invisible min-h-56 w-full";

function ReservedReverseForm(): React.ReactElement {
  return (
    <div data-reserved-form-slot="" aria-hidden="true" className={RESERVED_REVERSE_FORM_CLASS} />
  );
}

// Defensive strip for any bracketed planning marker (for example "[wip]")
// that should never reach a screen reader, even though locked copy has none.
const BRACKET_MARKER_PATTERN = /\[[^\]]*\]/g;

export function stripBracketedMarkers(value: string): string {
  return value.replace(BRACKET_MARKER_PATTERN, "").replace(/\s+/g, " ").trim();
}

/**
 * Defensive bracket stripping for a guidance record's title and body, not
 * just the single-line announcement. Applies to whatever guidance record is
 * handed to the current row, so any bracketed planning marker never reaches
 * the visible guidance slot (which is also what a screen reader announces).
 */
export function sanitizeGuidanceRecord(
  record: GuidanceRecord | null,
): GuidanceRecord | null {
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
 * One-poll hold for a nonterminal instruction that comes back omitted or
 * unknown. `lastValidKey` and `lastValidView` retain the last genuine
 * instruction so the row list and cadence do not flicker back to "probe" for
 * a single bad poll; `held` marks that the one-poll grace period was already
 * spent so a persistent unknown state falls back to the unknown-key title
 * instead of holding forever.
 */
export interface LiveInstructionHold {
  lastValidView: MachineView | null;
  lastValidKey: NextInstruction | null;
  held: boolean;
}

export const INITIAL_LIVE_INSTRUCTION_HOLD: LiveInstructionHold = {
  lastValidView: null,
  lastValidKey: null,
  held: false,
};

export interface StabilizedLiveView {
  view: MachineView;
  /** Raw guidance lookup key: a known/unknown instruction string, or null. */
  guidanceKey: string | null;
}

function rawInstructionKey(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Stabilize one poll's resolved view against the previous hold state. A
 * terminal poll always wins immediately. A genuine instruction replaces the
 * hold normally. The first omitted/unknown instruction after a genuine one
 * holds the last valid view and instruction for one poll; a persistent
 * omitted/unknown instruction keeps that last safe view (and its cadence)
 * but exposes the current raw key so the caller can fall back to the
 * unknown-key guidance instead of the stale title.
 */
export function stabilizeLiveView(
  view: MachineView,
  rawInstruction: string | null | undefined,
  hold: LiveInstructionHold,
): { stabilized: StabilizedLiveView; hold: LiveInstructionHold } {
  const raw = rawInstructionKey(rawInstruction);

  if (view.terminalize) {
    return {
      stabilized: { view, guidanceKey: null },
      hold: INITIAL_LIVE_INSTRUCTION_HOLD,
    };
  }

  if (view.instruction !== null) {
    return {
      stabilized: { view, guidanceKey: view.instruction },
      hold: { lastValidView: view, lastValidKey: view.instruction, held: false },
    };
  }

  if (hold.lastValidView === null) {
    return { stabilized: { view, guidanceKey: raw }, hold };
  }

  if (!hold.held) {
    return {
      stabilized: { view: hold.lastValidView, guidanceKey: hold.lastValidKey },
      hold: { ...hold, held: true },
    };
  }

  return {
    stabilized: { view: hold.lastValidView, guidanceKey: raw },
    hold,
  };
}

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
  sourceKind: "terminal" | "cached_session" | "none";
  showAreas: boolean;
  reportUrl: string | null;
  showPublicActions: boolean;
  bannerVerdict: VerdictKind | null;
  bannerTitle: string;
  bannerMessage: string;
  evidenceMode: "disclosure" | "not_saved" | "expired" | "session" | "none";
  evidence: EvidenceItem[];
  rawJsonNote: string | null;
  rawJsonTitle: string;
  reportFailure: ValidatorFailure | null;
}

function requestDeps(
  config: ValidatorRuntimeConfig,
  signal?: AbortSignal,
): ValidatorFetchDeps {
  return {
    origin: config.validatorApiOrigin,
    timeoutMs: config.requestTimeoutMs,
    backoffInitialMs: config.backoffInitialMs,
    backoffMaxMs: config.backoffMaxMs,
    signal,
  };
}

function sessionFromProps(host?: string, id?: string): ValidatorUrlState | null {
  if (host === undefined || id === undefined) {
    return null;
  }
  const normalizedHost = normalizeHost(host);
  const normalizedId = normalizeSessionId(id);
  if (normalizedHost === null || normalizedId === null) {
    return null;
  }
  return { host: normalizedHost, id: normalizedId };
}

function sessionFromLocation(host?: string, id?: string): ValidatorUrlState | null {
  const fromProps = sessionFromProps(host, id);
  if (fromProps !== null) {
    return fromProps;
  }
  if (typeof window === "undefined") {
    return null;
  }
  const parsed = parseValidatorUrlState(window.location.href);
  return parsed.ok ? parsed.state : null;
}

function sessionLinkErrorMessage(): string {
  if (typeof window === "undefined") {
    return "This result link is incomplete.";
  }
  const parsed = parseValidatorUrlState(window.location.href);
  if (parsed.ok) {
    return "This result link is incomplete.";
  }
  if (
    parsed.reason === "invalid_host" ||
    parsed.reason === "invalid_id" ||
    parsed.reason === "invalid_url"
  ) {
    return "This result link has an invalid session ID.";
  }
  return "This result link is incomplete.";
}

function asGrade(value: unknown): GradeKind | null {
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

function visibleIndex(statuses: MachineView["statuses"], step: UserStep): number {
  let index = 0;
  for (const item of USER_STEPS) {
    if (statuses[item] === "hidden") {
      continue;
    }
    index += 1;
    if (item === step) {
      return index;
    }
  }
  return index;
}

/**
 * Live session report href. Shown only when origin is a normalized real
 * origin. An empty origin has no proxy-confirmation contract, so the link
 * stays hidden instead of falling back to a relative /validator path.
 * Built with joinValidatorUrl so that helper supplies the /validator prefix.
 * Do not use resolvePublicReportUrl here: that helper rejects an empty
 * origin, and this live route must stay independent of the permanent
 * public-report URL.
 */
export function liveViewReportHref(origin: string, sessionId: string): string | null {
  const trimmedOrigin = origin.trim();
  if (trimmedOrigin === "") {
    return null;
  }
  return joinValidatorUrl(trimmedOrigin, `/report/${encodeURIComponent(sessionId)}`);
}

export function specificationInputFromReport(report: ReportResponse | null): unknown {
  if (report === null) {
    return undefined;
  }
  const nested = specificationFromReport(report);
  return nested !== undefined ? nested : report.score;
}

export function resultAreaEntries(
  areas: readonly SpecificationAreaGridEntry[],
): SpecificationAreaGridEntry[] {
  return areas.map((entry) => {
    if (entry.pillLabel !== undefined) {
      return entry;
    }
    if (entry.grade === "pass") {
      return { ...entry, pillLabel: "Pass" };
    }
    if (entry.grade === "warn") {
      return { ...entry, pillLabel: "Needs attention" };
    }
    if (entry.grade === "fail") {
      return { ...entry, pillLabel: "Fail" };
    }
    return entry;
  });
}

export function areaTotals(areas: readonly SpecificationAreaGridEntry[]): {
  passed: number;
  warn: number;
  failed: number;
  rest: number;
} {
  let passed = 0;
  let warn = 0;
  let failed = 0;
  let rest = 0;
  for (const area of areas) {
    if (area.grade === "pass") {
      passed += 1;
    } else if (area.grade === "warn") {
      warn += 1;
    } else if (area.grade === "fail") {
      failed += 1;
    } else {
      rest += 1;
    }
  }
  return { passed, warn, failed, rest };
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

export function progressAnnouncement(
  view: MachineView,
  guidanceKey: string | null,
): string {
  let visible = 0;
  let current = 1;
  for (const step of USER_STEPS) {
    if (view.statuses[step] === "hidden") {
      continue;
    }
    visible += 1;
    if (step === view.step) {
      current = visible;
    }
  }
  const guidanceRecord = guidanceFor(guidanceKey);
  const guidanceTitle =
    guidanceRecord !== null && guidanceRecord.kind === "instruction"
      ? guidanceRecord.title
      : undefined;
  const shortTitle =
    guidanceTitle !== undefined && guidanceTitle !== "" ? guidanceTitle : STEP_ANNOUNCE[view.step];
  return `Step ${current} of ${visible}: ${stripBracketedMarkers(shortTitle)}`;
}

function evidenceModeFor(
  visibility: ReportVisibility,
  items: EvidenceItem[],
): ResultsPageProjection["evidenceMode"] {
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
  const sourceReport =
    !terminal
      ? null
      : input.terminalReport !== null
        ? input.terminalReport
        : notPublic
          ? input.lastLiveReport
          : null;
  const sourceKind: ResultsPageProjection["sourceKind"] =
    input.terminalReport !== null
      ? "terminal"
      : sourceReport !== null
        ? "cached_session"
        : "none";
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

  let visibility: ReportVisibility;
  if (!terminal) {
    visibility = "session";
  } else if (input.terminalReport !== null) {
    visibility = input.terminalReport.visibility;
  } else if (notPublic) {
    visibility = "not_saved";
  } else if (expired) {
    visibility = "expired";
  } else {
    visibility = "unknown";
  }

  const candidate = input.terminalReport?.reportUrl ?? input.terminalReport?.url;
  const reportUrl =
    visibility === "permanent"
      ? resolvePublicReportUrl(candidate, input.validatorApiOrigin)
      : null;
  const showPublicActions = visibility === "permanent" && reportUrl !== null;

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

type SummaryChipIcon = "pass" | "warn" | "fail" | "not-tested";

function summaryChipCounts(
  areas: readonly Pick<SpecificationAreaGridEntry, "grade">[],
): { pass: number; warn: number; fail: number; notTested: number } {
  let pass = 0;
  let warn = 0;
  let fail = 0;
  let notTested = 0;
  for (const area of areas) {
    if (area.grade === "pass") {
      pass += 1;
    } else if (area.grade === "warn") {
      warn += 1;
    } else if (area.grade === "fail") {
      fail += 1;
    } else {
      notTested += 1;
    }
  }
  return { pass, warn, fail, notTested };
}

const SUMMARY_CHIPS = [
  { icon: "pass", label: "pass", text: "text-emerald-300", Icon: CircleCheck },
  { icon: "warn", label: "warn", text: "text-amber-200", Icon: TriangleAlert },
  { icon: "fail", label: "fail", text: "text-rose-300", Icon: CircleX },
  { icon: "not-tested", label: "not tested", text: "text-zinc-300", Icon: CircleMinus },
] as const satisfies ReadonlyArray<{
  icon: SummaryChipIcon;
  label: string;
  text: string;
  Icon: typeof CircleCheck;
}>;

function SummaryChipBand({
  areas,
  assessed,
  total,
  coverageLabel,
}: {
  areas: readonly SpecificationAreaGridEntry[];
  assessed: number;
  total: number;
  coverageLabel: string;
}): React.ReactElement {
  const counts = summaryChipCounts(areas);
  const countFor: Record<SummaryChipIcon, number> = {
    pass: counts.pass,
    warn: counts.warn,
    fail: counts.fail,
    "not-tested": counts.notTested,
  };
  const sentence =
    `${assessed} of ${total} areas tested: ${counts.pass} pass, ` +
    `${counts.warn} warn, ${counts.fail} fail, ${counts.notTested} not tested`;
  return (
    <>
      <div
        data-summary-chips=""
        className="grid min-h-[5.5rem] grid-cols-2 gap-2 sm:min-h-11 sm:grid-cols-4"
      >
        {SUMMARY_CHIPS.map((chip) => {
          const Icon = chip.Icon;
          return (
            <span
              key={chip.icon}
              data-icon={chip.icon}
              className={`inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/40 px-2.5 py-0.5 text-xs tabular-nums ${chip.text}`}
              aria-hidden="true"
            >
              <Icon size={16} strokeWidth={2} aria-hidden="true" />
              <span className="min-w-[1ch]">{countFor[chip.icon]}</span>
              <span>{chip.label}</span>
            </span>
          );
        })}
      </div>
      <p className="text-sm text-zinc-300" data-summary-coverage="">
        {coverageLabel} areas tested
      </p>
      <span className="sr-only" data-summary-sr="">
        {sentence}
      </span>
    </>
  );
}

function BackToTest({ href }: { href: string }): React.ReactElement {
  return (
    <a href={href} className={`${ACTION_BTN} text-zinc-200`}>
      Back to Test
    </a>
  );
}

function RunNewCheck({ href }: { href: string }): React.ReactElement {
  return (
    <a href={href} className={ACTION_BTN}>
      Run a new check
    </a>
  );
}

function ReloadButton({ label }: { label: string }): React.ReactElement {
  return (
    <button
      type="button"
      className={ACTION_BTN}
      onClick={() => {
        if (typeof window !== "undefined") {
          window.location.reload();
        }
      }}
    >
      {label}
    </button>
  );
}

function pageLinkIsReadOnly(href: string): boolean {
  try {
    return new URL(href).searchParams.get(PAGE_LINK_READONLY_PARAM) === PAGE_LINK_READONLY_VALUE;
  } catch {
    return false;
  }
}

function pageLinkHref(status: ResultsPageStatus, href: string): string {
  if (status !== "live") {
    return href;
  }
  try {
    const url = new URL(href);
    url.searchParams.set(PAGE_LINK_READONLY_PARAM, PAGE_LINK_READONLY_VALUE);
    return url.href;
  } catch {
    return href;
  }
}

function readOnlyStop(): Promise<{
  ok: false;
  kind: "aborted";
  status: null;
  error: string;
  message: string;
}> {
  return Promise.resolve({
    ok: false,
    kind: "aborted",
    status: null,
    error: "aborted",
    message: "",
  });
}

export type CopyNotice = {
  ok: boolean;
  text: string;
};

export const EMPTY_COPY_NOTICE: CopyNotice = { ok: true, text: "" };
export const COPY_SUCCESS_TEXT = "Copied";

function clipboardWriter(): Clipboard | undefined {
  if (
    typeof window === "undefined" ||
    window.isSecureContext !== true ||
    typeof navigator === "undefined"
  ) {
    return undefined;
  }
  const clipboard = navigator.clipboard;
  if (clipboard === undefined || typeof clipboard.writeText !== "function") {
    return undefined;
  }
  return clipboard;
}

function createOffscreenCopyTextarea(value: string): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  // 1px offscreen. display:none and the old opacity:0 fixed trick both break
  // selection in some browsers, so the node stays measurable for the copy.
  textarea.style.position = "absolute";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.padding = "0";
  textarea.style.border = "0";
  textarea.style.overflow = "hidden";
  return textarea;
}

function restorePriorFocus(previousActive: Element | null, textarea: HTMLTextAreaElement): void {
  if (
    previousActive instanceof HTMLElement &&
    previousActive !== textarea &&
    previousActive.isConnected
  ) {
    try {
      previousActive.focus({ preventScroll: true });
    } catch {
      // Focus restore is best-effort.
    }
  }
}

// Shared page-link / report-link / later AG-1.4 copy helper. Tier 2 execCommand
// is best-effort only; a true return is not a guarantee on every browser.
export async function copyText(value: string): Promise<boolean> {
  const clipboard = clipboardWriter();
  if (clipboard !== undefined) {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // Clipboard API rejected; try the execCommand fallback.
    }
  }
  if (typeof document === "undefined") {
    return false;
  }
  const previousActive = document.activeElement;
  const textarea = createOffscreenCopyTextarea(value);
  document.body.appendChild(textarea);
  try {
    if (typeof textarea.focus === "function") {
      textarea.focus({ preventScroll: true });
    }
    if (typeof textarea.select === "function") {
      textarea.select();
    }
    if (typeof document.execCommand !== "function") {
      return false;
    }
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    try {
      const parent = textarea.parentNode;
      if (parent !== null) {
        parent.removeChild(textarea);
      }
    } catch {
      // Textarea cleanup is best-effort.
    }
    restorePriorFocus(previousActive, textarea);
  }
}

export function CopyNoticeRegion({
  notice,
  fallbackValue,
}: {
  notice: CopyNotice;
  fallbackValue: string | null;
}): React.ReactElement {
  const successText = notice.ok ? notice.text : "";
  const failureText = notice.ok ? "" : notice.text;
  return (
    <div className="space-y-2">
      <p
        id="results-copy-notice"
        className="text-sm text-zinc-300"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {successText}
      </p>
      {failureText !== "" ? (
        <p
          id="results-copy-failure"
          className="text-sm text-rose-200"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {failureText}
        </p>
      ) : null}
      {fallbackValue !== null ? (
        <input
          type="text"
          readOnly
          value={fallbackValue}
          aria-describedby={failureText !== "" ? "results-copy-failure" : "results-copy-notice"}
          data-copy-fallback=""
          className="w-full rounded-xl border border-rose-400 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
      ) : null}
    </div>
  );
}

export default function ResultsShell({
  host,
  id,
  testHref = TEST_HREF,
}: ResultsShellProps): React.ReactElement {
  const [session, setSession] = useState<ValidatorUrlState | null>(() =>
    sessionFromProps(host, id),
  );
  const [mounted, setMounted] = useState(false);
  const [config, setConfig] = useState<ValidatorRuntimeConfig | null>(null);
  const [poll, setPoll] = useState<SessionPollResponse | null>(null);
  const [view, setView] = useState<MachineView | null>(null);
  const [guidanceKey, setGuidanceKey] = useState<string | null>(null);
  const [lastLiveReport, setLastLiveReport] = useState<ReportResponse | null>(null);
  const [terminalReport, setTerminalReport] = useState<ReportResponse | null>(null);
  const [reportFailure, setReportFailure] = useState<ValidatorFailure | null>(null);
  const [error, setError] = useState("");
  const [copyNotice, setCopyNotice] = useState<CopyNotice>(EMPTY_COPY_NOTICE);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const [rawJsonOpen, setRawJsonOpen] = useState(false);
  const [selectedArea, setSelectedArea] = useState<CanonicalAreaId | null>(null);
  const viewRef = useRef<MachineView | null>(null);
  const liveHoldRef = useRef<LiveInstructionHold>(INITIAL_LIVE_INSTRUCTION_HOLD);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyMountedRef = useRef(true);
  // Live trigger buttons keyed by canonical area id, plus a grid-heading
  // fallback. On close we restore focus by area id so the correct trigger wins
  // even if the modal remounted a fresh button; OverlayFrame does its own
  // restore first and this deferred restore wins afterward.
  const triggerRefs = useRef(new Map<CanonicalAreaId, HTMLButtonElement | null>());
  const gridHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const registerTriggerRef = useCallback(
    (area: CanonicalAreaId, el: HTMLButtonElement | null): void => {
      if (el === null) {
        triggerRefs.current.delete(area);
        return;
      }
      triggerRefs.current.set(area, el);
    },
    [],
  );

  useEffect(() => {
    setMounted(true);
    setSession(sessionFromLocation(host, id));
  }, [host, id]);

  useEffect(() => {
    viewRef.current = null;
    liveHoldRef.current = INITIAL_LIVE_INSTRUCTION_HOLD;
    setPoll(null);
    setView(null);
    setGuidanceKey(null);
    setLastLiveReport(null);
    setTerminalReport(null);
    setReportFailure(null);
    setError("");
    setRawJsonOpen(false);
    setSelectedArea(null);
    setCopyNotice(EMPTY_COPY_NOTICE);
    setCopyFallback(null);
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  }, [session?.host, session?.id]);

  useEffect(() => {
    copyMountedRef.current = true;
    return () => {
      copyMountedRef.current = false;
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const loaded = await loadValidatorConfig(fetchConfigSource(fetch.bind(globalThis)));
      if (controller.signal.aborted) {
        return;
      }
      setConfig(loaded);
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (config === null || session === null) {
      return;
    }
    const controller = new AbortController();
    const readOnly =
      typeof window !== "undefined" && pageLinkIsReadOnly(window.location.href);
    void runResultsPollLoop(
      {
        sessionId: session.id,
        cadence: {
          pollIntervalMs: config.pollIntervalMs,
          activePollIntervalMs: config.activePollIntervalMs,
        },
        deps: requestDeps(config, controller.signal),
        signal: controller.signal,
        // Copied live links use ?ro=1 so this view keeps GET polling but
        // never POSTs /stop.
        readOnly,
        stop: readOnly ? readOnlyStop : undefined,
      },
      {
        onPoll: (data) => {
          setPoll(data);
        },
        onView: (machine, pollData) => {
          const { stabilized, hold } = stabilizeLiveView(
            machine,
            pollData.nextInstruction,
            liveHoldRef.current,
          );
          liveHoldRef.current = hold;
          viewRef.current = stabilized.view;
          setView(stabilized.view);
          setGuidanceKey(stabilized.guidanceKey);
        },
        onReport: (data) => {
          if (viewRef.current?.terminalize === true) {
            setTerminalReport(data);
          } else {
            setLastLiveReport(data);
          }
        },
        onReportFailure: setReportFailure,
        onError: setError,
      },
    );
    return () => controller.abort();
  }, [config, session]);

  const projection = projectResultsPage({
    poll,
    view,
    lastLiveReport,
    terminalReport,
    reportFailure,
    validatorApiOrigin: config?.validatorApiOrigin ?? "",
  });

  function clearCopyTimer(): void {
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  }

  function settleCopyOutcome(ok: boolean, value: string, failureText: string): void {
    clearCopyTimer();
    if (ok) {
      setCopyFallback(null);
      // Commit an empty live-region tick so a repeat copy can re-announce.
      setCopyNotice({ ok: true, text: "" });
      copyTimerRef.current = setTimeout(() => {
        if (!copyMountedRef.current) {
          copyTimerRef.current = null;
          return;
        }
        setCopyNotice({ ok: true, text: COPY_SUCCESS_TEXT });
        copyTimerRef.current = setTimeout(() => {
          if (!copyMountedRef.current) {
            copyTimerRef.current = null;
            return;
          }
          setCopyNotice((current) => (current.ok ? { ok: true, text: "" } : current));
          copyTimerRef.current = null;
        }, 2000);
      }, 0);
      return;
    }
    setCopyFallback(value);
    setCopyNotice({ ok: false, text: failureText });
  }

  async function handleCopyPageLink(): Promise<void> {
    if (session === null || typeof window === "undefined") {
      return;
    }
    const value = pageLinkHref(projection.status, window.location.href);
    const ok = await copyText(value);
    settleCopyOutcome(ok, value, "Could not copy the page link.");
  }

  async function handleCopyReport(): Promise<void> {
    if (projection.reportUrl === null) {
      return;
    }
    const ok = await copyText(projection.reportUrl);
    settleCopyOutcome(
      ok,
      projection.reportUrl,
      "Could not copy the report link. Open the report and copy its address instead.",
    );
  }

  if (session === null) {
    if (!mounted) {
      return <p className="text-sm text-zinc-400">Loading session...</p>;
    }
    return (
      <div className="space-y-4">
        <BackToTest href={testHref} />
        <p className="text-sm text-rose-200" role="alert">
          {sessionLinkErrorMessage()}
        </p>
      </div>
    );
  }

  const resultAreas = resultAreaEntries(projection.score.areas);
  const selectedEntry =
    selectedArea === null
      ? null
      : resultAreas.find((entry) => entry.area === selectedArea) ?? null;
  const statusText =
    projection.status === "live" || projection.status === "loading_report"
      ? view === null
        ? "Loading session..."
        : progressAnnouncement(view, guidanceKey)
      : null;
  const currentRowGuidance: GuidanceRecord | null = sanitizeGuidanceRecord(
    guidanceFor(guidanceKey),
  );
  // Terminal live-row guidance is cleared (guidanceKey is null). The empty
  // not-saved panel still uses the poll state so RESULT_GUIDANCE copy and
  // the trimmed failModeLabel remain visible when report data did not
  // survive. Use only poll.failModeLabel; do not substitute backend reason
  // tokens.
  const emptyStateGuidance: GuidanceRecord | null = sanitizeGuidanceRecord(
    guidanceFor(poll?.state),
  );
  const emptyFailModeLabel = (poll?.failModeLabel ?? "").trim();
  const liveReportHref =
    projection.status === "live"
      ? liveViewReportHref(config?.validatorApiOrigin ?? "", session.id)
      : null;
  const rawJsonLabel = "View full report JSON";
  // Normal ready/live results surface the full report JSON as a low-emphasis
  // footer action; the malformed terminal keeps a prominent action button.
  const readyRawJsonTrigger =
    projection.sourceReport !== null ? (
      <button
        type="button"
        className="text-sm text-zinc-400 underline hover:text-zinc-200"
        aria-haspopup="dialog"
        aria-expanded={rawJsonOpen}
        onClick={() => setRawJsonOpen(true)}
      >
        {rawJsonLabel}
      </button>
    ) : null;
  const malformedRawJsonTrigger =
    projection.sourceReport !== null ? (
      <button
        type="button"
        className={ACTION_BTN}
        aria-haspopup="dialog"
        aria-expanded={rawJsonOpen}
        onClick={() => setRawJsonOpen(true)}
      >
        {rawJsonLabel}
      </button>
    ) : null;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-zinc-100">
            Result for {session.host}
          </p>
          <p className="mt-1 break-all text-sm text-zinc-400">
            Session {session.id}
          </p>
          {projection.status !== "not_saved_empty" ? (
            <>
              <button
                type="button"
                className={`${ACTION_BTN} mt-2`}
                onClick={() => {
                  void handleCopyPageLink();
                }}
              >
                Copy page link
              </button>
              {projection.status === "ready" &&
              projection.visibility === "not_saved" &&
              projection.sourceKind === "cached_session" ? (
                <p className="mt-2 text-sm text-zinc-400">
                  {PAGE_LINK_NOT_SAVED_NOTICE}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      {projection.bannerVerdict !== null &&
      (projection.status === "live" || projection.status === "ready") ? (
        <div data-banner-region="">
          <VerdictBanner
            verdict={projection.bannerVerdict}
            title={projection.bannerTitle}
            message={projection.bannerMessage}
          />
        </div>
      ) : null}
      {statusText !== null ? (
        <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-zinc-400">
          {statusText}
        </p>
      ) : null}
      <CopyNoticeRegion notice={copyNotice} fallbackValue={copyFallback} />
      {error !== "" ? (
        <div className="space-y-3">
          <p className="text-sm text-rose-200" role="alert">
            We could not update this scan. {error}
          </p>
          <div className="flex flex-wrap gap-2">
            <ReloadButton label="Try again" />
            <RunNewCheck href={testHref} />
          </div>
        </div>
      ) : null}
      {view === null ? (
        <p className="text-sm text-zinc-400">Loading session...</p>
      ) : projection.status === "live" ? (
        <div className="space-y-3">
          {USER_STEPS.map((step) => {
            const status = view.statuses[step];
            if (status === "hidden") {
              return null;
            }
            const isCurrent = status === "current";
            return (
              <StepRow
                key={step}
                step={step}
                status={status}
                index={visibleIndex(view.statuses, step)}
                guidance={isCurrent ? currentRowGuidance : undefined}
                ctaHref={isCurrent && liveReportHref !== null ? liveReportHref : undefined}
                formSlot={step === "reverse" ? <ReservedReverseForm /> : undefined}
              />
            );
          })}
        </div>
      ) : null}
      {projection.status === "loading_report" ? (
        <p className="text-sm text-zinc-400">Loading report...</p>
      ) : null}
      {projection.status === "not_saved_empty" ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-100">This scan was not saved</h2>
          <p className="text-sm text-zinc-300">
            The session finished without a saved public report, and result details
            are not available from this link.
          </p>
          {emptyStateGuidance !== null && emptyStateGuidance.kind === "instruction" ? (
            <div className="space-y-1">
              <p className="text-sm font-semibold text-zinc-100">{emptyStateGuidance.title}</p>
              <p className="text-sm text-zinc-300">{emptyStateGuidance.body}</p>
            </div>
          ) : null}
          {emptyStateGuidance !== null && emptyStateGuidance.kind === "terminal" ? (
            <p className="text-sm text-zinc-300">{emptyStateGuidance.body}</p>
          ) : null}
          {emptyFailModeLabel !== "" ? (
            <p className="text-sm text-zinc-300">{emptyFailModeLabel}</p>
          ) : null}
          <RunNewCheck href={testHref} />
        </div>
      ) : null}
      {projection.status === "malformed" ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-100">Result unavailable</h2>
          <p className="text-sm text-zinc-300">
            The scan finished, but the validator returned result data this page
            could not read.
          </p>
          <div className="flex flex-wrap gap-2">
            <ReloadButton label="Try loading again" />
            <RunNewCheck href={testHref} />
          </div>
        </div>
      ) : null}
      {projection.status === "expired" ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">{VISIBILITY_NOTICE.expired}</p>
          <p className="text-sm text-zinc-400">{EVIDENCE_EXPIRED}</p>
          <RunNewCheck href={testHref} />
        </div>
      ) : null}
      {projection.status === "report_error" ? (
        <div className="space-y-3">
          <p className="text-sm text-rose-200" role="alert">
            We could not load this report.
            {projection.reportFailure !== null && projection.reportFailure.message !== ""
              ? ` ${projection.reportFailure.message}`
              : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <ReloadButton label="Try loading again" />
            <RunNewCheck href={testHref} />
          </div>
        </div>
      ) : null}
      {projection.showAreas ? (
        <div className="space-y-4">
          <SummaryChipBand
            areas={projection.score.areas}
            assessed={projection.score.assessed}
            total={projection.score.total}
            coverageLabel={projection.score.coverageLabel}
          />
          <div>
            <h2
              ref={gridHeadingRef}
              tabIndex={-1}
              className="mb-3 text-sm font-semibold text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
            >
              What was tested
            </h2>
            <AreaGrid
              areas={resultAreas}
              variant="results"
              openArea={selectedArea}
              onAreaClick={(areaId) => setSelectedArea(areaId)}
              registerTriggerRef={registerTriggerRef}
            />
          </div>
        </div>
      ) : null}
      {projection.status === "ready" || projection.status === "live" ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">{VISIBILITY_NOTICE[projection.visibility]}</p>
          {projection.visibility === "permanent" ? (
            <p className="text-sm text-zinc-400">The validator retention policy applies.</p>
          ) : null}
        </div>
      ) : null}
      {projection.status === "ready" &&
      projection.showPublicActions &&
      projection.reportUrl !== null &&
      projection.bannerVerdict !== "interrupted" ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            href={projection.reportUrl}
            className={ACTION_BTN}
            target="_blank"
            rel="noreferrer"
          >
            Open public report
          </a>
          <button
            type="button"
            className={ACTION_BTN}
            onClick={() => {
              void handleCopyReport();
            }}
          >
            Copy public report link
          </button>
        </div>
      ) : null}
      {projection.bannerVerdict === "interrupted" ? (
        <div className="flex flex-wrap gap-2"><RunNewCheck href={testHref} /></div>
      ) : null}
      {projection.status === "ready" || projection.status === "live" ? (
        <div className="space-y-4">
          {projection.evidenceMode === "disclosure" ? (
            <EvidenceDisclosure
              title="Evidence"
              items={projection.evidence}
              defaultExpanded={projection.evidence.length > 0}
            />
          ) : null}
          {projection.evidenceMode === "not_saved" ? (
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Evidence</h2>
              <p className="mt-1 text-sm text-zinc-400">{EVIDENCE_EMPTY_SNAPSHOT}</p>
              <p className="mt-1 text-sm text-zinc-400">{EVIDENCE_NOT_SAVED}</p>
            </div>
          ) : null}
          {projection.evidenceMode === "session" && projection.sourceReport !== null ? (
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Evidence</h2>
              <p className="mt-1 text-sm text-zinc-400">{EVIDENCE_EMPTY_SNAPSHOT}</p>
            </div>
          ) : null}
          {projection.evidenceMode === "none" &&
          projection.visibility === "unknown" &&
          projection.sourceReport !== null ? (
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Evidence</h2>
              <p className="mt-1 text-sm text-zinc-400">{EVIDENCE_EMPTY_SNAPSHOT}</p>
            </div>
          ) : null}
          {projection.evidenceMode === "expired" ? (
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Evidence</h2>
              <p className="mt-1 text-sm text-zinc-400">{EVIDENCE_EXPIRED}</p>
            </div>
          ) : null}
          {projection.sourceKind === "cached_session" ? (
            <p className="text-sm text-zinc-400">{CACHED_SESSION_JSON_NOTE}</p>
          ) : null}
          {readyRawJsonTrigger}
        </div>
      ) : null}
      {projection.status === "malformed" ? malformedRawJsonTrigger : null}
      {rawJsonOpen && projection.sourceReport !== null ? (
        <ReportJsonModal
          title={projection.rawJsonTitle}
          sourceReport={projection.sourceReport}
          note={projection.rawJsonNote}
          downloadName={`report-${session.id}.json`}
          onClose={() => setRawJsonOpen(false)}
        />
      ) : null}
      {selectedArea !== null &&
      selectedEntry !== null &&
      projection.sourceReport !== null &&
      (projection.status === "ready" || projection.status === "live") ? (
        <AreaModal
          area={selectedArea}
          areaLabel={selectedEntry.label}
          items={projection.evidence}
          sourceReport={projection.sourceReport}
          grade={selectedEntry.grade}
          pillLabel={selectedEntry.pillLabel}
          evidenceCount={selectedEntry.evidenceCount}
          onClose={() => {
            const area = selectedArea;
            setSelectedArea(null);
            // OverlayFrame removes inert and restores its captured element in a
            // passive-effect cleanup. A microtask would run before that cleanup,
            // so the focus could land while the body is still inert. Defer with
            // setTimeout(0): a macrotask that runs after OverlayFrame's inert
            // cleanup (React flushes passive effects via MessageChannel, which
            // beats the clamped setTimeout) and that the happy-dom tests flush
            // through their act/timer loop. This deferred focus is remount
            // insurance and wins afterward, refocusing the current trigger for
            // the stored area id or the grid heading when the trigger is gone.
            setTimeout(() => {
              if (area === null) {
                return;
              }
              const btn = triggerRefs.current.get(area);
              if (btn !== undefined && btn !== null && btn.isConnected) {
                btn.focus();
              } else {
                gridHeadingRef.current?.focus();
              }
            }, 0);
          }}
        />
      ) : null}
    </div>
  );
}
