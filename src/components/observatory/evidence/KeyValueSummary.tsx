import React from "react";

interface KVEntry {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

interface KeyValueSummaryProps {
  title?: string;
  entries: KVEntry[];
  columns?: 1 | 2;
}

export default function KeyValueSummary({
  title,
  entries,
  columns = 1,
}: KeyValueSummaryProps) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
      {title ? (
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
          {title}
        </div>
      ) : null}
      <dl
        className={[
          "grid gap-x-4 gap-y-2",
          columns === 2 ? "grid-cols-2" : "grid-cols-1",
        ].join(" ")}
      >
        {entries.map((entry, i) => (
          <div key={i} className="space-y-0.5">
            <dt className="text-[11px] text-zinc-500">{entry.label}</dt>
            <dd
              className={
                entry.mono
                  ? "font-mono text-xs text-zinc-200"
                  : "text-xs text-zinc-200"
              }
            >
              {entry.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
