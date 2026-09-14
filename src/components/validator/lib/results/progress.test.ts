import { describe, expect, test } from "bun:test";

import { resolveValidatorMachine, USER_STEPS } from "../stateMachine";
import { UNKNOWN_GUIDANCE_TITLE } from "../validatorGuidance";
import {
  progressAnnouncement,
  progressStatusText,
  STEP_ANNOUNCE,
  stripBracketedMarkers,
} from "./progress";

function activeViewOf(state: string, nextInstruction?: string) {
  return resolveValidatorMachine({ state, optInActive: true, nextInstruction });
}

describe("stripBracketedMarkers", () => {
  test("removes bracketed planning markers and collapses the surrounding whitespace", () => {
    expect(stripBracketedMarkers("Paste the outgoing invite [wip]")).toBe(
      "Paste the outgoing invite",
    );
    expect(stripBracketedMarkers("[todo] Wait for the reverse invite start")).toBe(
      "Wait for the reverse invite start",
    );
    expect(stripBracketedMarkers("Keep [one] and [two] out")).toBe("Keep and out");
  });

  test("leaves marker-free copy exactly as-is", () => {
    expect(stripBracketedMarkers("No markers here")).toBe("No markers here");
  });
});

describe("STEP_ANNOUNCE", () => {
  test("covers every user step with non-empty fallback copy", () => {
    expect(Object.keys(STEP_ANNOUNCE).sort()).toEqual([...USER_STEPS].sort());
    for (const step of USER_STEPS) {
      expect(STEP_ANNOUNCE[step].length).toBeGreaterThan(0);
    }
  });
});

describe("progressAnnouncement title selection", () => {
  test("uses the guidance title for a known current instruction, not its body", () => {
    const view = activeViewOf("invite_minted", "paste_s1");
    const text = progressAnnouncement(view, "paste_s1");
    expect(text).toBe("Step 3 of 6: Paste the outgoing invite");
    expect(text).not.toContain("Use Copy invitation");
  });

  test("falls back to STEP_ANNOUNCE when there is no guidance for an omitted key", () => {
    const view = resolveValidatorMachine({ state: "created", optInActive: false });
    const text = progressAnnouncement(view, null);
    expect(text).toBe("Step 1 of 3: Checking server capabilities.");
  });

  test("uses the unknown-key title for a persistent raw unknown key", () => {
    const view = activeViewOf("invite_minted", "paste_s1");
    const text = progressAnnouncement(view, "not_a_real_step");
    expect(text).toBe(`Step 3 of 6: ${UNKNOWN_GUIDANCE_TITLE}`);
  });

  test("falls back to STEP_ANNOUNCE when guidance is terminal rather than an instruction", () => {
    const view = activeViewOf("invite_minted", "paste_s1");
    const text = progressAnnouncement(view, "terminal_pass");
    expect(text).toBe("Step 3 of 6: Waiting for invitation steps.");
  });

  test("STEP_ANNOUNCE fallbacks stay unchanged after marker stripping", () => {
    for (const step of USER_STEPS) {
      expect(stripBracketedMarkers(STEP_ANNOUNCE[step])).toBe(STEP_ANNOUNCE[step]);
    }
  });
});

describe("progressStatusText", () => {
  test("announces live progress when a machine view is present", () => {
    const view = activeViewOf("invite_minted", "paste_s1");
    expect(progressStatusText("live", view, "paste_s1")).toBe(
      progressAnnouncement(view, "paste_s1"),
    );
  });

  test("announces loading-report progress with the same live derivation", () => {
    const view = activeViewOf("invite_minted", "paste_s1");
    expect(progressStatusText("loading_report", view, "paste_s1")).toBe(
      progressAnnouncement(view, "paste_s1"),
    );
  });

  test("uses the loading copy when live or loading_report has no view yet", () => {
    expect(progressStatusText("live", null, null)).toBe("Loading session...");
    expect(progressStatusText("loading_report", null, "paste_s1")).toBe(
      "Loading session...",
    );
  });

  test("returns null for terminal page statuses", () => {
    const view = activeViewOf("invite_minted", "paste_s1");
    expect(progressStatusText("ready", view, "paste_s1")).toBeNull();
    expect(progressStatusText("not_saved_empty", view, null)).toBeNull();
    expect(progressStatusText("malformed", null, null)).toBeNull();
    expect(progressStatusText("expired", null, null)).toBeNull();
    expect(progressStatusText("report_error", view, null)).toBeNull();
  });
});
