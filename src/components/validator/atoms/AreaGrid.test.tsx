import React from "react";
import { describe, expect, test } from "bun:test";

import {
  AREA_RESULT_PILL,
  CANONICAL_AREA_IDS,
  areaGridEntriesFromScore,
  parseSpecificationScore,
} from "../lib/validatorScore";
import AreaGrid, { VALIDATOR_AREA_IDS } from "./AreaGrid";
import {
  areaGradeText,
  areaRateText,
  areaResultCardHtml,
  countAttr,
  hasNonAscii,
  pillLabels,
  render,
} from "./test-helpers";

describe("AreaGrid rendering", () => {
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
});
