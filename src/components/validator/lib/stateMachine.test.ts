import { describe, expect, test } from "bun:test";

import { DEFAULT_VALIDATOR_CONFIG, parseValidatorConfig } from "./validatorConfig";
import {
  CTA_INSTRUCTIONS,
  NEXT_INSTRUCTIONS,
  OPT_IN_MANIFEST_PATH,
  SESSION_STATES,
  TERMINAL_STATES,
  USER_STEP_LABELS,
  USER_STEPS,
  instructionForSession,
  isCta,
  isTerminalState,
  resolveValidatorMachine,
  type CtaInstruction,
  type NextInstruction,
  type SessionState,
} from "./stateMachine";

const STATE_INSTRUCTION: Record<SessionState, NextInstruction | null> = {
  created: "wait_probe",
  passive_running: "wait_probe",
  passive_complete: "stop",
  active_running: "wait_invite_mint",
  invite_minted: "paste_s1",
  invite_accepted: "wait_reverse_start",
  reverse_awaiting_invite: "paste_s2",
  reverse_invite_accepted: "wait_forward_share",
  forward_share_sent: "open_forward_file",
  capability_exercise: "wait_oq2_open",
  reverse_awaiting_share: "wait_reverse_share_or_timeout",
  terminal_pass: null,
  terminal_fail: null,
  interrupted: null,
};

describe("stateMachine contract tables", () => {
  test("manifest opt-in path is the form gate, not poll state", () => {
    expect(OPT_IN_MANIFEST_PATH).toBe("optIn.start.optInActive");
  });

  test("uses plain-language progress labels without changing step ids", () => {
    expect(USER_STEPS).toEqual([
      "probe",
      "queue_or_rest",
      "invite",
      "reverse",
      "share",
      "result",
    ]);
    expect(USER_STEP_LABELS).toEqual({
      probe: "Check server",
      queue_or_rest: "Check capabilities",
      invite: "Invite",
      reverse: "Reverse",
      share: "Share",
      result: "Prepare result",
    });
  });

  test("maps every documented session state", () => {
    for (const state of SESSION_STATES) {
      const optOut = instructionForSession({ state, optInActive: false });
      if (state === "passive_complete") {
        expect(optOut).toBe("stop");
        expect(
          instructionForSession({ state, optInActive: true }),
        ).toBeNull();
        continue;
      }
      expect(optOut).toBe(STATE_INSTRUCTION[state]);
    }
  });

  test("ready active opt-in waiter publishes wait_active_slot", () => {
    expect(
      instructionForSession({
        state: "passive_running",
        optInActive: true,
        isReadyOptInWaiter: true,
      }),
    ).toBe("wait_active_slot");
    expect(
      instructionForSession({
        state: "passive_running",
        optInActive: false,
        isReadyOptInWaiter: true,
      }),
    ).toBe("wait_probe");
  });
});

