/**
 * RESULTS island. Polls a session, caches the last live report, and projects
 * a private or public terminal result without treating report_not_public as a
 * load error.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CircleCheck, CircleMinus, CircleX, TriangleAlert } from "lucide-react";
import AreaGrid from "../atoms/AreaGrid";
import AreaModal from "../atoms/AreaModal";
import EvidenceDisclosure from "../atoms/EvidenceDisclosure";
import ReportJsonModal from "../atoms/ReportJsonModal";
import StepRow from "../atoms/StepRow";
import VerdictBanner, {
  verdictKindFromScore,
  type VerdictKind,
} from "../atoms/VerdictBanner";
import type { GradeKind } from "../atoms/Pill";
import type { EvidenceItem } from "../lib/evidence/types";
import {
  fetchConfigSource,
  loadValidatorConfig,
  type ValidatorRuntimeConfig,
} from "../lib/validatorConfig";
import {
  claimInvite,
  isReportNotPublicFailure,
  joinValidatorUrl,
  postReverseInvite,
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
  type UserStep,
} from "../lib/stateMachine";
import {
  actionErrorCopy,
  guidanceFor,
  type GuidanceRecord,
} from "../lib/validatorGuidance";
import type { ValidatorUrlState } from "../lib/urlState";
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
import { AREA_DESCRIPTIONS } from "../lib/score/areas";
import {
  progressAnnouncement,
  progressStatusText,
  stripBracketedMarkers,
} from "../lib/results/progress";
import {
  projectSessionStart,
  sessionFromLocation,
  sessionFromProps,
  SESSION_START_LOADING_TEXT,
} from "../lib/results/sessionStart";
import {
  INITIAL_LIVE_INSTRUCTION_HOLD,
  stabilizeLiveView,
  type LiveInstructionHold,
} from "../lib/results/stabilizeLiveView";

export { AREA_DESCRIPTIONS } from "../lib/score/areas";
export { progressAnnouncement, stripBracketedMarkers };
export { INITIAL_LIVE_INSTRUCTION_HOLD, stabilizeLiveView };

export interface ResultsShellProps {
  host?: string;
  id?: string;
  testHref?: string;
}

export const TEST_HREF = "/validator/";

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

const ACTION_BTN =
  "inline-flex min-h-11 items-center rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800";

// AG-2.2 reserved the in-row `data-cta-slot` column StepRow already
// renders for every row (sized for "Copy invitation", "Copy again", and
// the secondary report link). AG-2.3 wires the live "View report"
// secondary link on the current row. AG-1.4 wires the primary
// "Copy invitation" / "Copy again" claim CTA plus the cached-invite field on
// the current paste_s1 row (see InvitePasteSlot). AG-1.5 wires the bounded
// reverse-invite form into this same slot, but only while the displayed
// instruction is exactly paste_s2; every other reverse-row state (pending,
// complete, or current at wait_forward_share) keeps the invisible reserved
// placeholder below so the layout never shifts. The slot mounts inside the
// reverse row's own StepRow card (via its formSlot prop), not as a sibling
// element.
const RESERVED_REVERSE_FORM_CLASS = "invisible min-h-56 w-full";
const REVERSE_FORM_CLASS = "mt-3 min-h-56 w-full space-y-3";

// AG-1.5 bounded length for the unpadded base64url(token@fqdn) reverse
// invite shape. A DNS fqdn is at most 253 ASCII characters; with a generous
// allowance for the token half, unpadded base64url inflates plaintext by
// roughly 4/3. 512 covers that with headroom without accepting arbitrary
// pasted text.
export const MAX_REVERSE_INVITE_LENGTH = 512;

export const REVERSE_INVITE_FIELD_LABEL = "Return invitation";
export const REVERSE_INVITE_SUBMIT_LABEL = "Submit return invitation";
export const REVERSE_INVITE_TOO_LONG_TEXT =
  "That return invitation is too long. Paste the invitation issued by the target server.";

/**
 * AG-1.5 reverse-invite form slot. Renders the invisible reserved
 * placeholder unless `active` is true (the displayed instruction is exactly
 * paste_s2), in which case it renders the real, controlled textarea form.
 * Both branches keep the same `data-reserved-form-slot` / `data-reserved
 * -alert-slot` markers so the reserved-layout contract does not change
 * shape when the form goes live.
 */
