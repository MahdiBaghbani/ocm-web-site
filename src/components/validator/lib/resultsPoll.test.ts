import { describe, expect, test } from "bun:test";

import {
  MAX_TRANSIENT_POLL_FAILURES,
  isTransientPollFailure,
  nextTransientPollDelayMs,
  runResultsPollLoop,
  type ResultsPollHooks,
} from "./resultsPoll";
import type {
  ReportResponse,
  SessionPollResponse,
  StopSessionResponse,
  ValidatorFailure,
  ValidatorResult,
} from "./validatorFetch";

const SESSION_ID = "0193a0c2-7c1d-7b4a-8f2e-1a2b3c4d5e6f";
const REPORT: ReportResponse = {
  schema: "federation_tester_report.v1",
  id: SESSION_ID,
  visibility: "session",
};

function okPoll(data: SessionPollResponse): ValidatorResult<SessionPollResponse> {
  return { ok: true, status: 200, data };
}

function okStop(state: string): ValidatorResult<StopSessionResponse> {
  return { ok: true, status: 200, data: { id: SESSION_ID, state } };
}

function fail(
  kind: ValidatorFailure["kind"],
  message: string,
  extra: Partial<ValidatorFailure> = {},
): ValidatorFailure {
  return { ok: false, kind, status: extra.status ?? null, error: extra.error ?? kind, message, ...extra };
}

function hooks(): ResultsPollHooks & {
  polls: SessionPollResponse[];
  reports: ReportResponse[];
  reportFailures: Array<ValidatorFailure | null>;
  errors: string[];
  terminal: boolean[];
} {
  const polls: SessionPollResponse[] = [];
  const reports: ReportResponse[] = [];
  const reportFailures: Array<ValidatorFailure | null> = [];
  const errors: string[] = [];
  const terminal: boolean[] = [];
  return {
    polls,
    reports,
    reportFailures,
    errors,
    terminal,
    onPoll: (data) => polls.push(data),
    onView: (view) => terminal.push(view.terminalize),
    onReport: (data) => reports.push(data),
    onReportFailure: (failure) => reportFailures.push(failure),
    onError: (message) => errors.push(message),
  };
}

async function runLoop(
  recorded: ReturnType<typeof hooks>,
  input: Parameters<typeof runResultsPollLoop>[0],
): Promise<void> {
  await runResultsPollLoop(input, recorded);
}

describe("transient poll policy", () => {
  test("classifies retryable kinds and honors 429 retryAfterMs", () => {
    expect(isTransientPollFailure(fail("invalid_response", "bad"))).toBe(true);
    expect(isTransientPollFailure(fail("http", "limited", { status: 429 }))).toBe(true);
    expect(isTransientPollFailure(fail("session_not_found", "gone"))).toBe(false);
    expect(nextTransientPollDelayMs(fail("http", "slow", { status: 429, retryAfterMs: 7000 }), 1000)).toBe(7000);
    expect(nextTransientPollDelayMs(fail("http", "slow", { status: 429, retryAfterMs: 120000 }), 1000)).toBe(30000);
    expect(nextTransientPollDelayMs(fail("http", "slow", { status: 429 }), 1000)).toBe(1000);
    expect(nextTransientPollDelayMs(fail("invalid_response", "bad"), 1500)).toBe(1500);
  });
});

