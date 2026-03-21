// Overlay open/close uses pushState so the browser back button dismisses the modal.
// Tab, mitm, stack, and expanded mutations use replaceState because they are
// in-modal chrome changes, not navigation history entries.
import type { EvidenceTab } from "./contracts";

export interface OverlayClosed {
  kind: "closed";
}

export interface OverlayRun {
  kind: "run";
  runId: string;
  cellId: string;
}

export type OverlayState = OverlayClosed | OverlayRun;

export function parseOverlayFromUrl(url: string | URL): OverlayState {
  const u =
    typeof url === "string"
      ? new URL(url, typeof window === "undefined" ? "http://localhost" : window.location.origin)
      : url;
  const cell = u.searchParams.get("cell") ?? "";
  const run = u.searchParams.get("run") ?? "";
  if (run) return { kind: "run", runId: run, cellId: cell || "" };
  // Legacy ?cell=-only URLs map to run overlay with no runId yet.
  if (cell) return { kind: "run", runId: "", cellId: cell };
  return { kind: "closed" };
}

export function setOverlayInUrl(overlay: OverlayState): void {
  const u = new URL(window.location.href);
  u.searchParams.delete("cell");
  u.searchParams.delete("run");

  if (overlay.kind === "run") {
    if (overlay.cellId) u.searchParams.set("cell", overlay.cellId);
    if (overlay.runId) u.searchParams.set("run", overlay.runId);
  } else {
    // Overlay closed: scrub modal-internal params so they cannot leak into the next open.
    u.searchParams.delete("tab");
    u.searchParams.delete("mitm");
    u.searchParams.delete("stack");
  }

  const next = `${u.pathname}?${u.searchParams.toString()}${u.hash}`;
  const clean = next.replace(/\?$/, "");
  window.history.pushState({}, "", clean);
}

export function parseExpandedFromUrl(url: string | URL): string[] | null {
  const u =
    typeof url === "string"
      ? new URL(url, typeof window === "undefined" ? "http://localhost" : window.location.origin)
      : url;
  const param = u.searchParams.get("expanded");
  if (param === null) return null;
  return param.split(",").filter((s) => s.length > 0);
}

export function setExpandedInUrl(value: string[] | null): void {
  const u = new URL(window.location.href);
  if (value === null) {
    u.searchParams.delete("expanded");
  } else {
    u.searchParams.set("expanded", value.join(","));
  }
  const next = `${u.pathname}?${u.searchParams.toString()}${u.hash}`;
  const clean = next.replace(/\?$/, "");
  window.history.replaceState({}, "", clean);
}

const VALID_TABS: readonly EvidenceTab[] = [
  "overview",
  "screenshots",
  "mitm",
  "logs",
  "meta",
  "stack",
];

export function parseTabFromUrl(url: string | URL): EvidenceTab | null {
  if (typeof window === "undefined") return null;
  const u =
    typeof url === "string" ? new URL(url, window.location.origin) : url;
  const tab = u.searchParams.get("tab");
  if (!tab) return null;
  return (VALID_TABS as string[]).includes(tab) ? (tab as EvidenceTab) : null;
}

export function setTabInUrl(value: EvidenceTab | null): void {
  if (typeof window === "undefined") return;
  const u = new URL(window.location.href);
  if (value === null) {
    u.searchParams.delete("tab");
  } else {
    u.searchParams.set("tab", value);
  }
  const next = `${u.pathname}?${u.searchParams.toString()}${u.hash}`;
  const clean = next.replace(/\?$/, "");
  window.history.replaceState({}, "", clean);
}

export type MitmSubTab = "traffic" | "files";
const VALID_MITM_SUBTABS: readonly MitmSubTab[] = ["traffic", "files"];

export function parseMitmFromUrl(url: string | URL): MitmSubTab | null {
  if (typeof window === "undefined") return null;
  const u =
    typeof url === "string" ? new URL(url, window.location.origin) : url;
  const param = u.searchParams.get("mitm");
  if (!param) return null;
  return (VALID_MITM_SUBTABS as string[]).includes(param)
    ? (param as MitmSubTab)
    : null;
}

export function setMitmInUrl(value: MitmSubTab | null): void {
  if (typeof window === "undefined") return;
  const u = new URL(window.location.href);
  if (value === null) {
    u.searchParams.delete("mitm");
  } else {
    u.searchParams.set("mitm", value);
  }
  const next = `${u.pathname}?${u.searchParams.toString()}${u.hash}`;
  const clean = next.replace(/\?$/, "");
  window.history.replaceState({}, "", clean);
}

export type StackSubTab = "summary" | "files";
const VALID_STACK_SUBTABS: readonly StackSubTab[] = ["summary", "files"];

export function parseStackFromUrl(url: string | URL): StackSubTab | null {
  if (typeof window === "undefined") return null;
  const u =
    typeof url === "string" ? new URL(url, window.location.origin) : url;
  const param = u.searchParams.get("stack");
  if (!param) return null;
  return (VALID_STACK_SUBTABS as string[]).includes(param)
    ? (param as StackSubTab)
    : null;
}

export function setStackInUrl(value: StackSubTab | null): void {
  if (typeof window === "undefined") return;
  const u = new URL(window.location.href);
  if (value === null) {
    u.searchParams.delete("stack");
  } else {
    u.searchParams.set("stack", value);
  }
  const next = `${u.pathname}?${u.searchParams.toString()}${u.hash}`;
  const clean = next.replace(/\?$/, "");
  window.history.replaceState({}, "", clean);
}
