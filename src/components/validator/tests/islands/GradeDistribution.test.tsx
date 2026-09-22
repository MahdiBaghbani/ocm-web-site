import React from "react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import GradeDistribution from "@/components/validator/islands/GradeDistribution";

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("GradeDistribution", () => {
  test("labels summed area grades as area-grade totals, not session totals", () => {
    const html = render(
      <GradeDistribution
        areas={[
          { area: "discovery", pass: 2, warn: 1, fail: 0 },
          { area: "tls", pass: 1, warn: 0, fail: 3 },
        ]}
      />,
    );
    expect(html).toContain("Area-grade totals");
    expect(html).toContain("area-grade totals: pass 3, warn 1, fail 3");
    expect(html).toContain("pass 3");
    expect(html).toContain("warn 1");
    expect(html).toContain("fail 3");
    expect(html).not.toContain("session totals");
  });

  test("labels explicit totals as area-grade totals", () => {
    const html = render(<GradeDistribution totals={{ pass: 1, warn: 2, fail: 4 }} />);
    expect(html).toContain("Area-grade totals");
    expect(html).toContain('aria-label="area-grade totals: pass 1, warn 2, fail 4"');
  });

  test("omits non-canonical areas that AreaGrid does not render", () => {
    const html = render(
      <GradeDistribution
        areas={[
          { area: "tls", pass: 2, warn: 0, fail: 0 },
          { area: "not-an-area", pass: 9, warn: 9, fail: 9 },
        ]}
      />,
    );
    expect(html).toContain("area-grade totals: pass 2, warn 0, fail 0");
    expect(html).not.toContain("pass 11");
  });
});
