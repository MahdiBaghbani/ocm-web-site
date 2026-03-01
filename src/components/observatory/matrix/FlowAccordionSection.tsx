import React from "react";
import type { CellStatus } from "../lib/contracts";
import { statusToUi } from "../lib/statusStyles";

export interface FlowAccordionSectionProps {
  flowId: string;
  label?: string;
  subtitle?: string;
  cellCount: number;
  rollupBadges: { status: CellStatus; count: number }[];
  expanded: boolean;
  onToggle: (flowId: string) => void;
  children: React.ReactNode;
}

export function FlowAccordionSection({
  flowId,
  label,
  subtitle,
  cellCount,
  rollupBadges,
  expanded,
  onToggle,
  children,
}: FlowAccordionSectionProps): React.ReactElement {
  const visibleBadges = rollupBadges.filter((b) => b.count > 0);
  const displayLabel = label && label.length > 0 ? label : flowId;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/20">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        aria-expanded={expanded}
        aria-controls={"flow-body-" + flowId}
        onClick={() => onToggle(flowId)}
      >
        <span className="flex items-start gap-2">
          <span className="mt-0.5 w-3 shrink-0 font-mono text-sm text-zinc-400">
            {expanded ? "v" : ">"}
          </span>
          <span className="flex flex-col">
            <span className="text-sm font-semibold text-zinc-100">
              {displayLabel}
              <span className="ml-2 text-xs font-normal text-zinc-500">
                {cellCount} cells
              </span>
            </span>
            {subtitle ? (
              <span className="text-xs text-zinc-400">{subtitle}</span>
            ) : null}
          </span>
        </span>

        {visibleBadges.length > 0 ? (
          <span className="flex flex-wrap items-center justify-end gap-2">
            {visibleBadges.map(({ status, count }) => {
              const ui = statusToUi(status);
              return (
                <span
                  key={status}
                  className={`inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/40 px-2.5 py-0.5 text-xs ${ui.text}`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${ui.dot}`} />
                  {ui.label}: {count}
                </span>
              );
            })}
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div id={"flow-body-" + flowId} className="border-t border-zinc-800 px-5 pb-5 pt-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}
