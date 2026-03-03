import React from "react";

interface OverlayFrameProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function OverlayFrame({ title, onClose, children }: OverlayFrameProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <button
        className="absolute inset-0 bg-black/60"
        aria-label="Close overlay"
        onClick={onClose}
      />
      <div className="relative h-full w-full max-w-3xl overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-zinc-50">{title}</h2>
          <button
            className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
