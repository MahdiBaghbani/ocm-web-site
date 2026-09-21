import React, { act, useState } from "react";
import { describe, expect, test } from "bun:test";
import { ChevronRight } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

import EvidenceDisclosure from "@/components/validator/atoms/EvidenceDisclosure";
import {
  installDomShim,
  reactDomContainerOf,
  ShimEvent,
  ShimNode,
} from "@/components/validator/tests/helpers/domShim";

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

function svgInnerMarkup(html: string): string {
  const match = /<svg[^>]*>([\s\S]*?)<\/svg>/.exec(html);
  if (match === null) {
    throw new Error("missing svg");
  }
  return match[1];
}

function disclosureChevronSlot(html: string): string {
  const match = /data-icon="disclosure-chevron"[^>]*>([\s\S]*?)<\/span>/.exec(html);
  if (match === null) {
    throw new Error("missing disclosure-chevron slot");
  }
  return match[1];
}

function pillLabels(html: string): string[] {
  const pillLabelRe =
    /<span class="h-2 w-2 shrink-0 rounded-full [^"]*" aria-hidden="true"><\/span>([^<]*)<\/span>/g;
  return [...html.matchAll(pillLabelRe)].map((match) => match[1]);
}

function firstPillLabel(html: string): string | null {
  const labels = pillLabels(html);
  return labels.length === 0 ? null : labels[0];
}

function findNode(node: ShimNode, match: (candidate: ShimNode) => boolean): ShimNode | null {
  if (match(node)) return node;
  for (const child of node.childNodes) {
    const found = findNode(child, match);
    if (found !== null) return found;
  }
  return null;
}

function ControlledEvidence(props: {
  onToggle: (open: boolean) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <EvidenceDisclosure
      title="TLS"
      items={[]}
      expanded={open}
      onToggle={(next) => {
        props.onToggle(next);
        setOpen(next);
      }}
    />
  );
}

