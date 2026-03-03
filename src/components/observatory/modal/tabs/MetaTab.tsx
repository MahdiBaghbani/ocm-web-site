import React, { useEffect, useMemo, useState } from "react";
import type { EvidenceItem } from "../../lib/contracts";
import FilePane from "../FilePane";
import EvidenceViewer from "../../evidence/EvidenceViewer";
import type { EvidenceTabProps } from "../RunModal";

export default function MetaTab({
  evidenceItems,
  artifactBase,
}: EvidenceTabProps) {
  const items = useMemo(
    () => evidenceItems.filter((i): i is EvidenceItem => i.tab === "meta"),
    [evidenceItems],
  );
  const [selectedPath, setSelectedPath] = useState(items[0]?.path ?? "");

  useEffect(() => {
    setSelectedPath(items[0]?.path ?? "");
  }, [items]);

  return (
    <FilePane
      items={items}
      selectedPath={selectedPath}
      onSelect={setSelectedPath}
      renderViewer={(item) => (
        <EvidenceViewer item={item} artifactBase={artifactBase} />
      )}
      emptyLabel="No meta evidence."
    />
  );
}
