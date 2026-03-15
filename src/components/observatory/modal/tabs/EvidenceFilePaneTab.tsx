import React, { useEffect, useMemo, useState } from "react";
import type { EvidenceItem, EvidenceTab } from "../../lib/contracts";
import FilePane from "../FilePane";
import EvidenceViewer from "../../evidence/EvidenceViewer";

/** Tab panel that renders a file-pane + evidence viewer for one tab bucket. */
interface EvidenceFilePaneTabProps {
  evidenceItems: EvidenceItem[];
  artifactBase: string;
  tab: EvidenceTab;
  emptyLabel: string;
  cellPair?: readonly [string, string];
}

export default function EvidenceFilePaneTab({
  evidenceItems,
  artifactBase,
  tab,
  emptyLabel,
  cellPair,
}: EvidenceFilePaneTabProps) {
  const items = useMemo(
    () => evidenceItems.filter((i): i is EvidenceItem => i.tab === tab),
    [evidenceItems, tab],
  );
  const [selectedPath, setSelectedPath] = useState(items[0]?.path ?? "");

  useEffect(() => {
    setSelectedPath(items[0]?.path ?? "");
  }, [items]);

  return (
    <div className="h-full">
      <FilePane
        items={items}
        selectedPath={selectedPath}
        onSelect={setSelectedPath}
        renderViewer={(item) => (
          <EvidenceViewer
            item={item}
            artifactBase={artifactBase}
            fillParent
            cellPair={cellPair}
          />
        )}
        emptyLabel={emptyLabel}
      />
    </div>
  );
}
