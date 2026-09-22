import React from "react";
import { describe, expect, test } from "bun:test";
import {
  CircleCheck,
  CircleStop,
  CircleX,
  Info,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";

import {
  countAttr,
  firstPillLabel,
  iconSlotMarkup,
  render,
  svgInnerMarkup,
} from "@/components/validator/tests/atoms/helpers/test-helpers";
import VerdictBanner, { VERDICT_KINDS, verdictKindFromScore } from "@/components/validator/atoms/VerdictBanner";

const VERDICT_LUCIDE_ICONS = {
  pass: CircleCheck,
  fail: CircleX,
  warn: TriangleAlert,
  running: LoaderCircle,
  interrupted: CircleStop,
  inconclusive: Info,
} as const;

describe("VerdictBanner", () => {
  test("renders each verdict kind with distinguishing content", () => {
    const pass = render(<VerdictBanner verdict="pass" />);
    const fail = render(<VerdictBanner verdict="fail" message="probe failed" />);
    const warn = render(<VerdictBanner verdict="warn" />);
    const running = render(<VerdictBanner verdict="running" />);
    const interrupted = render(<VerdictBanner verdict="interrupted" />);
    const inconclusive = render(<VerdictBanner verdict="inconclusive" />);
    expect(pass).toContain("Pass"); expect(pass).toContain('role="status"');
    expect(fail).toContain("Fail"); expect(fail).toContain("probe failed");
    expect(fail).toContain('role="alert"'); expect(warn).toContain("Warn");
    expect(running).toContain("Scan in progress"); expect(interrupted).toContain("Interrupted");
    expect(inconclusive).toContain("No compatibility result");
    expect(pass).toContain('aria-hidden="true"');
  });

  test("maps explicit pass, warn, and fail grades", () => {
    expect(verdictKindFromScore({ grade: "pass", state: "terminal_pass" })).toBe("pass");
    expect(verdictKindFromScore({ grade: "warn", state: "terminal_pass" })).toBe("warn");
    expect(verdictKindFromScore({ grade: "fail", state: "terminal_pass" })).toBe("fail");
  });

  test("keys interrupted from state even when grade is null or stale", () => {
    expect(verdictKindFromScore({ grade: null, state: "interrupted" })).toBe("interrupted");
    expect(verdictKindFromScore({ grade: "pass", state: "interrupted" })).toBe("interrupted");
    expect(verdictKindFromScore({ grade: "warn", state: "interrupted" })).toBe("interrupted");
  });

  test("keys terminal fail from state when grade is absent or contradictory", () => {
    expect(verdictKindFromScore({ grade: null, state: "terminal_fail" })).toBe("fail");
    expect(verdictKindFromScore({ grade: "warn", state: "terminal_fail" })).toBe("fail");
  });

  test("maps validated terminal_pass null grade to inconclusive", () => {
    expect(verdictKindFromScore({ grade: null, state: "terminal_pass" })).toBe("inconclusive");
  });

  test("maps non-terminal null grade to running", () => {
    expect(verdictKindFromScore({ grade: null, state: "passive_running" })).toBe("running");
    expect(verdictKindFromScore({ grade: null, state: "created" })).toBe("running");
  });

  test("lets grade fail take precedence over a contradictory pass-like state", () => {
    expect(verdictKindFromScore({ grade: "fail", state: "terminal_pass" })).toBe("fail");
    expect(verdictKindFromScore({ grade: "fail", state: "passive_running" })).toBe("fail");
  });

  test("renders inconclusive as neutral gray with an Info icon, not green", () => {
    const html = render(<VerdictBanner verdict="inconclusive" />);
    expect(html).toContain("No compatibility result");
    expect(html).toContain('data-icon="inconclusive"');
    expect(html).toContain("<svg");
    expect(html).not.toContain(">i<");
    expect(html).toContain("border-zinc-800");
    expect(html).toContain("bg-zinc-900/20");
    expect(html).not.toContain("emerald");
    expect(html).not.toContain("Pass");
    expect(firstPillLabel(html)).toBe("unassessed");
  });

  test("renders a lucide icon for each verdict kind", () => {
    const refInners = VERDICT_KINDS.map((kind) => {
      const Icon = VERDICT_LUCIDE_ICONS[kind];
      return svgInnerMarkup(render(<Icon size={20} />));
    });
    expect(new Set(refInners).size).toBe(VERDICT_KINDS.length);
    for (const kind of VERDICT_KINDS) {
      const Icon = VERDICT_LUCIDE_ICONS[kind];
      const refInner = svgInnerMarkup(render(<Icon size={20} />));
      const html = render(<VerdictBanner verdict={kind} />);
      expect(html).toContain(`data-icon="${kind}"`);
      expect(html).toContain("<svg");
      expect(html).toContain(refInner);
      expect(svgInnerMarkup(html)).toBe(refInner);
      expect(html).not.toContain(">v<");
      expect(html).not.toContain(">x<");
      expect(html).not.toContain(">!<");
      expect(html).not.toContain("...");
      expect(html).not.toContain(">i<");
    }
  });

  test("shows heading once and pill as a status indicator", () => {
    const html = render(<VerdictBanner verdict="pass" title="Compatible" />);
    expect(countAttr(html, "Compatible")).toBe(1);
    expect(firstPillLabel(html)).toBe("pass");
  });

  test("running verdict renders a LoaderCircle icon", () => {
    const refInner = svgInnerMarkup(render(<LoaderCircle size={20} />));
    const running = render(<VerdictBanner verdict="running" />);
    expect(running).toContain('data-icon="running"');
    expect(running).toContain("<svg");
    expect(running).toContain(refInner);
    expect(svgInnerMarkup(running)).toBe(refInner);
    expect(running).not.toContain("...");
    expect(running).not.toContain(">v<");
  });

  test("interrupted CircleStop and inconclusive Info render distinct icons", () => {
    const interrupted = render(<VerdictBanner verdict="interrupted" />);
    const inconclusive = render(<VerdictBanner verdict="inconclusive" />);
    expect(interrupted).toContain('data-icon="interrupted"');
    expect(inconclusive).toContain('data-icon="inconclusive"');
    expect(interrupted).toContain("<svg");
    expect(inconclusive).toContain("<svg");
    expect(iconSlotMarkup(interrupted)).not.toBe(iconSlotMarkup(inconclusive));
    expect(interrupted).not.toContain(">i<");
    expect(inconclusive).not.toContain(">i<");
  });
});
