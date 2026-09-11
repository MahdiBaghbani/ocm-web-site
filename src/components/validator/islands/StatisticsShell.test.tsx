import React, { act } from "react";
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
    expect(html).not.toContain("Why are these zero?");
    expect(html).not.toContain("enough unique hosts");
    expect(html).not.toContain("No platform counts.");
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
  type: string;
  bubbles: boolean;
  target: ShimNode | null = null;
  currentTarget: ShimNode | null = null;
  cancelable = true;
  defaultPrevented = false;
  isTrusted = false;
  timeStamp = Date.now();
  stopped = false;
  constructor(type: string, bubbles = true) {
    this.type = type;
    this.bubbles = bubbles;
  }
  preventDefault(): void {
    this.defaultPrevented = true;
  }
  stopPropagation(): void {
    this.stopped = true;
  }
  stopImmediatePropagation(): void {
    this.stopped = true;
  }
}

class ShimNode {
  nodeType: number;
  nodeName: string;
  tagName: string;
  ownerDocument!: ShimDocument;
  parentNode: ShimNode | null = null;
  childNodes: ShimNode[] = [];
  nodeValue = "";
  style: Record<string, string> = {};
  attrs = new Map<string, string>();
  listeners = new Map<string, ShimRec[]>();
  disabled = false;
  multiple = false;
  selected = false;
  defaultSelected = false;
  type = "";
  name = "";
  declare value: string;
  declare checked: boolean;
  get options(): ShimNode[] {
    return this.childNodes.filter((child) => child.tagName === "OPTION");
  }
  constructor(doc: ShimDocument | null, nodeType: number, name: string) {
    this.nodeType = nodeType;
    this.nodeName = name;
    this.tagName = name;
    if (name === "INPUT") this.type = "text";
    if (name === "BUTTON") this.type = "submit";
    if (doc !== null) this.ownerDocument = doc;
  }
  focus(): void {
    this.ownerDocument.activeElement = this;
  }
  blur(): void {
    if (this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
  }
  get firstChild(): ShimNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): ShimNode | null {
    return this.childNodes.at(-1) ?? null;
  }
  get nextSibling(): ShimNode | null {
    const parent = this.parentNode;
    return parent === null ? null : (parent.childNodes[parent.childNodes.indexOf(this) + 1] ?? null);
  }
  get textContent(): string {
    return this.nodeType === TEXT_NODE
      ? this.nodeValue
      : this.childNodes.map((child) => child.textContent).join("");
  }
  set textContent(value: string) {
    this.childNodes = [];
    if (value === "") return;
    const text = new ShimNode(this.ownerDocument, TEXT_NODE, "#text");
    text.nodeValue = value;
    text.parentNode = this;
    this.childNodes.push(text);
  }
  contains(other: ShimNode): boolean {
    for (let node: ShimNode | null = other; node !== null; node = node.parentNode) {
      if (node === this) return true;
    }
    return false;
  }
  appendChild(node: ShimNode): ShimNode {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  removeChild(node: ShimNode): ShimNode {
    const index = this.childNodes.indexOf(node);
    if (index !== -1) {
      this.childNodes.splice(index, 1);
      node.parentNode = null;
    }
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
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value));
    if (name === "id") this.id = String(value);
    if (name === "type") this.type = String(value);
    if (name === "name") this.name = String(value);
    if (name === "value") {
      const protoSet = Object.getOwnPropertyDescriptor(ShimNode.prototype, "value")?.set;
      protoSet?.call(this, String(value));
    }
    if (name === "disabled") this.disabled = true;
    if (name === "checked") {
      const protoSet = Object.getOwnPropertyDescriptor(ShimNode.prototype, "checked")?.set;
      protoSet?.call(this, true);
    }
  }
  setAttributeNS(_ns: string, name: string, value: string): void {
    this.setAttribute(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attrs.has(name) ? (this.attrs.get(name) ?? "") : null;
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
    if (name === "disabled") this.disabled = false;
    if (name === "checked") this.checked = false;
  }
  addEventListener(type: string, listener: ShimFnArg, options?: ShimOpts): void {
    if (typeof listener !== "function") return;
    const list = this.listeners.get(type) ?? [];
    list.push({ fn: listener, capture: captureOf(options) });
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, listener: ShimFnArg, options?: ShimOpts): void {
    if (typeof listener !== "function") return;
    const capture = captureOf(options);
    const list = this.listeners.get(type);
    if (list === undefined) return;
    this.listeners.set(
      type,
      list.filter((entry) => entry.fn !== listener || entry.capture !== capture),
    );
  }
  dispatchEvent(event: ShimEvent): boolean {
    event.target = this;
    const path: ShimNode[] = [];
    for (let node: ShimNode | null = this; node !== null; node = node.parentNode) {
      path.push(node);
    }
    for (let i = path.length - 1; i >= 0 && !event.stopped; i -= 1) {
      path[i]?.emit(event, true);
    }
    for (const node of path) {
      if (event.stopped) break;
      node.emit(event, false);
    }
    return !event.defaultPrevented;
  }
  emit(event: ShimEvent, capture: boolean): void {
    event.currentTarget = this;
    for (const rec of this.listeners.get(event.type) ?? []) {
      if (rec.capture === capture) rec.fn(event);
    }
  }
  id = "";
}

