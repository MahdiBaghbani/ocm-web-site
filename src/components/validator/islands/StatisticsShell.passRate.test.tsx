import React, { act } from "react";
import { describe, expect, test } from "bun:test";

import StatisticsShell from "./StatisticsShell";
import {
  installDomShim,
  reactDomContainerOf,
} from "../test-helpers/domShim";
import { mockIslandFetch, readyStatistics } from "../test-helpers/statisticsFetch";
import {
  findById,
  findByTag,
  htmlOf,
  tileValue,
} from "../test-helpers/statisticsShell";
import { waitForText } from "../test-helpers/wait";

describe("StatisticsShell island panels", () => {
  test("ready branch renders numeric tiles, platforms, and area-grade totals", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = mockIslandFetch(200, readyStatistics());
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<StatisticsShell />);
      });
      await waitForText(container, "80%");
      findById(container, "validator-stats-days");
      findByTag(container, "select");
      const html = htmlOf(container);
      expect(tileValue(container, "Sessions")).toBe("10");
      expect(tileValue(container, "Unique hosts")).toBe("6");
      expect(tileValue(container, "Healthy")).toBe("80%");
      expect(html).toContain("nextcloud");
      expect(html).toContain("opencloud");
      expect(html).toContain("Area-grade totals");
      expect(html).toContain("Server discovery");
      expect(html).toContain("1/8 areas assessed");
      expect(html).not.toContain("Public totals stay at zero until");
      await act(() => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });
});
