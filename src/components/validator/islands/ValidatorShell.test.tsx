import React, { act } from "react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import ValidatorShell, { ValidatorEntryForm } from "./ValidatorShell";

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

function checkboxChunk(html: string, id: string): string {
  const marker = `id="${id}"`;
  const start = html.indexOf(marker);
  if (start === -1) {
    throw new Error(`missing checkbox ${id}`);
  }
  const from = html.lastIndexOf("<input", start);
  const to = html.indexOf(">", start);
  if (from === -1 || to === -1) {
    throw new Error(`unreadable checkbox ${id}`);
  }
  return html.slice(from, to + 1);
}

function isChecked(html: string, id: string): boolean {
  return /\schecked(?:="[^"]*")?/.test(checkboxChunk(html, id));
}

function isDisabled(html: string, id: string): boolean {
  return /\sdisabled(?:="[^"]*")?/.test(checkboxChunk(html, id));
}

const noopChange = (): void => undefined;
const noopSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
  event.preventDefault();
};

const readyForm = {
  target: "",
  onTargetChange: noopChange,
  optInPermanent: false,
  optInActive: false,
  optInStats: false,
  onOptInPermanentChange: noopChange,
  onOptInActiveChange: noopChange,
  onOptInStatsChange: noopChange,
  submitting: false,
  configReady: true,
  activeAvailable: true,
  manifestLoading: false,
  manifestFailed: false,
  hostError: "",
  formError: "",
  previewHost: null as string | null,
  onSubmit: noopSubmit,
};

