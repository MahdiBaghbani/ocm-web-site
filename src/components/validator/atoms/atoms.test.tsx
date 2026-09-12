import React, { act } from "react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AREA_RESULT_PILL,
  CANONICAL_AREA_IDS,
  areaGridEntriesFromScore,
  parseSpecificationScore,
} from "../lib/validatorScore";
import AreaGrid, { VALIDATOR_AREA_IDS, type ValidatorAreaId } from "./AreaGrid";
import DomainField from "./DomainField";
import Pill, { PILL_KINDS } from "./Pill";
import RawJsonPanel from "./RawJsonPanel";
import StepRow from "./StepRow";
import VerdictBanner, { verdictKindFromScore } from "./VerdictBanner";

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

function countAttr(html: string, attr: string): number {
  return html.split(attr).length - 1;
}

const FILE_VIEWER_CHIP = 'data-testid="file-viewer-chip"';
const FILE_VIEWER_CHIP_SURFACE = "rounded-xl border border-zinc-800 bg-zinc-900/30";

function countChipsInFileViewerPanel(html: string): number {
  const panelCount = countAttr(html, FILE_VIEWER_CHIP);
  return panelCount !== 1 ? panelCount : countAttr(html, FILE_VIEWER_CHIP_SURFACE);
}

function pillLabels(html: string): string[] {
  const pillLabelRe =
    /data-pill-kind="[^"]*"[^>]*><span[^>]*aria-hidden="true"><\/span>([^<]*)<\/span>/g;
  return [...html.matchAll(pillLabelRe)].map((match) => match[1]);
}

function firstPillLabel(html: string): string | null {
  const labels = pillLabels(html);
  return labels.length === 0 ? null : labels[0];
}

function areaCardHtml(html: string, title: string): string {
  const heading = `>${title}</h3>`;
  const start = html.indexOf(heading);
  if (start === -1) throw new Error(`missing area heading: ${title}`);
  const rest = html.slice(start + heading.length);
  const next = rest.indexOf('<h3 class="text-sm font-semibold text-zinc-100">');
  return next === -1 ? rest : rest.slice(0, next);
}

function areaGradeText(html: string, title: string): string {
  const card = areaCardHtml(html, title);
  const label = firstPillLabel(card);
  if (label === null) throw new Error(`missing grade pill for ${title}`);
  return label;
}

function areaRateText(html: string, title: string): string {
  const card = areaCardHtml(html, title);
  const match = /<div class="text-lg font-semibold text-zinc-100">([^<]*)<\/div>/.exec(
    card,
  );
  if (match === null) throw new Error(`missing rate for ${title}`);
  return match[1];
}

function areaResultCardHtml(html: string, areaId: string): string {
  const attr = `data-area-card="${areaId}"`;
  const attrAt = html.indexOf(attr);
  if (attrAt === -1) throw new Error(`missing data-area-card: ${areaId}`);
  const start = html.lastIndexOf("<article", attrAt);
  if (start === -1) throw new Error(`missing article for ${areaId}`);
  const rest = html.slice(start);
  const close = rest.indexOf("</article>");
  return close === -1 ? rest : rest.slice(0, close + "</article>".length);
}

function stepIndexNumeral(html: string): string | null {
  const match =
    /<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-medium text-zinc-200">(\d+)<\/span>/.exec(
      html,
    );
  return match === null ? null : match[1];
}

function hasNonAscii(value: string): boolean {
  for (const char of value) {
    if (char.charCodeAt(0) > 127) {
      return true;
    }
  }
  return false;
}

