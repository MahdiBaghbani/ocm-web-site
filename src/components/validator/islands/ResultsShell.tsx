/**
 * RESULTS island. Polls a session, caches the last live report, and projects
 * a private or public terminal result without treating report_not_public as a
 * load error.
 */
import React, { useEffect, useRef, useState } from "react";
import AreaGrid from "../atoms/AreaGrid";
import EvidenceDisclosure, { type EvidenceItem } from "../atoms/EvidenceDisclosure";
import RawJsonPanel from "../atoms/RawJsonPanel";
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
  rawJsonSummary: string;
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
      return `${label} Assessed ${score.coverageLabel} areas.`;
    }
  }
  return `${DEFAULT_BANNER_BODY[score.outcome]} Assessed ${score.coverageLabel} areas.`;
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
  const score = projectValidatorScore({
    pollState: pollState === "" ? null : pollState,
    specification: specificationInputFromReport(sourceReport),
    reportOk: input.terminalReport !== null,
    failModeLabel: input.poll?.failModeLabel,
    descriptions: AREA_DESCRIPTIONS,
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
  const evidence = evidenceItems(sourceReport?.evidence);
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
    rawJsonSummary: cached ? "Last session JSON" : "Raw report JSON",
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

async function copyText(value: string): Promise<boolean> {
  if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
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
  const [copyNotice, setCopyNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const viewRef = useRef<MachineView | null>(null);

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
  }, [session?.host, session?.id]);

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
    void runResultsPollLoop(
      {
        sessionId: session.id,
        cadence: {
          pollIntervalMs: config.pollIntervalMs,
          activePollIntervalMs: config.activePollIntervalMs,
        },
        deps: requestDeps(config, controller.signal),
        signal: controller.signal,
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

  async function handleCopySession(): Promise<void> {
    if (session === null) {
      return;
    }
    const ok = await copyText(session.id);
    if (ok) {
      setCopyNotice({ ok: true, text: "Copied" });
      window.setTimeout(() => setCopyNotice(null), 2000);
      return;
    }
    setCopyNotice({ ok: false, text: "Could not copy the session ID." });
  }

  async function handleCopyReport(): Promise<void> {
    if (projection.reportUrl === null) {
      return;
    }
    const ok = await copyText(projection.reportUrl);
    if (ok) {
      setCopyNotice({ ok: true, text: "Copied" });
      window.setTimeout(() => setCopyNotice(null), 2000);
      return;
    }
    setCopyNotice({
      ok: false,
      text: "Could not copy the report link. Open the report and copy its address instead.",
    });
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

  const totals = areaTotals(projection.score.areas);
  const statusText =
    projection.status === "live" || projection.status === "loading_report"
      ? view === null
        ? "Loading session..."
        : progressAnnouncement(view)
      : null;
  const rawJsonDisclosure =
    projection.sourceReport !== null ? (
      <details className="rounded-2xl border border-zinc-800 bg-zinc-900/20">
        <summary className="flex min-h-11 cursor-pointer list-none items-center px-5 py-3 text-sm font-semibold text-zinc-100">
          {projection.rawJsonSummary}
        </summary>
        <div className="space-y-3 border-t border-zinc-800 px-5 py-4">
          {projection.rawJsonNote !== null ? (
            <p className="text-sm text-zinc-400">{projection.rawJsonNote}</p>
          ) : null}
          <RawJsonPanel
            value={projection.sourceReport}
            title={projection.rawJsonTitle}
            downloadName={`report-${session.id}.json`}
          />
        </div>
      </details>
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
          <button type="button" className={`${ACTION_BTN} mt-2`} onClick={() => { void handleCopySession(); }}>
            Copy session ID
          </button>
        </div>
      </div>
      {projection.bannerVerdict !== null &&
      (projection.status === "live" || projection.status === "ready") ? (
        <VerdictBanner
          verdict={projection.bannerVerdict}
          title={projection.bannerTitle}
          message={projection.bannerMessage}
        />
      ) : null}
      {statusText !== null ? (
        <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-zinc-400">
          {statusText}
        </p>
      ) : null}
      {copyNotice !== null ? (
        <p
          className={`text-sm ${copyNotice.ok ? "text-zinc-300" : "text-rose-200"}`}
          role={copyNotice.ok ? "status" : "alert"}
        >
          {copyNotice.text}
        </p>
      ) : null}
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
          <p className="text-sm text-zinc-300">
            <span className="font-mono">v</span> {totals.passed} passed{" "}
            <span className="font-mono">!</span> {totals.warn} need attention{" "}
            <span className="font-mono">x</span> {totals.failed} failed{" "}
            <span className="font-mono">i</span> {totals.rest} not tested
          </p>
          <div>
            <h2 className="mb-3 text-sm font-semibold text-zinc-100">What was tested</h2>
            <AreaGrid areas={resultAreaEntries(projection.score.areas)} />
          </div>
        </div>
      ) : null}
      {projection.status === "ready" || projection.status === "live" ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">{VISIBILITY_NOTICE[projection.visibility]}</p>
          {projection.visibility === "permanent" ? (
            <p className="text-sm text-zinc-400">The validator retention policy applies.</p>
          ) : null}
          {projection.showPublicActions &&
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
          {rawJsonDisclosure}
        </div>
      ) : null}
      {projection.status === "malformed" ? rawJsonDisclosure : null}
    </div>
  );
}
