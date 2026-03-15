import React from "react";

export interface FieldRowProps {
  label: string;
  fullValue: string;
  displayValue: string;
}

export default function FieldRow({ label, fullValue, displayValue }: FieldRowProps) {
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
    </div>
  );
}