function viewDetailsLabels(html: string): string[] {
  const labelRe = /aria-label="(View details for [^"]+)"/g;
  return [...html.matchAll(labelRe)].map((match) => match[1]);
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

  test("renders inconclusive as neutral gray with an ASCII i glyph, not green", () => {
    const html = render(<VerdictBanner verdict="inconclusive" />);
    expect(html).toContain("No compatibility result");
    expect(html).toContain(">i<");
    expect(html).toContain("border-zinc-800");
    expect(html).toContain("bg-zinc-900/20");
    expect(html).not.toContain("emerald");
    expect(html).not.toContain("Pass");
    expect(firstPillLabel(html)).toBe("unassessed");
  });

  test("uses only ASCII glyphs and copy", () => {
    const kinds = ["pass", "fail", "warn", "running", "interrupted", "inconclusive"] as const;
    for (const kind of kinds) {
      const html = render(<VerdictBanner verdict={kind} />);
      expect(hasNonAscii(html)).toBe(false);
    }
    expect(verdictKindFromScore({ grade: "pass", state: "terminal_pass" })).toBe("pass");
  });

  test("shows heading once and pill as a status indicator", () => {
    const html = render(<VerdictBanner verdict="pass" title="Compatible" />);
    expect(countAttr(html, "Compatible")).toBe(1);
    expect(firstPillLabel(html)).toBe("pass");
  });

  test("running glyph stays ASCII ellipsis in a wider icon span", () => {
    const running = render(<VerdictBanner verdict="running" />);
    const pass = render(<VerdictBanner verdict="pass" />);
    expect(running).toContain("...");
    expect(running).toContain("w-6");
    expect(running).not.toContain("w-3");
    expect(pass).toContain(">v<");
    expect(pass).toContain("w-6");
  });
});
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
});
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

  test("warn card without a reason code suppresses the missing-slug fallback", () => {
    const html = render(
      <AreaGrid
        variant="results"
        areas={[{ area: "tls", grade: "warn", pillLabel: "Needs attention" }]}
      />,
    );
    const card = areaResultCardHtml(html, "tls");
    expect(card).toContain(">Secure connection</h3>");
    expect(areaGradeText(html, "Secure connection")).toBe("Needs attention");
    expect(card).not.toContain("Check note");
    expect(card).not.toContain("This evidence item has no reason code");
    expect(card).not.toContain('data-area-reason="tls"');
  });

  test("whitespace-only reason code suppresses the missing-slug fallback", () => {
    const html = render(
      <AreaGrid
        variant="results"
        areas={[{ area: "tls", grade: "fail", reasonCode: "  ", pillLabel: "Fail" }]}
      />,
    );
    const card = areaResultCardHtml(html, "tls");
    expect(card).toContain(">Secure connection</h3>");
    expect(areaGradeText(html, "Secure connection")).toBe("Fail");
    expect(card).not.toContain("Check note");
    expect(card).not.toContain("This evidence item has no reason code");
    expect(card).not.toContain('data-area-reason="tls"');
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

  test("results View details appears only when openable", () => {
    const html = render(
      <AreaGrid
        variant="results"
        onAreaClick={() => undefined}
        areas={[
          { area: "discovery", grade: "pass", evidenceCount: 2 },
          { area: "tls", grade: "fail", evidenceCount: 0 },
        ]}
      />,
    );
    const discovery = areaResultCardHtml(html, "discovery");
    const tls = areaResultCardHtml(html, "tls");
    expect(discovery).toContain(">Server discovery</h3>");
    expect(discovery).toContain("View details");
    expect(discovery).toContain('aria-label="View details for Server discovery"');
    expect(tls).toContain(">Secure connection</h3>");
    expect(tls).not.toContain("View details");
    expect(countAttr(html, ">View details</")).toBe(1);
    expect(viewDetailsLabels(html)).toEqual(["View details for Server discovery"]);
    expect(html).not.toContain("This area checks");
    expect(html).not.toContain("areas assessed");
    expect(html).not.toContain("pass rate");
    expect(html).not.toContain("text-lg font-semibold text-zinc-100");
  });

  test("results View details buttons have unique accessible names", () => {
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
    const labels = viewDetailsLabels(html);
    expect(labels).toEqual([
      "View details for Server discovery",
      "View details for Secure connection",
      "View details for Signing keys",
      "View details for Request signing",
      "View details for Share exchange",
      "View details for Notifications",
      "View details for Access tokens",
      "View details for Capabilities",
    ]);
    expect(new Set(labels).size).toBe(8);
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
          node.getAttribute("aria-label") === "View details for Server discovery";
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