describe("ValidatorShell entry form", () => {
  test("renders the form-first labels, hints, fieldset, and primary action", () => {
    const html = render(<ValidatorShell />);
    expect(html).toContain("Enter the server you want to check.");
    expect(html).toContain("Save a public report");
    expect(html).toContain("Saves the result after this session so anyone with the link can view it. The validator retention policy applies.");
    expect(html).toContain("Run active validation");
    expect(html).toContain(
      "Tests live sharing steps and may ask you to complete actions during the scan. Off runs passive checks only.",
    );
    expect(html).toContain("Contribute to public statistics");
    expect(html).toContain("Adds aggregate data after enough unique hosts are in the public window. It does not create a public report for this server.");
    expect(html).toContain("<fieldset");
    expect(html).toContain("<legend");
    expect(html).toContain("Optional settings");
    expect(html).toContain("Loading validator...");
    expect(html).toContain("Loading option...");
    expect(html.indexOf("Save a public report")).toBeLessThan(html.indexOf("Run active validation"));
    expect(html.indexOf("Run active validation")).toBeLessThan(
      html.indexOf("Contribute to public statistics"),
    );
    expect(isChecked(html, "validator-opt-in-permanent")).toBe(false);
    expect(isChecked(html, "validator-opt-in-active")).toBe(false);
    expect(isChecked(html, "validator-opt-in-stats")).toBe(false);
    expect(isDisabled(html, "validator-opt-in-active")).toBe(true);
    expect(html).toContain("min-h-11");
  });

  test("keeps an unavailable active row visible and disabled", () => {
    const html = render(
      <ValidatorEntryForm
        {...readyForm}
        activeAvailable={false}
        manifestFailed={true}
      />,
    );
    expect(html).toContain("Run active validation");
    expect(html).toContain(
      "Tests live sharing steps and may ask you to complete actions during the scan. Off runs passive checks only.",
    );
    expect(isDisabled(html, "validator-opt-in-active")).toBe(true);
    expect(html).toContain("Extra scan options are unavailable. You can still run a basic check.");
    expect(html).not.toContain("Loading option...");
    expect(html).not.toContain("manifest unavailable:");
    expect(html).toContain("Check this server");
  });

  test("uses the exact primary action wording when ready", () => {
    const html = render(<ValidatorEntryForm {...readyForm} />);
    expect(html).toContain("Check this server");
    expect(html).not.toContain("Start scan");
    expect(html).not.toContain("Starting...");
  });

  test("pending state preserves form data", () => {
    const html = render(
      <ValidatorEntryForm
        {...readyForm}
        target="peer.example:8443"
        optInPermanent={true}
        optInStats={true}
        submitting={true}
        previewHost="peer.example:8443"
      />,
    );
    expect(html).toContain('value="peer.example:8443"');
    expect(html).toContain("Server to check: peer.example:8443");
    expect(isChecked(html, "validator-opt-in-permanent")).toBe(true);
    expect(isChecked(html, "validator-opt-in-stats")).toBe(true);
    expect(isChecked(html, "validator-opt-in-active")).toBe(false);
    expect(html).toContain("Starting check...");
    expect(html).not.toContain("Loading validator...");
  });

  test("always mounts the reserved preview node and wires aria-describedby when empty", () => {
    const html = render(<ValidatorShell />);
    expect(html).toContain('id="validator-host-preview"');
    expect(html).toContain('aria-describedby="validator-domain-help validator-host-preview"');
    expect(html).not.toContain("Server to check:");
  });

  test("reserved preview node stays empty when there is no host", () => {
    const html = render(<ValidatorEntryForm {...readyForm} />);
    expect(html).toContain('id="validator-host-preview"');
    expect(html).not.toContain("Server to check:");
  });

  test("reserved preview node renders the host when populated", () => {
    const html = render(<ValidatorEntryForm {...readyForm} previewHost="peer.example.com" />);
    expect(html).toContain('id="validator-host-preview"');
    expect(html).toContain('aria-describedby="validator-domain-help validator-host-preview"');
    expect(html).toContain("Server to check: peer.example.com");
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
  type = "";
  name = "";
  declare value: string;
  declare checked: boolean;
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

function findAlert(root: ShimNode): ShimNode {
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (node.getAttribute("role") === "alert") {
      found = node;
    }
  });
  if (found === null) {
    throw new Error("missing role=alert");
  }
  return found;
}

function reactChangeProps(node: ShimNode): {
  onChange?: (event: { target: ShimNode }) => void;
} {
  const key = Object.getOwnPropertyNames(node).find((name) => name.startsWith("__reactProps"));
  if (key === undefined) {
    throw new Error("missing react props");
  }
  return (node as unknown as Record<string, { onChange?: (event: { target: ShimNode }) => void }>)[key];
}

function driveText(node: ShimNode, value: string): void {
  const protoSet = Object.getOwnPropertyDescriptor(ShimNode.prototype, "value")?.set;
  if (protoSet === undefined) {
    throw new Error("missing value setter");
  }
  protoSet.call(node, value);
  const onChange = reactChangeProps(node).onChange;
  if (onChange === undefined) {
    throw new Error("missing text onChange");
  }
  onChange({ target: node });
}

function driveCheckbox(node: ShimNode, checked: boolean): void {
  const protoSet = Object.getOwnPropertyDescriptor(ShimNode.prototype, "checked")?.set;
  if (protoSet === undefined) {
    throw new Error("missing checked setter");
  }
  protoSet.call(node, checked);
  const onChange = reactChangeProps(node).onChange;
  if (onChange === undefined) {
    throw new Error("missing checkbox onChange");
  }
  onChange({ target: node });
}

function findSubmit(root: ShimNode): ShimNode {
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (node.tagName === "BUTTON" && (node.type === "submit" || node.getAttribute("type") === "submit")) {
      found = node;
    }
  });
  if (found === null) {
    throw new Error("missing submit button");
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

describe("ValidatorShell start rejection", () => {
  test("submit preserves values after API failure", async () => {
    const failureMessage = "Could not start the scan.";
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("config.json")) {
        return jsonResponse(200, {
          poll_interval_ms: 1,
          active_poll_interval_ms: 1,
          backoff_initial_ms: 1,
          backoff_max_ms: 1,
          request_timeout_ms: 5000,
        });
      }
      if (url.includes("/api/manifest")) {
        return jsonResponse(404, { error: "missing", message: "missing" });
      }
      if (method === "POST" && url.includes("/start")) {
        return jsonResponse(503, { error: "start_failed", message: failureMessage });
      }
      return jsonResponse(404, { error: "missing", message: "missing" });
    }) as typeof fetch;

    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ValidatorShell />);
      });
      await waitForText(container, "Check this server");

      const host = findById(container, "validator-domain");
      await act(() => {
        driveText(host, "peer.example");
      });

      const permanent = findById(container, "validator-opt-in-permanent");
      const stats = findById(container, "validator-opt-in-stats");
      await act(() => {
        driveCheckbox(permanent, true);
        driveCheckbox(stats, true);
      });

      const form = findByTag(container, "form");
      await act(() => {
        form.dispatchEvent(new ShimEvent("submit"));
      });
      await waitForText(container, failureMessage);

      expect(findById(container, "validator-domain").value).toBe("peer.example");
      expect(findById(container, "validator-opt-in-permanent").checked).toBe(true);
      expect(findById(container, "validator-opt-in-stats").checked).toBe(true);
      const alert = findAlert(container);
      expect(alert.textContent).toContain(failureMessage);
      const submit = findSubmit(container);
      expect(submit.disabled).toBe(false);
      expect(container.textContent).toContain("Check this server");
      expect(container.textContent).not.toContain("Starting check...");
      await act(() => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });

  test("submit surfaces a fallback when the start API returns an empty message", async () => {
    const fallbackMessage = "Could not start the scan.";
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("config.json")) {
        return jsonResponse(200, {
          poll_interval_ms: 1,
          active_poll_interval_ms: 1,
          backoff_initial_ms: 1,
          backoff_max_ms: 1,
          request_timeout_ms: 5000,
        });
      }
      if (url.includes("/api/manifest")) {
        return jsonResponse(404, { error: "missing", message: "missing" });
      }
      if (method === "POST" && url.includes("/start")) {
        return jsonResponse(503, { error: "start_failed", message: "" });
      }
      return jsonResponse(404, { error: "missing", message: "missing" });
    }) as typeof fetch;

    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ValidatorShell />);
      });
      await waitForText(container, "Check this server");

      const host = findById(container, "validator-domain");
      await act(() => {
        driveText(host, "peer.example");
      });

      const form = findByTag(container, "form");
      await act(() => {
        form.dispatchEvent(new ShimEvent("submit"));
      });
      await waitForText(container, fallbackMessage);

      const alert = findAlert(container);
      expect(alert.textContent).toContain(fallbackMessage);
      const submit = findSubmit(container);
      expect(submit.disabled).toBe(false);
      expect(container.textContent).toContain("Check this server");
      expect(container.textContent).not.toContain("Starting check...");
      await act(() => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });
});

