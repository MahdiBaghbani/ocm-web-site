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
  // The raw poll payload is passed alongside the resolved view so a
  // consumer can read fields like nextInstruction directly, instead of
  // reaching back into whatever onPoll last stashed.
  onView: (view: MachineView, poll: SessionPollResponse) => void;
  onReport: (data: ReportResponse) => void;
  onReportFailure: (failure: ValidatorFailure | null) => void;
  onError: (message: string) => void;
}

export interface ResultsPollLoopInput {
  sessionId: string;
  cadence: MachineCadence;
  deps: ValidatorFetchDeps;
  signal: AbortSignal;
  // Copied read-only links keep GET polling but never POST /stop.
  readOnly?: boolean;
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
  const readOnly = input.readOnly ?? false;
  const fallbackMs = cadence.pollIntervalMs ?? DEFAULT_VALIDATOR_CONFIG.pollIntervalMs;

  let postedStop = false;
  let lastState: string | undefined;
  let lastReportAt: number | undefined;
  let transientFailures = 0;
  // Cadence from the last poll that carried a genuine (recognized,
  // non-terminal) instruction. An omitted or unrecognized nextInstruction on
  // a later poll has no cadence of its own; once we have a safe cadence on
  // record we keep polling at it instead of halting on a transient bad
  // payload.
  let lastLiveCadenceMs: number | undefined;

  const maybeFetchReport = async (
    state: string,
    machine: MachineView,
  ): Promise<void> => {
    const now = clock();
    const live = machine.continuePolling || machine.shouldPostStop;
    const due = lastState !== state ||
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
      hooks.onReportFailure(null);
      return;
    }
    if (result.kind !== "aborted") {
      hooks.onReportFailure(result);
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
    hooks.onView(machine, data);
    await maybeFetchReport(data.state, machine);
    if (signal.aborted) {
      return;
    }

    // Read-only views keep GET polling and never POST /stop; they only
    // stop when the session reaches a real terminal state.
    if (!readOnly && machine.shouldPostStop && !postedStop) {
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
      hooks.onView(nextMachine, next);
      await maybeFetchReport(next.state, nextMachine);
      return;
    }

    // Terminal always wins immediately and is never held on a stale cadence.
    if (machine.terminalize) {
      return;
    }

    if (machine.continuePolling) {
      lastLiveCadenceMs = machine.pollIntervalMs;
    }

    // Only halt outright when no safe cadence has ever been established; a
    // persistent omitted/unrecognized instruction after a genuine one keeps
    // polling below instead of stalling the session.
    if (!readOnly && !machine.continuePolling && lastLiveCadenceMs === undefined) {
      return;
    }

    // shouldPostStop keeps a non-zero cadence. A null-instruction non-terminal
    // poll has pollIntervalMs 0: fall back to the last safe live cadence when
    // one exists, otherwise the configured fallback, so we do not busy-loop.
    const waitMs =
      machine.continuePolling || machine.shouldPostStop
        ? readOnly && machine.pollIntervalMs === 0
          ? fallbackMs
          : machine.pollIntervalMs
        : lastLiveCadenceMs ?? fallbackMs;
    const waited = await wait(waitMs, { signal });
    if (!waited.ok) {
      return;
    }
  }
}
