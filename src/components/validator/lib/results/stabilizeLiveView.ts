/**
 * Pure one-poll live-view stabilizer for the results page.
 * Inputs to outputs only: no React, refs, or session state.
 */

import type { MachineView, NextInstruction } from "../stateMachine";

/**
 * One-poll hold for a nonterminal instruction that comes back omitted or
 * unknown. `lastValidKey` and `lastValidView` retain the last genuine
 * instruction so the row list and cadence do not flicker back to "probe" for
 * a single bad poll; `held` marks that the one-poll grace period was already
 * spent so a persistent unknown state falls back to the unknown-key title
 * instead of holding forever.
 */
export interface LiveInstructionHold {
  lastValidView: MachineView | null;
  lastValidKey: NextInstruction | null;
  held: boolean;
}

export const INITIAL_LIVE_INSTRUCTION_HOLD: LiveInstructionHold = {
  lastValidView: null,
  lastValidKey: null,
  held: false,
};

export interface StabilizedLiveView {
  view: MachineView;
  /** Raw guidance lookup key: a known/unknown instruction string, or null. */
  guidanceKey: string | null;
}

function rawInstructionKey(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Stabilize one poll's resolved view against the previous hold state. A
 * terminal poll always wins immediately. A genuine instruction replaces the
 * hold normally. The first omitted/unknown instruction after a genuine one
 * holds the last valid view and instruction for one poll; a persistent
 * omitted/unknown instruction keeps that last safe view (and its cadence)
 * but exposes the current raw key so the caller can fall back to the
 * unknown-key guidance instead of the stale title.
 */
export function stabilizeLiveView(
  view: MachineView,
  rawInstruction: string | null | undefined,
  hold: LiveInstructionHold,
): { stabilized: StabilizedLiveView; hold: LiveInstructionHold } {
  const raw = rawInstructionKey(rawInstruction);

  if (view.terminalize) {
    return {
      stabilized: { view, guidanceKey: null },
      hold: INITIAL_LIVE_INSTRUCTION_HOLD,
    };
  }

  if (view.instruction !== null) {
    return {
      stabilized: { view, guidanceKey: view.instruction },
      hold: { lastValidView: view, lastValidKey: view.instruction, held: false },
    };
  }

  if (hold.lastValidView === null) {
    return { stabilized: { view, guidanceKey: raw }, hold };
  }

  if (!hold.held) {
    return {
      stabilized: { view: hold.lastValidView, guidanceKey: hold.lastValidKey },
      hold: { ...hold, held: true },
    };
  }

  return {
    stabilized: { view: hold.lastValidView, guidanceKey: raw },
    hold,
  };
}
