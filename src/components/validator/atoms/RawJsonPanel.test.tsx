import React from "react";
import { describe, expect, test } from "bun:test";

import RawJsonPanel from "./RawJsonPanel";
import {
  FILE_VIEWER_CHIP,
  countAttr,
  countChipsInFileViewerPanel,
  render,
} from "./test-helpers";

describe("RawJsonPanel", () => {
  test("renders one JSON panel without throwing", () => {
    const html = render(
      <RawJsonPanel
        title="Report"
        downloadName="report-abc.json"
        value={{ schema: "federation_tester_report.v1", id: "abc" }}
      />,
    );
    expect(html).toContain("Report");
    expect(html).toContain("federation_tester_report.v1");
    expect(html).toContain("abc");
    expect(html).toContain("Download");
    expect(countAttr(html, FILE_VIEWER_CHIP)).toBe(1);
    expect(countChipsInFileViewerPanel(html)).toBe(1);
  });
});
