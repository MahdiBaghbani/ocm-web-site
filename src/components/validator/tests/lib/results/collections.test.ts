import { describe, expect, test } from "bun:test";

import type { EvidenceItem } from "@/components/validator/lib/evidence/types";
import { resolveValidatorMachine, USER_STEPS } from "@/components/validator/lib/stateMachine";
import type { CanonicalAreaId, SpecificationAreaGridEntry } from "@/components/validator/lib/validatorScore";
import {
  projectEvidenceCollection,
  projectProgressCollections,
  projectStepCollection,
  resultAreaEntries,
} from "@/components/validator/lib/results/collections";
import { progressStatusText } from "@/components/validator/lib/results/progress";

function areaEntry(
  area: CanonicalAreaId,
  grade: SpecificationAreaGridEntry["grade"],
  extra: Partial<SpecificationAreaGridEntry> = {},
): SpecificationAreaGridEntry {
  return {
    area,
    label: area,
    grade,
    evidenceCount: 0,
    ...extra,
  };
}

function activeViewOf(state: string, nextInstruction?: string) {
  return resolveValidatorMachine({ state, optInActive: true, nextInstruction });
}

describe("resultAreaEntries", () => {
  test("assigns Pass, Needs attention, and Fail labels in input order", () => {
    const areas = resultAreaEntries([
      areaEntry("discovery", "pass"),
      areaEntry("tls", "warn"),
      areaEntry("sharing", "fail"),
    ]);
    expect(areas.map((entry) => entry.area)).toEqual(["discovery", "tls", "sharing"]);
    expect(areas.map((entry) => entry.pillLabel)).toEqual([
      "Pass",
      "Needs attention",
      "Fail",
    ]);
  });

  test("keeps an explicit pill label and leaves unlabeled null-grade rows unlabeled", () => {
    const custom = areaEntry("jwks", "pass", { pillLabel: "Custom pass" });
    const unlabeled = areaEntry("httpsig", null);
    const areas = resultAreaEntries([custom, unlabeled]);
    expect(areas[0]).toBe(custom);
    expect(areas[1]?.pillLabel).toBeUndefined();
  });

  test("returns an empty collection when there are no areas", () => {
    expect(resultAreaEntries([])).toEqual([]);
  });
});

describe("projectStepCollection", () => {
  test("omits hidden steps and numbers the rest 1-based in USER_STEPS order", () => {
    const view = resolveValidatorMachine({ state: "created", optInActive: false });
    const steps = projectStepCollection(view);
    expect(steps.map((row) => row.step)).toEqual(["probe", "queue_or_rest", "result"]);
    expect(steps.map((row) => row.index)).toEqual([1, 2, 3]);
    expect(steps.every((row) => USER_STEPS.includes(row.step))).toBe(true);
    expect(steps.some((row) => row.step === "invite")).toBe(false);
    const current = steps.find((row) => row.isCurrent);
    expect(current?.step).toBe(view.step);
    expect(current?.status).toBe("current");
  });

  test("keeps every user step visible and in catalog order when opt-in is active", () => {
    const view = activeViewOf("invite_minted", "paste_s1");
    const steps = projectStepCollection(view);
    expect(steps.map((row) => row.step)).toEqual([...USER_STEPS]);
    expect(steps.map((row) => row.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(steps.find((row) => row.isCurrent)?.step).toBe("invite");
  });

  test("returns an empty collection when there is no view or every step is hidden", () => {
    expect(projectStepCollection(null)).toEqual([]);
    const view = activeViewOf("invite_minted", "paste_s1");
    const hidden = {
      ...view,
      statuses: {
        probe: "hidden",
        queue_or_rest: "hidden",
        invite: "hidden",
        reverse: "hidden",
        share: "hidden",
        result: "hidden",
      },
    } as const;
    expect(projectStepCollection(hidden)).toEqual([]);
  });
});

describe("projectEvidenceCollection", () => {
  test("returns an empty collection for missing or empty evidence", () => {
    expect(projectEvidenceCollection(undefined)).toEqual([]);
    expect(projectEvidenceCollection(null)).toEqual([]);
    expect(projectEvidenceCollection([])).toEqual([]);
  });

  test("preserves supplied evidence items and their order", () => {
    const items: EvidenceItem[] = [
      { scoreArea: "tls", reasonCode: "jwks_unadvertised" },
      { scoreArea: "discovery", reasonCode: "discovery_probed" },
    ];
    expect(projectEvidenceCollection(items)).toBe(items);
  });
});

describe("projectProgressCollections", () => {
  test("labels areas, lists visible steps, and keeps empty evidence empty", () => {
    const view = resolveValidatorMachine({ state: "created", optInActive: false });
    const collections = projectProgressCollections({
      status: "live",
      areas: [areaEntry("discovery", "pass"), areaEntry("tls", null)],
      evidence: [],
      view,
      guidanceKey: null,
    });
    expect(collections.areas.map((entry) => entry.pillLabel)).toEqual(["Pass", undefined]);
    expect(collections.steps.map((row) => row.step)).toEqual(["probe", "queue_or_rest", "result"]);
    expect(collections.evidence).toEqual([]);
  });

  test("uses RO-1B.1 progress output exactly for live, loading, and terminal statuses", () => {
    const view = activeViewOf("invite_minted", "paste_s1");
    const live = projectProgressCollections({
      status: "live",
      areas: [],
      evidence: [{ scoreArea: "tls" }],
      view,
      guidanceKey: "paste_s1",
    });
    expect(live.progress).toBe(progressStatusText("live", view, "paste_s1"));
    expect(live.progress).toBe("Step 3 of 6: Paste the outgoing invite");
    expect(live.evidence).toEqual([{ scoreArea: "tls" }]);

    expect(
      projectProgressCollections({
        status: "loading_report",
        areas: [],
        evidence: [],
        view: null,
        guidanceKey: null,
      }).progress,
    ).toBe(progressStatusText("loading_report", null, null));

    expect(
      projectProgressCollections({
        status: "ready",
        areas: [],
        evidence: [],
        view,
        guidanceKey: "paste_s1",
      }).progress,
    ).toBeNull();
  });
});
