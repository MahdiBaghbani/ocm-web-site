import React, { useState } from "react";

export interface CopyChipProps {
  label: string;
  fullValue: string;
  displayValue: string;
}

export default function CopyChip({ label, fullValue, displayValue }: CopyChipProps) {
  const [copiedAt, setCopiedAt] = useState<number | null>(null);

  React.useEffect(() => {
    if (copiedAt === null) return;
    const id = setTimeout(() => setCopiedAt(null), 2000);
    return () => clearTimeout(id);
  }, [copiedAt]);

  function handleCopy() {
    void navigator.clipboard.writeText(fullValue).then(() => {
      setCopiedAt(Date.now());
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <code
        className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200"
        title={fullValue}
      >
        {displayValue}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy ${label}`}
        className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700"
      >
        Copy
      </button>
      <span
        aria-live="polite"
        className={`shrink-0 w-14 text-right text-xs text-emerald-400 transition-opacity ${
          copiedAt !== null ? "opacity-100" : "opacity-0"
        }`}
      >
        Copied!
      </span>
    </div>
  );
}
