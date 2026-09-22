/**
 * RESULTS island. Polls a session, caches the last live report, and projects
 * a private or public terminal result without treating report_not_public as a
 * load error.
 */
import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { joinValidatorUrl } from "../lib/validatorFetch";
import {
  guidanceFor,
  type GuidanceRecord,
} from "../lib/validatorGuidance";
import {
  type CanonicalAreaId,
  type SpecificationAreaGridEntry,
} from "../lib/validatorScore";
import { stripBracketedMarkers } from "../lib/results/progress";
import { projectActionable } from "../lib/results/actionable";
import { projectActionRows } from "../lib/results/actionRows";
import { projectCapability } from "../lib/results/capability";
import { projectProgressCollections } from "../lib/results/collections";
import { projectSessionStart } from "../lib/results/sessionStart";
import { projectTransportFailure } from "../lib/results/transportFailure";
import { projectSessionFailure } from "../lib/results/sessionFailures";
import { projectResultsPage } from "../lib/results/projectResultsPage";
import {
  ActionSection,
  EvidenceSection,
  ProgressSection,
  ResultsHeader,
  syncSessionIdentity,
  useClaimAction,
  useClipboardActions,
  useResultPolling,
  useResultSession,
  useReverseInvite,
  type ClipboardCopyTarget,
} from "./results";

export { AREA_DESCRIPTIONS } from "../lib/score/areas";
export {
  progressAnnouncement,
  stripBracketedMarkers,
} from "../lib/results/progress";
export {
  INITIAL_LIVE_INSTRUCTION_HOLD,
  stabilizeLiveView,
} from "../lib/results/stabilizeLiveView";
export { resultAreaEntries } from "../lib/results/collections";
export {
  COPY_AGAIN_LABEL,
  COPY_INVITATION_LABEL,
} from "../lib/results/actionRows";
export { VISIBILITY_NOTICE } from "../lib/results/capability";
export {
  bannerBody,
  CACHED_SESSION_JSON_NOTE,
  loadedEvidenceCountsByArea,
  primaryReasonCodesByArea,
  primaryReasonsByArea,
  projectResultsPage,
  specificationInputFromReport,
} from "../lib/results/projectResultsPage";
export type {
  ResultsPageProjection,
  ResultsPageStatus,
} from "../lib/results/projectResultsPage";

export interface ResultsShellProps {
  host?: string;
  id?: string;
  testHref?: string;
}

export const TEST_HREF = "/validator/";

export {
  CLAIM_COPY_FAILURE_TEXT,
  COPY_SUCCESS_TEXT,
  CopyNoticeRegion,
  EMPTY_COPY_NOTICE,
  EVIDENCE_EMPTY_SNAPSHOT,
  EVIDENCE_EXPIRED,
  EVIDENCE_NOT_SAVED,
  INVITE_FIELD_LABEL,
  MAX_REVERSE_INVITE_LENGTH,
  PAGE_LINK_NOT_SAVED_NOTICE,
  REVERSE_INVITE_FIELD_LABEL,
  REVERSE_INVITE_SUBMIT_LABEL,
  REVERSE_INVITE_TOO_LONG_TEXT,
  copyText,
  readStoredInvite,
  reverseInviteErrorCopy,
  writeStoredInvite,
} from "./results";
export type { CopyNotice } from "./results";

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