const textValueSlots = new WeakMap<ShimNode, string>();
const checkedSlots = new WeakMap<ShimNode, boolean>();
Object.defineProperty(ShimNode.prototype, "value", {
  configurable: true,
  enumerable: true,
  get(): string {
    return textValueSlots.get(this) ?? "";
  },
  set(next: string) {
    textValueSlots.set(this, String(next));
  },
});
Object.defineProperty(ShimNode.prototype, "checked", {
  configurable: true,
  enumerable: true,
  get(): boolean {
    return checkedSlots.get(this) ?? false;
  },
  set(next: boolean) {
    checkedSlots.set(this, next === true);
  },
});

class ShimDocument extends ShimNode {
  defaultView: ShimWindow | null = null;
  documentElement: ShimNode;
  head: ShimNode;
  body: ShimNode;
  activeElement: ShimNode | null;
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
  createElement(name: string): ShimNode {
    return new ShimNode(this, ELEMENT_NODE, name.toUpperCase());
  }
  createElementNS(_ns: string, name: string): ShimNode {
    return this.createElement(name);
  }
  createTextNode(value: string): ShimNode {
    const text = new ShimNode(this, TEXT_NODE, "#text");
    text.nodeValue = value;
    return text;
  }
}

class HTMLIFrameElement {}

class ShimWindow {
  document: ShimDocument;
  event: undefined = undefined;
  navigator = { userAgent: "shim" };
  location = { protocol: "https:", href: "https://localhost/", assign: (_href: string): void => {} };
  top: ShimWindow;
  self: ShimWindow;
  HTMLIFrameElement = HTMLIFrameElement;
  host: ShimNode;
  constructor(doc: ShimDocument) {
    this.document = doc;
    this.top = this;
    this.self = this;
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
  const prev = {
    window: globals.window,
    document: globals.document,
    act: globals.IS_REACT_ACT_ENVIRONMENT,
  };
  const doc = new ShimDocument();
  const win = new ShimWindow(doc);
  doc.defaultView = win;
  globals.window = win;
  globals.document = doc;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    document: doc,
    restore: () => {
      if (owned.window) globals.window = prev.window;
      else delete globals.window;
      if (owned.document) globals.document = prev.document;
      else delete globals.document;
      if (owned.act) globals.IS_REACT_ACT_ENVIRONMENT = prev.act;
      else delete globals.IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function walk(node: ShimNode, visit: (current: ShimNode) => void): void {
  visit(node);
  for (const child of node.childNodes) {
    walk(child, visit);
  }
}

function findById(root: ShimNode, id: string): ShimNode {
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (node.id === id || node.getAttribute("id") === id) {
      found = node;
    }
  });
  if (found === null) {
    throw new Error(`missing #${id}`);
  }
  return found;
}

function findByTag(root: ShimNode, tagName: string): ShimNode {
  const upper = tagName.toUpperCase();
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (node.tagName === upper && found === null) {
      found = node;
    }
  });
  if (found === null) {
    throw new Error(`missing <${tagName}>`);
  }
  return found;
}

