import React, { act } from "react";
import { describe, expect, test } from "bun:test";

import {
  AREA_RESULT_PILL,
  CANONICAL_AREA_IDS,
  areaGridEntriesFromScore,
  parseSpecificationScore,
} from "../lib/validatorScore";
import { guidanceFor } from "../lib/validatorGuidance";
import {
  installDomShim,
  reactDomContainerOf,
  ShimEvent,
} from "../test-helpers/domShim";
import AreaGrid, { VALIDATOR_AREA_IDS, type ValidatorAreaId } from "./AreaGrid";
import DomainField from "./DomainField";
import RawJsonPanel from "./RawJsonPanel";
import StepRow from "./StepRow";
import {
  FILE_VIEWER_CHIP,
  actionButtonIds,
  actionButtonLabelledby,
  areaGradeText,
  areaRateText,
  areaResultCardHtml,
  countAttr,
  countChipsInFileViewerPanel,
  ctaSlotTag,
  findNode,
  guidanceSlotTag,
  hasNonAscii,
  pillLabels,
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
describe("AreaGrid", () => {
  test("always renders the eight canonical areas", () => {
    const html = render(<AreaGrid />);
    expect(html).toContain("Server discovery"); expect(html).toContain("Secure connection");
    expect(html).toContain("Signing keys"); expect(html).toContain("Request signing");
    expect(html).toContain("Share exchange"); expect(html).toContain("Notifications");
    expect(html).toContain("Access tokens"); expect(html).toContain("Capabilities");
    expect(html).toContain(`0/${VALIDATOR_AREA_IDS.length} areas assessed`);
  });

  test("overlays grades and pass rates", () => {
    const html = render(
      <AreaGrid
        areas={[
          { area: "discovery", grade: "pass", evidenceCount: 2 },
          { area: "tls", pass: 3, warn: 1, fail: 0 },
          { area: "jwks", passRate: 0.5 },
          { area: "httpsig", passRate: 1.7 },
          { area: "sharing", passRate: -0.4 },
          { area: "token", grade: "warn", evidenceCount: 1 },
        ]}
      />,
    );
    expect(html).toContain("75%"); expect(html).toContain("50%");
    expect(html).toContain("100%");
    expect(areaRateText(html, "Share exchange")).toBe("0%");
    expect(html).toContain("2 evidence items"); expect(html).toContain("1 evidence item");
    expect(html).toContain("6/8 areas assessed");
    expect(areaGradeText(html, "Server discovery")).toBe("pass");
    expect(areaGradeText(html, "Secure connection")).toBe("warn");
    expect(areaGradeText(html, "Access tokens")).toBe("warn");
  });

  test("renders the TLS area grade as exact pill text", () => {
    const html = render(<AreaGrid areas={[{ area: "tls", grade: "pass" }]} />);
    expect(areaGradeText(html, "Secure connection")).toBe("pass");
  });

  test("explicit grade wins over conflicting evidence counts", () => {
    const html = render(
      <AreaGrid
        areas={[{ area: "tls", grade: "pass", pass: 0, warn: 0, fail: 5 }]}
      />,
    );
    expect(areaGradeText(html, "Secure connection")).toBe("pass");
  });

  test("renders explicit pass, fail, and warn grade labels", () => {
    const html = render(
      <AreaGrid
        areas={[
          { area: "discovery", grade: "pass" },
          { area: "tls", grade: "fail" },
          { area: "jwks", grade: "warn" },
        ]}
      />,
    );
    expect(areaGradeText(html, "Server discovery")).toBe("pass");
    expect(areaGradeText(html, "Secure connection")).toBe("fail");
    expect(areaGradeText(html, "Signing keys")).toBe("warn");
    expect(areaGradeText(html, "Request signing")).toBe("unassessed");
    expect(areaGradeText(html, "Share exchange")).toBe("unassessed");
  });

  test("renders zero evidence counts and the missing-count fallback", () => {
    const html = render(
      <AreaGrid areas={[{ area: "discovery", evidenceCount: 0 }, { area: "tls", grade: "pass" }]} />,
    );
    expect(html).toContain("0 evidence items");
    expect(html).toContain("pass rate");
  });

  test("keeps canonical areas only and last overlay wins", () => {
    const html = render(
      <AreaGrid
        areas={[
          { area: "discovery", grade: "pass" },
          { area: "discovery", grade: "fail" },
          { area: "not-an-area", grade: "pass", label: "Mystery" },
        ]}
      />,
    );
    expect(html).toContain("Server discovery");
    expect(html).toContain("Capabilities");
    expect(html).not.toContain("Mystery");
    expect(html).toContain(`1/${VALIDATOR_AREA_IDS.length} areas assessed`);
    expect(areaGradeText(html, "Server discovery")).toBe("fail");
    expect(pillLabels(html).includes("pass")).toBe(false);
  });

  test("result path renders custom description and custom pill label", () => {
    const html = render(
      <AreaGrid
        variant="results"
        areas={[
          {
            area: "discovery",
            grade: "pass",
            description: "Plain discovery copy",
            pillLabel: "Custom pass pill",
            evidenceCount: 0,
          },
        ]}
      />,
    );
    const card = areaResultCardHtml(html, "discovery");
    expect(html).toContain('data-area-card="discovery"');
    expect(card).toContain(">Server discovery</h3>");
    expect(card).toContain("Plain discovery copy");
    expect(areaGradeText(html, "Server discovery")).toBe("Custom pass pill");
    expect(html).toContain("Server discovery");
    expect(html).toContain("0 evidence items");
    expect(html).not.toContain("pass rate");
    expect(html).not.toContain("areas assessed");
    expect(html).not.toContain("text-lg font-semibold text-zinc-100");
    expect(html).not.toContain("This area checks");
    expect(card).not.toContain("View details");
  });

  test("result tile title is unchanged when description and pill label are set", () => {
    const html = render(
      <AreaGrid
        variant="results"
        areas={[
          {
            area: "tls",
            label: "TLS",
            grade: "warn",
            description: "Plain TLS copy",
            pillLabel: "Compatible with warnings",
          },
        ]}
      />,
    );
    const card = areaResultCardHtml(html, "tls");
    expect(html).toContain('data-area-card="tls"');
    expect(card).toContain(">TLS</h3>");
    expect(html).not.toContain(">Plain TLS copy</h3>");
    expect(areaGradeText(html, "TLS")).toBe("Compatible with warnings");
    expect(html).not.toContain("areas assessed");
    expect(html).not.toContain("pass rate");
  });

  test("warn and fail result cards show the primary resolved reason", () => {
    const html = render(
      <AreaGrid
        variant="results"
        areas={[
          {
            area: "jwks",
            grade: "warn",
            reasonCode: "jwks_unadvertised",
            pillLabel: "Needs attention",
          },
          {
            area: "httpsig",
            grade: "fail",
            reasonCode: "httpsig_probed",
            pillLabel: "Fail",
          },
          {
            area: "discovery",
            grade: "pass",
            reasonCode: "discovery_probed",
            pillLabel: "Pass",
          },
        ]}
      />,
    );
    const jwks = areaResultCardHtml(html, "jwks");
    expect(jwks).toContain("Signing keys not advertised");
    expect(jwks).toContain("did not publish a jwksUri");
    const httpsig = areaResultCardHtml(html, "httpsig");
    expect(httpsig).toContain("HTTP signature probe");
    expect(httpsig).toContain("two signed GET requests");
    const discovery = areaResultCardHtml(html, "discovery");
    expect(discovery).not.toContain("Discovery endpoint checked");
    expect(html).not.toContain("text-lg font-semibold text-zinc-100");
    expect(html).not.toContain("pass rate");
    expect(html).not.toContain("areas assessed");
    expect(hasNonAscii(html)).toBe(false);
  });

  test("primary reason outcome drives remedy visibility over the aggregate grade", () => {
    const remedy =
      "Publish a 200 JSON document at /.well-known/ocm with enabled true and the required apiVersion, endPoint, and resourceTypes.";
    const primaryPass = render(
      <AreaGrid
        variant="results"
        areas={[
          {
            area: "discovery",
            grade: "warn",
            reasonCode: "discovery_probed",
            primaryGrade: "pass",
            primaryAffectsGrade: false,
            pillLabel: "Needs attention",
          },
        ]}
      />,
    );
    const primaryCard = areaResultCardHtml(primaryPass, "discovery");
    expect(primaryCard).toContain("Discovery endpoint checked");
    expect(primaryCard).not.toContain(remedy);

    const fallback = render(
      <AreaGrid
        variant="results"
        areas={[
          {
            area: "discovery",
            grade: "warn",
            reasonCode: "discovery_probed",
            pillLabel: "Needs attention",
          },
        ]}
      />,
    );
    const fallbackCard = areaResultCardHtml(fallback, "discovery");
    expect(fallbackCard).toContain("Discovery endpoint checked");
    expect(fallbackCard).toContain(remedy);
    expect(hasNonAscii(primaryPass)).toBe(false);
    expect(hasNonAscii(fallback)).toBe(false);
  });

  test("warn card without a reason code still keeps stable h3 selectors", () => {
    const html = render(
      <AreaGrid
        variant="results"
        areas={[{ area: "tls", grade: "warn", pillLabel: "Needs attention" }]}
      />,
    );
    const card = areaResultCardHtml(html, "tls");
    expect(card).toContain(">Secure connection</h3>");
    expect(areaGradeText(html, "Secure connection")).toBe("Needs attention");
    expect(html).not.toContain("pass rate");
    expect(html).not.toContain("text-lg font-semibold text-zinc-100");
  });

  test("warn card without a reason code shows the honest missing-reason caption", () => {
    const html = render(
      <AreaGrid
        variant="results"
        areas={[{ area: "tls", grade: "warn", pillLabel: "Needs attention" }]}
      />,
    );
    const card = areaResultCardHtml(html, "tls");
    expect(card).toContain(">Secure connection</h3>");
    expect(areaGradeText(html, "Secure connection")).toBe("Needs attention");
    expect(card).toContain("Reason not provided in this report.");
    expect(card).toContain('data-area-reason="tls"');
    expect(card).not.toContain("Check note");
    expect(card).not.toContain("This evidence item has no reason code");
  });

  test("whitespace-only reason code shows the honest missing-reason caption", () => {
    const html = render(
      <AreaGrid
        variant="results"
        areas={[{ area: "tls", grade: "fail", reasonCode: "  ", pillLabel: "Fail" }]}
      />,
    );
    const card = areaResultCardHtml(html, "tls");
    expect(card).toContain(">Secure connection</h3>");
    expect(areaGradeText(html, "Secure connection")).toBe("Fail");
    expect(card).toContain("Reason not provided in this report.");
    expect(card).toContain('data-area-reason="tls"');
    expect(card).not.toContain("Check note");
    expect(card).not.toContain("This evidence item has no reason code");
  });

  test("mapped reason copy renders when a warn card has a reason code", () => {
    const html = render(
      <AreaGrid
        variant="results"
        areas={[
          { area: "jwks", grade: "warn", reasonCode: "jwks_unadvertised", pillLabel: "Needs attention" },
        ]}
      />,
    );
    const card = areaResultCardHtml(html, "jwks");
    expect(card).toContain("Signing keys not advertised");
    expect(card).toContain('data-area-reason="jwks"');
    expect(card).not.toContain("Reason not provided in this report.");
  });

  test("pass result card renders no reason block", () => {
    const html = render(
      <AreaGrid
        variant="results"
        areas={[
          { area: "discovery", grade: "pass", reasonCode: "discovery_probed", pillLabel: "Pass" },
        ]}
      />,
    );
    const card = areaResultCardHtml(html, "discovery");
    expect(card).not.toContain('data-area-reason="discovery"');
    expect(card).not.toContain("Reason not provided in this report.");
    expect(card).not.toContain("Discovery endpoint checked");
  });

  test("null grade can render Not tested", () => {
    const html = render(
      <AreaGrid
        variant="results"
        areas={[{ area: "jwks", grade: null, pillLabel: AREA_RESULT_PILL.notTested }]}
      />,
    );
    expect(html).toContain('data-area-card="jwks"');
    expect(areaGradeText(html, "Signing keys")).toBe("Not tested");
    expect(html).not.toContain("areas assessed");
  });

  test("missing row can render Not reported through the adapter", () => {
    const parsed = parseSpecificationScore({
      grade: "pass",
      state: "terminal_pass",
      terminal: true,
      assessedAreas: 1,
      totalAreas: 8,
      areas: [{ area: "discovery", grade: "pass", evidenceCount: 0 }],
    });
    const html = render(
      <AreaGrid variant="results" areas={areaGridEntriesFromScore(parsed)} />,
    );
    expect(areaGradeText(html, "Server discovery")).toBe("pass");
    expect(areaGradeText(html, "Secure connection")).toBe(AREA_RESULT_PILL.notReported);
    expect(areaGradeText(html, "Capabilities")).toBe(AREA_RESULT_PILL.notReported);
    for (const areaId of CANONICAL_AREA_IDS) {
      expect(html).toContain(`data-area-card="${areaId}"`);
    }
    for (const title of [
      "Server discovery",
      "Secure connection",
      "Signing keys",
      "Request signing",
      "Share exchange",
      "Notifications",
      "Access tokens",
      "Capabilities",
    ]) {
      expect(html).toContain(`>${title}</h3>`);
    }
    expect(html).not.toContain("areas assessed");
    expect(html).not.toContain("pass rate");
    expect(VALIDATOR_AREA_IDS).toEqual(CANONICAL_AREA_IDS);
  });

  test("statistics path still renders percent pill and sample caption", () => {
    const html = render(
      <AreaGrid
        areas={[
          { area: "tls", pass: 3, warn: 1, fail: 0 },
          { area: "jwks", passRate: 0.5 },
        ]}
      />,
    );
    expect(areaRateText(html, "Secure connection")).toBe("75%");
    expect(areaRateText(html, "Signing keys")).toBe("50%");
    expect(areaGradeText(html, "Secure connection")).toBe("warn");
    expect(areaGradeText(html, "Signing keys")).toBe("unassessed");
    expect(html).toContain("pass rate");
    expect(html).not.toContain("Plain discovery copy");
    expect(html).not.toContain("Not tested");
    expect(html).not.toContain("Not reported");
    expect(html).toContain(`2/${VALIDATOR_AREA_IDS.length} areas assessed`);
  });

  test("all eight canonical areas remain after result overlays", () => {
    const html = render(
      <AreaGrid
        variant="results"
        areas={[
          {
            area: "discovery",
            grade: null,
            description: "Plain discovery copy",
            pillLabel: AREA_RESULT_PILL.notTested,
          },
        ]}
      />,
    );
    expect(countAttr(html, "data-area-card=")).toBe(8);
    expect(html).toContain("Server discovery");
    expect(html).toContain("Secure connection");
    expect(html).toContain("Signing keys");
    expect(html).toContain("Request signing");
    expect(html).toContain("Share exchange");
    expect(html).toContain("Notifications");
    expect(html).toContain("Access tokens");
    expect(html).toContain("Capabilities");
    expect(html).not.toContain("areas assessed");
    expect(html).not.toContain("pass rate");
    expect(html).not.toContain("text-lg font-semibold text-zinc-100");
    expect(html).not.toContain("This area checks");
  });

  test("results interactive trigger appears only when openable", () => {
    const html = render(
      <AreaGrid
        variant="results"
        onAreaClick={() => undefined}
        areas={[
          { area: "discovery", grade: "pass", evidenceCount: 2 },
          { area: "tls", grade: null, evidenceCount: 0 },
        ]}
      />,
    );
    const discovery = areaResultCardHtml(html, "discovery");
    const tls = areaResultCardHtml(html, "tls");
    expect(discovery).toContain(">Server discovery</h3>");
    expect(discovery).toContain("View details");
    expect(discovery).toContain('id="area-card-discovery-action"');
    expect(discovery).toContain('aria-haspopup="dialog"');
    expect(discovery).toContain('id="area-card-discovery-title"');
    expect(tls).toContain(">Secure connection</h3>");
    expect(tls).not.toContain("View details");
    expect(tls).not.toContain("area-card-tls-action");
    expect(countAttr(html, ">View details</")).toBe(1);
    expect(actionButtonIds(html)).toEqual(["area-card-discovery-action"]);
    expect(actionButtonLabelledby(html, "discovery")).toBe(
      "area-card-discovery-title area-card-discovery-action",
    );
    expect(html).not.toContain("This area checks");
    expect(html).not.toContain("areas assessed");
    expect(html).not.toContain("pass rate");
    expect(html).not.toContain("text-lg font-semibold text-zinc-100");
  });

  test("loaded-evidence-only card stays interactive without a grade or reported evidence", () => {
    // foldGrade(entry) is null here: no explicit grade and no pass/warn/fail
    // counts. evidenceCount is undefined (countOf -> 0), so the only clause that
    // can make the card interactive is loadedEvidenceCount > 0. This proves the
    // loadedEvidence clause: if it were removed from the interactive predicate,
    // the trigger button would not render and this assertion would fail.
    const html = render(
      <AreaGrid
        variant="results"
        onAreaClick={() => undefined}
        areas={[{ area: "discovery", loadedEvidenceCount: 2 }]}
      />,
    );
    const card = areaResultCardHtml(html, "discovery");
    expect(card).toContain('id="area-card-discovery-action"');
    expect(actionButtonIds(html)).toEqual(["area-card-discovery-action"]);
  });

  test("card with no grade and no reported or loaded evidence renders no trigger", () => {
    const html = render(
      <AreaGrid
        variant="results"
        onAreaClick={() => undefined}
        areas={[{ area: "discovery" }]}
      />,
    );
    const card = areaResultCardHtml(html, "discovery");
    expect(card).not.toContain("area-card-discovery-action");
    expect(actionButtonIds(html)).toEqual([]);
  });

  test("warn and fail result triggers read Why and evidence, pass reads View details", () => {
    const html = render(
      <AreaGrid
        variant="results"
        onAreaClick={() => undefined}
        areas={[
          { area: "discovery", grade: "pass", evidenceCount: 1 },
          { area: "tls", grade: "warn", evidenceCount: 1 },
          { area: "jwks", grade: "fail", evidenceCount: 1 },
        ]}
      />,
    );
    const discovery = areaResultCardHtml(html, "discovery");
    const tls = areaResultCardHtml(html, "tls");
    const jwks = areaResultCardHtml(html, "jwks");
    expect(discovery).toContain(">View details</button>");
    expect(tls).toContain(">Why and evidence</button>");
    expect(jwks).toContain(">Why and evidence</button>");
  });

  test("card trigger reflects openArea through aria-expanded", () => {
    const html = render(
      <AreaGrid
        variant="results"
        onAreaClick={() => undefined}
        openArea="tls"
        areas={[
          { area: "discovery", grade: "pass", evidenceCount: 1 },
          { area: "tls", grade: "warn", evidenceCount: 1 },
        ]}
      />,
    );
    const discovery = areaResultCardHtml(html, "discovery");
    const tls = areaResultCardHtml(html, "tls");
    expect(discovery).toContain('aria-expanded="false"');
    expect(tls).toContain('aria-expanded="true"');
  });

  test("results triggers have unique ids and resolve accessible names via labelledby", () => {
    const html = render(
      <AreaGrid
        variant="results"
        onAreaClick={() => undefined}
        areas={VALIDATOR_AREA_IDS.map((area) => ({
          area,
          grade: "pass" as const,
          evidenceCount: 1,
        }))}
      />,
    );
    const ids = actionButtonIds(html);
    expect(ids).toEqual(VALIDATOR_AREA_IDS.map((area) => `area-card-${area}-action`));
    expect(new Set(ids).size).toBe(8);
    for (const area of VALIDATOR_AREA_IDS) {
      expect(actionButtonLabelledby(html, area)).toBe(
        `area-card-${area}-title area-card-${area}-action`,
      );
      expect(html).toContain(`id="area-card-${area}-title"`);
    }
    expect(countAttr(html, ">View details</")).toBe(8);
    expect(html).not.toContain("This area checks");
    expect(html).not.toContain("<h3 class=\"text-sm font-semibold text-zinc-100\"><button");
  });

  test("results View details click reports the area ID", async () => {
    const seen: ValidatorAreaId[] = [];
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(
          <AreaGrid
            variant="results"
            onAreaClick={(areaId) => { seen.push(areaId); }}
            areas={[{ area: "discovery", grade: "pass", evidenceCount: 2 }]}
          />,
        );
      });
      const card = findNode(container, (node) => node.getAttribute("data-area-card") === "discovery");
      expect(card).not.toBeNull();
      if (card === null) throw new Error("missing data-area-card: discovery");
      const button = findNode(card, (node) => {
        return node.tagName === "BUTTON" &&
          node.getAttribute("id") === "area-card-discovery-action";
      });
      expect(button).not.toBeNull();
      if (button === null) throw new Error("missing discovery View details button");
      await act(() => { button.dispatchEvent(new ShimEvent("click")); });
      expect(seen).toEqual(["discovery"]);
      await act(() => { root.unmount(); });
    } finally {
      restore();
    }
  });

  test("results trigger opens for an unassessed card with evidence", async () => {
    const seen: ValidatorAreaId[] = [];
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(
          <AreaGrid
            variant="results"
            onAreaClick={(areaId) => { seen.push(areaId); }}
            areas={[{ area: "discovery", grade: null, evidenceCount: 1 }]}
          />,
        );
      });
      const card = findNode(container, (node) => node.getAttribute("data-area-card") === "discovery");
      expect(card).not.toBeNull();
      if (card === null) throw new Error("missing data-area-card: discovery");
      const button = findNode(card, (node) => {
        return node.tagName === "BUTTON" &&
          node.getAttribute("id") === "area-card-discovery-action";
      });
      expect(button).not.toBeNull();
      if (button === null) throw new Error("missing discovery View details button");
      await act(() => { button.dispatchEvent(new ShimEvent("click")); });
      expect(seen).toEqual(["discovery"]);
      await act(() => { root.unmount(); });
    } finally {
      restore();
    }
  });

  test("statistics cards stay noninteractive when onAreaClick is set", () => {
    const html = render(
      <AreaGrid
        areas={[{ area: "discovery", grade: "pass", evidenceCount: 3 }]}
        onAreaClick={() => undefined}
      />,
    );
    expect(html).not.toContain("View details");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("data-area-card");
    expect(html).toContain(`1/${VALIDATOR_AREA_IDS.length} areas assessed`);
  });
});
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
describe("DomainField", () => {
  test("renders a labeled read-only domain value", () => {
    const html = render(<DomainField value="peer.example:8443" />);
    expect(html).toContain("Server address");
    expect(html).toContain("peer.example:8443");
    expect(html).toContain("readOnly");
  });

  test("renders an editable field with an error", () => {
    const html = render(
      <DomainField label="Target host" value="bad host" error="Enter a host" onChange={() => undefined} />,
    );
    expect(html).toContain("Target host");
    expect(html).toContain("Enter a host");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("readOnly");
  });

  test("composes aria-describedby from helper, preview, and error", () => {
    const html = render(
      <DomainField
        value="bad host"
        helperText="Use a domain, IP address, or http/https URL."
        helperId="validator-domain-help"
        previewId="validator-host-preview"
        error="Enter a server address."
        onChange={() => undefined}
      />,
    );
    expect(html).toContain(
      'aria-describedby="validator-domain-help validator-host-preview validator-domain-error"',
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="validator-domain-help"');
    expect(html).toContain("Use a domain, IP address, or http/https URL.");
    expect(html).toContain('id="validator-domain-error"');
    expect(html).toContain('autoComplete="off"');
    expect(html).not.toContain('autoComplete="email"');
    expect(html).not.toContain('autoComplete="url"');
    expect(html).not.toContain('autoComplete="username"');
    expect(html).not.toContain('autoComplete="current-password"');
  });
});
