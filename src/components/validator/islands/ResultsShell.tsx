/**
 * RESULTS island. Polls a session, posts stop once, and refreshes the report.
 */
import React, { useEffect, useState } from "react";
import EvidenceDisclosure, { type EvidenceItem } from "../atoms/EvidenceDisclosure";
import RawJsonPanel from "../atoms/RawJsonPanel";
import StepRow from "../atoms/StepRow";
import VerdictBanner, { verdictKindFromScore } from "../atoms/VerdictBanner";
import type { GradeKind } from "../atoms/Pill";
import {
  fetchConfigSource,
  loadValidatorConfig,
  type ValidatorRuntimeConfig,
} from "../lib/validatorConfig";
import {
  fetchManifest,
  type ReportResponse,
  type SessionPollResponse,
  type ValidatorFetchDeps,
  type ValidatorManifest,
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
import ManifestCard from "./ManifestCard";

export interface ResultsShellProps {
  host?: string;
  id?: string;
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

function asGrade(value: unknown): GradeKind | null {
  return value === "pass" || value === "fail" || value === "warn" ? value : null;
}

function gradeFromReport(report: ReportResponse | null): GradeKind | null {
  if (report === null || !isRecord(report.score)) {
    return null;
  }
  return asGrade(report.score.grade);
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

export default function ResultsShell({
  host,
  id,
}: ResultsShellProps): React.ReactElement {
  const [session, setSession] = useState<ValidatorUrlState | null>(() =>
    sessionFromProps(host, id),
  );
  const [mounted, setMounted] = useState(false);
  const [config, setConfig] = useState<ValidatorRuntimeConfig | null>(null);
  const [manifest, setManifest] = useState<ValidatorManifest | null>(null);
  const [poll, setPoll] = useState<SessionPollResponse | null>(null);
  const [view, setView] = useState<MachineView | null>(null);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [reportError, setReportError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setMounted(true);
    setSession(sessionFromLocation(host, id));
  }, [host, id]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const loaded = await loadValidatorConfig(fetchConfigSource(fetch.bind(globalThis)));
      if (controller.signal.aborted) {
        return;
      }
      setConfig(loaded);
      const mf = await fetchManifest(requestDeps(loaded, controller.signal));
      if (controller.signal.aborted || !mf.ok) {
        return;
      }
      setManifest(mf.data);
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
        onView: setView,
        onReport: setReport,
        onReportError: setReportError,
        onError: setError,
      },
    );
    return () => controller.abort();
  }, [config, session]);

  const terminalReportReady = report !== null || reportError !== "";
  const evidence = evidenceItems(report?.evidence);
  const showPermanentEvidence =
    report?.visibility === "permanent" &&
    evidence.length > 0 &&
    reportError === "";

  if (session === null) {
    if (!mounted) {
      return <p className="text-sm text-zinc-400">Loading session...</p>;
    }
    return (
      <p className="text-sm text-rose-200" role="alert">
        Missing host or session id.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-400">
        {session.host} / {session.id}
      </p>
      {error !== "" ? (
        <p className="text-sm text-rose-200" role="alert">
          {error}
        </p>
      ) : null}
      {view === null ? (
        <p className="text-sm text-zinc-400">Loading session...</p>
      ) : (
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
      )}
      {reportError !== "" ? (
        <p className="text-sm text-rose-200" role="alert">
          {reportError}
        </p>
      ) : null}
      {view?.terminalize === true && !terminalReportReady ? (
        <p className="text-sm text-zinc-400">Loading report...</p>
      ) : null}
      {view?.terminalize === true && terminalReportReady ? (
        <VerdictBanner
          verdict={verdictKindFromScore({
            grade: gradeFromReport(report),
            terminal: true,
          })}
          message={poll?.failModeLabel}
        />
      ) : null}
      {manifest !== null ? <ManifestCard manifest={manifest} /> : null}
      {report !== null ? (
        <RawJsonPanel value={report} title="Report JSON" downloadName="report.json" />
      ) : null}
      {showPermanentEvidence ? (
        <EvidenceDisclosure
          title="Evidence"
          items={evidence}
          defaultExpanded={false}
        />
      ) : null}
    </div>
  );
}