function ReverseFormSlot({
  active,
  value,
  onChange,
  busy,
  error,
  onSubmit,
}: {
  active: boolean;
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
}): React.ReactElement {
  if (!active) {
    return (
      <div data-reserved-form-slot="" aria-hidden="true" className={RESERVED_REVERSE_FORM_CLASS}>
        <div data-reserved-alert-slot="" />
      </div>
    );
  }
  return (
    <div data-reserved-form-slot="" className={REVERSE_FORM_CLASS}>
      <form
        data-reverse-form=""
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="space-y-1">
          <label
            htmlFor="results-reverse-invite-field"
            className="block text-xs font-semibold text-zinc-300"
          >
            {REVERSE_INVITE_FIELD_LABEL}
          </label>
          <textarea
            id="results-reverse-invite-field"
            data-reverse-invite-field=""
            rows={3}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
        </div>
        <button type="submit" className={ACTION_BTN} disabled={busy}>
          {REVERSE_INVITE_SUBMIT_LABEL}
        </button>
      </form>
      <div data-reserved-alert-slot="">
        {error !== null ? (
          <p
            data-post-error=""
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="text-sm text-rose-200"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Pure mapping from a postReverseInvite failure to operator-facing copy.
 * The known backend reasonCodes reuse the shared paste_* guidance strings;
 * anything else (peer_unreachable, not_found, internal_error, or an
 * unrecognized envelope) falls back to the backend message, and finally to
 * a generic string when even that is empty.
 */
export function reverseInviteErrorCopy(failure: ValidatorFailure): string {
  if (failure.error === "wrong_target_host") {
    return actionErrorCopy("paste_422_wrong_target_host");
  }
  if (failure.error === "conflict") {
    return actionErrorCopy("paste_409_conflict");
  }
  if (failure.error === "missing_field") {
    return actionErrorCopy("paste_400_invalid_invitation");
  }
  return failure.message !== "" ? failure.message : "Could not import the return invitation.";
}

// AG-1.4 invite paste slot. Mounts inside the current invite row's card via
// StepRow's formSlot. Shows the locked claim error when a claim failed with no
// usable cache, and the cached invitation in a labeled, read-only, selectable
// field that stays available even when the clipboard copy fails.
function InvitePasteSlot({
  invite,
  error,
}: {
  invite: string | null;
  error: string | null;
}): React.ReactElement | null {
  if (invite === null && error === null) {
    return null;
  }
  return (
    <div data-invite-slot="" className="mt-3 space-y-2">
      {error !== null ? (
        <p
          data-post-error=""
          className="text-sm text-rose-200"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {error}
        </p>
      ) : null}
      {invite !== null ? (
        <div className="space-y-1">
          <label
            htmlFor="results-invite-field"
            className="block text-xs font-semibold text-zinc-300"
          >
            {INVITE_FIELD_LABEL}
          </label>
          <input
            id="results-invite-field"
            type="text"
            readOnly
            value={invite}
            data-invite-field=""
            data-invite-value={invite}
            className="w-full select-all rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
        </div>
      ) : null}
    </div>
  );
}

function liveViewSignature(step: UserStep, guidanceKey: string | null): string {
  return `${step}:${guidanceKey ?? ""}`;
}

function isFocusLossControl(node: Element | null): node is HTMLElement {
  if (node === null) {
    return false;
  }
  const tag = typeof node.tagName === "string" ? node.tagName.toUpperCase() : "";
  return tag === "BUTTON" || tag === "A" || tag === "TEXTAREA" || tag === "FORM";
}

function snapshotFocusLossControl(): Element | null {
  if (typeof document === "undefined") {
    return null;
  }
  const active = document.activeElement;
  return isFocusLossControl(active) ? active : null;
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

// AG-1.4 claim CTA copy and cached-invite field labels.
export const COPY_INVITATION_LABEL = "Copy invitation";
export const COPY_AGAIN_LABEL = "Copy again";
export const INVITE_FIELD_LABEL = "Invitation";
export const CLAIM_COPY_FAILURE_TEXT =
  "Could not copy the invitation. Select and copy it from the field below.";

const INVITE_STORAGE_PREFIX = "validator:invite:";

function inviteStorageKey(sessionId: string): string {
  return `${INVITE_STORAGE_PREFIX}${sessionId}`;
}

// SessionStorage is a best-effort durable backup of a claimed invitation for a
// single session id. Access and read/write can throw (disabled storage, quota,
// privacy mode); every path is guarded and non-fatal, so the in-memory cache
// remains the source of truth.
export function readStoredInvite(sessionId: string): string | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    const store: Storage | undefined = window.sessionStorage;
    if (store === undefined || store === null) {
      return null;
    }
    const raw = store.getItem(inviteStorageKey(sessionId));
    return typeof raw === "string" && raw !== "" ? raw : null;
  } catch {
    return null;
  }
}

export function writeStoredInvite(sessionId: string, value: string): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    const store: Storage | undefined = window.sessionStorage;
    if (store === undefined || store === null) {
      return;
    }
    store.setItem(inviteStorageKey(sessionId), value);
  } catch {
    // Storing the invite is best-effort; the in-memory cache stays valid.
  }
}

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
  const [cachedInvite, setCachedInvite] = useState<string | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  // Terminal lock. An uncached 410 means the invitation is already claimed and
  // unrecoverable in this browser, so the CTA must stay disabled after the
  // in-flight claimBusy clears. It persists until a session/navigation reset.
  const [claimLocked, setClaimLocked] = useState(false);
  // AG-2.4 sole POST-error channel for the current row. The claim CTA and
  // the reverse-invite form both write here; only one of them can be the
  // active row at a time, so the two failure paths never collide.
  const [postError, setPostError] = useState<string | null>(null);
  // Holds the session id of the in-flight claim, or null when idle. Using the
  // id (not a bool) lets an old claim's finally avoid clearing a newer
  // session's lock after a navigation reset cleared the shared ref.
  const claimLockRef = useRef<string | null>(null);
  // Mirrors the current session id every render so an async claim callback can
  // compare the session it started in against the live session with no
  // effect-timing gap.
  const currentSessionIdRef = useRef<string | null>(null);
  // AG-1.5 reverse-invite form state. The textarea stays controlled and its
  // busy/lock pair mirrors the AG-1.4 claim race-safety shape; its error now
  // shares the postError channel above.
  const [reverseValue, setReverseValue] = useState("");
  const [reverseBusy, setReverseBusy] = useState(false);
  // Holds the session id of the in-flight reverse POST, or null when idle.
  // Reverse POST is not cached, so unlike claimLockRef this only guards
  // against a double submit while one request is outstanding.
  const reverseLockRef = useRef<string | null>(null);
  // Mirrors the current guidanceKey every render so an async reverse-invite
  // callback can tell whether polling already left paste_s2 while its POST
  // was in flight, with no effect-timing gap.
  const guidanceKeyRef = useRef<string | null>(null);
  // AG-2.4 sole POST-error channel. Cleared synchronously during render
  // (see the guidanceKeyRef assignment below) whenever the displayed
  // instruction changes, so a stale claim or reverse failure never survives
  // past the row it happened on, not even for one committed frame. A fresh
  // POST attempt clears it directly (see handleClaimInvite /
  // handleReverseInvite), and a repeat poll of the same instruction leaves
  // guidanceKey unchanged, so this does not fire on every poll.
  const prevGuidanceKeyRef = useRef(guidanceKey);
  const [rawJsonOpen, setRawJsonOpen] = useState(false);
  const [selectedArea, setSelectedArea] = useState<CanonicalAreaId | null>(null);
  const viewRef = useRef<MachineView | null>(null);
  const liveHoldRef = useRef<LiveInstructionHold>(INITIAL_LIVE_INSTRUCTION_HOLD);
  const currentCardRef = useRef<HTMLDivElement | null>(null);
  const liveViewSeededRef = useRef(false);
  const lastLiveSignatureRef = useRef<string | null>(null);
  const pendingFocusLossElRef = useRef<Element | null>(null);
  const [restoreCurrentCardFocus, setRestoreCurrentCardFocus] = useState(false);
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
    setSession(
      sessionFromLocation(
        host,
        id,
        typeof window === "undefined" ? null : window.location.href,
      ),
    );
  }, [host, id]);

  useEffect(() => {
    viewRef.current = null;
    liveHoldRef.current = INITIAL_LIVE_INSTRUCTION_HOLD;
    liveViewSeededRef.current = false;
    lastLiveSignatureRef.current = null;
    pendingFocusLossElRef.current = null;
    setRestoreCurrentCardFocus(false);
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
    setCachedInvite(null);
    setClaimBusy(false);
    setClaimLocked(false);
    setPostError(null);
    claimLockRef.current = null;
    setReverseValue("");
    setReverseBusy(false);
    reverseLockRef.current = null;
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
          const signature = liveViewSignature(stabilized.view.step, stabilized.guidanceKey);
          const seeded = liveViewSeededRef.current;
          const previous = lastLiveSignatureRef.current;
          lastLiveSignatureRef.current = signature;
          liveViewSeededRef.current = true;
          if (seeded && previous !== signature) {
            pendingFocusLossElRef.current = snapshotFocusLossControl();
          } else {
            pendingFocusLossElRef.current = null;
          }
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

  useLayoutEffect(() => {
    const pending = pendingFocusLossElRef.current;
    if (pending === null) {
      return;
    }
    pendingFocusLossElRef.current = null;
    if (pending.isConnected) {
      setRestoreCurrentCardFocus(false);
      return;
    }
    setRestoreCurrentCardFocus(true);
    const card = currentCardRef.current;
    if (card === null) {
      return;
    }
    card.tabIndex = -1;
    try {
      card.focus({ preventScroll: true });
    } catch {
      // Focus restore is best-effort.
    }
  }, [guidanceKey, view]);

  currentSessionIdRef.current = session?.id ?? null;
  guidanceKeyRef.current = guidanceKey;
  if (prevGuidanceKeyRef.current !== guidanceKey) {
    prevGuidanceKeyRef.current = guidanceKey;
    setPostError(null);
  }

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

  // AG-1.4 primary CTA for the paste_s1 step. First use claims the invitation
  // (one POST), caches it before any clipboard access, then copies it. Once a
  // cache exists, this is "Copy again": it copies the cached value only and
  // never POSTs. A fast double click issues exactly one claim because the ref
  // lock is acquired synchronously before the await.
  async function handleClaimInvite(): Promise<void> {
    if (session === null || config === null) {
      return;
    }
    // An uncached 410 terminally locked this browser out of claiming; never
    // re-POST even if a stray click reaches the disabled CTA.
    if (claimLocked) {
      return;
    }
    // Capture the session this claim belongs to. Every post-await write is
    // guarded against it so a POST for session A that resolves after
    // navigation to session B cannot touch B's cache, error, notice, or state.
    const claimSessionId = session.id;
    if (cachedInvite !== null) {
      const ok = await copyText(cachedInvite);
      // A copy that resolves after navigation must not re-announce for B.
      if (claimSessionId !== currentSessionIdRef.current) {
        return;
      }
      settleCopyOutcome(ok, cachedInvite, CLAIM_COPY_FAILURE_TEXT);
      return;
    }
    if (claimLockRef.current !== null) {
      return;
    }
    claimLockRef.current = claimSessionId;
    setClaimBusy(true);
    setPostError(null);
    try {
      const result = await claimInvite(claimSessionId, requestDeps(config));
      // Ignore a stale resolution entirely once the session changed.
      if (claimSessionId !== currentSessionIdRef.current) {
        return;
      }
      if (result.ok) {
        const invite = result.data.inviteString;
        // Cache before clipboard so the invite survives a copy failure and
        // later polls; sessionStorage is a best-effort durable backup.
        setCachedInvite(invite);
        writeStoredInvite(claimSessionId, invite);
        const ok = await copyText(invite);
        // Navigation during the copy await must not re-announce for B.
        if (claimSessionId !== currentSessionIdRef.current) {
          return;
        }
        settleCopyOutcome(ok, invite, CLAIM_COPY_FAILURE_TEXT);
        return;
      }
      // A late failure response must not overwrite postError once the
      // instruction has already advanced past paste_s1 for this session.
      // Caching above is unaffected: only these announcement writes guard on
      // guidanceKey, matching AG-1.5's reverse-handler pattern.
      if (
        claimSessionId !== currentSessionIdRef.current
        || guidanceKeyRef.current !== "paste_s1"
      ) {
        return;
      }
      if (result.error === "INVITE_ALREADY_CLAIMED") {
        const cached = readStoredInvite(claimSessionId);
        if (cached !== null) {
          setCachedInvite(cached);
          const ok = await copyText(cached);
          if (
            claimSessionId !== currentSessionIdRef.current
            || guidanceKeyRef.current !== "paste_s1"
          ) {
            return;
          }
          settleCopyOutcome(ok, cached, CLAIM_COPY_FAILURE_TEXT);
        } else {
          // Already claimed and unrecoverable here: show locked copy and keep
          // the CTA disabled permanently for this session.
          setPostError(actionErrorCopy("claim_410_no_cache"));
          setClaimLocked(true);
        }
        return;
      }
      if (result.error === "SESSION_NOT_READY") {
        setPostError(actionErrorCopy("claim_409_session_not_ready"));
        return;
      }
      setPostError(
        result.message !== "" ? result.message : "Could not claim the invitation.",
      );
    } finally {
      // Only release the in-flight lock this claim actually still owns; a
      // newer session may have reset the shared ref or acquired its own lock.
      if (claimLockRef.current === claimSessionId) {
        claimLockRef.current = null;
      }
      // Never clear a newer session's transient busy state. claimLocked is
      // intentionally left untouched here so an uncached-410 lock persists.
      if (claimSessionId === currentSessionIdRef.current) {
        setClaimBusy(false);
      }
    }
  }

  // AG-1.5 submit for the paste_s2 reverse-invite form. Reuses AG-1.4's ref
  // lock plus busy state so a fast double click issues exactly one POST, but
  // unlike the claim CTA the reverse POST result is never cached: each
  // submit from paste_s2 can post again once the prior request settles. A
  // 200 never advances the UI on its own (only the poll leaving paste_s2
  // does that), and any write after this POST settles is dropped once either
  // the session changed or polling already left paste_s2 while it was in
  // flight.
  async function handleReverseInvite(): Promise<void> {
    if (session === null || config === null) {
      return;
    }
    // Trim only the surrounding whitespace; inner whitespace/content is part
    // of the invite string and must reach the backend unchanged.
    const trimmed = reverseValue.trim();
    if (trimmed.length > MAX_REVERSE_INVITE_LENGTH) {
      setPostError(REVERSE_INVITE_TOO_LONG_TEXT);
      return;
    }
    if (reverseLockRef.current !== null) {
      return;
    }
    const reverseSessionId = session.id;
    reverseLockRef.current = reverseSessionId;
    setReverseBusy(true);
    setPostError(null);
    try {
      const result = await postReverseInvite(reverseSessionId, trimmed, requestDeps(config));
      // Ignore a stale resolution: either the session changed, or polling
      // already left paste_s2 while this POST was in flight. Neither the
      // 200 nor the error is state truth; only the poll loop is.
      if (
        reverseSessionId !== currentSessionIdRef.current ||
        guidanceKeyRef.current !== "paste_s2"
      ) {
        return;
      }
      if (result.ok) {
        setPostError(null);
        return;
      }
      setPostError(reverseInviteErrorCopy(result));
    } finally {
      // Only release the in-flight lock this submit actually still owns.
      if (reverseLockRef.current === reverseSessionId) {
        reverseLockRef.current = null;
      }
      // Busy clears on session identity alone (matching AG-1.4): once this
      // session's own POST settles, the submit button must re-enable even
      // if polling already moved past paste_s2 and unmounted the form.
      if (reverseSessionId === currentSessionIdRef.current) {
        setReverseBusy(false);
      }
    }
  }

  if (session === null) {
    const sessionStart = projectSessionStart(
      null,
      mounted,
      typeof window === "undefined" ? null : window.location.href,
    );
    if (sessionStart.kind === "failure") {
      return (
        <div className="space-y-4">
          <BackToTest href={testHref} />
          <p className="text-sm text-rose-200" role="alert">
            {sessionStart.message}
          </p>
        </div>
      );
    }
    return <p className="text-sm text-zinc-400">{SESSION_START_LOADING_TEXT}</p>;
  }

  const resultAreas = resultAreaEntries(projection.score.areas);
  const selectedEntry =
    selectedArea === null
      ? null
      : resultAreas.find((entry) => entry.area === selectedArea) ?? null;
  const statusText = progressStatusText(projection.status, view, guidanceKey);
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
      view !== null &&
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
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-step-status=""
          className="text-sm text-zinc-400"
        >
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
        <div className="space-y-3" data-step-list="">
          {USER_STEPS.map((step) => {
            const status = view.statuses[step];
            if (status === "hidden") {
              return null;
            }
            const isCurrent = status === "current";
            const isClaimRow = isCurrent && guidanceKey === "paste_s1";
            const claimLabel =
              cachedInvite !== null ? COPY_AGAIN_LABEL : COPY_INVITATION_LABEL;
            const isReverseFormRow = isCurrent && guidanceKey === "paste_s2";
            const rowFormSlot =
              step === "reverse" ? (
                <ReverseFormSlot
                  active={isReverseFormRow}
                  value={reverseValue}
                  onChange={setReverseValue}
                  busy={reverseBusy}
                  error={postError}
                  onSubmit={() => {
                    void handleReverseInvite();
                  }}
                />
              ) : isClaimRow ? (
                <InvitePasteSlot invite={cachedInvite} error={postError} />
              ) : undefined;
            return (
              <StepRow
                key={step}
                step={step}
                status={status}
                index={visibleIndex(view.statuses, step)}
                guidance={isCurrent ? currentRowGuidance : undefined}
                ctaLabel={isClaimRow ? claimLabel : undefined}
                onCta={
                  isClaimRow
                    ? () => {
                        void handleClaimInvite();
                      }
                    : undefined
                }
                disabled={isClaimRow ? claimBusy || claimLocked : undefined}
                ctaHref={isCurrent && liveReportHref !== null ? liveReportHref : undefined}
                formSlot={rowFormSlot}
                cardRef={isCurrent ? currentCardRef : undefined}
                cardTabIndex={isCurrent && restoreCurrentCardFocus ? -1 : undefined}
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
