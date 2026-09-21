import { describe, expect, test } from "bun:test";

import {
  resolveTerminalState,
  resolveSpecificationGrade,
} from "@/components/validator/lib/score/project";
import { parseSpecificationScore } from "@/components/validator/lib/score/parse";
import {
  specification,
  allAreas,
} from "@/components/validator/tests/lib/score/helpers/test-helpers";

describe("state and grade authority", () => {
  test("uses a known terminal poll state over cached score state", () => {
    expect(resolveTerminalState("terminal_pass", "passive_complete")).toBe("terminal_pass");
    expect(resolveTerminalState("passive_complete", "terminal_pass")).toBeNull();
    expect(resolveTerminalState(undefined, "terminal_fail")).toBe("terminal_fail");
    expect(resolveTerminalState("", "interrupted")).toBe("interrupted");
    expect(resolveTerminalState(null, "created")).toBeNull();
  });

  test("honors an explicit successful terminal grade", () => {
    const parsed = parseSpecificationScore(specification({ grade: "warn" }));
    expect(
      resolveSpecificationGrade({
        reportOk: true,
        parsed,
        terminalState: "terminal_pass",
      }),
    ).toBe("warn");
  });

  test("folds when the parsed grade is null and terminal_pass is known", () => {
    const parsed = parseSpecificationScore(
      specification({
        grade: null,
        areas: allAreas((id) => (id === "tls" ? "fail" : "pass")),
      }),
    );
    expect(
      resolveSpecificationGrade({
        reportOk: true,
        parsed,
        terminalState: "terminal_pass",
      }),
    ).toBe("fail");
  });
});