describe("runResultsPollLoop", () => {
  test("does not poll again after stop is posted", async () => {
    let polls = 0;
    let stops = 0;
    let reports = 0;
    const recorded = hooks();
    await runLoop(recorded, {
      sessionId: SESSION_ID,
      cadence: { pollIntervalMs: 1000, activePollIntervalMs: 2000 },
      deps: {},
      signal: new AbortController().signal,
      poll: async () => {
        polls += 1;
        return okPoll({
          state: "passive_complete",
          ts: 1,
          optInActive: false,
          nextInstruction: "stop",
        });
      },
      stop: async () => {
        stops += 1;
        return okStop("interrupted");
      },
      report: async () => {
        reports += 1;
        return { ok: true, status: 200, data: REPORT };
      },
      wait: async () => ({ ok: true }),
    });
    expect(polls).toBe(1);
    expect(stops).toBe(1);
    expect(reports).toBe(2);
    expect(recorded.polls.map((item) => item.state)).toEqual(["passive_complete", "interrupted"]);
    expect(recorded.terminal.at(-1)).toBe(true);
    expect(recorded.reports).toEqual([REPORT, REPORT]);
  });

  test("surfaces a report error and retries after a failed fetch", async () => {
    let polls = 0;
    let reports = 0;
    const recorded = hooks();
    await runLoop(recorded, {
      sessionId: SESSION_ID,
      cadence: { pollIntervalMs: 1000, activePollIntervalMs: 2000 },
      deps: {},
      signal: new AbortController().signal,
      now: () => 10_000,
      poll: async () => {
        polls += 1;
        if (polls === 1) {
          return okPoll({
            state: "passive_running",
            ts: 1,
            optInActive: false,
            nextInstruction: "wait_probe",
          });
        }
        return okPoll({
          state: "terminal_pass",
          ts: 2,
          optInActive: false,
        });
      },
      report: async () => {
        reports += 1;
        if (reports === 1) {
          return fail("invalid_response", "report unavailable");
        }
        return { ok: true, status: 200, data: REPORT };
      },
      wait: async () => ({ ok: true }),
    });
    expect(polls).toBe(2);
    expect(reports).toBe(2);
    expect(recorded.reportFailures).toEqual([
      fail("invalid_response", "report unavailable"),
      null,
    ]);
    expect(recorded.reports).toEqual([REPORT]);
    expect(recorded.terminal.at(-1)).toBe(true);
  });

  test("does not start the report refresh window until fetchReport succeeds", async () => {
    let now = 1000;
    let reports = 0;
    const recorded = hooks();
    await runLoop(recorded, {
      sessionId: SESSION_ID,
      cadence: { pollIntervalMs: 1000, activePollIntervalMs: 2000 },
      deps: {},
      signal: new AbortController().signal,
      reportRefreshMs: 3000,
      now: () => now,
      poll: async () => okPoll({
        state: "passive_running",
        ts: 1,
        optInActive: false,
        nextInstruction: "wait_probe",
      }),
      report: async () => {
        reports += 1;
        if (reports < 3) {
          return fail("http", "report 503", { status: 503 });
        }
        return { ok: true, status: 200, data: REPORT };
      },
      wait: async () => {
        now += 100;
        if (reports >= 3) {
          return { ok: false, reason: "aborted" };
        }
        return { ok: true };
      },
    });
    expect(reports).toBe(3);
    expect(recorded.reportFailures).toEqual([
      fail("http", "report 503", { status: 503 }),
      fail("http", "report 503", { status: 503 }),
      null,
    ]);
    expect(recorded.reports).toEqual([REPORT]);
  });

  test("bounds invalid_response and 429 retries and uses retryAfterMs", async () => {
    const delays: number[] = [];
    let polls = 0;
    const recorded = hooks();
    await runLoop(recorded, {
      sessionId: SESSION_ID,
      cadence: { pollIntervalMs: 1000, activePollIntervalMs: 2000 },
      deps: {},
      signal: new AbortController().signal,
      poll: async () => {
        polls += 1;
        if (polls === 1) {
          return fail("http", "slow down", { status: 429, retryAfterMs: 2500 });
        }
        return fail("invalid_response", "bad poll");
      },
      wait: async (ms) => {
        delays.push(ms);
        return { ok: true };
      },
    });
    expect(polls).toBe(MAX_TRANSIENT_POLL_FAILURES);
    expect(delays).toEqual([2500, 1000, 1000, 1000]);
    expect(recorded.errors).toEqual(["bad poll"]);
  });

  test("preserves report_not_public on the structured failure callback", async () => {
    const recorded = hooks();
    const notPublic = fail("http", "report is not public", {
      status: 404,
      error: "report_not_public",
    });
    await runLoop(recorded, {
      sessionId: SESSION_ID,
      cadence: { pollIntervalMs: 1000, activePollIntervalMs: 2000 },
      deps: {},
      signal: new AbortController().signal,
      poll: async () => okPoll({
        state: "terminal_pass",
        ts: 1,
        optInActive: false,
      }),
      report: async () => notPublic,
      wait: async () => ({ ok: true }),
    });
    expect(recorded.reports).toEqual([]);
    expect(recorded.reportFailures).toEqual([notPublic]);
    expect(recorded.reportFailures[0]?.error).toBe("report_not_public");
    expect(recorded.terminal.at(-1)).toBe(true);
  });

  test("fetches the terminal report once for a terminal_pass transition", async () => {
    let reports = 0;
    const recorded = hooks();
    await runLoop(recorded, {
      sessionId: SESSION_ID,
      cadence: { pollIntervalMs: 1000, activePollIntervalMs: 2000 },
      deps: {},
      signal: new AbortController().signal,
      poll: async () => okPoll({
        state: "terminal_pass",
        ts: 1,
        optInActive: false,
      }),
      report: async () => {
        reports += 1;
        return { ok: true, status: 200, data: REPORT };
      },
      wait: async () => ({ ok: true }),
    });
    expect(reports).toBe(1);
    expect(recorded.reports).toEqual([REPORT]);
    expect(recorded.reportFailures).toEqual([null]);
  });

  test("stops immediately on session_not_found", async () => {
    const recorded = hooks();
    await runLoop(recorded, {
      sessionId: SESSION_ID,
      cadence: { pollIntervalMs: 1000 },
      deps: {},
      signal: new AbortController().signal,
      poll: async () => fail("session_not_found", "session not found"),
      wait: async () => ({ ok: true }),
    });
    expect(recorded.errors).toEqual(["session not found"]);
  });
});
