import React, { act } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import ResultsShell from "./ResultsShell";
import { RESULT_HEADLINE, type CanonicalAreaId } from "../lib/validatorScore";
import type { ReportResponse } from "../lib/validatorFetch";
import { requestUrl, jsonResponse } from "@/components/validator/tests/helpers/fetchStub";
import { registerHappyDom, teardownHappyDom } from "@/components/validator/tests/helpers/happyDom";

const SESSION_ID = "0193a0c2-7c1d-7b4a-8f2e-1a2b3c4d5e6f";
const API_ORIGIN = "https://validator.example.com";
const AREA_IDS = [
  "discovery",
  "tls",
  "jwks",
  "httpsig",
  "sharing",
  "notification",
  "token",
  "capability",
] as const satisfies readonly CanonicalAreaId[];

function areaRow(area: CanonicalAreaId, grade: "pass" | "warn" | "fail" | null): Record<string, unknown> {
  return {
    area,
    grade,
    testRunCount: 0,
    distinctTestCount: 0,
    requiredTestCount: 0,
    optionalTestCount: 0,
    passedTestCount: 0,
    failedTestCount: 0,
    passWithWarningCount: 0,
    evidenceCount: 0,
  };
}

function specification(
  gradeFor: (id: CanonicalAreaId) => "pass" | "warn" | "fail" | null,
  grade: "pass" | "warn" | "fail" | null = "pass",
): Record<string, unknown> {
  return {
    grade,
    state: "terminal_pass",
    terminal: true,
    assessedAreas: 8,
    totalAreas: 8,
    areas: AREA_IDS.map((id) => areaRow(id, gradeFor(id))),
  };
}

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

describe("ResultsShell loaded-evidence projection", () => {
  beforeAll(async () => {
    await registerHappyDom();
  });

  afterAll(() => {
    teardownHappyDom();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
  });

  test("a zero-count scored area stays interactive when loaded evidence exists", async () => {
    // jwks is scored with a null grade and zero reported evidence, so its card
    // trigger renders only because loaded evidence rows exist for the area. This
    // exercises the full projection wiring end to end:
    //   ResultsShell.loadedEvidenceCountsByArea (evidence rows)
    //     -> projectResultsPage loadedEvidenceByArea
    //     -> validatorScore areaGridEntriesFromScore entry.loadedEvidenceCount
    //     -> AreaGrid interactive open predicate.
    // Removing the loadedEvidenceByArea argument from the projectResultsPage
    // call leaves loadedEvidenceCount at 0, so the interactive predicate
    // (grade !== null || evidenceCount > 0 || loadedEvidence > 0) is false and
    // the trigger never renders, which fails the assertions below.
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification((id) => (id === "jwks" ? null : "pass")), {
        evidence: [
          { area: "jwks", scoreArea: "jwks", reasonCode: "jwks_probed", grade: "pass" },
          { area: "jwks", scoreArea: "jwks", reasonCode: "jwks_probed", grade: "pass" },
        ],
      }),
    );
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes(RESULT_HEADLINE.compatible) === true,
      );

      // The jwks area has a null grade and zero reported evidence; the only
      // reason its card is interactive is the loaded evidence projected through
      // the score. Without the loadedEvidenceByArea wiring this query is null.
      await waitForDom(
        () => document.querySelector("button#area-card-jwks-action") !== null,
      );
      const trigger = document.querySelector<HTMLButtonElement>(
        "button#area-card-jwks-action",
      );
      expect(trigger).not.toBeNull();
      if (trigger === null) {
        throw new Error("missing jwks trigger");
      }
      expect(trigger.getAttribute("id")).toBe("area-card-jwks-action");
      expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
      // Null grade means no warn/fail reason forward label, so the neutral
      // View details label proves the card is interactive purely via evidence.
      expect(trigger.textContent).toBe("View details");
      await act(() => {
        root.unmount();
      });
    } finally {
      restoreFetch();
    }
  });
});
