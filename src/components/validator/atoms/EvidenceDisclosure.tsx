/**
 * Expandable evidence panel for one step or area. Copies accordion zinc
 * tokens; does not wrap the matrix FlowAccordionSection contract.
 */
import React, { useId, useState } from "react";
import FieldRow from "../../observatory/stack/cards/FieldRow";
import Pill, { type GradeKind } from "./Pill";

export interface EvidenceItem {
  area?: string;
  scoreArea?: string;
  leg?: string;
  step?: string;
  reasonCode?: string;
  severity?: string;
  grade?: GradeKind | null;
  affectsGrade?: boolean;
  payloadRedacted?: boolean;
  createdAt?: string;
}

export interface EvidenceDisclosureProps {
  title: string;
  subtitle?: string;
  items: readonly EvidenceItem[];
  id?: string;
  expanded?: boolean;
  defaultExpanded?: boolean;
  onToggle?: (open: boolean) => void;
}

const ROW_KEYS = [
  "area",
  "scoreArea",
  "leg",
  "step",
  "reasonCode",
  "severity",
  "grade",
  "affectsGrade",
  "payloadRedacted",
  "createdAt",
] as const;

const ROW_LABELS: Record<(typeof ROW_KEYS)[number], string> = {
  area: "area",
  scoreArea: "score area",
  leg: "leg",
  step: "step",
  reasonCode: "reason",
  severity: "severity",
  grade: "grade",
  affectsGrade: "affects grade",
  payloadRedacted: "redacted",
  createdAt: "created",
};

function displayOf(value: string | boolean | GradeKind): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return value;
}

function rowsFor(item: EvidenceItem): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  for (const key of ROW_KEYS) {
    // Grade is rendered once as a Pill, not again as a FieldRow.
    if (key === "grade") {
      continue;
    }
    const raw = item[key];
    if (raw === undefined || raw === null || raw === "") {
      continue;
    }
    rows.push({ label: ROW_LABELS[key], value: displayOf(raw) });
  }
  return rows;
}

export default function EvidenceDisclosure({
  title,
  subtitle,
  items,
  id,
  expanded,
  defaultExpanded = true,
  onToggle,
}: EvidenceDisclosureProps): React.ReactElement {
  const [internalOpen, setInternalOpen] = useState(defaultExpanded);
  const isControlled = expanded !== undefined;
  const isOpen = expanded ?? internalOpen;
  const generatedId = useId();
  const bodyId = id !== undefined && id !== "" ? id : generatedId;

  function handleToggle(): void {
    const nextOpen = !isOpen;
    if (onToggle !== undefined) {
      onToggle(nextOpen);
    }
    if (!isControlled) {
      setInternalOpen(nextOpen);
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/20">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        aria-expanded={isOpen}
        aria-controls={bodyId}
        onClick={handleToggle}
      >
        <span className="flex items-start gap-2">
          <span
            className="mt-0.5 w-3 shrink-0 font-mono text-sm text-zinc-400"
            aria-hidden="true"
          >
            {isOpen ? "v" : ">"}
          </span>
          <span className="flex flex-col">
            <span className="text-sm font-semibold text-zinc-100">
              {title}
              <span className="ml-2 text-xs font-normal text-zinc-500">
                {items.length} {items.length === 1 ? "item" : "items"}
              </span>
            </span>
            {subtitle !== undefined && subtitle !== "" ? (
              <span className="text-xs text-zinc-400">{subtitle}</span>
            ) : null}
          </span>
        </span>
      </button>
      <div
        id={bodyId}
        hidden={!isOpen}
        className="space-y-4 border-t border-zinc-800 px-5 pb-5 pt-4"
      >
        {items.length === 0 ? (
          <p className="text-sm text-zinc-400">No evidence.</p>
        ) : (
          items.map((item, index) => {
            const rows = rowsFor(item);
            const key =
              item.reasonCode !== undefined && item.reasonCode !== ""
                ? `${item.reasonCode}-${index}`
                : `evidence-${index}`;
            return (
              <div key={key} className="space-y-2">
                {item.grade === "pass" ||
                item.grade === "fail" ||
                item.grade === "warn" ? (
                  <Pill kind={item.grade} />
                ) : null}
                {rows.map((row) => (
                  <FieldRow
                    key={row.label}
                    label={row.label}
                    fullValue={row.value}
                    displayValue={row.value}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
