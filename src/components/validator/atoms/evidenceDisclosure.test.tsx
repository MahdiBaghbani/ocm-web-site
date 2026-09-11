import React, { act, useState } from "react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import EvidenceDisclosure from "./EvidenceDisclosure";

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
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

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const DOCUMENT_NODE = 9;
type ShimFn = (event: ShimEvent) => void;
type ShimRec = { fn: ShimFn; capture: boolean };
type ShimFnArg = ShimFn | Record<string, unknown>;
type ShimOpts = boolean | { capture?: boolean };
function captureOf(options?: ShimOpts): boolean {
  return typeof options === "boolean" ? options : options?.capture === true;
}

class ShimEvent {
  type: string; bubbles: boolean; target: ShimNode | null = null; currentTarget: ShimNode | null = null;
  cancelable = true; defaultPrevented = false; isTrusted = false; timeStamp = Date.now(); stopped = false;
  constructor(type: string, bubbles = true) { this.type = type; this.bubbles = bubbles; }
  preventDefault(): void { this.defaultPrevented = true; }
  stopPropagation(): void { this.stopped = true; }
  stopImmediatePropagation(): void { this.stopped = true; }
}

class ShimNode {
  nodeType: number; nodeName: string; tagName: string; ownerDocument!: ShimDocument;
  parentNode: ShimNode | null = null; childNodes: ShimNode[] = []; nodeValue = "";
  style: Record<string, string> = {}; attrs = new Map<string, string>(); listeners = new Map<string, ShimRec[]>();
  constructor(doc: ShimDocument | null, nodeType: number, name: string) {
    this.nodeType = nodeType; this.nodeName = name; this.tagName = name;
    if (doc !== null) this.ownerDocument = doc;
  }
  get firstChild(): ShimNode | null { return this.childNodes[0] ?? null; }
  get lastChild(): ShimNode | null { return this.childNodes.at(-1) ?? null; }
  get nextSibling(): ShimNode | null {
    const parent = this.parentNode;
    return parent === null ? null : (parent.childNodes[parent.childNodes.indexOf(this) + 1] ?? null);
  }
  get textContent(): string {
    return this.nodeType === TEXT_NODE ? this.nodeValue : this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(value: string) {
    this.childNodes = [];
    if (value === "") return;
    const text = new ShimNode(this.ownerDocument, TEXT_NODE, "#text");
    text.nodeValue = value; text.parentNode = this; this.childNodes.push(text);
  }
  contains(other: ShimNode): boolean {
    for (let node: ShimNode | null = other; node !== null; node = node.parentNode) {
      if (node === this) return true;
    }
    return false;
  }
  appendChild(node: ShimNode): ShimNode {
    node.parentNode?.removeChild(node);
    node.parentNode = this; this.childNodes.push(node); return node;
  }
  removeChild(node: ShimNode): ShimNode {
    const index = this.childNodes.indexOf(node);
    if (index !== -1) { this.childNodes.splice(index, 1); node.parentNode = null; }
    return node;
  }
  insertBefore(node: ShimNode, before: ShimNode | null): ShimNode {
    if (before === null) return this.appendChild(node);
    node.parentNode?.removeChild(node);
    const index = this.childNodes.indexOf(before);
    node.parentNode = this;
    this.childNodes.splice(index === -1 ? this.childNodes.length : index, 0, node);
    return node;
  }
  setAttribute(name: string, value: string): void { this.attrs.set(name, String(value)); }
  setAttributeNS(_ns: string, name: string, value: string): void { this.setAttribute(name, value); }
  getAttribute(name: string): string | null {
    return this.attrs.has(name) ? (this.attrs.get(name) ?? "") : null;
  }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  addEventListener(type: string, listener: ShimFnArg, options?: ShimOpts): void {
    if (typeof listener !== "function") return;
    const list = this.listeners.get(type) ?? [];
    list.push({ fn: listener, capture: captureOf(options) }); this.listeners.set(type, list);
  }
  removeEventListener(type: string, listener: ShimFnArg, options?: ShimOpts): void {
    if (typeof listener !== "function") return;
    const capture = captureOf(options);
    const list = this.listeners.get(type);
    if (list === undefined) return;
    this.listeners.set(type, list.filter((entry) => entry.fn !== listener || entry.capture !== capture));
  }
  dispatchEvent(event: ShimEvent): boolean {
    event.target = this;
    const path: ShimNode[] = [];
    for (let node: ShimNode | null = this; node !== null; node = node.parentNode) path.push(node);
    for (let i = path.length - 1; i >= 0 && !event.stopped; i -= 1) path[i]?.emit(event, true);
    for (const node of path) { if (event.stopped) break; node.emit(event, false); }
    return !event.defaultPrevented;
  }
  emit(event: ShimEvent, capture: boolean): void {
    event.currentTarget = this;
    for (const rec of this.listeners.get(event.type) ?? []) { if (rec.capture === capture) rec.fn(event); }
  }
}

class ShimDocument extends ShimNode {
  defaultView: ShimWindow | null = null;
  documentElement: ShimNode; head: ShimNode; body: ShimNode; activeElement: ShimNode | null;
  constructor() {
    super(null, DOCUMENT_NODE, "#document");
    this.ownerDocument = this;
    this.documentElement = new ShimNode(this, ELEMENT_NODE, "HTML");
    this.head = new ShimNode(this, ELEMENT_NODE, "HEAD");
    this.body = new ShimNode(this, ELEMENT_NODE, "BODY");
    this.activeElement = this.body;
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }
  createElement(name: string): ShimNode { return new ShimNode(this, ELEMENT_NODE, name.toUpperCase()); }
  createElementNS(_ns: string, name: string): ShimNode { return this.createElement(name); }
  createTextNode(value: string): ShimNode {
    const text = new ShimNode(this, TEXT_NODE, "#text");
    text.nodeValue = value;
    return text;
  }
}

class HTMLIFrameElement {}

class ShimWindow {
  document: ShimDocument; event: undefined = undefined; navigator = { userAgent: "shim" };
  location = { protocol: "https:", href: "https://localhost/" };
  top: ShimWindow; self: ShimWindow; HTMLIFrameElement = HTMLIFrameElement; host: ShimNode;
  constructor(doc: ShimDocument) {
    this.document = doc; this.top = this; this.self = this;
    this.host = new ShimNode(doc, ELEMENT_NODE, "WINDOW");
  }
  addEventListener(type: string, listener: ShimFnArg, options?: ShimOpts): void {
    this.host.addEventListener(type, listener, options);
  }
  removeEventListener(type: string, listener: ShimFnArg, options?: ShimOpts): void {
    this.host.removeEventListener(type, listener, options);
  }
}

type ShimGlobalSlots = {
  window?: ShimWindow;
  document?: ShimDocument;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function shimGlobalSlots(): ShimGlobalSlots {
  return globalThis as unknown as ShimGlobalSlots;
}

function reactDomContainerOf(node: ShimNode): Element {
  return node as unknown as Element;
}

function installDomShim(): { document: ShimDocument; restore: () => void } {
  const globals = shimGlobalSlots();
  const owned = {
    window: Object.prototype.hasOwnProperty.call(globals, "window"),
    document: Object.prototype.hasOwnProperty.call(globals, "document"),
    act: Object.prototype.hasOwnProperty.call(globals, "IS_REACT_ACT_ENVIRONMENT"),
  };
  const prev = { window: globals.window, document: globals.document, act: globals.IS_REACT_ACT_ENVIRONMENT };
  const doc = new ShimDocument();
  const win = new ShimWindow(doc);
  doc.defaultView = win; globals.window = win; globals.document = doc; globals.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    document: doc,
    restore: () => {
      if (owned.window) globals.window = prev.window; else delete globals.window;
      if (owned.document) globals.document = prev.document; else delete globals.document;
      if (owned.act) globals.IS_REACT_ACT_ENVIRONMENT = prev.act; else delete globals.IS_REACT_ACT_ENVIRONMENT;
    },
  };
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
