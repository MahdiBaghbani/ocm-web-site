import React, { act } from "react";
import { describe, expect, test } from "bun:test";

import StatisticsShell from "./StatisticsShell";
import {
  installDomShim,
  reactDomContainerOf,
} from "../test-helpers/domShim";
import { emptyStatistics, mockIslandFetch } from "../test-helpers/statisticsFetch";
import { findById, findByTag, htmlOf } from "../test-helpers/statisticsShell";
import { waitForText } from "../test-helpers/wait";

describe("StatisticsShell island panels", () => {
  test("empty branch omits GradeDistribution", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = mockIslandFetch(200, emptyStatistics());
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<StatisticsShell />);
      });
      await waitForText(container, "Public totals stay at zero until");
      findById(container, "validator-stats-days");
      findByTag(container, "select");
      const html = htmlOf(container);
      expect(html).not.toContain("Area-grade totals");
      await act(() => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });
});
