import { describe, expect, test } from "bun:test";

import {
  POLL_TRANSPORT_FAILURE_PREFIX,
  POLL_TRANSPORT_RETRY_LABEL,
  projectPollTransportFailure,
  projectReportTransportFailure,
  projectTransportFailure,
  REPORT_TRANSPORT_FAILURE_PREFIX,
  REPORT_TRANSPORT_RETRY_LABEL,
} from "./transportFailure";

describe("projectPollTransportFailure", () => {
  test("hides the poll panel when the error string is empty", () => {
    expect(projectPollTransportFailure("")).toBeNull();
  });

  test("keeps retry visible and prefixes the poll error copy exactly", () => {
    expect(projectPollTransportFailure("network request failed")).toEqual({
      message: `${POLL_TRANSPORT_FAILURE_PREFIX} network request failed`,
      showRetry: true,
      retryLabel: POLL_TRANSPORT_RETRY_LABEL,
    });
  });
});

describe("projectReportTransportFailure", () => {
  test("hides the report panel for every page status except report_error", () => {
    const failure = { message: "missing" };
    expect(projectReportTransportFailure("live", failure)).toBeNull();
    expect(projectReportTransportFailure("loading_report", failure)).toBeNull();
    expect(projectReportTransportFailure("ready", failure)).toBeNull();
    expect(projectReportTransportFailure("not_saved_empty", failure)).toBeNull();
    expect(projectReportTransportFailure("malformed", failure)).toBeNull();
    expect(projectReportTransportFailure("expired", failure)).toBeNull();
  });

  test("keeps retry visible and appends a non-empty report failure message", () => {
    expect(
      projectReportTransportFailure("report_error", { message: "missing" }),
    ).toEqual({
      message: `${REPORT_TRANSPORT_FAILURE_PREFIX} missing`,
      showRetry: true,
      retryLabel: REPORT_TRANSPORT_RETRY_LABEL,
    });
  });

  test("shows the report prefix alone when the failure message is empty or absent", () => {
    const prefixOnly = {
      message: REPORT_TRANSPORT_FAILURE_PREFIX,
      showRetry: true as const,
      retryLabel: REPORT_TRANSPORT_RETRY_LABEL,
    };
    expect(projectReportTransportFailure("report_error", null)).toEqual(prefixOnly);
    expect(projectReportTransportFailure("report_error", { message: "" })).toEqual(
      prefixOnly,
    );
  });
});

describe("projectTransportFailure", () => {
  test("returns hidden panels when there is no poll error and the page is not report_error", () => {
    expect(projectTransportFailure("", "ready", { message: "missing" })).toEqual({
      poll: null,
      report: null,
    });
  });

  test("projects poll and report panels independently without suppressing either", () => {
    expect(
      projectTransportFailure("timed out", "report_error", { message: "missing" }),
    ).toEqual({
      poll: {
        message: `${POLL_TRANSPORT_FAILURE_PREFIX} timed out`,
        showRetry: true,
        retryLabel: POLL_TRANSPORT_RETRY_LABEL,
      },
      report: {
        message: `${REPORT_TRANSPORT_FAILURE_PREFIX} missing`,
        showRetry: true,
        retryLabel: REPORT_TRANSPORT_RETRY_LABEL,
      },
    });
  });
});
