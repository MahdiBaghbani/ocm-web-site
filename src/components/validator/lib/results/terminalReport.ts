/**
 * Pure terminal-report selection for the results page.
 * Inputs to outputs only: no React, refs, or session state.
 */

import type { ReportResponse } from "../validatorFetch";

export type TerminalReportSourceKind = "terminal" | "cached_session" | "none";

/**
 * Choose which report the results page may show. Live views expose no
 * source report. When terminal, terminalReport wins; lastLiveReport is
 * only the not-public fallback. The two reports stay distinct.
 */
export function selectTerminalReport(input: {
  terminal: boolean;
  terminalReport: ReportResponse | null;
  lastLiveReport: ReportResponse | null;
  notPublic: boolean;
}): {
  sourceReport: ReportResponse | null;
  sourceKind: TerminalReportSourceKind;
} {
  const sourceReport =
    !input.terminal
      ? null
      : input.terminalReport !== null
        ? input.terminalReport
        : input.notPublic
          ? input.lastLiveReport
          : null;
  const sourceKind: TerminalReportSourceKind =
    input.terminalReport !== null
      ? "terminal"
      : sourceReport !== null
        ? "cached_session"
        : "none";
  return { sourceReport, sourceKind };
}
