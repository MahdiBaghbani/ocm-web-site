import React, { useRef } from "react";
import type { EvidenceItem } from "../lib/contracts";

interface FilePaneProps {
  items: EvidenceItem[];
  selectedPath: string;
  onSelect: (path: string) => void;
  renderViewer: (item: EvidenceItem) => React.ReactNode;
  toolbar?: React.ReactNode;
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
  toolbar,
  emptyLabel = "No files.",
}: FilePaneProps) {
  const selectorRef = useRef<HTMLDivElement>(null);

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/30 p-10">
        <span className="text-sm text-zinc-400">{emptyLabel}</span>
      </div>
    );
  }

  const selectedItem = items.find((i) => i.path === selectedPath) ?? items[0];

  if (items.length === 1) {
    return (
      <div className="space-y-3">
        {toolbar ? (
          <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950 pb-2">
            {toolbar}
          </div>
        ) : null}
        {renderViewer(selectedItem)}
      </div>
    );
  }

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

  // Chrome estimate: OverlayFrame p-6 (24px) + title row (~40px) + mt-6 (24px)
  // + RunModal tab bar (~40px) + space-y-5 gap (20px) = ~148px; using 8rem
  // (128px) as a conservative static value so content area has breathing room.
  return (
    <div className="grid grid-cols-[18rem_1fr] h-[calc(90vh-8rem)] gap-0">
      {/* Selector pane - scrolls independently */}
      <div
        ref={selectorRef}
        className="min-h-0 overflow-y-auto space-y-1 border-r border-zinc-800 bg-zinc-900/20 p-2"
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

      {/* Viewer pane - scrolls independently */}
      <div className="min-h-0 overflow-y-auto p-3">
        {toolbar ? (
          <div className="sticky top-0 z-10 mb-2 border-b border-zinc-800 bg-zinc-950 pb-2">
            {toolbar}
          </div>
        ) : null}
        {renderViewer(selectedItem)}
      </div>
    </div>
  );
}
