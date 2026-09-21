import { describe, expect, test } from "bun:test";

import type { CanonicalAreaId, SpecificationAreaGridEntry } from "@/components/validator/lib/validatorScore";
import {
  RAW_JSON_LABEL,
  projectActionable,
  projectAreaModalAction,
  projectRawJsonAction,
  resolveSelectedAreaEntry,
  type ActionableInput,
} from "@/components/validator/lib/results/actionable";

function areaEntry(
  area: CanonicalAreaId,
  grade: SpecificationAreaGridEntry["grade"],
): SpecificationAreaGridEntry {
  return {
    area,
    label: area,
    grade,
    evidenceCount: 0,
  };
}

const AREAS = [areaEntry("discovery", "pass"), areaEntry("tls", "warn")];

function actionableInput(extra: Partial<ActionableInput> = {}): ActionableInput {
  return {
    status: "ready",
    hasSourceReport: true,
    selectedArea: "discovery",
    areas: AREAS,
    ...extra,
  };
}

describe("projectRawJsonAction", () => {
  test("shows the ready trigger whenever a source report exists", () => {
    expect(projectRawJsonAction("ready", true)).toEqual({
      hasSourceReport: true,
      showMalformedTrigger: false,
      label: RAW_JSON_LABEL,
    });
    expect(projectRawJsonAction("live", true).hasSourceReport).toBe(true);
    expect(projectRawJsonAction("ready", false)).toEqual({
      hasSourceReport: false,
      showMalformedTrigger: false,
      label: RAW_JSON_LABEL,
    });
  });

  test("shows the prominent trigger only on a malformed terminal with a report", () => {
    expect(projectRawJsonAction("malformed", true).showMalformedTrigger).toBe(true);
    expect(projectRawJsonAction("malformed", false).showMalformedTrigger).toBe(false);
    expect(projectRawJsonAction("expired", true).showMalformedTrigger).toBe(false);
    expect(projectRawJsonAction("report_error", true).showMalformedTrigger).toBe(
      false,
    );
  });

  test("keeps the existing raw-JSON label", () => {
    expect(RAW_JSON_LABEL).toBe("View full report JSON");
  });
});

describe("resolveSelectedAreaEntry", () => {
  test("returns the matching visible row and null when none is selected", () => {
    expect(resolveSelectedAreaEntry("tls", AREAS)?.area).toBe("tls");
    expect(resolveSelectedAreaEntry(null, AREAS)).toBeNull();
    expect(resolveSelectedAreaEntry("jwks", AREAS)).toBeNull();
  });
});

describe("projectAreaModalAction", () => {
  test("opens only for a selected ready or live row with a source report", () => {
    const entry = AREAS[0] ?? null;
    expect(projectAreaModalAction("discovery", entry, true, "ready")).toBe(true);
    expect(projectAreaModalAction("discovery", entry, true, "live")).toBe(true);
    expect(projectAreaModalAction("discovery", entry, true, "malformed")).toBe(false);
    expect(projectAreaModalAction("discovery", entry, false, "ready")).toBe(false);
    expect(projectAreaModalAction("discovery", null, true, "ready")).toBe(false);
    expect(projectAreaModalAction(null, entry, true, "ready")).toBe(false);
  });
});

describe("projectActionable", () => {
  test("combines the raw-JSON flags and selected-area modal the renderer reads", () => {
    const ready = projectActionable(actionableInput());
    expect(ready.rawJson.hasSourceReport).toBe(true);
    expect(ready.rawJson.showMalformedTrigger).toBe(false);
    expect(ready.rawJson.label).toBe(RAW_JSON_LABEL);
    expect(ready.areaModal.selectedEntry?.area).toBe("discovery");
    expect(ready.areaModal.showModal).toBe(true);

    const malformed = projectActionable(
      actionableInput({ status: "malformed", selectedArea: null }),
    );
    expect(malformed.rawJson.showMalformedTrigger).toBe(true);
    expect(malformed.areaModal.selectedEntry).toBeNull();
    expect(malformed.areaModal.showModal).toBe(false);
  });
});
