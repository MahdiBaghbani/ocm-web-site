/**
 * Generic expandable record list. Body-only - caller wraps in ViewerFrame.
 *
 * Conditional balancing: when fillParent && no row is expanded && record count
 * is small (<= balanceThreshold, default 6), each row stretches to fill the
 * available height equally via flex-1 + min-h-[3rem]. Once any row expands or
 * the count exceeds the threshold, rows fall back to intrinsic height with
 * scroll. This avoids breaking expansion UX on long lists.
 *
 * Stable keys via the getKey callback. Use record-derived identifiers
 * (event_id, exchange_id, etc.) - never raw array index, which becomes
 * unstable under filter/sort.
 */
import React, { useState } from "react";

export interface RecordListProps<T> {
  records: readonly T[];
  /** Stable key per record. Caller derives from record fields (event_id, etc.). */
  getKey: (item: T, idx: number) => string;
  /** Render the always-visible summary row content. `open` is provided in case styling depends on state. */
  renderSummary: (item: T, idx: number, open: boolean) => React.ReactNode;
  /** Optional expanded body. When undefined, rows are not clickable. */
  renderExpanded?: (item: T, idx: number) => React.ReactNode;
  /** Empty state node (rendered when records.length === 0). */
  emptyState: React.ReactNode;
  /** When true, container claims h-full from its parent. */
  fillParent?: boolean;
  /** When true and conditions met, rows distribute equally to fill height. */
  balanceWhenCollapsed?: boolean;
  /** Max record count for balancing to apply. Default 6. */
  balanceThreshold?: number;
  /** Initially-expanded row index (default none). */
  defaultExpandedIdx?: number;
}

export function RecordList<T>({
  records,
  getKey,
  renderSummary,
  renderExpanded,
  emptyState,
  fillParent,
  balanceWhenCollapsed,
  balanceThreshold,
  defaultExpandedIdx,
}: RecordListProps<T>) {
  const [openIdx, setOpenIdx] = useState<number | null>(defaultExpandedIdx ?? null);

  const someOpen = openIdx !== null;
  const balancing = !!(
    balanceWhenCollapsed &&
    fillParent &&
    !someOpen &&
    records.length <= (balanceThreshold ?? 6)
  );

  if (records.length === 0) {
    return (
      <div
        className={
          fillParent ? "h-full flex items-center justify-center" : ""
        }
      >
        {emptyState}
      </div>
    );
  }

  return (
    <div
      className={[
        "flex flex-col",
        fillParent ? "h-full min-h-0 flex-1 overflow-y-auto" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {records.map((rec, i) => {
        const open = openIdx === i;
        const rowClasses = [
          "flex flex-col border-b border-zinc-800 last:border-0",
          balancing ? "flex-1 min-h-[3rem]" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div key={getKey(rec, i)} className={rowClasses}>
            {renderExpanded ? (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenIdx(open ? null : i)}
                className="flex w-full grow items-center gap-3 px-3 py-2 text-left hover:bg-zinc-800/40"
              >
                {renderSummary(rec, i, open)}
              </button>
            ) : (
              <div className="flex w-full grow items-center gap-3 px-3 py-2">
                {renderSummary(rec, i, open)}
              </div>
            )}
            {open && renderExpanded ? (
              <div className="space-y-2 bg-zinc-900/40 px-3 pb-3 pt-1">
                {renderExpanded(rec, i)}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
