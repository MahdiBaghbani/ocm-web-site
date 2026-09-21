import React from "react";
import { describe, expect, test } from "bun:test";

import Pill, { PILL_KINDS } from "@/components/validator/atoms/Pill";
import { firstPillLabel, render } from "@/components/validator/tests/atoms/helpers/test-helpers";

describe("Pill", () => {
  test("renders every kind with its default label", () => {
    const expected = {
      pass: "pass",
      fail: "fail",
      warn: "warn",
      pending: "pending",
      info: "info",
      unassessed: "unassessed",
      notrun: "not-run",
    } as const;
    for (const kind of PILL_KINDS) {
      const html = render(<Pill kind={kind} />);
      expect(html).toContain(`data-pill-kind="${kind}"`);
      expect(firstPillLabel(html)).toBe(expected[kind]);
    }
    const custom = render(<Pill kind="unassessed" label="idle" />);
    expect(custom).toContain('data-pill-kind="unassessed"');
    expect(firstPillLabel(custom)).toBe("idle");
  });
});
