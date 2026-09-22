import React, { act } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import ResultsShell, { projectResultsPage } from "@/components/validator/islands/ResultsShell";
import { RESULT_HEADLINE } from "@/components/validator/lib/validatorScore";
import { resolveValidatorMachine } from "@/components/validator/lib/stateMachine";
import type { ReportResponse, SessionPollResponse } from "@/components/validator/lib/validatorFetch";
import { requestUrl, jsonResponse } from "@/components/validator/tests/helpers/fetchStub";
import { registerHappyDom, teardownHappyDom } from "@/components/validator/tests/helpers/happyDom";

const SESSION_ID = "0193a0c2-7c1d-7b4a-8f2e-1a2b3c4d5e6f";
const API_ORIGIN = "https://validator.example.com";

function permanentReport(score: unknown, extra: Partial<ReportResponse> = {}): ReportResponse {
  return {
    schema: "federation_tester_report.v1",
    id: SESSION_ID,
    visibility: "permanent",
    reportUrl: `/validator/report/${SESSION_ID}`,
    score: { specification: score },
    evidence: [],
    ...extra,
  };
}

function pollOf(state: string, extra: Partial<SessionPollResponse> = {}): SessionPollResponse {
  return { state, ts: 1, optInActive: false, ...extra };
}

function viewOf(state: string, nextInstruction?: string) {
  return resolveValidatorMachine({
    state,
    optInActive: false,
    nextInstruction,
  });
}

function project(input: Partial<Parameters<typeof projectResultsPage>[0]> = {}) {
  return projectResultsPage({
    poll: pollOf("terminal_pass"),
    view: viewOf("terminal_pass"),
    lastLiveReport: null,
    terminalReport: null,
    reportFailure: null,
    validatorApiOrigin: API_ORIGIN,
    ...input,
  });
}

function installTerminalReportFetch(report: ReportResponse): () => void {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("config.json")) {
      return jsonResponse(200, {
        poll_interval_ms: 1,
        active_poll_interval_ms: 1,
        backoff_initial_ms: 1,
        backoff_max_ms: 1,
        request_timeout_ms: 5000,
        validator_api_origin: API_ORIGIN,
      });
    }
    if (url.includes(`/api/session/${SESSION_ID}`)) {
      return jsonResponse(200, { state: "terminal_pass", ts: 1, optInActive: false });
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(200, report);
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

async function waitForDom(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for a DOM condition");
    }
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
      });
    });
  }
}

describe("ResultsShell public action row ready/live guard", () => {
  beforeAll(async () => {
    await registerHappyDom();
  });

  afterAll(async () => {
    await teardownHappyDom();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
  });

  test("hides public actions for a malformed permanent report with a valid reportUrl", async () => {
    // permanentReport({ grade: null }) is visibility permanent with a valid
    // public reportUrl, so showPublicActions is true, but the score is
    // unusable and status is malformed. The action row must stay hidden
    // because status is not ready/live. Dropping that guard and gating only
    // on showPublicActions && reportUrl would render Open/Copy here.
    const report = permanentReport({ grade: null });
    const result = project({
      terminalReport: report,
    });
    expect(result.status).toBe("malformed");
    expect(result.visibility).toBe("permanent");
    expect(result.reportUrl).not.toBeNull();
    expect(result.showPublicActions).toBe(true);

    const restoreFetch = installTerminalReportFetch(report);
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes(RESULT_HEADLINE.resultUnavailable) === true,
      );

      expect(document.body.textContent).not.toContain("Open public report");
      expect(document.body.textContent).not.toContain("Copy public report link");
      await act(() => {
        root.unmount();
      });
    } finally {
      restoreFetch();
    }
  });
});
