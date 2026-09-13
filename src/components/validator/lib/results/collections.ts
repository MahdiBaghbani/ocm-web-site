/**
 * Pure area, step, and evidence collections for the results page.
 * Inputs to outputs only: no React, refs, or session state.
 */

import type { EvidenceItem } from "../evidence/types";
import {
  USER_STEPS,
  type MachineView,
  type StepStatus,
  type UserStep,
} from "../stateMachine";
import type { SpecificationAreaGridEntry } from "../validatorScore";
import { progressStatusText } from "./progress";

export type VisibleStepStatus = Exclude<StepStatus, "hidden">;

export interface StepCollectionItem {
  step: UserStep;
  status: VisibleStepStatus;
  /** 1-based numeral among visible steps, matching StepRow.index. */
  index: number;
  isCurrent: boolean;
}

export interface ProgressCollectionsInput {
  status: string;
  areas: readonly SpecificationAreaGridEntry[];
  evidence: readonly EvidenceItem[];
  view: MachineView | null;
  guidanceKey: string | null;
}

export interface ProgressCollections {
  areas: SpecificationAreaGridEntry[];
  steps: StepCollectionItem[];
  evidence: readonly EvidenceItem[];
  progress: string | null;
}

export function resultAreaEntries(
  areas: readonly SpecificationAreaGridEntry[],
): SpecificationAreaGridEntry[] {
  return areas.map((entry) => {
    if (entry.pillLabel !== undefined) {
      return entry;
    }
    if (entry.grade === "pass") {
      return { ...entry, pillLabel: "Pass" };
    }
    if (entry.grade === "warn") {
      return { ...entry, pillLabel: "Needs attention" };
    }
    if (entry.grade === "fail") {
      return { ...entry, pillLabel: "Fail" };
    }
    return entry;
  });
}

function visibleIndex(statuses: MachineView["statuses"], step: UserStep): number {
  let index = 0;
  for (const item of USER_STEPS) {
    if (statuses[item] === "hidden") {
      continue;
    }
    index += 1;
    if (item === step) {
      return index;
    }
  }
  return index;
}

/**
 * Visible live-row steps in USER_STEPS order. Hidden steps are omitted.
 * A null view has no rows yet.
 */
export function projectStepCollection(view: MachineView | null): StepCollectionItem[] {
  if (view === null) {
    return [];
  }
  const items: StepCollectionItem[] = [];
  for (const step of USER_STEPS) {
    const status = view.statuses[step];
    if (status === "hidden") {
      continue;
    }
    items.push({
      step,
      status,
      index: visibleIndex(view.statuses, step),
      isCurrent: status === "current",
    });
  }
  return items;
}

/**
 * Evidence rows for display. Missing or empty input becomes an empty
 * collection; order of supplied items is unchanged.
 */
export function projectEvidenceCollection(
  items: readonly EvidenceItem[] | null | undefined,
): readonly EvidenceItem[] {
  if (items === undefined || items === null || items.length === 0) {
    return [];
  }
  return items;
}

/**
 * Area labels, visible steps, evidence rows, and RO-1B.1 progress text
 * for the results page. Session identity and refs stay in the caller.
 */
export function projectProgressCollections(
  input: ProgressCollectionsInput,
): ProgressCollections {
  return {
    areas: resultAreaEntries(input.areas),
    steps: projectStepCollection(input.view),
    evidence: projectEvidenceCollection(input.evidence),
    progress: progressStatusText(input.status, input.view, input.guidanceKey),
  };
}
