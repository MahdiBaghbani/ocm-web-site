// Shared shim DOM for validator tests that render into a plain object graph
// instead of a real browser document. This is the union of the three
// disjoint capability families that used to be copied inline across five
// test files: ResultsShell's connectivity/querying additions (children,
// isConnected, querySelector/querySelectorAll/closest, hasAttribute, and
// HTMLElement installation), ValidatorShell's form fields/attributes
// (focus/blur, disabled, type, name, id, value, checked, location.assign),
// and StatisticsShell's select/option/checkbox additions (multiple,
// selected, defaultSelected, options).

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

export class ShimEvent {
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

export class ShimNode {
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
  id = "";
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

  get options(): ShimNode[] {
    return this.childNodes.filter((child) => child.tagName === "OPTION");
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
  get children(): ShimNode[] {
    return this.childNodes.filter((child) => child.nodeType === ELEMENT_NODE);
  }
  get isConnected(): boolean {
    let node: ShimNode | null = this;
    while (node !== null) {
      if (node.nodeType === DOCUMENT_NODE) return true;
      node = node.parentNode;
    }
    return false;
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
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
    if (name === "disabled") this.disabled = false;
    if (name === "checked") this.checked = false;
  }
  querySelectorAll(_selector: string): ShimNode[] {
    return [];
  }
  querySelector(_selector: string): ShimNode | null {
    return null;
  }
  closest(_selector: string): ShimNode | null {
    return null;
  }
  focus(): void {
    this.ownerDocument.activeElement = this;
  }
  blur(): void {
    if (this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
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

export class ShimDocument extends ShimNode {
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

export class HTMLIFrameElement {}

export class ShimWindow {
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

export function reactDomContainerOf(node: ShimNode): Element {
  return node as unknown as Element;
}

export function installDomShim(): { document: ShimDocument; restore: () => void } {
  const globals = shimGlobalSlots();
  const htmlHost = globalThis as { HTMLElement?: unknown };
  const owned = {
    window: Object.prototype.hasOwnProperty.call(globals, "window"),
    document: Object.prototype.hasOwnProperty.call(globals, "document"),
    act: Object.prototype.hasOwnProperty.call(globals, "IS_REACT_ACT_ENVIRONMENT"),
    html: Object.prototype.hasOwnProperty.call(htmlHost, "HTMLElement"),
  };
  const prev = {
    window: globals.window,
    document: globals.document,
    act: globals.IS_REACT_ACT_ENVIRONMENT,
    html: htmlHost.HTMLElement,
  };
  const doc = new ShimDocument();
  const win = new ShimWindow(doc);
  doc.defaultView = win;
  globals.window = win;
  globals.document = doc;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof htmlHost.HTMLElement === "undefined") {
    htmlHost.HTMLElement = class HTMLElement {};
  }
  return {
    document: doc,
    restore: () => {
      if (owned.window) globals.window = prev.window;
      else delete globals.window;
      if (owned.document) globals.document = prev.document;
      else delete globals.document;
      if (owned.act) globals.IS_REACT_ACT_ENVIRONMENT = prev.act;
      else delete globals.IS_REACT_ACT_ENVIRONMENT;
      if (owned.html) htmlHost.HTMLElement = prev.html;
      else delete htmlHost.HTMLElement;
    },
  };
}
