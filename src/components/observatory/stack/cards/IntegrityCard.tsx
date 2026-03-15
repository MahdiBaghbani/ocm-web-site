import React from "react";
import type { ComposeManifest } from "../../lib/contracts";
import SummaryCard from "../../ui/SummaryCard";
import FieldRow from "./FieldRow";

function shortHash(value: string): string {
  return value.length <= 16 ? value : value.slice(0, 16) + "...";
}

interface IntegrityCardProps {
  manifest: ComposeManifest;
}

export default function IntegrityCard({ manifest }: IntegrityCardProps) {
  return (
    <SummaryCard title="Integrity" className="h-full">
      <div className="space-y-2">
        <FieldRow
          label="stack_def_sha256"
          fullValue={manifest.stack_def_sha256}
          displayValue={shortHash(manifest.stack_def_sha256)}
        />
        <FieldRow
          label="stack_env_sha256"
          fullValue={manifest.stack_env_sha256}
          displayValue={shortHash(manifest.stack_env_sha256)}
        />
      </div>
    </SummaryCard>
  );
}