describe("ValidatorShell reserved preview", () => {
  test("blur populates the reserved node and immediate submit still starts the scan", async () => {
    const previousFetch = globalThis.fetch;
    let startCalled = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("config.json")) {
        return jsonResponse(200, {
          poll_interval_ms: 1,
          active_poll_interval_ms: 1,
          backoff_initial_ms: 1,
          backoff_max_ms: 1,
          request_timeout_ms: 5000,
        });
      }
      if (url.includes("/api/manifest")) {
        return jsonResponse(404, { error: "missing", message: "missing" });
      }
      if (method === "POST" && url.includes("/start")) {
        startCalled = true;
        return jsonResponse(200, { id: "scan-1", optInStats: false, optInPermanent: false });
      }
      return jsonResponse(404, { error: "missing", message: "missing" });
    }) as typeof fetch;

    const { document: doc, restore } = installDomShim();
    let assigned = "";
    if (doc.defaultView !== null) {
      doc.defaultView.location.assign = (href: string): void => {
        assigned = href;
      };
    }
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ValidatorShell />);
      });
      await waitForText(container, "Check this server");

      const reservedBefore = findById(container, "validator-host-preview");
      expect(reservedBefore.textContent).toBe("");

      const host = findById(container, "validator-domain");
      await act(() => {
        driveText(host, "peer.example");
      });
      await act(() => {
        host.dispatchEvent(new ShimEvent("focusout"));
      });

      const reservedAfter = findById(container, "validator-host-preview");
      expect(reservedAfter.textContent).toContain("Server to check: peer.example");

      const form = findByTag(container, "form");
      await act(() => {
        form.dispatchEvent(new ShimEvent("submit"));
      });
      const deadline = Date.now() + 2000;
      while (!startCalled && Date.now() < deadline) {
        await act(async () => {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 5);
          });
        });
      }
      expect(startCalled).toBe(true);
      expect(assigned).toContain("/validator/results");
      await act(() => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });
});
