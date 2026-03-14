import React from "react";
import type { ComposeManifest } from "../../lib/contracts";
import SummaryCard from "../../ui/SummaryCard";
import CopyChip from "./CopyChip";

interface IdentityCardProps {
  manifest: ComposeManifest;
}

export default function IdentityCard({ manifest }: IdentityCardProps) {
  return (
    <SummaryCard
      title="Identity"
      badge={
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
          {manifest.resolved_files.length} resolved files
        </span>
      }
      className="h-full"
    >
      <div className="space-y-2">
        <CopyChip
          label="stack_id"
          fullValue={manifest.stack_id}
          displayValue={manifest.stack_id}
        />
        <CopyChip
          label="base"
          fullValue={manifest.base}
          displayValue={manifest.base}
        />
      </div>
    </SummaryCard>
  );
}
