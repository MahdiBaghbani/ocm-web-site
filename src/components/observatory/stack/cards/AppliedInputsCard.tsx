import React from "react";
import type { ComposeManifest } from "../../lib/contracts";
import SummaryCard from "../../ui/SummaryCard";

interface AppliedInputsCardProps {
  manifest: ComposeManifest;
}

export default function AppliedInputsCard({ manifest }: AppliedInputsCardProps) {
  return (
    <SummaryCard
      title="Applied inputs"
      badge={
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
          {manifest.applied_inputs.length}
        </span>
      }
      className="h-full"
      bodyClassName="overflow-y-auto"
    >
      {manifest.applied_inputs.length > 0 ? (
        <ul className="space-y-1">
          {manifest.applied_inputs.map((input) => (
            <li key={input} className="break-all font-mono text-xs text-zinc-200">
              {input}
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-xs text-zinc-500">No inputs applied.</span>
      )}
    </SummaryCard>
  );
}
