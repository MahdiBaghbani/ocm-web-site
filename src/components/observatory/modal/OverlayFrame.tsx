import React, { useEffect } from "react";

interface OverlayFrameProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function OverlayFrame({ title, onClose, children }: OverlayFrameProps) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        className="absolute inset-0 bg-black/60"
        aria-label="Close overlay"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex h-[96vh] w-[96vw] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        {/* Fixed header chrome */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-6 py-4">
          <h2 className="truncate text-lg font-semibold text-zinc-50">{title}</h2>
          <button
            className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 min-h-0 overflow-hidden px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
