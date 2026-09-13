/**
 * Pure raw-JSON and selected-area action flags for the results page.
 * Inputs to outputs only: no React, refs, or session state.
 */

import type {
  CanonicalAreaId,
  SpecificationAreaGridEntry,
} from "../validatorScore";

export const RAW_JSON_LABEL = "View full report JSON";

export type RawJsonActionProjection = {
  hasSourceReport: boolean;
  showMalformedTrigger: boolean;
  label: string;
};

export type AreaModalActionProjection = {
  selectedEntry: SpecificationAreaGridEntry | null;
  showModal: boolean;
};

export type ActionableInput = {
  status: string;
  hasSourceReport: boolean;
  selectedArea: CanonicalAreaId | null;
  areas: readonly SpecificationAreaGridEntry[];
};

export type ActionableProjection = {
  rawJson: RawJsonActionProjection;
  areaModal: AreaModalActionProjection;
};

/**
 * Footer vs prominent raw-JSON action. Both stay hidden without a source
 * report. The prominent button is the malformed terminal only.
 */
export function projectRawJsonAction(
  status: string,
  hasSourceReport: boolean,
): RawJsonActionProjection {
  return {
    hasSourceReport,
    showMalformedTrigger: hasSourceReport && status === "malformed",
    label: RAW_JSON_LABEL,
  };
}

/**
 * Selected area row, or null when nothing is selected or the id is absent
 * from the visible collection.
 */
export function resolveSelectedAreaEntry(
  selectedArea: CanonicalAreaId | null,
  areas: readonly SpecificationAreaGridEntry[],
): SpecificationAreaGridEntry | null {
  if (selectedArea === null) {
    return null;
  }
  return areas.find((entry) => entry.area === selectedArea) ?? null;
}

/**
 * Area-detail modal mount. Requires a selected row that exists in the
 * collection, a source report, and ready or live status.
 */
export function projectAreaModalAction(
  selectedArea: CanonicalAreaId | null,
  selectedEntry: SpecificationAreaGridEntry | null,
  hasSourceReport: boolean,
  status: string,
): boolean {
  return (
    selectedArea !== null &&
    selectedEntry !== null &&
    hasSourceReport &&
    (status === "ready" || status === "live")
  );
}

/**
 * Raw-JSON triggers plus the selected-area modal flag. Handlers, open
 * state, and focus restore stay in the caller.
 */
export function projectActionable(input: ActionableInput): ActionableProjection {
  const selectedEntry = resolveSelectedAreaEntry(input.selectedArea, input.areas);
  return {
    rawJson: projectRawJsonAction(input.status, input.hasSourceReport),
    areaModal: {
      selectedEntry,
      showModal: projectAreaModalAction(
        input.selectedArea,
        selectedEntry,
        input.hasSourceReport,
        input.status,
      ),
    },
  };
}
