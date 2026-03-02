import React from "react";
import type { EvidenceItem } from "../../lib/contracts";

interface StubRendererProps {
  item: EvidenceItem;
}

export default function StubRenderer({ item }: StubRendererProps) {
  const reason = item.stub_reason ?? "no reason provided";
  const subtitle = item.logical_name || item.path;
  return (
    <div className="rounded-xl border border-amber-900/50 bg-amber-950/30 p-4">
      <div className="text-sm font-medium text-amber-300">
        SKIPPED: {reason}
      </div>
      <div className="mt-1 text-xs text-zinc-500">{subtitle}</div>
    </div>
  );
}
