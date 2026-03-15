import React from "react";
import type { EvidenceTabProps } from "../types";
import EvidenceFilePaneTab from "./EvidenceFilePaneTab";

export default function LogsTab({ evidenceItems, artifactBase }: EvidenceTabProps) {
  return (
    <EvidenceFilePaneTab
      evidenceItems={evidenceItems}
      artifactBase={artifactBase}
      tab="logs"
      emptyLabel="No log evidence."
    />
  );
}
