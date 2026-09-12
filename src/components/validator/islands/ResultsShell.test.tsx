import React, { act } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import ResultsShell, {
  AREA_DESCRIPTIONS,
  CACHED_SESSION_JSON_NOTE,
  EVIDENCE_NOT_SAVED,
  TEST_HREF,
  VISIBILITY_NOTICE,
  areaTotals,
  bannerBody,
  projectResultsPage,
  resultAreaEntries,
  specificationInputFromReport,
} from "./ResultsShell";
import { RESULT_HEADLINE, type CanonicalAreaId } from "../lib/validatorScore";
import { resolveValidatorMachine } from "../lib/stateMachine";
import type {
  ReportResponse,
  SessionPollResponse,
  ValidatorFailure,
} from "../lib/validatorFetch";

const SESSION_ID = "0193a0c2-7c1d-7b4a-8f2e-1a2b3c4d5e6f";
const API_ORIGIN = "https://validator.example.com";
const AREA_IDS = [
  "discovery",
  "tls",
  "jwks",
  "httpsig",
  "sharing",
  "notification",
  "token",
  "capability",
] as const satisfies readonly CanonicalAreaId[];

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

function areaRow(area: CanonicalAreaId, grade: "pass" | "warn" | "fail" | null): Record<string, unknown> {
  return {
    area,
    grade,
    testRunCount: 0,
    distinctTestCount: 0,
    requiredTestCount: 0,
    optionalTestCount: 0,
    passedTestCount: 0,
    failedTestCount: 0,
    passWithWarningCount: 0,
    evidenceCount: 0,
  };
}

function specification(
  gradeFor: (id: CanonicalAreaId) => "pass" | "warn" | "fail" | null,
  grade: "pass" | "warn" | "fail" | null = "pass",
): Record<string, unknown> {
  return {
    grade,
    state: "terminal_pass",
    terminal: true,
    assessedAreas: 8,
    totalAreas: 8,
    areas: AREA_IDS.map((id) => areaRow(id, gradeFor(id))),
  };
}

function liveReport(score: unknown, extra: Partial<ReportResponse> = {}): ReportResponse {
  return {
    schema: "federation_tester_report.v1",
    id: SESSION_ID,
    visibility: "session",
    score: { specification: score },
    ...extra,
  };
}

function permanentReport(score: unknown, extra: Partial<ReportResponse> = {}): ReportResponse {
  return {
    schema: "federation_tester_report.v1",
    id: SESSION_ID,
    visibility: "permanent",
    reportUrl: `/validator/report/${SESSION_ID}`,
    score: { specification: score },
    evidence: [],
    ...extra,
  };
}

function pollOf(state: string, extra: Partial<SessionPollResponse> = {}): SessionPollResponse {
  return { state, ts: 1, optInActive: false, ...extra };
}

function viewOf(state: string, nextInstruction?: string) {
  return resolveValidatorMachine({
    state,
    optInActive: false,
    nextInstruction,
  });
}

function fail(
  kind: ValidatorFailure["kind"],
  message: string,
  extra: Partial<ValidatorFailure> = {},
): ValidatorFailure {
  return {
    ok: false,
    kind,
    status: extra.status ?? null,
    error: extra.error ?? kind,
    message,
    ...extra,
  };
}

function project(input: Partial<Parameters<typeof projectResultsPage>[0]> = {}) {
  return projectResultsPage({
    poll: pollOf("terminal_pass"),
    view: viewOf("terminal_pass"),
    lastLiveReport: null,
    terminalReport: null,
    reportFailure: null,
    validatorApiOrigin: API_ORIGIN,
    ...input,
  });
}

describe("ResultsShell hydration", () => {
  test("SSR without props matches the first client render and hides the missing-session alert", () => {
    const html = render(<ResultsShell />);
    expect(html).toContain("Loading session...");
    expect(html).not.toContain("Missing host or session id");
    expect(html).not.toContain("invalid session ID");
    expect(html).not.toContain('role="alert"');
  });

  test("SSR with host and id renders identity without reading window location", () => {
    const html = render(<ResultsShell host="Peer.Example" id={` ${SESSION_ID} `} />);
    expect(html).toContain("Result for peer.example");
    expect(html).toContain("Session");
    expect(html).toContain(SESSION_ID);
    expect(html).not.toContain("Back to Test");
    expect(html).toContain("Copy session ID");
    expect(html).toContain("Loading session...");
    expect(html).not.toContain("Missing host or session id");
  });

  test("SSR with invalid props stays on the mounted-gate loading state", () => {
    const html = render(<ResultsShell host="not a host" id="has space" />);
    expect(html).toContain("Loading session...");
    expect(html).not.toContain("Missing host or session id");
    expect(html).not.toContain("invalid session ID");
  });
});

