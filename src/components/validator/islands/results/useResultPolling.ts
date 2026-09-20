/**
 * Config load and live session polling for the RESULTS island, including the
 * one-poll hold via stabilizeLiveView.
 */
import React, { useEffect, useRef, useState } from "react";
import { loadSharedRuntimeConfig } from "../../../../lib/siteRuntimeConfig";
import type { ValidatorRuntimeConfig } from "../../lib/validatorConfig";
import {
  type ReportResponse,
  type SessionPollResponse,
  type ValidatorFailure,
  type ValidatorFetchDeps,
} from "../../lib/validatorFetch";
import { runResultsPollLoop } from "../../lib/resultsPoll";
import type { MachineView, UserStep } from "../../lib/stateMachine";
import type { ValidatorUrlState } from "../../lib/urlState";
import {
  INITIAL_LIVE_INSTRUCTION_HOLD,
  stabilizeLiveView,
  type LiveInstructionHold,
} from "../../lib/results/stabilizeLiveView";

const PAGE_LINK_READONLY_PARAM = "ro";
const PAGE_LINK_READONLY_VALUE = "1";

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

function pageLinkIsReadOnly(href: string): boolean {
  try {
    return new URL(href).searchParams.get(PAGE_LINK_READONLY_PARAM) === PAGE_LINK_READONLY_VALUE;
  } catch {
    return false;
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

export function useResultPolling({
  session,
}: {
  session: ValidatorUrlState | null;
}): {
  config: ValidatorRuntimeConfig | null;
  poll: SessionPollResponse | null;
  view: MachineView | null;
  guidanceKey: string | null;
  lastLiveReport: ReportResponse | null;
  terminalReport: ReportResponse | null;
  reportFailure: ValidatorFailure | null;
  error: string;
  pendingFocusLossElRef: React.MutableRefObject<Element | null>;
  reset: () => void;
} {
  const [config, setConfig] = useState<ValidatorRuntimeConfig | null>(null);
  const [poll, setPoll] = useState<SessionPollResponse | null>(null);
  const [view, setView] = useState<MachineView | null>(null);
  const [guidanceKey, setGuidanceKey] = useState<string | null>(null);
  const [lastLiveReport, setLastLiveReport] = useState<ReportResponse | null>(null);
  const [terminalReport, setTerminalReport] = useState<ReportResponse | null>(null);
  const [reportFailure, setReportFailure] = useState<ValidatorFailure | null>(null);
  const [error, setError] = useState("");
  const viewRef = useRef<MachineView | null>(null);
  const liveHoldRef = useRef<LiveInstructionHold>(INITIAL_LIVE_INSTRUCTION_HOLD);
  const liveViewSeededRef = useRef(false);
  const lastLiveSignatureRef = useRef<string | null>(null);
  const pendingFocusLossElRef = useRef<Element | null>(null);

  function reset(): void {
    viewRef.current = null;
    liveHoldRef.current = INITIAL_LIVE_INSTRUCTION_HOLD;
    liveViewSeededRef.current = false;
    lastLiveSignatureRef.current = null;
    pendingFocusLossElRef.current = null;
    setPoll(null);
    setView(null);
    setGuidanceKey(null);
    setLastLiveReport(null);
    setTerminalReport(null);
    setReportFailure(null);
    setError("");
  }

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const loaded = await loadSharedRuntimeConfig();
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

  return {
    config,
    poll,
    view,
    guidanceKey,
    lastLiveReport,
    terminalReport,
    reportFailure,
    error,
    pendingFocusLossElRef,
    reset,
  };
}
