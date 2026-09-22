import { describe, expect, test } from "bun:test";

import {
  ACTION_ERROR_COPY,
  INSTRUCTION_KEYS,
  OPERATOR_ACTIONS,
  TERMINAL_KEYS,
  UNKNOWN_GUIDANCE_TITLE,
  VALIDATOR_GUIDANCE,
  actionErrorCopy,
  guidanceFor,
  type ActionErrorKind,
  type GuidanceKey,
  type GuidancePhase,
  type GuidanceRecord,
  type InstructionActivity,
  type InstructionKey,
  type InstructionMode,
  type OperatorAction,
  type TerminalKey,
} from "@/components/validator/lib/validatorGuidance";

describe("instruction key set", () => {
  test("defines exactly 11 instruction keys, each once", () => {
    expect(INSTRUCTION_KEYS).toHaveLength(11);
    expect(new Set(INSTRUCTION_KEYS).size).toBe(11);
    const expectedKeys: InstructionKey[] = [
      "open_forward_file",
      "paste_s1",
      "paste_s2",
      "stop",
      "wait_active_slot",
      "wait_forward_share",
      "wait_invite_mint",
      "wait_oq2_open",
      "wait_probe",
      "wait_reverse_share_or_timeout",
      "wait_reverse_start",
    ];
    expect([...INSTRUCTION_KEYS].sort()).toEqual(expectedKeys.sort());
  });

  test("each instruction key resolves to an instruction record", () => {
    for (const key of INSTRUCTION_KEYS) {
      const record = VALIDATOR_GUIDANCE[key];
      expect(record.kind).toBe("instruction");
      expect(record.key).toBe(key);
    }
  });
});

describe("terminal state set", () => {
  test("defines exactly 3 terminal states, each once", () => {
    expect(TERMINAL_KEYS).toHaveLength(3);
    expect(new Set(TERMINAL_KEYS).size).toBe(3);
    const expectedTerminalKeys: TerminalKey[] = [
      "interrupted",
      "terminal_fail",
      "terminal_pass",
    ];
    expect([...TERMINAL_KEYS].sort()).toEqual(expectedTerminalKeys.sort());
  });

  test("each terminal is kind terminal with report_if_permanent CTA", () => {
    for (const key of TERMINAL_KEYS) {
      const record = VALIDATOR_GUIDANCE[key];
      expect(record.kind).toBe("terminal");
      expect(record.phase).toBe("result");
      expect(record.cta).toBe("report_if_permanent");
    }
  });
});

describe("map completeness", () => {
  test("map has exactly the 11 instruction plus 3 terminal keys", () => {
    const keys = Object.keys(VALIDATOR_GUIDANCE);
    expect(keys).toHaveLength(14);
    expect(keys.sort()).toEqual(
      [...INSTRUCTION_KEYS, ...TERMINAL_KEYS].sort(),
    );
  });
});

describe("operator action classification", () => {
  test("the four operator actions are classified once each", () => {
    expect(OPERATOR_ACTIONS).toHaveLength(4);
    const expectedActions: OperatorAction[] = [
      "copy_invite",
      "open_file",
      "paste_reverse",
      "report_if_permanent",
    ];
    expect([...OPERATOR_ACTIONS].sort()).toEqual(expectedActions.sort());
  });

  test("named CTAs bind to the locked keys", () => {
    expect(VALIDATOR_GUIDANCE.paste_s1.cta).toBe("copy_invite");
    expect(VALIDATOR_GUIDANCE.paste_s2.cta).toBe("paste_reverse");
    expect(VALIDATOR_GUIDANCE.open_forward_file.cta).toBe("open_file");
    for (const key of TERMINAL_KEYS) {
      expect(VALIDATOR_GUIDANCE[key].cta).toBe("report_if_permanent");
    }
  });

  test("the action classification covers exactly four instruction keys", () => {
    const actionKeys = INSTRUCTION_KEYS.filter(
      (key) => VALIDATOR_GUIDANCE[key].activity === "action",
    );
    const expectedActionKeys: InstructionKey[] = [
      "open_forward_file",
      "paste_s1",
      "paste_s2",
      "wait_reverse_share_or_timeout",
    ];
    expect([...actionKeys].sort()).toEqual(expectedActionKeys.sort());
  });

  test("wait_reverse_share_or_timeout is an ACTION with no CTA", () => {
    const record = VALIDATOR_GUIDANCE.wait_reverse_share_or_timeout;
    expect(record.activity).toBe("action");
    expect(record.cta).toBe("none");
  });

  test("wait, passive, and auto entries never expose a CTA", () => {
    for (const key of INSTRUCTION_KEYS) {
      const record = VALIDATOR_GUIDANCE[key];
      if (record.kind === "instruction" && record.activity !== "action") {
        expect(record.cta).toBe("none");
      }
    }
  });

  test("locked mode and activity classifications are exact", () => {
    const expected: Record<
      InstructionKey,
      { mode: InstructionMode; activity: InstructionActivity; phase: GuidancePhase }
    > = {
      wait_probe: { mode: "passive", activity: "wait", phase: "probe" },
      wait_invite_mint: { mode: "active", activity: "wait", phase: "invite" },
      paste_s1: { mode: "active", activity: "action", phase: "invite" },
      wait_reverse_start: { mode: "active", activity: "wait", phase: "invite" },
      paste_s2: { mode: "active", activity: "action", phase: "reverse" },
      wait_forward_share: { mode: "active", activity: "wait", phase: "reverse" },
      open_forward_file: { mode: "active", activity: "action", phase: "share" },
      wait_oq2_open: { mode: "active", activity: "wait", phase: "share" },
      wait_reverse_share_or_timeout: {
        mode: "active",
        activity: "action",
        phase: "share",
      },
      wait_active_slot: { mode: "active", activity: "wait", phase: "queue" },
      stop: { mode: "passive", activity: "auto", phase: "queue" },
    };
    for (const key of INSTRUCTION_KEYS) {
      const record = VALIDATOR_GUIDANCE[key];
      expect({
        mode: record.mode,
        activity: record.activity,
        phase: record.phase,
      }).toEqual(expected[key]);
    }
  });
});