async function waitForText(container: ShimNode, needle: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!container.textContent.includes(needle)) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${JSON.stringify(needle)} in: ${container.textContent}`);
    }
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
      });
    });
  }
}

const CONFIG_BODY = {
  poll_interval_ms: 1,
  active_poll_interval_ms: 1,
  backoff_initial_ms: 1,
  backoff_max_ms: 1,
  request_timeout_ms: 5000,
};

const AREA_IDS = [
  "discovery",
  "tls",
  "jwks",
  "httpsig",
  "sharing",
  "notification",
  "token",
  "capability",
] as const;

function parseableManifest(): Record<string, unknown> {
  return {
    schema: "federation_tester_manifest.v1",
    apiVersion: "v1",
    servicePrefix: "/validator",
    optIn: {
      default: "off",
      start: {
        optInStats: { type: "boolean", default: false },
        optInPermanent: { type: "boolean", default: false },
      },
      scan: { statsQuery: "stats", permanentQuery: "permanent", optInValue: "1" },
    },
    retention: {
      tiers: ["ephemeral", "permanent"],
      defaultTier: "ephemeral",
      clock: "utc",
      patchPath: "/retention",
      lockPath: "/lock",
    },
    report: { htmlPath: "/report/{id}", apiPath: "/api/report/{id}" },
    statistics: {
      schema: "federation_tester_statistics.v1",
      timeframesDays: [7, 14, 30, 60, 90, 365, 0],
      defaultDays: 14,
      kAnonymityUniqueHosts: 5,
      unknownPlatformExempt: true,
    },
    routes: [{ method: "GET", fullPath: "/api/manifest" }],
    reverseInvite: { available: true },
    platform: { available: true },
    tlsSummary: { available: true },
    sessionKind: { supported: ["passive"], scanDefault: "passive" },
    nextInstruction: { created: "wait_probe" },
  };
}

function zeroAreas(): Array<{ area: string; pass: number; warn: number; fail: number }> {
  return AREA_IDS.map((area) => ({ area, pass: 0, warn: 0, fail: 0 }));
}

function emptyStatistics(): Record<string, unknown> {
  return {
    schema: "federation_tester_statistics.v1",
    window: { days: 14, from: 0, to: 0, selector: "14" },
    totals: { sessions: 0, uniqueHosts: 0, healthyPct: 0 },
    platforms: [],
    areas: zeroAreas(),
    daily: [],
    dailyOmitted: true,
  };
}

function readyStatistics(): Record<string, unknown> {
  const areas = zeroAreas();
  areas[0] = { area: "discovery", pass: 8, warn: 1, fail: 1 };
  return {
    schema: "federation_tester_statistics.v1",
    window: { days: 14, from: 1, to: 2, selector: "14" },
    totals: { sessions: 10, uniqueHosts: 6, healthyPct: 80 },
    platforms: [
      { platform: "nextcloud", count: 5, pct: 50 },
      { platform: "opencloud", count: 5, pct: 50 },
    ],
    areas,
    daily: [{ ts: 1, sessions: 1, healthyPct: 100 }],
  };
}

function mockIslandFetch(statisticsStatus: number, statisticsBody: unknown): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("config.json")) {
      return jsonResponse(200, CONFIG_BODY);
    }
    if (url.includes("/api/manifest")) {
      return jsonResponse(200, parseableManifest());
    }
    if (url.includes("/api/statistics")) {
      return jsonResponse(statisticsStatus, statisticsBody);
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
}

function htmlOf(node: ShimNode): string {
  if (node.nodeType === TEXT_NODE) {
    return node.nodeValue;
  }
  if (node.nodeType === DOCUMENT_NODE) {
    return node.childNodes.map(htmlOf).join("");
  }
  const tag = node.tagName.toLowerCase();
  const attrs = [...node.attrs.entries()]
    .map(([name, value]) => ` ${name}="${value}"`)
    .join("");
  return `<${tag}${attrs}>${node.childNodes.map(htmlOf).join("")}</${tag}>`;
}

const TILE_VALUE_CLASS = "text-lg font-semibold text-zinc-100";

function tileValue(root: ShimNode, title: string): string {
  let found = "";
  walk(root, (node) => {
    if (node.tagName !== "H3" || node.textContent !== title) {
      return;
    }
    const card = node.parentNode?.parentNode;
    if (card === undefined || card === null) {
      return;
    }
    walk(card, (current) => {
      if (current.getAttribute("class") === TILE_VALUE_CLASS) {
        found = current.textContent;
      }
    });
  });
  return found;
}

describe("StatisticsShell island panels", () => {
  test("empty branch renders explanation, dash tiles, and no grade distribution", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = mockIslandFetch(200, emptyStatistics());
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<StatisticsShell />);
      });
      await waitForText(container, "Public totals stay at zero until");
      findById(container, "validator-stats-days");
      findByTag(container, "select");
      const html = htmlOf(container);
      expect(html).toContain("Public totals stay at zero until");
      expect(html).toContain("Opted-in runs may be recorded even before they appear here.");
      expect(tileValue(container, "Sessions")).toBe("-");
      expect(tileValue(container, "Unique hosts")).toBe("-");
      expect(tileValue(container, "Healthy")).toBe("-");
      expect(html).toContain("Platform counts appear after at least 5 unique hosts");
      expect(html).not.toContain("Area-grade totals");
      expect(html).toContain("0/8 areas assessed");
      await act(() => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });

  test("ready branch renders numeric tiles, platforms, and area-grade totals", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = mockIslandFetch(200, readyStatistics());
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<StatisticsShell />);
      });
      await waitForText(container, "80%");
      findById(container, "validator-stats-days");
      findByTag(container, "select");
      const html = htmlOf(container);
      expect(tileValue(container, "Sessions")).toBe("10");
      expect(tileValue(container, "Unique hosts")).toBe("6");
      expect(tileValue(container, "Healthy")).toBe("80%");
      expect(html).toContain("nextcloud");
      expect(html).toContain("opencloud");
      expect(html).toContain("Area-grade totals");
      expect(html).toContain("Server discovery");
      expect(html).toContain("1/8 areas assessed");
      expect(html).not.toContain("Public totals stay at zero until");
      await act(() => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });

  test("error branch renders statistics unavailable without loading or empty copy", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = mockIslandFetch(503, {
      error: "stats_failed",
      message: "statistics unavailable now",
    });
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<StatisticsShell />);
      });
      await waitForText(container, "statistics unavailable:");
      findById(container, "validator-stats-days");
      findByTag(container, "select");
      const html = htmlOf(container);
      expect(html).toContain("statistics unavailable:");
      expect(html).not.toContain("Loading statistics...");
      expect(html).not.toContain("Public totals stay at zero until");
      await act(() => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });
});
