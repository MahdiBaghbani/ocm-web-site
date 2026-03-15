/**
 * File-pane: a sidebar of selectable files + a content area where the
 * caller-provided renderViewer renders the active file.
 *
 * Contract: callers must always render `<EvidenceViewer ... fillParent />`
 * inside renderViewer. FilePane provides h-full + min-h-0 and the chip
 * comes from the renderer (single-chip invariant).
 */
import React, { useRef } from "react";
import type { EvidenceItem } from "../lib/contracts";

interface FilePaneProps {
  items: EvidenceItem[];
  selectedPath: string;
  onSelect: (path: string) => void;
  /**
   * Render the currently selected item. Callers should always pass
   * fillParent to EvidenceViewer (FilePane provides the h-full container;
   * the single-chip invariant requires the renderer to fill it).
   */
  renderViewer: (item: EvidenceItem) => React.ReactNode;
  emptyLabel?: string;
}

function formatKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function FilePane({
  items,
  selectedPath,
  onSelect,
  renderViewer,
  emptyLabel = "No files.",
}: FilePaneProps) {
  const selectorRef = useRef<HTMLDivElement>(null);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/30 p-10">
        <span className="text-sm text-zinc-400">{emptyLabel}</span>
      </div>
    );
  }

  const selectedItem = items.find((i) => i.path === selectedPath) ?? items[0];

  function handleSelectorKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const idx = items.findIndex((i) => i.path === selectedItem.path);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = items[(idx + 1) % items.length];
      if (next) onSelect(next.path);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = items[(idx - 1 + items.length) % items.length];
      if (prev) onSelect(prev.path);
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[18rem_1fr] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/20">
      {/* Sidebar - independent vertical scroll. */}
      <div
        ref={selectorRef}
        className="min-h-0 space-y-1 overflow-y-auto border-r border-zinc-800 bg-zinc-900/50 p-2"
        onKeyDown={handleSelectorKeyDown}
        aria-label="Evidence files"
        tabIndex={0}
      >
        {items.map((item) => {
          const isActive = item.path === selectedItem.path;
          const label = item.logical_name || item.path;
          const isSkipped = Boolean(item.stub_reason);
          return (
            <button
              key={item.path}
              type="button"
              aria-pressed={isActive}
              className={[
                "w-full rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                isActive
                  ? "bg-zinc-800 text-zinc-50 ring-1 ring-sky-500"
                  : "text-zinc-300 hover:bg-zinc-800/60",
              ].join(" ")}
              onClick={() => onSelect(item.path)}
            >
              <div className="flex min-w-0 items-start justify-between gap-1">
                <span className="min-w-0 flex-1 break-words">{label}</span>
                {isSkipped ? (
                  <span className="shrink-0 rounded bg-amber-900/50 px-1 py-0.5 text-[10px] text-amber-400">
                    skipped
                  </span>
                ) : null}
              </div>
              <span className="mt-0.5 block text-[11px] text-zinc-500">
                {formatKB(item.size_bytes)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Content side - hands height to fillParent renderer. */}
      <div className="flex min-h-0 min-w-0 flex-col p-3">
        {renderViewer(selectedItem)}
      </div>
    </div>
  );
}
