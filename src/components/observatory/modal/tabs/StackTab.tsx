import React, { useMemo } from "react";
import type { EvidenceTabProps } from "../RunModal";
import StackPane from "../../stack/StackPane";

export default function StackTab({ evidenceItems, artifactBase }: EvidenceTabProps) {
  const items = useMemo(
    () => evidenceItems.filter((it) => it.tab === "stack"),
    [evidenceItems],
  );

  return <StackPane stackItems={items} artifactBase={artifactBase} />;
}
