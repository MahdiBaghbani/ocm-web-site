/**
 * Small status/label chip. Generic validator kinds; colors from observatory
 * statusToUi without exposing matrix CellStatus on the public props.
 */
import React from "react";
import { statusToUi } from "../../observatory/lib/statusStyles";

export const PILL_KINDS = [
  "pass",
  "fail",
  "warn",
  "pending",
  "info",
  "unassessed",
  "notrun",
] as const;

export type PillKind = (typeof PILL_KINDS)[number];

export const GRADE_KINDS = ["pass", "fail", "warn"] as const;
export type GradeKind = (typeof GRADE_KINDS)[number];

const KIND_TO_STATUS = {
  pass: "passed",
  fail: "failed",
  warn: "infra-failed",
  pending: "test-implementation-pending",
  info: "unknown",
  unassessed: "not-run",
  notrun: "not-run",
} as const;

const DEFAULT_LABEL: Record<PillKind, string> = {
  pass: "pass",
  fail: "fail",
  warn: "warn",
  pending: "pending",
  info: "info",
  unassessed: "unassessed",
  notrun: "not-run",
};

export interface PillProps {
  kind: PillKind;
  label?: string;
}

export default function Pill({ kind, label }: PillProps): React.ReactElement {
  const ui = statusToUi(KIND_TO_STATUS[kind]);
  // Warn keeps the orange pill dot; grade copy uses amber text.
  const text = kind === "warn" ? "text-amber-200" : ui.text;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/40 px-2.5 py-0.5 text-xs ${text}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${ui.dot}`} aria-hidden="true" />
      {label ?? DEFAULT_LABEL[kind]}
    </span>
  );
}
