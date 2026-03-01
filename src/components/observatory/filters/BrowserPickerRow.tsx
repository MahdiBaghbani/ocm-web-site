// Shared multi-browser pill row for run modal overview switching.
import React from "react";
import type { CellStatus } from "../lib/contracts";
import { statusToUi } from "../lib/statusStyles";

export interface BrowserPickerItem {
  browser: string;
  runId: string;
  cellId: string;
  status: CellStatus;
}

export interface BrowserPickerRowProps {
  items: BrowserPickerItem[];
  activeCellId: string;
  onSelect: (item: BrowserPickerItem) => void;
}

export function BrowserPickerRow({
  items,
  activeCellId,
  onSelect,
}: BrowserPickerRowProps): React.ReactElement | null {
  if (items.length <= 1) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const { browser, runId, cellId, status } = item;
        const ui = statusToUi(status);
        const isActive = cellId === activeCellId;
        const disabled = runId === "";
        return (
          <button
            key={cellId}
            type="button"
            aria-pressed={isActive}
            disabled={disabled}
            className={[
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
              disabled
                ? `border-zinc-800 ${ui.text} bg-zinc-950/40 opacity-50 cursor-not-allowed`
                : isActive
                  ? `ring-2 ring-blue-500 border-zinc-700 ${ui.text} bg-zinc-900`
                  : `border-zinc-800 ${ui.text} bg-zinc-950/40 hover:bg-zinc-900`,
            ].join(" ")}
            onClick={() => onSelect(item)}
          >
            <span>{browser}</span>
            <span className={`h-2 w-2 shrink-0 rounded-full ${ui.dot}`} />
          </button>
        );
      })}
    </div>
  );
}
