/**
 * Pure live-progress and status-text derivation for the results page.
 * Inputs to outputs only: no React, refs, or session state.
 */

import { USER_STEPS, type MachineView, type UserStep } from "../stateMachine";
import { guidanceFor } from "../validatorGuidance";

// Defensive strip for any bracketed planning marker (for example "[wip]")
// that should never reach a screen reader, even though locked copy has none.
const BRACKET_MARKER_PATTERN = /\[[^\]]*\]/g;

export function stripBracketedMarkers(value: string): string {
  return value.replace(BRACKET_MARKER_PATTERN, "").replace(/\s+/g, " ").trim();
}

export const STEP_ANNOUNCE: Record<UserStep, string> = {
  probe: "Checking server capabilities.",
  queue_or_rest: "Continuing or finishing the scan.",
  invite: "Waiting for invitation steps.",
  reverse: "Waiting for the return invitation.",
  share: "Testing sharing.",
  result: "Preparing the result.",
};

export function progressAnnouncement(
  view: MachineView,
  guidanceKey: string | null,
): string {
  let visible = 0;
  let current = 1;
  for (const step of USER_STEPS) {
    if (view.statuses[step] === "hidden") {
      continue;
    }
    visible += 1;
    if (step === view.step) {
      current = visible;
    }
  }
  const guidanceRecord = guidanceFor(guidanceKey);
  const guidanceTitle =
    guidanceRecord !== null && guidanceRecord.kind === "instruction"
      ? guidanceRecord.title
      : undefined;
  const shortTitle =
    guidanceTitle !== undefined && guidanceTitle !== "" ? guidanceTitle : STEP_ANNOUNCE[view.step];
  return `Step ${current} of ${visible}: ${stripBracketedMarkers(shortTitle)}`;
}

/**
 * Progress-relevant live/loading status copy. Terminal page statuses return
 * null. A null view is still loading the first machine snapshot.
 */
export function progressStatusText(
  status: string,
  view: MachineView | null,
  guidanceKey: string | null,
): string | null {
  if (status !== "live" && status !== "loading_report") {
    return null;
  }
  if (view === null) {
    return "Loading session...";
  }
  return progressAnnouncement(view, guidanceKey);
}
