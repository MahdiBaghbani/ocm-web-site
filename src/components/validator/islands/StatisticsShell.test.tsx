import React from "react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import StatisticsShell from "./StatisticsShell";
import {
  DEFAULT_STATISTICS_DAYS,
  STATISTICS_TIMEFRAME_DAYS,
  parseDaysToken,
} from "../lib/validatorStatistics";

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

function selectedValue(html: string): string | null {
  const onSelect = /<select[^>]* value="([^"]*)"/.exec(html);
  if (onSelect !== null) {
    return onSelect[1];
  }
  const selectedOption =
    /<option[^>]* selected[^>]* value="([^"]*)"/.exec(html) ??
    /<option[^>]* value="([^"]*)"[^>]* selected/.exec(html);
  return selectedOption === null ? null : selectedOption[1];
}

function optionValues(html: string): string[] {
  return [...html.matchAll(/<option[^>]* value="([^"]*)"/g)].map((match) => match[1]);
}

describe("StatisticsShell selector", () => {
  test("SSR uses a numeric days token and the fallback timeframe list", () => {
    const html = render(<StatisticsShell />);
    expect(typeof DEFAULT_STATISTICS_DAYS).toBe("number");
    expect(selectedValue(html)).toBe(String(DEFAULT_STATISTICS_DAYS));
    expect(optionValues(html)).toEqual(STATISTICS_TIMEFRAME_DAYS.map(String));
    expect(html).toContain('id="validator-stats-days"');
    expect(html).toContain("Loading statistics...");
  });

  test("SSR honors a numeric initialDays token", () => {
    const html = render(<StatisticsShell initialDays={7} />);
    expect(selectedValue(html)).toBe("7");
    expect(parseDaysToken(selectedValue(html))).toBe(7);
  });

  test("SSR parses a string initialDays token", () => {
    const html = render(<StatisticsShell initialDays="30" />);
    expect(selectedValue(html)).toBe("30");
  });
});
