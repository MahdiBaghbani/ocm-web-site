/**
 * Overall scan verdict. pass/fail/warn plus in-progress and interrupted.
 */
import React from "react";
import { statusToUi } from "../../observatory/lib/statusStyles";
import Pill, { type GradeKind } from "./Pill";

export const VERDICT_KINDS = [
  "pass",
  "fail",
  "warn",
  "running",
  "interrupted",
] as const;

export type VerdictKind = (typeof VERDICT_KINDS)[number];

export interface VerdictBannerProps {
  verdict: VerdictKind;
  title?: string;
  message?: string;
}

const KIND_TO_STATUS = {
  pass: "passed",
  fail: "failed",
  warn: "infra-failed",
  running: "not-run",
  interrupted: "not-run",
} as const;

const TINT: Record<VerdictKind, string> = {
  pass: "border-emerald-900/50 bg-emerald-950/30",
  fail: "border-rose-900/50 bg-rose-950/30",
  warn: "border-amber-900/50 bg-amber-950/30",
  running: "border-zinc-800 bg-zinc-900/20",
  interrupted: "border-zinc-800 bg-zinc-900/20",
};

const GLYPH: Record<VerdictKind, string> = {
  pass: "v",
  fail: "x",
  warn: "!",
  running: "i",
  interrupted: "i",
};

const DEFAULT_TITLE: Record<VerdictKind, string> = {
  pass: "Pass",
  fail: "Fail",
  warn: "Warn",
  running: "Scan in progress",
  interrupted: "Interrupted",
};

const PILL_KIND = {
  pass: "pass",
  fail: "fail",
  warn: "warn",
  running: "pending",
  interrupted: "notrun",
} as const;

/** Map a report score grade and terminal flag to a banner kind. */
export function verdictKindFromScore(input: {
  grade: GradeKind | null;
  terminal: boolean;
}): VerdictKind {
  if (input.grade === "pass" || input.grade === "fail" || input.grade === "warn") {
    return input.grade;
  }
  return input.terminal ? "interrupted" : "running";
}

export default function VerdictBanner({
  verdict,
  title,
  message,
}: VerdictBannerProps): React.ReactElement {
  const ui = statusToUi(KIND_TO_STATUS[verdict]);
  const text = verdict === "warn" ? "text-amber-200" : ui.text;
  const heading = title ?? DEFAULT_TITLE[verdict];

  return (
    <div
      className={`rounded-2xl border p-5 ${TINT[verdict]}`}
      role={verdict === "fail" ? "alert" : "status"}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span
            className={`mt-0.5 w-3 shrink-0 font-mono text-sm ${text}`}
            aria-hidden="true"
          >
            {GLYPH[verdict]}
          </span>
          <div className="min-w-0">
            <div className={`text-sm font-semibold ${text}`}>{heading}</div>
            {message !== undefined && message !== "" ? (
              <p className="mt-1 text-sm text-zinc-300">{message}</p>
            ) : null}
          </div>
        </div>
        <span
          className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${ui.dot}`}
          aria-hidden="true"
        />
      </div>
      <div className="mt-3">
        <Pill kind={PILL_KIND[verdict]} />
      </div>
    </div>
  );
}