export default function ResultsShell({
  host,
  id,
  testHref = TEST_HREF,
}: ResultsShellProps): React.ReactElement {
  const [postError, setPostError] = useState<string | null>(null);
  const [rawJsonOpen, setRawJsonOpen] = useState(false);
  const [selectedArea, setSelectedArea] = useState<CanonicalAreaId | null>(null);
  const [restoreCurrentCardFocus, setRestoreCurrentCardFocus] = useState(false);
  const currentCardRef = useRef<HTMLDivElement | null>(null);
  const sessionChangeResetRef = useRef<() => void>(() => {});
  const copyTargetRef = useRef<ClipboardCopyTarget>({ status: "live", reportUrl: null });
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

  const {
    session,
    mounted,
    currentSessionIdRef,
    guidanceKeyRef,
    prevGuidanceKeyRef,
  } = useResultSession({ host, id, sessionChangeResetRef });

  const {
    copyNotice,
    copyFallback,
    settleCopyOutcome,
    handleCopyPageLink,
    handleCopyReport,
    reset: resetClipboard,
  } = useClipboardActions({ session, copyTargetRef });

  const {
    config,
    poll,
    view,
    guidanceKey,
    lastLiveReport,
    terminalReport,
    reportFailure,
    error,
    pendingFocusLossElRef,
    reset: resetPolling,
  } = useResultPolling({ session });

  const {
    cachedInvite,
    claimBusy,
    claimLocked,
    handleClaimInvite,
    reset: resetClaim,
  } = useClaimAction({
    session,
    config,
    currentSessionIdRef,
    guidanceKeyRef,
    settleCopyOutcome,
    setPostError,
  });

  const {
    reverseValue,
    reverseBusy,
    setReverseValue,
    handleReverseInvite,
    reset: resetReverse,
  } = useReverseInvite({
    session,
    config,
    currentSessionIdRef,
    guidanceKeyRef,
    setPostError,
  });

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

  // Guard 15: synchronous render-phase session-identity writes. Must stay in
  // this orchestrator render body; never a useEffect, child, or hook body.
  syncSessionIdentity(
    { currentSessionIdRef, guidanceKeyRef, prevGuidanceKeyRef },
    session?.id ?? null,
    guidanceKey,
    setPostError,
  );

  sessionChangeResetRef.current = () => {
    resetPolling();
    setRestoreCurrentCardFocus(false);
    setRawJsonOpen(false);
    setSelectedArea(null);
    resetClipboard();
    resetClaim();
    setPostError(null);
    resetReverse();
  };

  const projection = projectResultsPage({
    poll,
    view,
    lastLiveReport,
    terminalReport,
    reportFailure,
    validatorApiOrigin: config?.validatorApiOrigin ?? "",
  });
  copyTargetRef.current = {
    status: projection.status,
    reportUrl: projection.reportUrl,
  };

  if (session === null) {
    const sessionStart = projectSessionStart(
      null,
      mounted,
      typeof window === "undefined" ? null : window.location.href,
    );
    return (
      <ResultsHeader
        kind="session-start"
        sessionStart={sessionStart}
        testHref={testHref}
      />
    );
  }

  const collections = projectProgressCollections({
    status: projection.status,
    areas: projection.score.areas,
    evidence: projection.evidence,
    view,
    guidanceKey,
  });
  const resultAreas = collections.areas;
  const actionable = projectActionable({
    status: projection.status,
    hasSourceReport: projection.sourceReport !== null,
    selectedArea,
    areas: resultAreas,
  });
  const selectedEntry = actionable.areaModal.selectedEntry;
  const statusText = collections.progress;
  const transportFailure = projectTransportFailure(
    error,
    projection.status,
    projection.reportFailure,
  );
  const currentRowGuidance: GuidanceRecord | null = sanitizeGuidanceRecord(
    guidanceFor(guidanceKey),
  );
  const sessionFailure = projectSessionFailure(
    projection.status,
    poll?.state,
    poll?.failModeLabel,
  );
  const liveReportHref =
    projection.status === "live"
      ? liveViewReportHref(config?.validatorApiOrigin ?? "", session.id)
      : null;
  const actionRows = projectActionRows({
    status: projection.status,
    visibility: projection.visibility,
    sourceKind: projection.sourceKind,
    showPublicActions: projection.showPublicActions,
    reportUrl: projection.reportUrl,
    bannerVerdict: projection.bannerVerdict,
    guidanceKey,
    cachedInvite,
    claimBusy,
    claimLocked,
    reverseBusy,
    liveReportHref,
    steps: collections.steps,
  });
  const capability = projectCapability({
    status: projection.status,
    visibility: projection.visibility,
    evidenceMode: projection.evidenceMode,
    sourceKind: projection.sourceKind,
    hasSourceReport: projection.sourceReport !== null,
  });
  const rawJsonLabel = actionable.rawJson.label;

  return (
    <div className="space-y-6">
      <ResultsHeader
        kind="identity"
        host={session.host}
        sessionId={session.id}
        pageLink={actionRows.pageLink}
        onCopyPageLink={() => {
          void handleCopyPageLink();
        }}
      />
      <ProgressSection
        bannerVerdict={projection.bannerVerdict}
        bannerTitle={projection.bannerTitle}
        bannerMessage={projection.bannerMessage}
        view={view}
        status={projection.status}
        statusText={statusText}
        copyNotice={copyNotice}
        copyFallback={copyFallback}
        pollFailure={transportFailure.poll}
        testHref={testHref}
        liveRows={actionRows.liveRows}
        currentRowGuidance={currentRowGuidance}
        reverseValue={reverseValue}
        onReverseChange={setReverseValue}
        postError={postError}
        onReverseSubmit={() => {
          void handleReverseInvite();
        }}
        cachedInvite={cachedInvite}
        onClaimInvite={() => {
          void handleClaimInvite();
        }}
        currentCardRef={currentCardRef}
        restoreCurrentCardFocus={restoreCurrentCardFocus}
      />
      <ActionSection
        sessionFailure={sessionFailure}
        testHref={testHref}
        reportFailure={transportFailure.report}
        showAreas={projection.showAreas}
        scoreAreas={projection.score.areas}
        resultAreas={resultAreas}
        assessed={projection.score.assessed}
        total={projection.score.total}
        coverageLabel={projection.score.coverageLabel}
        selectedArea={selectedArea}
        onAreaClick={(areaId) => setSelectedArea(areaId)}
        registerTriggerRef={registerTriggerRef}
        gridHeadingRef={gridHeadingRef}
        visibilityNotice={capability.visibilityNotice}
        publicReport={actionRows.publicReport}
        onCopyReport={() => {
          void handleCopyReport();
        }}
        interruptedRecoveryVisible={actionRows.interruptedRecovery.visible}
      />
      <EvidenceSection
        evidence={capability.evidence}
        items={collections.evidence}
        hasSourceReport={actionable.rawJson.hasSourceReport}
        showMalformedTrigger={actionable.rawJson.showMalformedTrigger}
        rawJsonLabel={rawJsonLabel}
        rawJsonOpen={rawJsonOpen}
        onOpenRawJson={() => setRawJsonOpen(true)}
        onCloseRawJson={() => setRawJsonOpen(false)}
        rawJsonTitle={projection.rawJsonTitle}
        sourceReport={projection.sourceReport}
        rawJsonNote={projection.rawJsonNote}
        downloadName={`report-${session.id}.json`}
        showAreaModal={actionable.areaModal.showModal}
        selectedArea={selectedArea}
        selectedEntry={selectedEntry}
        onCloseAreaModal={() => {
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
    </div>
  );
}