describe("EvidenceDisclosure", () => {
  test("renders expanded evidence rows for an area", () => {
    const html = render(
      <EvidenceDisclosure
        title="Discovery"
        subtitle="passive"
        expanded={true}
        items={[
          {
            area: "discovery",
            leg: "passive",
            step: "probe",
            reasonCode: "well_known_ok",
            grade: "pass",
            affectsGrade: true,
            payloadRedacted: true,
            createdAt: "2026-09-02T00:00:00Z",
          },
        ]}
      />,
    );
    expect(html).toContain("Discovery");
    expect(html).toContain("well_known_ok");
    expect(html).toContain("passive");
    expect(html).toContain('aria-expanded="true"');
    const controls = /aria-controls="([^"]+)"/.exec(html);
    expect(controls).not.toBeNull();
    const bodyId = controls === null ? "" : controls[1];
    expect(bodyId).not.toBe("");
    expect(html).toContain(`id="${bodyId}"`);
    expect(html).not.toContain(`id="${bodyId}" hidden`);
    expect(firstPillLabel(html)).toBe("pass");
    expect(html).not.toContain(">grade<");
    expect(html).toContain('aria-hidden="true"');
  });

  test("resolves confirmed slug copy while retaining the raw reason row", () => {
    const html = render(
      <EvidenceDisclosure
        title="Discovery"
        expanded={true}
        items={[
          {
            reasonCode: "discovery_probed",
            grade: "fail",
            affectsGrade: true,
          },
        ]}
      />,
    );
    // Resolved narrative copy from the SF-2.1 map.
    expect(html).toContain("Discovery endpoint checked");
    expect(html).toContain('data-reason-source="map"');
    // Remedy shows for a fail outcome that affects the grade.
    expect(html).toContain("Publish a 200 JSON document");
    // Raw reason-code identity remains visible as a FieldRow.
    expect(html).toContain(">reason<");
    expect(html).toContain("discovery_probed");
  });

  test("renders map copy for all four confirmed slugs", () => {
    const cases: { slug: string; title: string }[] = [
      { slug: "jwks_unadvertised", title: "Signing keys not advertised" },
      { slug: "discovery_probed", title: "Discovery endpoint checked" },
      { slug: "tls_probed", title: "TLS handshake probed" },
      { slug: "httpsig_probed", title: "HTTP signature probe" },
    ];
    for (const item of cases) {
      const html = render(
        <EvidenceDisclosure
          title="Area"
          expanded={true}
          items={[{ reasonCode: item.slug, grade: "warn" }]}
        />,
      );
      expect(html).toContain(item.title);
      expect(html).toContain('data-reason-source="map"');
      expect(html).toContain(item.slug);
    }
  });

  test("renders the resolved why narrative for confirmed slugs", () => {
    // Locks the rendered narrative body, not just titles/source hooks, using
    // exact copy from the SF-2.1 resolver map. Covers the grade-specific
    // jwks_unadvertised slug and a grade-agnostic _probed slug.
    const cases: { slug: string; why: string }[] = [
      {
        slug: "jwks_unadvertised",
        why: "The discovery document did not publish a jwksUri and did not advertise the http-sig capability, so signing keys are optional and the validator did not fetch a key set.",
      },
      {
        slug: "discovery_probed",
        why: "The validator sent an uncached GET to /.well-known/ocm and assessed the returned JSON discovery document. The pass, warn, or fail verdict is shown separately.",
      },
    ];
    for (const item of cases) {
      const html = render(
        <EvidenceDisclosure
          title="Area"
          expanded={true}
          items={[{ reasonCode: item.slug, grade: "warn" }]}
        />,
      );
      expect(html).toContain(item.why);
      expect(html).toContain('data-reason-source="map"');
      expect(html).toContain(item.slug);
    }
  });

  test("shows the fixed warn remedy for jwks_unadvertised", () => {
    const html = render(
      <EvidenceDisclosure
        title="Signing"
        expanded={true}
        items={[{ reasonCode: "jwks_unadvertised", grade: "pass" }]}
      />,
    );
    expect(html).toContain("Signing keys not advertised");
    // jwks_unadvertised is grade-specific warn, so its remedy renders even
    // when the caller passes a pass grade.
    expect(html).toContain("publish an https jwksUri");
    // The Pill reflects the resolved warn outcome, not the caller pass grade.
    expect(firstPillLabel(html)).toBe("warn");
  });

  test("titleizes jwks_probed via the acronym-aware fallback", () => {
    const html = render(
      <EvidenceDisclosure
        title="Signing"
        expanded={true}
        items={[{ reasonCode: "jwks_probed", grade: "pass" }]}
      />,
    );
    expect(html).toContain("JWKS Probed");
    expect(html).toContain('data-reason-source="titleize"');
    expect(html).toContain("jwks_probed");
  });

  test("uses the unknown fallback for well_known_ok", () => {
    const html = render(
      <EvidenceDisclosure
        title="Discovery"
        expanded={true}
        items={[{ reasonCode: "well_known_ok", grade: "pass" }]}
      />,
    );
    // well_known_ok is deliberately absent from the map, so it falls through
    // to the conservative titleized fallback, never a mapping.
    expect(html).toContain("Well Known Ok");
    expect(html).toContain('data-reason-source="titleize"');
    expect(html).not.toContain('data-reason-source="map"');
    expect(html).toContain("well_known_ok");
  });

  test("emits the redaction note for a true payloadRedacted and keeps raw reason", () => {
    const html = render(
      <EvidenceDisclosure
        title="Discovery"
        expanded={true}
        items={[
          {
            reasonCode: "discovery_probed",
            grade: "pass",
            affectsGrade: true,
            payloadRedacted: true,
          },
        ]}
      />,
    );
    // The boolean redacted row is gone, replaced by a human-readable note.
    expect(html).not.toContain(">redacted<");
    expect(html).toContain("Supporting details were redacted from this report.");
    // affectsGrade is not the redacted row and stays a FieldRow.
    expect(html).toContain(">affects grade<");
    // Raw reason-code identity is still retained.
    expect(html).toContain(">reason<");
    expect(html).toContain("discovery_probed");
  });

  test("omits the redaction note when payloadRedacted is false", () => {
    const html = render(
      <EvidenceDisclosure
        title="Discovery"
        expanded={true}
        items={[
          {
            reasonCode: "discovery_probed",
            grade: "pass",
            affectsGrade: true,
            payloadRedacted: false,
          },
        ]}
      />,
    );
    // No boolean redacted row and no note when false.
    expect(html).not.toContain(">redacted<");
    expect(html).not.toContain("Supporting details were redacted from this report.");
    // affectsGrade remains a FieldRow and the raw reason is retained.
    expect(html).toContain(">affects grade<");
    expect(html).toContain(">reason<");
    expect(html).toContain("discovery_probed");
  });

  test("uncontrolled disclosure toggles body open state on click", async () => {
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => { root.render(<EvidenceDisclosure title="TLS" items={[]} />); });
      const button = findNode(container, (node) => node.tagName === "BUTTON");
      expect(button).not.toBeNull();
      if (button === null) throw new Error("missing toggle button");
      const bodyId = button.getAttribute("aria-controls");
      expect(bodyId).not.toBeNull();
      if (bodyId === null) throw new Error("missing aria-controls");
      const body = findNode(container, (node) => node.getAttribute("id") === bodyId);
      expect(body).not.toBeNull();
      if (body === null) throw new Error("missing disclosure body");
      expect(button.getAttribute("aria-expanded")).toBe("true");
      expect(body.getAttribute("hidden")).toBeNull();
      expect(body.textContent).toContain("No evidence.");
      await act(() => { button.dispatchEvent(new ShimEvent("click")); });
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(body.getAttribute("hidden")).toBe("");
      await act(() => { button.dispatchEvent(new ShimEvent("click")); });
      expect(button.getAttribute("aria-expanded")).toBe("true");
      expect(body.getAttribute("hidden")).toBeNull();
      expect(body.textContent).toContain("No evidence.");
      await act(() => { root.unmount(); });
    } finally {
      restore();
    }
  });

  test("controlled disclosure reports open then closed to onToggle", async () => {
    const { document: doc, restore } = installDomShim();
    const seen: boolean[] = [];
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ControlledEvidence onToggle={(open) => { seen.push(open); }} />);
      });
      const button = findNode(container, (node) => node.tagName === "BUTTON");
      expect(button).not.toBeNull();
      if (button === null) throw new Error("missing toggle button");
      expect(button.getAttribute("aria-expanded")).toBe("false");
      await act(() => { button.dispatchEvent(new ShimEvent("click")); });
      expect(button.getAttribute("aria-expanded")).toBe("true");
      await act(() => { button.dispatchEvent(new ShimEvent("click")); });
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(seen).toEqual([true, false]);
      await act(() => { root.unmount(); });
    } finally {
      restore();
    }
  });

  test("renders empty-state message when expanded with zero items", () => {
    const html = render(<EvidenceDisclosure title="TLS" items={[]} expanded={true} />);
    expect(html).toContain("TLS");
    expect(html).toContain("0 items");
    expect(html).toContain("No evidence.");
    expect(html).toContain('aria-expanded="true"');
  });

  test("keeps a hidden body when collapsed", () => {
    const html = render(<EvidenceDisclosure title="TLS" items={[]} expanded={false} />);
    expect(html).toContain("TLS");
    expect(html).toContain("0 items");
    expect(html).toContain('aria-expanded="false"');
    const controls = /aria-controls="([^"]+)"/.exec(html);
    expect(controls).not.toBeNull();
    const bodyId = controls === null ? "" : controls[1];
    expect(bodyId).not.toBe("");
    expect(html).toContain(`id="${bodyId}" hidden`);
  });

  test("renders a ChevronRight icon that rotates when open", () => {
    const refInner = svgInnerMarkup(render(<ChevronRight size={16} />));
    const openHtml = render(
      <EvidenceDisclosure title="TLS" items={[]} expanded={true} />,
    );
    const closedHtml = render(
      <EvidenceDisclosure title="TLS" items={[]} expanded={false} />,
    );
    expect(openHtml).toContain('data-icon="disclosure-chevron"');
    expect(closedHtml).toContain('data-icon="disclosure-chevron"');
    expect(openHtml).toContain("<svg");
    expect(closedHtml).toContain("<svg");
    expect(svgInnerMarkup(openHtml)).toBe(refInner);
    expect(svgInnerMarkup(closedHtml)).toBe(refInner);
    expect(openHtml).toContain("rotate-90");
    expect(closedHtml).not.toContain("rotate-90");
    const openSlot = disclosureChevronSlot(openHtml);
    const closedSlot = disclosureChevronSlot(closedHtml);
    expect(openSlot).toContain("<svg");
    expect(closedSlot).toContain("<svg");
    expect(openSlot).toContain(refInner);
    expect(closedSlot).toContain(refInner);
    expect(openHtml).not.toContain(">v<");
    expect(closedHtml).not.toContain(">v<");
    expect(openSlot).not.toBe("v");
    expect(closedSlot).not.toBe(">");
    expect(closedSlot).not.toBe("&gt;");
    expect(openHtml).not.toContain("font-mono");
    expect(closedHtml).not.toContain("font-mono");
  });

  test("assigns unique body ids to sibling disclosures", () => {
    const html = render(
      <>
        <EvidenceDisclosure title="TLS" items={[]} expanded={false} />
        <EvidenceDisclosure title="TLS" items={[]} expanded={false} />
      </>,
    );
    const ids = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(html).toContain(`id="${ids[0]}"`);
    expect(html).toContain(`id="${ids[1]}"`);
  });
});
