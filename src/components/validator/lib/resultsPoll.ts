/**
 * Results island poll loop. Bounded transient retries, one stop, then halt.
 */
import { DEFAULT_VALIDATOR_CONFIG } from "./validatorConfig";
import {
  fetchReport,
  pollSession,
  stopSession,
  waitForBackoff,
  type ReportResponse,
  type SessionPollResponse,
  type StopSessionResponse,
  type ValidatorFailure,
  type ValidatorFetchDeps,
  type ValidatorResult,
  type WaitResult,
} from "./validatorFetch";
import {
  resolveValidatorMachine,
  type MachineCadence,
  type MachineView,
} from "./stateMachine";

export const REPORT_REFRESH_MS = 3000;
export const MAX_TRANSIENT_POLL_FAILURES = 5;
export const MAX_RETRY_AFTER_MS = 30_000;

type PollFn = (
  id: string,
  deps?: ValidatorFetchDeps,
) => Promise<ValidatorResult<SessionPollResponse>>;
type StopFn = (
  id: string,
  deps?: ValidatorFetchDeps,
) => Promise<ValidatorResult<StopSessionResponse>>;
type ReportFn = (
  id: string,
  deps?: ValidatorFetchDeps,
) => Promise<ValidatorResult<ReportResponse>>;
type WaitFn = (
  ms: number,
  options?: { signal?: AbortSignal },
) => Promise<WaitResult>;

export function isTransientPollFailure(failure: ValidatorFailure): boolean {
  return (
    failure.kind === "http" ||
    failure.kind === "network" ||
    failure.kind === "timeout" ||
    failure.kind === "invalid_response"
  );
}

export function nextTransientPollDelayMs(
  failure: ValidatorFailure,
  fallbackMs: number,
): number {
  if (failure.status === 429 && failure.retryAfterMs !== undefined) {
    return Math.min(Math.max(0, failure.retryAfterMs), MAX_RETRY_AFTER_MS);
  }
  return fallbackMs;
}

export interface ResultsPollHooks {
  onPoll: (data: SessionPollResponse) => void;
  onView: (view: MachineView) => void;
  onReport: (data: ReportResponse) => void;
  onReportError: (message: string) => void;
  onError: (message: string) => void;
}

export interface ResultsPollLoopInput {
  sessionId: string;
  cadence: MachineCadence;
  deps: ValidatorFetchDeps;
  signal: AbortSignal;
  reportRefreshMs?: number;
  now?: () => number;
  poll?: PollFn;
  stop?: StopFn;
  report?: ReportFn;
  wait?: WaitFn;
}

function machineFor(
  data: SessionPollResponse,
  cadence: MachineCadence,
): MachineView {
  return resolveValidatorMachine(
    {
      state: data.state,
      nextInstruction: data.nextInstruction,
      optInActive: data.optInActive,
    },
    cadence,
  );
}

export async function runResultsPollLoop(
  input: ResultsPollLoopInput,
  hooks: ResultsPollHooks,
): Promise<void> {
  const poll = input.poll ?? pollSession;
  const stop = input.stop ?? stopSession;
  const report = input.report ?? fetchReport;
  const wait = input.wait ?? waitForBackoff;
  const refreshMs = input.reportRefreshMs ?? REPORT_REFRESH_MS;
  const clock = input.now ?? Date.now;
  const { sessionId, cadence, deps, signal } = input;
  const fallbackMs = cadence.pollIntervalMs ?? DEFAULT_VALIDATOR_CONFIG.pollIntervalMs;

  let postedStop = false;
  let lastState: string | undefined;
  let lastReportAt: number | undefined;
  let transientFailures = 0;

  const maybeFetchReport = async (
    state: string,
    machine: MachineView,
  ): Promise<void> => {
    const now = clock();
    const live = machine.continuePolling || machine.shouldPostStop;
    const due = lastState !== state || machine.terminalize ||
      (live && (lastReportAt === undefined || now - lastReportAt >= refreshMs));
    if (!due) {
      return;
    }
    lastState = state;
    const result = await report(sessionId, deps);
    if (signal.aborted) {
      return;
    }
    if (result.ok) {
      lastReportAt = clock();
      hooks.onReport(result.data);
      hooks.onReportError("");
      return;
    }
    if (result.kind !== "aborted") {
      hooks.onReportError(result.message);
    }
  };

  while (!signal.aborted) {
    const result = await poll(sessionId, deps);
    if (signal.aborted) {
      return;
    }
    if (!result.ok) {
      if (result.kind === "aborted") {
        return;
      }
      if (result.kind === "session_not_found" || result.kind === "expired") {
        hooks.onError(result.message);
        return;
      }
      transientFailures += 1;
      if (transientFailures >= MAX_TRANSIENT_POLL_FAILURES) {
        hooks.onError(result.message);
        return;
      }
      const waited = await wait(nextTransientPollDelayMs(result, fallbackMs), {
        signal,
      });
      if (!waited.ok) {
        return;
      }
      continue;
    }

    transientFailures = 0;
    const data = result.data;
    const machine = machineFor(data, cadence);
    hooks.onPoll(data);
    hooks.onView(machine);
    await maybeFetchReport(data.state, machine);
    if (signal.aborted) {
      return;
    }

    if (machine.shouldPostStop && !postedStop) {
      postedStop = true;
      const stopped = await stop(sessionId, deps);
      if (signal.aborted) {
        return;
      }
      if (!stopped.ok) {
        if (stopped.kind !== "aborted") {
          hooks.onError(stopped.message);
        }
        return;
      }
      const next: SessionPollResponse = { ...data, state: stopped.data.state };
      const nextMachine = machineFor(next, cadence);
      hooks.onPoll(next);
      hooks.onView(nextMachine);
      await maybeFetchReport(next.state, nextMachine);
      return;
    }

    if (machine.terminalize || !machine.continuePolling) {
      return;
    }

    const waited = await wait(machine.pollIntervalMs, { signal });
    if (!waited.ok) {
      return;
    }
  }
}
