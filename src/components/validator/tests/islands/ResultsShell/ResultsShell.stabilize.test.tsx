import { describe, expect, test } from "bun:test";

import {
  INITIAL_LIVE_INSTRUCTION_HOLD,
  stabilizeLiveView,
} from "@/components/validator/islands/ResultsShell";
import { resolveValidatorMachine } from "@/components/validator/lib/stateMachine";
import { UNKNOWN_GUIDANCE_TITLE, guidanceFor } from "@/components/validator/lib/validatorGuidance";

function activeViewOf(state: string, nextInstruction?: string): ReturnType<typeof resolveValidatorMachine> {
  return resolveValidatorMachine({ state, optInActive: true, nextInstruction });
}

describe("stabilizeLiveView one-poll hold", () => {
  test("a genuine instruction passes through as-is and becomes the new hold anchor", () => {
    const view = activeViewOf("invite_minted", "paste_s1");
    const { stabilized, hold } = stabilizeLiveView(view, "paste_s1", INITIAL_LIVE_INSTRUCTION_HOLD);
    expect(stabilized.view).toBe(view);
    expect(stabilized.guidanceKey).toBe("paste_s1");
    expect(hold).toEqual({ lastValidView: view, lastValidKey: "paste_s1", held: false });
  });

  test("the first omitted instruction after a genuine one holds the last valid view and key for one poll", () => {
    const validView = activeViewOf("invite_minted", "paste_s1");
    const seeded = stabilizeLiveView(validView, "paste_s1", INITIAL_LIVE_INSTRUCTION_HOLD).hold;
    const omittedView = activeViewOf("invite_minted");
    const { stabilized, hold } = stabilizeLiveView(omittedView, undefined, seeded);
    expect(stabilized.view).toBe(validView);
    expect(stabilized.guidanceKey).toBe("paste_s1");
    expect(hold.held).toBe(true);
    expect(hold.lastValidView).toBe(validView);
  });

  test("the first unknown instruction after a genuine one holds the same way", () => {
    const validView = activeViewOf("invite_minted", "paste_s1");
    const seeded = stabilizeLiveView(validView, "paste_s1", INITIAL_LIVE_INSTRUCTION_HOLD).hold;
    const unknownView = activeViewOf("invite_minted", "not_a_real_step");
    const { stabilized, hold } = stabilizeLiveView(unknownView, "not_a_real_step", seeded);
    expect(stabilized.view).toBe(validView);
    expect(stabilized.guidanceKey).toBe("paste_s1");
    expect(hold.held).toBe(true);
  });

  test("a following valid instruction after the hold replaces it normally instead of extending the hold", () => {
    const validView = activeViewOf("invite_minted", "paste_s1");
    const seeded = stabilizeLiveView(validView, "paste_s1", INITIAL_LIVE_INSTRUCTION_HOLD).hold;
    const held = stabilizeLiveView(activeViewOf("invite_minted"), undefined, seeded).hold;
    const nextValidView = activeViewOf("invite_accepted", "wait_reverse_start");
    const { stabilized, hold } = stabilizeLiveView(nextValidView, "wait_reverse_start", held);
    expect(stabilized.view).toBe(nextValidView);
    expect(stabilized.guidanceKey).toBe("wait_reverse_start");
    expect(hold).toEqual({
      lastValidView: nextValidView,
      lastValidKey: "wait_reverse_start",
      held: false,
    });
  });

  test("a persistent unknown string after the hold is spent shows the unknown-key fallback but keeps the last safe view and cadence", () => {
    const validView = activeViewOf("invite_minted", "paste_s1");
    const seeded = stabilizeLiveView(validView, "paste_s1", INITIAL_LIVE_INSTRUCTION_HOLD).hold;
    const unknownView = activeViewOf("invite_minted", "not_a_real_step");
    const heldOnce = stabilizeLiveView(unknownView, "not_a_real_step", seeded);
    expect(heldOnce.hold.held).toBe(true);
    const persistent = stabilizeLiveView(unknownView, "not_a_real_step", heldOnce.hold);
    expect(persistent.stabilized.view).toBe(validView);
    expect(persistent.stabilized.view.pollIntervalMs).toBe(validView.pollIntervalMs);
    expect(persistent.stabilized.guidanceKey).toBe("not_a_real_step");
    const unknownRecord = guidanceFor(persistent.stabilized.guidanceKey);
    expect(unknownRecord).not.toBeNull();
    if (unknownRecord === null || unknownRecord.kind !== "instruction") {
      throw new Error("expected the unknown-key fallback to be instruction guidance");
    }
    expect(unknownRecord.title).toBe(UNKNOWN_GUIDANCE_TITLE);
  });

  test("a persistent omitted instruction after the hold is spent has no guidance key left for STEP_ANNOUNCE to fall back on", () => {
    const validView = activeViewOf("invite_minted", "paste_s1");
    const seeded = stabilizeLiveView(validView, "paste_s1", INITIAL_LIVE_INSTRUCTION_HOLD).hold;
    const omittedView = activeViewOf("invite_minted");
    const heldOnce = stabilizeLiveView(omittedView, undefined, seeded);
    const persistent = stabilizeLiveView(omittedView, undefined, heldOnce.hold);
    expect(persistent.stabilized.view).toBe(validView);
    expect(persistent.stabilized.guidanceKey).toBeNull();
  });

  test("a terminal poll always wins immediately, even mid-hold, and clears the hold state", () => {
    const validView = activeViewOf("invite_minted", "paste_s1");
    const seeded = stabilizeLiveView(validView, "paste_s1", INITIAL_LIVE_INSTRUCTION_HOLD).hold;
    const heldOnce = stabilizeLiveView(activeViewOf("invite_minted"), undefined, seeded).hold;
    const terminalView = resolveValidatorMachine({ state: "terminal_pass", optInActive: true });
    const { stabilized, hold } = stabilizeLiveView(terminalView, undefined, heldOnce);
    expect(stabilized.view).toBe(terminalView);
    expect(stabilized.guidanceKey).toBeNull();
    expect(hold).toEqual(INITIAL_LIVE_INSTRUCTION_HOLD);
  });

  test("an omitted or unknown instruction with no prior valid instruction cannot hold and is exposed as-is", () => {
    const view = resolveValidatorMachine({ state: "created", optInActive: false });
    const { stabilized, hold } = stabilizeLiveView(view, undefined, INITIAL_LIVE_INSTRUCTION_HOLD);
    expect(stabilized.view).toBe(view);
    expect(stabilized.guidanceKey).toBeNull();
    expect(hold).toBe(INITIAL_LIVE_INSTRUCTION_HOLD);
  });

  test("keeps the raw unknown key separate from the machine view's narrowed null instruction", () => {
    const view = activeViewOf("invite_minted", "not_a_real_step");
    expect(view.instruction).toBeNull();
    const { stabilized } = stabilizeLiveView(view, "not_a_real_step", INITIAL_LIVE_INSTRUCTION_HOLD);
    expect(stabilized.guidanceKey).toBe("not_a_real_step");
    expect(stabilized.guidanceKey).not.toBe(view.instruction);
  });
});