describe("resolveValidatorMachine instructions", () => {
  test("covers every server nextInstruction", () => {
    const cases: Array<{
      instruction: NextInstruction;
      state: SessionState;
      step: (typeof USER_STEPS)[number];
      cta: CtaInstruction | null;
      poll: number;
      continuePolling: boolean;
      shouldPostStop: boolean;
    }> = [
      {
        instruction: "wait_probe",
        state: "passive_running",
        step: "probe",
        cta: null,
        poll: DEFAULT_VALIDATOR_CONFIG.pollIntervalMs,
        continuePolling: true,
        shouldPostStop: false,
      },
      {
        instruction: "stop",
        state: "passive_complete",
        step: "queue_or_rest",
        cta: "stop",
        poll: DEFAULT_VALIDATOR_CONFIG.pollIntervalMs,
        continuePolling: false,
        shouldPostStop: true,
      },
      {
        instruction: "wait_active_slot",
        state: "passive_running",
        step: "queue_or_rest",
        cta: null,
        poll: DEFAULT_VALIDATOR_CONFIG.activePollIntervalMs,
        continuePolling: true,
        shouldPostStop: false,
      },
      {
        instruction: "wait_invite_mint",
        state: "active_running",
        step: "invite",
        cta: null,
        poll: DEFAULT_VALIDATOR_CONFIG.activePollIntervalMs,
        continuePolling: true,
        shouldPostStop: false,
      },
      {
        instruction: "paste_s1",
        state: "invite_minted",
        step: "invite",
        cta: "paste_s1",
        poll: DEFAULT_VALIDATOR_CONFIG.activePollIntervalMs,
        continuePolling: true,
        shouldPostStop: false,
      },
      {
        instruction: "wait_reverse_start",
        state: "invite_accepted",
        step: "invite",
        cta: null,
        poll: DEFAULT_VALIDATOR_CONFIG.activePollIntervalMs,
        continuePolling: true,
        shouldPostStop: false,
      },
      {
        instruction: "paste_s2",
        state: "reverse_awaiting_invite",
        step: "reverse",
        cta: "paste_s2",
        poll: DEFAULT_VALIDATOR_CONFIG.activePollIntervalMs,
        continuePolling: true,
        shouldPostStop: false,
      },
      {
        instruction: "wait_forward_share",
        state: "reverse_invite_accepted",
        step: "reverse",
        cta: null,
        poll: DEFAULT_VALIDATOR_CONFIG.activePollIntervalMs,
        continuePolling: true,
        shouldPostStop: false,
      },
      {
        instruction: "open_forward_file",
        state: "forward_share_sent",
        step: "share",
        cta: "open_forward_file",
        poll: DEFAULT_VALIDATOR_CONFIG.activePollIntervalMs,
        continuePolling: true,
        shouldPostStop: false,
      },
      {
        instruction: "wait_oq2_open",
        state: "capability_exercise",
        step: "share",
        cta: null,
        poll: DEFAULT_VALIDATOR_CONFIG.activePollIntervalMs,
        continuePolling: true,
        shouldPostStop: false,
      },
      {
        instruction: "wait_reverse_share_or_timeout",
        state: "reverse_awaiting_share",
        step: "share",
        cta: null,
        poll: DEFAULT_VALIDATOR_CONFIG.activePollIntervalMs,
        continuePolling: true,
        shouldPostStop: false,
      },
    ];

    expect(cases.map((item) => item.instruction).sort()).toEqual(
      [...NEXT_INSTRUCTIONS].sort(),
    );

    for (const item of cases) {
      const view = resolveValidatorMachine({
        state: item.state,
        nextInstruction: item.instruction,
        optInActive: item.instruction !== "wait_probe" && item.instruction !== "stop",
      });
      expect(view.instruction).toBe(item.instruction);
      expect(view.step).toBe(item.step);
      expect(view.cta).toBe(item.cta);
      expect(view.pollIntervalMs).toBe(item.poll);
      expect(view.continuePolling).toBe(item.continuePolling);
      expect(view.shouldPostStop).toBe(item.shouldPostStop);
      expect(view.terminalize).toBe(false);
      expect(view.statuses[item.step]).toBe("current");
    }
  });

  test("terminal states have no nextInstruction and stop polling", () => {
    for (const state of TERMINAL_STATES) {
      const view = resolveValidatorMachine({
        state,
        optInActive: false,
      });
      expect(isTerminalState(state)).toBe(true);
      expect(view.instruction).toBeNull();
      expect(view.step).toBe("result");
      expect(view.continuePolling).toBe(false);
      expect(view.terminalize).toBe(true);
      expect(view.shouldPostStop).toBe(false);
      expect(view.pollIntervalMs).toBe(0);
      expect(view.statuses.result).toBe("current");
      expect(view.statuses.probe).toBe("complete");
      expect(view.statuses.invite).toBe("hidden");
    }
  });

  test("stale wait instructions cannot revive a terminal session", () => {
    for (const state of TERMINAL_STATES) {
      const view = resolveValidatorMachine({
        state,
        nextInstruction: "wait_probe",
        optInActive: true,
      });
      expect(view.step).toBe("result");
      expect(view.instruction).toBeNull();
      expect(view.cta).toBeNull();
      expect(view.continuePolling).toBe(false);
      expect(view.shouldPostStop).toBe(false);
      expect(view.terminalize).toBe(true);
      expect(view.pollIntervalMs).toBe(0);
      expect(view.statuses.result).toBe("current");
      expect(view.statuses.invite).not.toBe("current");
      expect(USER_STEPS.some((step) => step !== "result" && view.statuses[step] === "current")).toBe(false);
    }
  });

  test("optInActive hides or reveals the active branch", () => {
    const passive = resolveValidatorMachine({
      state: "passive_running",
      nextInstruction: "wait_probe",
      optInActive: false,
    });
    expect(passive.showActiveSteps).toBe(false);
    expect(passive.statuses.invite).toBe("hidden");
    expect(passive.statuses.reverse).toBe("hidden");
    expect(passive.statuses.share).toBe("hidden");
    expect(passive.statuses.queue_or_rest).toBe("pending");

    const active = resolveValidatorMachine({
      state: "invite_minted",
      nextInstruction: "paste_s1",
      optInActive: true,
    });
    expect(active.showActiveSteps).toBe(true);
    expect(active.statuses.probe).toBe("complete");
    expect(active.statuses.queue_or_rest).toBe("complete");
    expect(active.statuses.invite).toBe("current");
    expect(active.statuses.reverse).toBe("pending");
    expect(active.statuses.share).toBe("pending");
    expect(active.statuses.result).toBe("pending");
  });

  test("unknown instructions do not keep polling or terminalize", () => {
    const view = resolveValidatorMachine({
      state: "passive_running",
      nextInstruction: "not_a_real_instruction",
      optInActive: false,
    });
    expect(view.instruction).toBeNull();
    expect(view.continuePolling).toBe(false);
    expect(view.terminalize).toBe(false);
    expect(view.shouldPostStop).toBe(false);
    expect(view.step).toBe("probe");
  });

  test("runtime config overlays replace default poll cadence", () => {
    const overlay = parseValidatorConfig({
      poll_interval_ms: 1500,
      active_poll_interval_ms: 2500,
    });
    expect(
      resolveValidatorMachine(
        {
          state: "passive_running",
          nextInstruction: "wait_probe",
          optInActive: false,
        },
        overlay,
      ).pollIntervalMs,
    ).toBe(1500);
    expect(
      resolveValidatorMachine(
        {
          state: "invite_minted",
          nextInstruction: "paste_s1",
          optInActive: true,
        },
        overlay,
      ).pollIntervalMs,
    ).toBe(2500);
    expect(overlay.pollIntervalMs).not.toBe(DEFAULT_VALIDATOR_CONFIG.pollIntervalMs);
  });

  test("CTA set matches the documented paste and stop keys", () => {
    expect([...CTA_INSTRUCTIONS]).toEqual([
      "paste_s1",
      "paste_s2",
      "open_forward_file",
      "stop",
    ]);
    expect(isCta("paste_s1")).toBe(true);
    expect(isCta("wait_probe")).toBe(false);
  });
});