describe("guidanceFor resolver", () => {
  test("a recognized key returns its record", () => {
    const record = guidanceFor("paste_s1");
    expect(record).not.toBeNull();
    expect(record?.key).toBe("paste_s1");
    expect(record?.cta).toBe("copy_invite");
  });

  test("null and undefined return null", () => {
    expect(guidanceFor(null)).toBeNull();
    expect(guidanceFor(undefined)).toBeNull();
  });

  test("empty or whitespace input returns null", () => {
    expect(guidanceFor("")).toBeNull();
    expect(guidanceFor("   ")).toBeNull();
  });

  test("an unknown non-empty input returns the fallback title", () => {
    const record = guidanceFor("not_a_real_step");
    expect(record).not.toBeNull();
    expect(record?.kind).toBe("instruction");
    expect(record?.cta).toBe("none");
    expect(record?.key).toBe("not_a_real_step");
    if (record === null || record.kind !== "instruction") {
      throw new Error("expected an unknown-step instruction record");
    }
    expect(record.title).toBe(UNKNOWN_GUIDANCE_TITLE);
  });
});

describe("guidanceFor terminal-key disposition (out-of-scope finding 6 verification)", () => {
  test("a raw key matching a known terminal key resolves to terminal guidance, not the unknown fallback", () => {
    const record = guidanceFor("terminal_pass");
    expect(record).not.toBeNull();
    if (record === null || record.kind !== "terminal") {
      throw new Error("expected terminal_pass to resolve to terminal guidance");
    }
    expect(record.mode).toBe("terminal");
    expect(record.phase).toBe("result");
  });

  test("a truly unrecognized raw key resolves to the unknown-key fallback", () => {
    const record = guidanceFor("not_a_real_step");
    expect(record).not.toBeNull();
    if (record === null || record.kind !== "instruction") {
      throw new Error("expected an unknown-key instruction fallback");
    }
    expect(record.title).toBe(UNKNOWN_GUIDANCE_TITLE);
    expect(record.phase).toBe("unknown");
  });
});

describe("action error copy", () => {
  const expected: Record<ActionErrorKind, string> = {
    claim_410_no_cache:
      "This invitation was already claimed, and this browser cannot retrieve it. Run a new check.",
    claim_409_session_not_ready:
      "This step is no longer available. Waiting for the scan to update.",
    paste_422_wrong_target_host:
      "That invitation is from a different server than the one under test. Paste the return invitation issued by the target.",
    paste_409_conflict:
      "The validator is not ready for this step, or a return invitation is already imported.",
    paste_400_invalid_invitation:
      "That does not look like a valid invitation string.",
  };

  test("all five error strings match exactly", () => {
    for (const kind of Object.keys(expected) as ActionErrorKind[]) {
      expect(ACTION_ERROR_COPY[kind]).toBe(expected[kind]);
      expect(actionErrorCopy(kind)).toBe(expected[kind]);
    }
  });

  test("exactly five error cases are defined", () => {
    expect(Object.keys(ACTION_ERROR_COPY)).toHaveLength(5);
  });
});

describe("ASCII and marker-free copy", () => {
  const asciiOnly = /^[\x20-\x7E]*$/;
  const placeholder = /[{}<>]|TODO|FIXME|XXX/;

  function guidanceStrings(record: GuidanceRecord): string[] {
    const strings = [record.status, record.body];
    if (record.kind === "instruction") {
      strings.push(record.title);
    }
    return strings;
  }

  test("every guidance string is ASCII and marker-free", () => {
    const records: GuidanceRecord[] = [
      ...(Object.keys(VALIDATOR_GUIDANCE) as GuidanceKey[]).map(
        (key) => VALIDATOR_GUIDANCE[key],
      ),
      guidanceFor("still_unknown_step") as GuidanceRecord,
    ];
    for (const record of records) {
      for (const value of guidanceStrings(record)) {
        expect(asciiOnly.test(value)).toBe(true);
        expect(placeholder.test(value)).toBe(false);
      }
    }
  });

  test("every error string is ASCII and marker-free", () => {
    for (const value of Object.values(ACTION_ERROR_COPY)) {
      expect(asciiOnly.test(value)).toBe(true);
      expect(placeholder.test(value)).toBe(false);
    }
  });
});
