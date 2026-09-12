/**
 * RESULTS island. Polls a session, caches the last live report, and projects
 * a private or public terminal result without treating report_not_public as a
 * load error.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
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
  evidenceMode: "disclosure" | "not_saved" | "expired" | "session" | "unknown" | "none";
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

export function progressAnnouncement(view: MachineView): string {
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
  return `Step ${current} of ${visible}: ${STEP_ANNOUNCE[view.step]}`;
}

function evidenceModeFor(
  visibility: ReportVisibility,
  items: EvidenceItem[],
): ResultsPageProjection["evidenceMode"] {
  if (visibility === "permanent") {
    return "disclosure";
  }
  if (visibility === "not_saved") {
    return "not_saved";
  }
  if (visibility === "expired") {
    return "expired";
  }
  if (visibility === "session") {
    return "session";
  }
  return items.length > 0 ? "unknown" : "none";
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
  const [lastLiveReport, setLastLiveReport] = useState<ReportResponse | null>(null);
  const [terminalReport, setTerminalReport] = useState<ReportResponse | null>(null);
  const [reportFailure, setReportFailure] = useState<ValidatorFailure | null>(null);
  const [error, setError] = useState("");
  const [copyNotice, setCopyNotice] = useState<CopyNotice>(EMPTY_COPY_NOTICE);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const [rawJsonOpen, setRawJsonOpen] = useState(false);
  const [selectedArea, setSelectedArea] = useState<CanonicalAreaId | null>(null);
  const viewRef = useRef<MachineView | null>(null);
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
    setPoll(null);
    setView(null);
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
        // Copied live links use ?ro=1 so this view does not POST /stop.
        stop: readOnly ? readOnlyStop : undefined,
      },
      {
        onPoll: setPoll,
        onView: (machine) => {
          viewRef.current = machine;
          setView(machine);
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
        : progressAnnouncement(view)
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
            return (
              <StepRow
                key={step}
                step={step}
                status={status}
                index={visibleIndex(view.statuses, step)}
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
          <div data-summary-chips="" />
          <p className="text-sm text-zinc-300">
            {projection.score.coverageLabel} areas tested
          </p>
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
      {(projection.status === "ready" || projection.status === "live") &&
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
              <p className="mt-1 text-sm text-zinc-400">{EVIDENCE_NOT_SAVED}</p>
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
