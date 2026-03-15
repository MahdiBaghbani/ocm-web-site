import React from "react";
import type { EvidenceTabProps } from "../types";
import EvidenceFilePaneTab from "./EvidenceFilePaneTab";

export default function MetaTab({ evidenceItems, artifactBase }: EvidenceTabProps) {
  return (
    <EvidenceFilePaneTab
      evidenceItems={evidenceItems}
      artifactBase={artifactBase}
      tab="meta"
      emptyLabel="No meta evidence."
    />
  );
}
