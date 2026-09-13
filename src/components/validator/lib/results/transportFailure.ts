/**
 * Pure transport and polling failure projection for the results page.
 * Inputs to outputs only: no React, refs, or session state.
 */

export const POLL_TRANSPORT_FAILURE_PREFIX = "We could not update this scan.";
export const REPORT_TRANSPORT_FAILURE_PREFIX = "We could not load this report.";
export const POLL_TRANSPORT_RETRY_LABEL = "Try again";
export const REPORT_TRANSPORT_RETRY_LABEL = "Try loading again";

export type TransportFailureDisplay = {
  message: string;
  showRetry: true;
  retryLabel: string;
};

export type TransportFailureProjection = {
  poll: TransportFailureDisplay | null;
  report: TransportFailureDisplay | null;
};

/**
 * Live poll/stop transport failure. An empty error string is not a failure.
 * Retry stays visible whenever this panel is shown.
 */
export function projectPollTransportFailure(
  error: string,
): TransportFailureDisplay | null {
  if (error === "") {
    return null;
  }
  return {
    message: `${POLL_TRANSPORT_FAILURE_PREFIX} ${error}`,
    showRetry: true,
    retryLabel: POLL_TRANSPORT_RETRY_LABEL,
  };
}

/**
 * Terminal report-fetch transport failure. Only the report_error page status
 * surfaces this panel; expired, not-public, malformed, and ready terminals
 * do not. Retry stays visible whenever this panel is shown.
 */
export function projectReportTransportFailure(
  status: string,
  reportFailure: { message: string } | null,
): TransportFailureDisplay | null {
  if (status !== "report_error") {
    return null;
  }
  const detail =
    reportFailure !== null && reportFailure.message !== ""
      ? ` ${reportFailure.message}`
      : "";
  return {
    message: `${REPORT_TRANSPORT_FAILURE_PREFIX}${detail}`,
    showRetry: true,
    retryLabel: REPORT_TRANSPORT_RETRY_LABEL,
  };
}

/**
 * Independent poll and report transport panels. Both can be present; neither
 * suppresses the other. Terminal page statuses other than report_error leave
 * the report panel hidden.
 */
export function projectTransportFailure(
  error: string,
  status: string,
  reportFailure: { message: string } | null,
): TransportFailureProjection {
  return {
    poll: projectPollTransportFailure(error),
    report: projectReportTransportFailure(status, reportFailure),
  };
}
