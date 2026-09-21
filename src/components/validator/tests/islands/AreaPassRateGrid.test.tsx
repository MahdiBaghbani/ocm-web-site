import React from "react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import AreaPassRateGrid from "@/components/validator/islands/AreaPassRateGrid";
import { zeroAreas } from "@/components/validator/tests/islands/StatisticsShell/helpers/statisticsFetch";

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("AreaPassRateGrid", () => {
  test("empty areas render 0/8 areas assessed", () => {
    const html = render(<AreaPassRateGrid areas={zeroAreas()} />);
    expect(html).toContain("0/8 areas assessed");
  });

  test("ready discovery overlay renders Server discovery and 1/8 areas assessed", () => {
    const areas = zeroAreas();
    areas[0] = { area: "discovery", pass: 8, warn: 1, fail: 1 };
    const html = render(<AreaPassRateGrid areas={areas} />);
    expect(html).toContain("Server discovery");
    expect(html).toContain("1/8 areas assessed");
  });
});
