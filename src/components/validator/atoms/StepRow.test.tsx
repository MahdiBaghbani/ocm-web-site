import React from "react";
import { describe, expect, test } from "bun:test";

import { guidanceFor } from "../lib/validatorGuidance";
import StepRow from "./StepRow";
import {
  ctaSlotTag,
  guidanceSlotTag,
  primaryButtonTag,
  render,
  rootCardTag,
  secondaryLinkTag,
  statusCaptionTag,
  stepIndexNumeral,
} from "./test-helpers";

describe("StepRow", () => {
  test("renders pending, current, and complete statuses", () => {
    const pending = render(<StepRow step="queue_or_rest" status="pending" index={2} />);
    const current = render(<StepRow step="probe" status="current" index={1} />);
    const complete = render(<StepRow step="result" status="complete" index={6} />);
    expect(pending).toContain("Continue or finish");
    expect(pending).toContain("pending");
    expect(current).toContain("Check server");
    expect(current).toContain("current");
    expect(stepIndexNumeral(current)).toBe("1");
    expect(complete).toContain("Prepare result");
    expect(complete).toContain("complete");
  });

  test("renders a CTA on a complete invite row and hides hidden steps", () => {
    const withCta = render(
      <StepRow step="invite" status="complete" index={3} ctaLabel="Paste invite" onCta={() => undefined} />,
    );
    expect(withCta).toContain("Create invitation");
    expect(withCta).toContain("Paste invite");
    expect(render(<StepRow step="share" status="hidden" index={5} />)).toBe("");
  });

  test("renders guidance title and body only on the current row", () => {
    const record = guidanceFor("paste_s1");
    expect(record).not.toBeNull();
    if (record === null || record.kind !== "instruction") {
      throw new Error("expected paste_s1 instruction guidance");
    }
    const current = render(
      <StepRow step="invite" status="current" index={3} guidance={record} />,
    );
    const pending = render(
      <StepRow step="invite" status="pending" index={3} guidance={record} />,
    );
    const complete = render(
      <StepRow step="invite" status="complete" index={3} guidance={record} />,
    );
    expect(current).toContain(record.title);
    expect(current).toContain(record.body);
    expect(guidanceSlotTag(current)).not.toContain('aria-hidden="true"');
    expect(pending).not.toContain(record.title);
    expect(pending).not.toContain(record.body);
    expect(complete).not.toContain(record.title);
    expect(complete).not.toContain(record.body);
    expect(guidanceSlotTag(pending)).toContain('aria-hidden="true"');
    expect(guidanceSlotTag(complete)).toContain('aria-hidden="true"');
  });

  test("reserves an empty guidance slot sized beyond min-h-10, hidden from accessibility APIs", () => {
    const html = render(<StepRow step="probe" status="current" index={1} />);
    expect(guidanceSlotTag(html)).toContain("min-h-28");
    expect(guidanceSlotTag(html)).toContain("sm:min-h-20");
    expect(html).not.toContain("min-h-10 ");
    expect(html).not.toContain('"min-h-10"');
    expect(html).toContain('data-guidance-slot=""');
    expect(guidanceSlotTag(html)).toContain('aria-hidden="true"');
    expect(html).not.toContain("Wait for the discovery probe");
  });

  test("renders a primary button and secondary report link together", () => {
    const html = render(
      <StepRow
        step="invite"
        status="current"
        index={3}
        ctaLabel="Copy invitation"
        onCta={() => undefined}
        ctaHref="/validator/report/abc"
      />,
    );
    expect(html).toContain("Copy invitation");
    expect(html).toContain("<button");
    expect(html).toContain('href="/validator/report/abc"');
    expect(html).toContain("View report");
    expect(html).toContain("<a");
    expect(html).toContain('target="_blank"');
    expect(primaryButtonTag(html)).toContain("focus-visible:outline-none");
    expect(primaryButtonTag(html)).toContain("focus-visible:ring-2");
    expect(primaryButtonTag(html)).toContain("focus-visible:ring-zinc-300");
  });

  test("renders terminal guidance body on the current row", () => {
    const record = guidanceFor("terminal_pass");
    expect(record).not.toBeNull();
    if (record === null || record.kind !== "terminal") {
      throw new Error("expected terminal_pass terminal guidance");
    }
    const current = render(
      <StepRow step="result" status="current" index={6} guidance={record} />,
    );
    const pending = render(
      <StepRow step="result" status="pending" index={6} guidance={record} />,
    );
    const complete = render(
      <StepRow step="result" status="complete" index={6} guidance={record} />,
    );
    expect(current).toContain(`<p>${record.body}</p>`);
    expect(current).not.toContain("font-semibold text-zinc-300");
    expect(guidanceSlotTag(current)).not.toContain('aria-hidden="true"');
    expect(pending).not.toContain(record.body);
    expect(complete).not.toContain(record.body);
    expect(guidanceSlotTag(pending)).toContain('aria-hidden="true"');
    expect(guidanceSlotTag(complete)).toContain('aria-hidden="true"');
  });

  test("renders a secondary report link without a primary button", () => {
    const html = render(
      <StepRow
        step="result"
        status="current"
        index={6}
        ctaHref="/validator/report/abc"
      />,
    );
    expect(html).toContain('href="/validator/report/abc"');
    expect(html).toContain("View report");
    expect(html).toContain("<a");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("<button");
    expect(ctaSlotTag(html)).not.toContain('aria-hidden="true"');
  });

  test("applies zinc-400 tokens on pending labels, status, slot, and link", () => {
    const pending = render(
      <StepRow step="queue_or_rest" status="pending" index={2} />,
    );
    const current = render(<StepRow step="probe" status="current" index={1} />);
    const complete = render(
      <StepRow step="result" status="complete" index={6} />,
    );
    const withLink = render(
      <StepRow
        step="result"
        status="current"
        index={6}
        ctaHref="/validator/report/abc"
      />,
    );
    expect(pending).toContain("text-sm font-semibold text-zinc-400");
    expect(complete).toContain("text-sm font-semibold text-zinc-400");
    expect(current).toContain("text-sm font-semibold text-zinc-100");
    expect(current).not.toContain("text-sm font-semibold text-zinc-400");
    expect(statusCaptionTag(pending)).toContain("text-xs text-zinc-400");
    expect(statusCaptionTag(current)).toContain("text-xs text-zinc-400");
    expect(statusCaptionTag(complete)).toContain("text-xs text-zinc-400");
    expect(guidanceSlotTag(current)).toContain("text-zinc-400");
    expect(secondaryLinkTag(withLink)).toContain("text-zinc-400");
  });

  test("reserves an empty CTA slot hidden from accessibility APIs", () => {
    const empty = render(<StepRow step="probe" status="current" index={1} />);
    const filled = render(
      <StepRow
        step="invite"
        status="current"
        index={3}
        ctaLabel="Copy invitation"
        onCta={() => undefined}
      />,
    );
    expect(empty).toContain('data-cta-slot=""');
    expect(ctaSlotTag(empty)).toContain("min-h-11");
    expect(ctaSlotTag(empty)).toContain("min-w-[10rem]");
    expect(ctaSlotTag(empty)).toContain("shrink-0");
    expect(ctaSlotTag(empty)).toContain('aria-hidden="true"');
    expect(ctaSlotTag(filled)).toContain("min-h-11");
    expect(ctaSlotTag(filled)).toContain("min-w-[10rem]");
    expect(ctaSlotTag(filled)).not.toContain('aria-hidden="true"');
  });

  test("mounts an optional formSlot inside the card regardless of row status", () => {
    const marker = <p data-testid="reverse-form-marker">form</p>;
    const current = render(
      <StepRow step="reverse" status="current" index={4} formSlot={marker} />,
    );
    const pending = render(
      <StepRow step="reverse" status="pending" index={4} formSlot={marker} />,
    );
    const complete = render(
      <StepRow step="reverse" status="complete" index={4} formSlot={marker} />,
    );
    const withoutSlot = render(<StepRow step="reverse" status="current" index={4} />);
    expect(current).toContain('data-testid="reverse-form-marker"');
    expect(pending).toContain('data-testid="reverse-form-marker"');
    expect(complete).toContain('data-testid="reverse-form-marker"');
    expect(withoutSlot).not.toContain('data-testid="reverse-form-marker"');
  });

  test("applies focus-ring classes on the root card and secondary link", () => {
    const html = render(
      <StepRow
        step="invite"
        status="current"
        index={3}
        ctaHref="/validator/report/abc"
      />,
    );
    expect(rootCardTag(html)).toContain("focus-visible:outline-none");
    expect(rootCardTag(html)).toContain("focus-visible:ring-2");
    expect(rootCardTag(html)).toContain("focus-visible:ring-zinc-300");
    expect(secondaryLinkTag(html)).toContain("focus-visible:outline-none");
    expect(secondaryLinkTag(html)).toContain("focus-visible:ring-2");
    expect(secondaryLinkTag(html)).toContain("focus-visible:ring-zinc-300");
  });

  test("disables the primary button while a claim is in flight", () => {
    const busy = render(
      <StepRow
        step="invite"
        status="current"
        index={3}
        ctaLabel="Copy invitation"
        onCta={() => undefined}
        disabled
      />,
    );
    const idle = render(
      <StepRow
        step="invite"
        status="current"
        index={3}
        ctaLabel="Copy invitation"
        onCta={() => undefined}
      />,
    );
    expect(primaryButtonTag(busy)).toMatch(/\sdisabled(?:[=/\s>])/);
    expect(primaryButtonTag(busy)).not.toContain("aria-disabled");
    expect(primaryButtonTag(idle)).not.toMatch(/\sdisabled(?:[=/\s>])/);
  });

  test("sets aria-current=step only on the current card", () => {
    const current = render(<StepRow step="probe" status="current" index={1} />);
    const pending = render(<StepRow step="probe" status="pending" index={1} />);
    const complete = render(<StepRow step="probe" status="complete" index={6} />);
    expect(rootCardTag(current)).toContain('aria-current="step"');
    expect(rootCardTag(pending)).not.toContain("aria-current");
    expect(rootCardTag(complete)).not.toContain("aria-current");
    expect(pending).not.toContain('aria-current="step"');
    expect(complete).not.toContain('aria-current="step"');
  });

  test("applies tabIndex=-1 on the current card only for the focus-loss restore path", () => {
    const current = render(<StepRow step="probe" status="current" index={1} />);
    const restoring = render(
      <StepRow step="probe" status="current" index={1} cardTabIndex={-1} />,
    );
    const pending = render(
      <StepRow step="probe" status="pending" index={1} cardTabIndex={-1} />,
    );
    const complete = render(
      <StepRow step="probe" status="complete" index={1} cardTabIndex={-1} />,
    );
    expect(rootCardTag(current)).not.toContain("tabindex");
    expect(rootCardTag(restoring)).toContain('tabindex="-1"');
    expect(rootCardTag(restoring)).not.toContain('tabindex="0"');
    expect(rootCardTag(pending)).not.toContain("tabindex");
    expect(rootCardTag(complete)).not.toContain("tabindex");
    expect(rootCardTag(restoring)).toContain('aria-current="step"');
  });
});
