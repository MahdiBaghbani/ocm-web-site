/**
 * Pure verdict and grade definitions shared by lib projections and atoms.
 * Inputs to outputs only: no React, hooks, refs, or session state. This module
 * is the single home for these definitions so lib code never imports from
 * atoms/islands and the banner and projection cannot diverge.
 */

export const GRADE_KINDS = ["pass", "fail", "warn"] as const;
export type GradeKind = (typeof GRADE_KINDS)[number];

export const VERDICT_KINDS = [
  "pass",
  "fail",
  "warn",
  "running",
  "interrupted",
  "inconclusive",
] as const;

export type VerdictKind = (typeof VERDICT_KINDS)[number];

/**
 * Map a validated grade plus poll/session state to a banner kind.
 * Interrupted and terminal_fail are keyed from state. Coverage is not inferred.
 */
export function verdictKindFromScore(input: {
  grade: GradeKind | null;
  state: string;
}): VerdictKind {
  if (input.state === "interrupted") {
    return "interrupted";
  }
  if (input.state === "terminal_fail") {
    return "fail";
  }
  if (input.grade === "fail") {
    return "fail";
  }
  if (input.grade === "warn") {
    return "warn";
  }
  if (input.grade === "pass") {
    return "pass";
  }
  if (input.state === "terminal_pass") {
    return "inconclusive";
  }
  return "running";
}
