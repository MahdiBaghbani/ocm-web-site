import { describe, expect, test } from "bun:test";

import type { ReportResponse } from "../validatorFetch";
import { selectTerminalReport } from "./terminalReport";

const TERMINAL_ID = "0193a0c2-7c1d-7b4a-8f2e-1a2b3c4d5e6f";
const LIVE_ID = "0193a0c2-7c1d-7b4a-8f2e-aaaaaaaaaaaa";

function report(
  id: string,
  extra: Partial<ReportResponse> = {},
): ReportResponse {
  return {
    schema: "federation_tester_report.v1",
    id,
    visibility: "session",
    ...extra,
  };
}

const TERMINAL_REPORT = report(TERMINAL_ID, {
  visibility: "permanent",
  evidence: [{ area: "discovery", reasonCode: "terminal_only" }],
  score: { specification: { grade: "fail" } },
});
const LIVE_REPORT = report(LIVE_ID, {
  visibility: "session",
  evidence: [{ area: "tls", reasonCode: "live_only" }],
  score: { specification: { grade: "pass" } },
});

describe("selectTerminalReport", () => {
  test("keeps live views without a source report even when both reports exist", () => {
    const selected = selectTerminalReport({
      terminal: false,
      terminalReport: TERMINAL_REPORT,
      lastLiveReport: LIVE_REPORT,
      notPublic: true,
    });
    expect(selected.sourceReport).toBeNull();
    expect(selected.sourceKind).toBe("terminal");
  });

  test("gives terminalReport precedence over lastLiveReport when terminal", () => {
    const selected = selectTerminalReport({
      terminal: true,
      terminalReport: TERMINAL_REPORT,
      lastLiveReport: LIVE_REPORT,
      notPublic: true,
    });
    expect(selected.sourceReport).toBe(TERMINAL_REPORT);
    expect(selected.sourceReport).not.toBe(LIVE_REPORT);
    expect(selected.sourceKind).toBe("terminal");
  });

  test("never merges lastLiveReport fields into the terminal report", () => {
    const selected = selectTerminalReport({
      terminal: true,
      terminalReport: TERMINAL_REPORT,
      lastLiveReport: LIVE_REPORT,
      notPublic: true,
    });
    expect(selected.sourceReport).toEqual(TERMINAL_REPORT);
    expect(selected.sourceReport?.id).toBe(TERMINAL_ID);
    expect(selected.sourceReport?.evidence).toEqual(TERMINAL_REPORT.evidence);
    expect(selected.sourceReport?.score).toEqual(TERMINAL_REPORT.score);
    expect(selected.sourceReport?.evidence).not.toEqual(LIVE_REPORT.evidence);
  });

  test("uses lastLiveReport only as the not-public fallback", () => {
    const fallback = selectTerminalReport({
      terminal: true,
      terminalReport: null,
      lastLiveReport: LIVE_REPORT,
      notPublic: true,
    });
    expect(fallback.sourceReport).toBe(LIVE_REPORT);
    expect(fallback.sourceKind).toBe("cached_session");

    const rejected = selectTerminalReport({
      terminal: true,
      terminalReport: null,
      lastLiveReport: LIVE_REPORT,
      notPublic: false,
    });
    expect(rejected.sourceReport).toBeNull();
    expect(rejected.sourceKind).toBe("none");
  });

  test("rejects lastLiveReport when a terminal report is already available", () => {
    const selected = selectTerminalReport({
      terminal: true,
      terminalReport: TERMINAL_REPORT,
      lastLiveReport: LIVE_REPORT,
      notPublic: false,
    });
    expect(selected.sourceReport).toBe(TERMINAL_REPORT);
    expect(selected.sourceKind).toBe("terminal");
  });

  test("leaves sourceKind terminal whenever terminalReport is present", () => {
    const live = selectTerminalReport({
      terminal: false,
      terminalReport: TERMINAL_REPORT,
      lastLiveReport: null,
      notPublic: false,
    });
    expect(live.sourceReport).toBeNull();
    expect(live.sourceKind).toBe("terminal");

    const emptyFallback = selectTerminalReport({
      terminal: true,
      terminalReport: null,
      lastLiveReport: null,
      notPublic: true,
    });
    expect(emptyFallback.sourceReport).toBeNull();
    expect(emptyFallback.sourceKind).toBe("none");
  });
});
