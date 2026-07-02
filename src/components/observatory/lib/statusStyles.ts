import type { CellStatus, DisplayStatus } from "./contracts";

export type { CellStatus };

// Subset of CellStatus shown in legends and rollup badges.
// Excludes vendor-out-of-scope and unknown (display-only states).
export const STATUS_OPTIONS: readonly CellStatus[] = [
  "passed",
  "failed",
  "infra-failed",
  "cleanup-failed",
  "down-failed",
  "vendor-unsupported",
  "test-implementation-pending",
  "not-run",
  "placeholder",
];

/** Map matrix-rules display_status to the matrix cell chip when no run result exists. */
export function displayStatusToCellStatus(displayStatus: DisplayStatus): CellStatus {
  switch (displayStatus) {
    case "supported":
      return "not-run";
    case "test-pending":
      return "test-implementation-pending";
    case "vendor-unsupported":
      return "vendor-unsupported";
    case "placeholder":
      return "placeholder";
    default:
      return "unknown";
  }
}

export interface StatusUi {
  label: string;
  dot: string;
  text: string;
  /**
   * Visual decoration applied to the borderless 28x28 chip.
   * May include "cell-cross-hatch" for vendor scoping signals,
   * ring/outline utilities for pending/unknown states.
   */
  decoration: string;
  glyph: string;
}

export function statusToUi(status: CellStatus): StatusUi {
  switch (status) {
    case "passed":
      return {
        label: "passed",
        dot: "bg-emerald-400",
        text: "text-emerald-200",
        decoration: "",
        glyph: "",
      };
    case "failed":
      return {
        label: "failed",
        dot: "bg-rose-400",
        text: "text-rose-200",
        decoration: "",
        glyph: "",
      };
    case "infra-failed":
      return {
        label: "infra-failed",
        dot: "bg-orange-400",
        text: "text-orange-200",
        decoration: "",
        glyph: "",
      };
    case "cleanup-failed":
      return {
        label: "cleanup-failed",
        dot: "bg-yellow-300",
        text: "text-yellow-100",
        decoration: "",
        glyph: "",
      };
    case "down-failed":
      return {
        label: "down-failed",
        dot: "bg-violet-400",
        text: "text-violet-200",
        decoration: "",
        glyph: "",
      };
    case "vendor-unsupported":
      return {
        label: "vendor-unsupported",
        dot: "bg-slate-600",
        text: "text-slate-300",
        decoration: "cell-cross-hatch ring-1 ring-slate-700/50",
        glyph: "",
      };
    case "test-implementation-pending":
      return {
        label: "test-implementation-pending",
        dot: "bg-amber-500/40",
        text: "text-amber-200",
        decoration: "outline outline-1 outline-dashed outline-amber-700/70",
        glyph: "",
      };
    case "vendor-out-of-scope":
      return {
        label: "vendor-out-of-scope",
        dot: "bg-zinc-700",
        text: "text-zinc-500",
        decoration: "cell-cross-hatch ring-1 ring-zinc-700/50",
        glyph: "",
      };
    case "placeholder":
      return {
        label: "placeholder",
        dot: "bg-zinc-700",
        text: "text-zinc-400",
        decoration: "",
        glyph: "",
      };
    case "not-run":
      return {
        label: "not-run",
        dot: "bg-zinc-500",
        text: "text-zinc-300",
        decoration: "outline outline-1 outline-dashed outline-zinc-700/70",
        glyph: "",
      };
    case "unknown":
      return {
        label: "unknown",
        dot: "bg-zinc-500",
        text: "text-zinc-300",
        decoration: "outline outline-1 outline-dotted outline-zinc-600/70",
        glyph: "[?]",
      };
    default:
      return {
        label: String(status || "unknown"),
        dot: "bg-zinc-500",
        text: "text-zinc-300",
        decoration: "outline outline-1 outline-dotted outline-zinc-600/70",
        glyph: "[?]",
      };
  }
}