describe("projectResultsPage private terminal completion", () => {
  test("report_not_public plus cached all-pass areas is Compatible", () => {
    const result = project({
      lastLiveReport: liveReport(specification(() => "pass")),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(result.status).toBe("ready");
    expect(result.visibility).toBe("not_saved");
    expect(result.sourceKind).toBe("cached_session");
    expect(result.score.headline).toBe(RESULT_HEADLINE.compatible);
    expect(result.bannerVerdict).toBe("pass");
    expect(result.bannerTitle).toBe(RESULT_HEADLINE.compatible);
    expect(result.showPublicActions).toBe(false);
    expect(result.rawJsonNote).toBe(CACHED_SESSION_JSON_NOTE);
    expect(result.evidenceMode).toBe("not_saved");
    expect(result.showAreas).toBe(true);
  });

  test("report_not_public plus one warn and no fail is Compatible with warnings", () => {
    const result = project({
      lastLiveReport: liveReport(specification((id) => (id === "tls" ? "warn" : "pass"), "warn")),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(result.score.headline).toBe(RESULT_HEADLINE.compatibleWithWarnings);
    expect(result.bannerVerdict).toBe("warn");
    expect(result.visibility).toBe("not_saved");
  });

  test("report_not_public plus one fail is Compatibility failed", () => {
    const result = project({
      lastLiveReport: liveReport(specification((id) => (id === "sharing" ? "fail" : "pass"), "fail")),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(result.score.headline).toBe(RESULT_HEADLINE.compatibilityFailed);
    expect(result.bannerVerdict).toBe("fail");
  });

  test("report_not_public plus malformed cache is Result unavailable, not the not-saved empty state", () => {
    const result = project({
      lastLiveReport: liveReport({ grade: null }),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(result.status).toBe("malformed");
    expect(result.status).not.toBe("not_saved_empty");
    expect(result.visibility).toBe("not_saved");
    expect(result.sourceKind).toBe("cached_session");
    expect(result.bannerVerdict).toBeNull();
    expect(result.score.headline).toBe(RESULT_HEADLINE.resultUnavailable);
    expect(result.showAreas).toBe(false);
  });

  test("report_not_public without cache is the not-saved empty state", () => {
    const result = project({
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(result.status).toBe("not_saved_empty");
    expect(result.visibility).toBe("not_saved");
    expect(result.bannerVerdict).toBeNull();
    expect(result.showAreas).toBe(false);
    expect(result.showPublicActions).toBe(false);
  });

  test("report_not_public without cache stays not-saved empty for terminal_fail", () => {
    const result = project({
      poll: pollOf("terminal_fail", { failModeLabel: "handshake failed" }),
      view: viewOf("terminal_fail"),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(result.status).toBe("not_saved_empty");
    expect(result.status).not.toBe("ready");
    expect(result.visibility).toBe("not_saved");
    expect(result.bannerVerdict).toBeNull();
    expect(result.showAreas).toBe(false);
    expect(result.showPublicActions).toBe(false);
  });

  test("unrelated 404 is a report error, not private success", () => {
    const result = project({
      lastLiveReport: liveReport(specification(() => "pass")),
      reportFailure: fail("http", "missing", { status: 404, error: "nope" }),
    });
    expect(result.status).toBe("report_error");
    expect(result.visibility).not.toBe("not_saved");
    expect(result.showPublicActions).toBe(false);
    expect(result.sourceReport).toBeNull();
  });

  test("network failure is a report error", () => {
    const result = project({
      reportFailure: fail("network", "network request failed"),
    });
    expect(result.status).toBe("report_error");
    expect(result.visibility).not.toBe("not_saved");
  });

  test("expired failure is the expired state and does not reuse cache", () => {
    const result = project({
      lastLiveReport: liveReport(specification(() => "pass")),
      reportFailure: fail("expired", "resource expired", { status: 410, error: "gone" }),
    });
    expect(result.status).toBe("expired");
    expect(result.visibility).toBe("expired");
    expect(result.sourceReport).toBeNull();
    expect(result.showAreas).toBe(false);
    expect(result.showPublicActions).toBe(false);
  });

  test("successful permanent report honors the parsed grade and validated URL", () => {
    const result = project({
      terminalReport: permanentReport(specification(() => "pass")),
    });
    expect(result.status).toBe("ready");
    expect(result.visibility).toBe("permanent");
    expect(result.sourceKind).toBe("terminal");
    expect(result.score.headline).toBe(RESULT_HEADLINE.compatible);
    expect(result.showPublicActions).toBe(true);
    expect(result.reportUrl).toBe(`https://validator.example.com/validator/report/${SESSION_ID}`);
    expect(result.rawJsonNote).toBeNull();
    expect(result.evidenceMode).toBe("disclosure");
  });

  test("hides public actions for session visibility even when a URL is present", () => {
    const result = project({
      terminalReport: liveReport(specification(() => "pass"), {
        reportUrl: `/validator/report/${SESSION_ID}`,
      }),
    });
    expect(result.visibility).toBe("session");
    expect(result.showPublicActions).toBe(false);
    expect(result.reportUrl).toBeNull();
  });

  test("hides public actions when a permanent URL is cross-origin", () => {
    const result = project({
      terminalReport: permanentReport(specification(() => "pass"), {
        reportUrl: "https://evil.example/validator/report/abc",
      }),
    });
    expect(result.visibility).toBe("permanent");
    expect(result.showPublicActions).toBe(false);
    expect(result.reportUrl).toBeNull();
  });

  test("cached terminal_pass with zero assessed is inconclusive, not a load error", () => {
    const result = project({
      lastLiveReport: liveReport(specification(() => null, null)),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(result.status).toBe("ready");
    expect(result.bannerVerdict).toBe("inconclusive");
    expect(result.score.headline).toBe(RESULT_HEADLINE.noCompatibilityResult);
    expect(result.score.coverageLabel).toBe("0 of 8");
    expect(result.visibility).toBe("not_saved");
  });

  test("malformed terminal score is Result unavailable, not Inconclusive", () => {
    const result = project({
      terminalReport: liveReport({ grade: null }),
    });
    expect(result.status).toBe("malformed");
    expect(result.bannerVerdict).toBeNull();
    expect(result.score.headline).toBe(RESULT_HEADLINE.resultUnavailable);
    expect(result.showAreas).toBe(false);
  });

  test("failModeLabel is used only for fail and interrupted copy", () => {
    const failResult = project({
      poll: pollOf("terminal_fail", { failModeLabel: "handshake failed" }),
      view: viewOf("terminal_fail"),
      lastLiveReport: liveReport(specification(() => "pass", null)),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    const interrupted = project({
      poll: pollOf("interrupted", { failModeLabel: "operator stopped" }),
      view: viewOf("interrupted"),
      lastLiveReport: liveReport(specification(() => "pass", null)),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    const pass = project({
      poll: pollOf("terminal_pass", { failModeLabel: "should not appear" }),
      lastLiveReport: liveReport(specification(() => "pass")),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(failResult.bannerMessage).toContain("handshake failed");
    expect(interrupted.bannerMessage).toContain("operator stopped");
    expect(pass.bannerMessage).not.toContain("should not appear");
    expect(pass.score.showFailModeLabel).toBe(false);
    expect(failResult.bannerMessage).not.toContain("Assessed");
    expect(interrupted.bannerMessage).not.toContain("Assessed");
    expect(pass.bannerMessage).not.toContain("Assessed");
  });

  test("keeps poll state authoritative over cached score.state", () => {
    const result = project({
      poll: pollOf("terminal_pass"),
      lastLiveReport: liveReport({
        ...specification(() => "pass"),
        state: "passive_complete",
        terminal: false,
      }),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    expect(result.score.terminalState).toBe("terminal_pass");
    expect(result.bannerVerdict).toBe("pass");
  });

  test("live view stays running and does not expose public actions", () => {
    const result = project({
      poll: pollOf("passive_running"),
      view: viewOf("passive_running", "wait_probe"),
      lastLiveReport: liveReport(specification(() => "pass")),
    });
    expect(result.status).toBe("live");
    expect(result.visibility).toBe("session");
    expect(result.bannerVerdict).toBe("running");
    expect(result.showPublicActions).toBe(false);
    expect(result.showAreas).toBe(false);
    expect(VISIBILITY_NOTICE.session).toContain("Live session");
  });
});

describe("result area presentation helpers", () => {
  test("uses Pass, Needs attention, and Fail pills and keeps descriptions", () => {
    const result = project({
      lastLiveReport: liveReport(specification((id) => {
        if (id === "tls") return "warn";
        if (id === "sharing") return "fail";
        return "pass";
      }, "fail")),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    const areas = resultAreaEntries(result.score.areas);
    const byId = Object.fromEntries(areas.map((entry) => [entry.area, entry]));
    expect(byId.discovery?.pillLabel).toBe("Pass");
    expect(byId.tls?.pillLabel).toBe("Needs attention");
    expect(byId.sharing?.pillLabel).toBe("Fail");
    expect(byId.discovery?.description).toBe(AREA_DESCRIPTIONS.discovery);
    const totals = areaTotals(areas);
    expect(totals.passed).toBe(6);
    expect(totals.warn).toBe(1);
    expect(totals.failed).toBe(1);
    expect(totals.rest).toBe(0);
  });

  test("result cards carry the primary reason code derived from evidence", () => {
    const result = project({
      lastLiveReport: liveReport(
        specification((id) => (id === "tls" ? "warn" : "pass"), "warn"),
        {
          evidence: [
            {
              area: "tls",
              scoreArea: "tls",
              reasonCode: "jwks_unadvertised",
              grade: "warn",
              affectsGrade: true,
            },
            {
              area: "discovery",
              scoreArea: "discovery",
              reasonCode: "discovery_probed",
              grade: "pass",
            },
          ],
        },
      ),
      reportFailure: fail("http", "report is not public", {
        status: 404,
        error: "report_not_public",
      }),
    });
    const areas = resultAreaEntries(result.score.areas);
    const byId = Object.fromEntries(areas.map((entry) => [entry.area, entry]));
    expect(byId.tls?.reasonCode).toBe("jwks_unadvertised");
    expect(byId.discovery?.reasonCode).toBe("discovery_probed");
    expect(byId.jwks?.reasonCode).toBeUndefined();
  });

  test("reads specification from report.score when the nested path is absent", () => {
    const spec = specification(() => "pass");
    expect(specificationInputFromReport({
      schema: "federation_tester_report.v1",
      id: SESSION_ID,
      visibility: "session",
      score: spec,
    })).toEqual(spec);
  });

  test("bannerBody includes failModeLabel only when the score says to show it", () => {
    const result = project({
      poll: pollOf("terminal_fail", { failModeLabel: "peer closed" }),
      view: viewOf("terminal_fail"),
      terminalReport: permanentReport(specification(() => "fail", "fail")),
    });
    expect(bannerBody(result.score)).toContain("peer closed");
    expect(bannerBody(result.score)).not.toContain("Assessed");
    expect(result.score.showFailModeLabel).toBe(true);
  });
});

describe("not-saved evidence copy", () => {
  test("uses the explicit not-public evidence sentence", () => {
    expect(EVIDENCE_NOT_SAVED).toBe(
      "No saved evidence is available because this report was not public.",
    );
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
    return this.nodeType === TEXT_NODE ? this.nodeValue : this.childNodes.map((child) => child.textContent).join("");
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
  setAttribute(name: string, value: string): void { this.attrs.set(name, String(value)); }
  setAttributeNS(_ns: string, name: string, value: string): void { this.setAttribute(name, value); }
  getAttribute(name: string): string | null {
    return this.attrs.has(name) ? (this.attrs.get(name) ?? "") : null;
  }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  querySelectorAll(_selector: string): ShimNode[] { return []; }
  querySelector(_selector: string): ShimNode | null { return null; }
  closest(_selector: string): ShimNode | null { return null; }
  focus(): void { this.ownerDocument.activeElement = this; }
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
  doc.defaultView = win; globals.window = win; globals.document = doc; globals.IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof htmlHost.HTMLElement === "undefined") {
    htmlHost.HTMLElement = class HTMLElement {};
  }
  return {
    document: doc,
    restore: () => {
      if (owned.window) globals.window = prev.window; else delete globals.window;
      if (owned.document) globals.document = prev.document; else delete globals.document;
      if (owned.act) globals.IS_REACT_ACT_ENVIRONMENT = prev.act; else delete globals.IS_REACT_ACT_ENVIRONMENT;
      if (owned.html) htmlHost.HTMLElement = prev.html; else delete htmlHost.HTMLElement;
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

describe("ResultsShell session change reset", () => {
  test("drops session A cache, failure, and view when the session id changes", async () => {
    const sessionB = "0193b1d3-8d2e-7c5b-9f3f-2b3c4d5e6f70";
    const cacheMarker = "session_a_cache_marker";
    let deliveredRunningA = false;
    let lastAPoll: "running" | "terminal" = "running";
    let releaseB = (): void => {};
    let bReleased = false;
    const waitForB = new Promise<void>((resolve) => {
      releaseB = () => {
        bReleased = true;
        resolve();
      };
    });
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("config.json")) {
        return jsonResponse(200, {
          poll_interval_ms: 1,
          active_poll_interval_ms: 1,
          backoff_initial_ms: 1,
          backoff_max_ms: 1,
          request_timeout_ms: 5000,
        });
      }
      if (url.includes(`/api/session/${SESSION_ID}`)) {
        if (!deliveredRunningA) {
          deliveredRunningA = true;
          lastAPoll = "running";
          return jsonResponse(200, {
            state: "passive_running",
            ts: 1,
            optInActive: false,
            nextInstruction: "wait_probe",
          });
        }
        lastAPoll = "terminal";
        return jsonResponse(200, { state: "terminal_pass", ts: 2, optInActive: false });
      }
      if (url.includes(`/api/report/${SESSION_ID}`)) {
        if (lastAPoll === "running") {
          return jsonResponse(200, liveReport(specification(() => "pass"), {
            evidence: [{ area: "discovery", reasonCode: cacheMarker, grade: "pass" }],
          }));
        }
        return jsonResponse(404, { error: "report_not_public", message: "report is not public" });
      }
      if (url.includes(`/api/session/${sessionB}`)) {
        if (!bReleased) {
          await waitForB;
        }
        return jsonResponse(200, { state: "terminal_pass", ts: 3, optInActive: false });
      }
      if (url.includes(`/api/report/${sessionB}`)) {
        return jsonResponse(404, { error: "report_not_public", message: "report is not public" });
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
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);
      expect(container.textContent).toContain(SESSION_ID);
      expect(container.textContent).toContain(CACHED_SESSION_JSON_NOTE);
      expect(container.textContent).toContain(EVIDENCE_NOT_SAVED);
      expect(container.textContent).not.toContain("Continue or finish");

      const cachedTrigger = findByExactText(container, "button", "View raw report JSON");
      await act(() => {
        reactClick(cachedTrigger);
      });
      await waitForText(doc.body, cacheMarker);
      expect(doc.body.textContent).toContain(cacheMarker);
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(true);
      expect(doc.body.textContent).toContain("Last session JSON");

      await act(() => {
        root.render(<ResultsShell host="peer.example" id={sessionB} />);
      });
      expect(container.textContent).toContain(sessionB);
      expect(container.textContent).toContain("Scan in progress");
      expect(container.textContent).toContain("Loading session...");
      expect(container.textContent).not.toContain(RESULT_HEADLINE.compatible);
      expect(container.textContent).not.toContain(CACHED_SESSION_JSON_NOTE);
      expect(container.textContent).not.toContain(EVIDENCE_NOT_SAVED);
      expect(container.textContent).not.toContain(cacheMarker);
      expect(container.textContent).not.toContain("Continue or finish");
      expect(container.textContent).not.toContain("This scan was not saved");
      expect(container.textContent).not.toContain("Last session JSON");

      await act(() => {
        releaseB();
      });
      await waitForText(container, "This scan was not saved");
      expect(container.textContent).toContain(sessionB);
      expect(container.textContent).not.toContain(RESULT_HEADLINE.compatible);
      expect(container.textContent).not.toContain(CACHED_SESSION_JSON_NOTE);
      expect(container.textContent).not.toContain(cacheMarker);
      expect(container.textContent).not.toContain("Last session JSON");
      expect(container.textContent).not.toContain(EVIDENCE_NOT_SAVED);
      await act(() => { root.unmount(); });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });

  test("resets raw JSON overlay when the session id changes to a ready permanent report", async () => {
    const sessionB = "0193b1d3-8d2e-7c5b-9f3f-2b3c4d5e6f70";
    const cacheMarker = "session_a_cache_marker";
    let deliveredRunningA = false;
    let lastAPoll: "running" | "terminal" = "running";
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("config.json")) {
        return jsonResponse(200, {
          poll_interval_ms: 1,
          active_poll_interval_ms: 1,
          backoff_initial_ms: 1,
          backoff_max_ms: 1,
          request_timeout_ms: 5000,
          validator_api_origin: API_ORIGIN,
        });
      }
      if (url.includes(`/api/session/${SESSION_ID}`)) {
        if (!deliveredRunningA) {
          deliveredRunningA = true;
          lastAPoll = "running";
          return jsonResponse(200, {
            state: "passive_running",
            ts: 1,
            optInActive: false,
            nextInstruction: "wait_probe",
          });
        }
        lastAPoll = "terminal";
        return jsonResponse(200, { state: "terminal_pass", ts: 2, optInActive: false });
      }
      if (url.includes(`/api/report/${SESSION_ID}`)) {
        if (lastAPoll === "running") {
          return jsonResponse(200, liveReport(specification(() => "pass"), {
            evidence: [{ area: "discovery", reasonCode: cacheMarker, grade: "pass" }],
          }));
        }
        return jsonResponse(404, { error: "report_not_public", message: "report is not public" });
      }
      if (url.includes(`/api/session/${sessionB}`)) {
        return jsonResponse(200, { state: "terminal_pass", ts: 3, optInActive: false });
      }
      if (url.includes(`/api/report/${sessionB}`)) {
        return jsonResponse(200, permanentReport(specification(() => "pass")));
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
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);
      expect(container.textContent).toContain(CACHED_SESSION_JSON_NOTE);
      expect(container.textContent).toContain(EVIDENCE_NOT_SAVED);

      const cachedTrigger = findByExactText(container, "button", "View raw report JSON");
      await act(() => {
        reactClick(cachedTrigger);
      });
      await waitForText(doc.body, cacheMarker);
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(true);

      await act(() => {
        root.render(<ResultsShell host="peer.example" id={sessionB} />);
      });
      expect(container.textContent).toContain(sessionB);
      await waitForText(container, RESULT_HEADLINE.compatible);
      await waitForText(container, VISIBILITY_NOTICE.permanent);
      expect(container.textContent).toContain("View raw report JSON");
      expect(container.textContent).not.toContain(CACHED_SESSION_JSON_NOTE);
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(false);
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 5);
        });
      });
      expect(container.textContent).toContain(RESULT_HEADLINE.compatible);
      expect(container.textContent).toContain("View raw report JSON");
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(false);
      await act(() => { root.unmount(); });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });

  test("closes the area detail modal when the session id changes to a ready permanent report", async () => {
    const sessionB = "0193b1d3-8d2e-7c5b-9f3f-2b3c4d5e6f70";
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("config.json")) {
        return jsonResponse(200, {
          poll_interval_ms: 1,
          active_poll_interval_ms: 1,
          backoff_initial_ms: 1,
          backoff_max_ms: 1,
          request_timeout_ms: 5000,
          validator_api_origin: API_ORIGIN,
        });
      }
      if (url.includes(`/api/session/${SESSION_ID}`)) {
        return jsonResponse(200, { state: "terminal_pass", ts: 1, optInActive: false });
      }
      if (url.includes(`/api/report/${SESSION_ID}`)) {
        return jsonResponse(200, permanentReport(specification(() => "pass")));
      }
      if (url.includes(`/api/session/${sessionB}`)) {
        return jsonResponse(200, { state: "terminal_pass", ts: 3, optInActive: false });
      }
      if (url.includes(`/api/report/${sessionB}`)) {
        // Session B is a ready permanent report with a real sourceReport and its
        // own assessed areas. The warn area gives it a distinct headline so the
        // test can wait for B's report to finish loading.
        return jsonResponse(
          200,
          permanentReport(specification((id) => (id === "tls" ? "warn" : "pass"), "warn")),
        );
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
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);

      const trigger = findByExactText(container, "button", "View details");
      expect(trigger.getAttribute("aria-label")).toBe("View details for Server discovery");
      await act(() => {
        reactClick(trigger);
      });
      await waitForText(doc.body, "Raw JSON");

      // Session A: the area modal is open on the discovery card.
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(true);
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-area-modal")),
      ).toBe(true);
      expect(nodesByRole(doc.body, "dialog").length).toBeGreaterThan(0);
      expect(
        nodesByRole(doc.body, "tablist").some(
          (node) => node.getAttribute("aria-label") === "Area details",
        ),
      ).toBe(true);
      expect(doc.body.textContent).toContain("Server discovery");

      await act(() => {
        root.render(<ResultsShell host="peer.example" id={sessionB} />);
      });
      expect(container.textContent).toContain(sessionB);
      // Wait for session B's distinct terminal report so its sourceReport is
      // loaded and the results grid is interactive again. If selectedArea were
      // not reset on the session change, the modal guard (sourceReport !== null
      // and status ready) would keep the AreaModal open here, which is what
      // makes this regression non-vacuous.
      await waitForText(container, RESULT_HEADLINE.compatibleWithWarnings);
      expect(viewDetailsAriaLabels(container).length).toBeGreaterThan(0);

      // Session B: the area modal is closed even though a valid sourceReport
      // exists, proving the session change reset selectedArea.
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(false);
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-area-modal")),
      ).toBe(false);
      expect(nodesByRole(doc.body, "dialog").length).toBe(0);
      expect(
        nodesByRole(doc.body, "tablist").some(
          (node) => node.getAttribute("aria-label") === "Area details",
        ),
      ).toBe(false);
      expect(doc.body.textContent).not.toContain("Raw JSON");
      await act(() => { root.unmount(); });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });
});

function walk(node: ShimNode, visit: (current: ShimNode) => void): void {
  visit(node);
  for (const child of node.childNodes) {
    walk(child, visit);
  }
}

function nodesByRole(root: ShimNode, role: string): ShimNode[] {
  const found: ShimNode[] = [];
  walk(root, (node) => {
    if (node.getAttribute("role") === role) {
      found.push(node);
    }
  });
  return found;
}

function nodesByTag(root: ShimNode, tagName: string): ShimNode[] {
  const upper = tagName.toUpperCase();
  const found: ShimNode[] = [];
  walk(root, (node) => {
    if (node.tagName === upper) {
      found.push(node);
    }
  });
  return found;
}

function findByExactText(root: ShimNode, tagName: string, text: string): ShimNode {
  const upper = tagName.toUpperCase();
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (found === null && node.tagName === upper && node.textContent === text) {
      found = node;
    }
  });
  if (found === null) {
    throw new Error(`missing <${tagName}> with text ${JSON.stringify(text)}`);
  }
  return found;
}

function reactClick(node: ShimNode): void {
  const key = Object.getOwnPropertyNames(node).find((name) => name.startsWith("__reactProps"));
  if (key !== undefined) {
    const props = (node as unknown as Record<string, { onClick?: (event: ShimEvent) => void }>)[key];
    if (typeof props.onClick === "function") {
      props.onClick(new ShimEvent("click"));
      return;
    }
  }
  node.dispatchEvent(new ShimEvent("click"));
}

function installTerminalReportFetch(report: ReportResponse): () => void {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("config.json")) {
      return jsonResponse(200, {
        poll_interval_ms: 1,
        active_poll_interval_ms: 1,
        backoff_initial_ms: 1,
        backoff_max_ms: 1,
        request_timeout_ms: 5000,
        validator_api_origin: API_ORIGIN,
      });
    }
    if (url.includes(`/api/session/${SESSION_ID}`)) {
      return jsonResponse(200, { state: "terminal_pass", ts: 1, optInActive: false });
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(200, report);
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

function installPermanentReportFetch(): () => void {
  return installTerminalReportFetch(permanentReport(specification(() => "pass")));
}

function installInterruptedReportFetch(): () => void {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("config.json")) {
      return jsonResponse(200, {
        poll_interval_ms: 1,
        active_poll_interval_ms: 1,
        backoff_initial_ms: 1,
        backoff_max_ms: 1,
        request_timeout_ms: 5000,
        validator_api_origin: API_ORIGIN,
      });
    }
    if (url.includes(`/api/session/${SESSION_ID}`)) {
      return jsonResponse(200, { state: "interrupted", ts: 1, optInActive: false });
    }
    if (url.includes(`/api/report/${SESSION_ID}`)) {
      return jsonResponse(200, permanentReport(specification(() => "pass", null)));
    }
    return jsonResponse(404, { error: "missing", message: "missing" });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

function installRejectedClipboard(): () => void {
  const writeText = (): Promise<void> => Promise.reject(new Error("clipboard rejected"));
  const navigatorHost = globalThis.navigator as { clipboard?: { writeText: (value: string) => Promise<void> } };
  const previous = navigatorHost.clipboard;
  navigatorHost.clipboard = { writeText };
  return () => {
    if (previous === undefined) {
      delete navigatorHost.clipboard;
    } else {
      navigatorHost.clipboard = previous;
    }
  };
}

describe("ResultsShell raw JSON disclosure and copy notice", () => {
  test("Raw JSON opens OverlayFrame inspector from the trigger", async () => {
    const envelopeMarker = "compatible_sf14_full_envelope_marker";
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification(() => "pass"), {
        envelopeMarker,
        retentionTier: envelopeMarker,
      } as unknown as Partial<ReportResponse>),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);
      expect(container.textContent).not.toContain(envelopeMarker);

      const trigger = findByExactText(container, "button", "View raw report JSON");
      expect(trigger.getAttribute("type")).toBe("button");
      await act(() => {
        reactClick(trigger);
      });
      await waitForText(doc.body, envelopeMarker);
      expect(doc.body.textContent).toContain(envelopeMarker);
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(true);
      expect(doc.body.textContent).toContain("Raw report JSON");
      expect(nodesByRole(doc.body, "dialog").length).toBeGreaterThan(0);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("malformed report opens the modal with the full envelope", async () => {
    const envelopeMarker = "malformed_sf14_full_envelope_marker";
    const restoreFetch = installTerminalReportFetch(
      liveReport({ grade: null }, {
        envelopeMarker,
        retentionTier: envelopeMarker,
      } as unknown as Partial<ReportResponse>),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.resultUnavailable);
      expect(container.textContent).not.toContain(envelopeMarker);

      const trigger = findByExactText(container, "button", "View raw report JSON");
      expect(trigger.getAttribute("type")).toBe("button");
      await act(() => {
        reactClick(trigger);
      });
      await waitForText(doc.body, envelopeMarker);
      expect(doc.body.textContent).toContain(envelopeMarker);
      expect(doc.body.textContent).toContain("Raw report JSON");
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(true);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("no-grid ready report opens the modal with the full envelope", async () => {
    const envelopeMarker = "nogrid_sf14_full_envelope_marker";
    const restoreFetch = installTerminalReportFetch(
      permanentReport(
        specification(() => null, null),
        {
          envelopeMarker,
          retentionTier: envelopeMarker,
        } as unknown as Partial<ReportResponse>,
      ),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.noCompatibilityResult);
      expect(container.textContent).not.toContain(envelopeMarker);

      const trigger = findByExactText(container, "button", "View raw report JSON");
      expect(trigger.getAttribute("type")).toBe("button");
      await act(() => {
        reactClick(trigger);
      });
      await waitForText(doc.body, envelopeMarker);
      expect(doc.body.textContent).toContain(envelopeMarker);
      expect(doc.body.textContent).toContain("Raw report JSON");
      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(true);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("copy rejection never announces success", async () => {
    const COPY_FAILURE =
      "Could not copy the report link. Open the report and copy its address instead.";
    const restoreFetch = installPermanentReportFetch();
    const restoreClipboard = installRejectedClipboard();
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, "Copy public report link");

      const copyButton = findByExactText(container, "button", "Copy public report link");
      await act(() => {
        reactClick(copyButton);
      });
      await waitForText(container, COPY_FAILURE);

      const alerts = nodesByRole(container, "alert");
      expect(alerts.some((node) => node.textContent === COPY_FAILURE)).toBe(true);
      const copySuccessNotices = nodesByRole(container, "status").filter((node) => {
        return node.tagName === "P" && node.textContent === "Copied";
      });
      expect(copySuccessNotices).toEqual([]);
      expect(alerts.some((node) => node.tagName === "P" && node.textContent === "Copied")).toBe(false);
      await act(() => { root.unmount(); });
    } finally {
      restoreClipboard();
      restoreFetch();
      restore();
    }
  });
});

describe("ResultsShell interrupted ready recovery", () => {
  test("ready interrupted results offer Run a new check without public actions", async () => {
    const restoreFetch = installInterruptedReportFetch();
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.scanInterrupted);
      expect(container.textContent).toContain("Run a new check");
      expect(container.textContent).not.toContain("This scan was not saved");
      expect(container.textContent).not.toContain("Open public report");
      expect(container.textContent).not.toContain("Copy public report link");
      const recovery = findByExactText(container, "a", "Run a new check");
      expect(recovery.getAttribute("href")).toBe("/validator/");
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });
});

describe("ResultsShell testHref", () => {
  test("defaults recovery links to TEST_HREF and honors a custom testHref", async () => {
    const customHref = "/ocm/validator/";
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));

      await act(() => {
        root.render(<ResultsShell />);
      });
      await waitForText(container, "Back to Test");
      const defaultBack = findByExactText(container, "a", "Back to Test");
      expect(defaultBack.getAttribute("href")).toBe(TEST_HREF);

      await act(() => {
        root.render(<ResultsShell testHref={customHref} />);
      });
      await waitForText(container, "Back to Test");
      const customBack = findByExactText(container, "a", "Back to Test");
      expect(customBack.getAttribute("href")).toBe(customHref);
      await act(() => { root.unmount(); });
    } finally {
      restore();
    }
  });

  test("uses a custom testHref on Run a new check", async () => {
    const customHref = "/ocm/validator/";
    const restoreFetch = installInterruptedReportFetch();
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(
          <ResultsShell host="peer.example" id={SESSION_ID} testHref={customHref} />,
        );
      });
      await waitForText(container, "Run a new check");
      const recovery = findByExactText(container, "a", "Run a new check");
      expect(recovery.getAttribute("href")).toBe(customHref);
      expect(recovery.getAttribute("href")).not.toBe(TEST_HREF);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });
});

function viewDetailsAriaLabels(root: ShimNode): string[] {
  return nodesByTag(root, "button")
    .map((node) => node.getAttribute("aria-label"))
    .filter((label): label is string => label !== null && label.startsWith("View details for"));
}

describe("ResultsShell area detail modal", () => {
  test("a ready results card opens the area detail modal", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification(() => "pass")),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);

      const trigger = findByExactText(container, "button", "View details");
      expect(trigger.getAttribute("aria-label")).toBe("View details for Server discovery");
      await act(() => {
        reactClick(trigger);
      });
      await waitForText(doc.body, "Raw JSON");

      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(true);
      expect(nodesByRole(doc.body, "dialog").length).toBeGreaterThan(0);
      expect(
        nodesByRole(doc.body, "tablist").some(
          (node) => node.getAttribute("aria-label") === "Area details",
        ),
      ).toBe(true);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("an assessed zero-evidence card opens the area detail modal", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification((id) => (id === "tls" ? "warn" : "pass"), "warn")),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatibleWithWarnings);

      const triggers = nodesByTag(container, "button").filter(
        (node) => node.getAttribute("aria-label") === "View details for Secure connection",
      );
      expect(triggers.length).toBe(1);
      const trigger = triggers[0];
      expect(trigger).not.toBeUndefined();
      await act(() => {
        reactClick(trigger as ShimNode);
      });
      await waitForText(doc.body, "Raw JSON");

      expect(
        nodesByTag(doc.body, "div").some((node) => node.hasAttribute("data-overlay-frame-root")),
      ).toBe(true);
      expect(
        nodesByRole(doc.body, "tablist").some(
          (node) => node.getAttribute("aria-label") === "Area details",
        ),
      ).toBe(true);
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("a truly empty unassessed card has no View details button", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification((id) => (id === "jwks" ? null : "pass"))),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);

      const labels = viewDetailsAriaLabels(container);
      expect(labels).toContain("View details for Server discovery");
      expect(labels).not.toContain("View details for Signing keys");
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("ready results use the interactive results grid, not statistics tiles", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification(() => "pass")),
    );
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForText(container, RESULT_HEADLINE.compatible);

      expect(
        nodesByTag(container, "article").some((node) => node.hasAttribute("data-area-card")),
      ).toBe(true);
      expect(viewDetailsAriaLabels(container).length).toBeGreaterThan(0);
      expect(container.textContent).not.toContain("areas assessed");
      expect(container.textContent).not.toContain("pass rate");
      await act(() => { root.unmount(); });
    } finally {
      restoreFetch();
      restore();
    }
  });
});

interface HappyDomRegistrator {
  register: (options?: { url?: string }) => void;
  unregister: () => void;
}

async function waitForDom(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for a DOM condition");
    }
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
      });
    });
  }
}

describe("ResultsShell area detail modal focus restoration", () => {
  let registrator: HappyDomRegistrator | null = null;

  beforeAll(async () => {
    const specifier: string = "@happy-dom/global-registrator";
    const mod = (await import(specifier)) as {
      GlobalRegistrator?: HappyDomRegistrator;
    };
    if (mod.GlobalRegistrator === undefined) {
      throw new Error(
        "ResultsShell.test.tsx focus tests need a DOM environment. Install the " +
          "dev-only harness with `bun add -d happy-dom @happy-dom/global-registrator`.",
      );
    }
    registrator = mod.GlobalRegistrator;
    registrator.register({ url: "http://localhost/" });
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterAll(() => {
    registrator?.unregister();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
  });

  test("Escape closes the area modal and restores focus to the trigger", async () => {
    const restoreFetch = installTerminalReportFetch(
      permanentReport(specification(() => "pass")),
    );
    try {
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(document.body);
      await act(() => {
        root.render(<ResultsShell host="peer.example" id={SESSION_ID} />);
      });
      await waitForDom(
        () => document.body.textContent?.includes(RESULT_HEADLINE.compatible) === true,
      );

      const trigger = document.querySelector<HTMLButtonElement>(
        'button[aria-label="View details for Server discovery"]',
      );
      if (trigger === null) {
        throw new Error("missing discovery View details button");
      }
      act(() => {
        trigger.focus();
      });
      expect(document.activeElement).toBe(trigger);

      await act(() => {
        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await waitForDom(() => document.querySelector("[data-overlay-frame-root]") !== null);
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      if (dialog === null) {
        throw new Error("missing dialog after opening the area modal");
      }
      expect(document.activeElement === trigger).toBe(false);

      await act(() => {
        dialog.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
      });
      await waitForDom(() => document.querySelector("[data-overlay-frame-root]") === null);

      expect(document.querySelector("[data-overlay-frame-root]")).toBeNull();
      expect(document.activeElement).toBe(trigger);
      await act(() => {
        root.unmount();
      });
    } finally {
      restoreFetch();
    }
  });
});
