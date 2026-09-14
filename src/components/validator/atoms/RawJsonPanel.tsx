/**
 * Standalone JSON panel for a manifest or report. ViewerFrame is the only
 * bordered surface; TextViewerCore must stay noChip so chips are never nested.
 * Pass fillParent to fill the parent height for modal use.
 */
import React from "react";
import { ViewerFrame } from "../../observatory/evidence/renderers/ViewerFrame";
import TextViewerCore from "../../observatory/evidence/renderers/TextViewerCore";

export interface RawJsonPanelProps {
  value: unknown;
  title?: string;
  downloadName?: string;
  /** When true, panel fills parent height and scrolls JSON internally. */
  fillParent?: boolean;
}

function formatJson(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    const text = JSON.stringify(value, null, 2);
    return text ?? "null";
  } catch {
    return "[unserializable]";
  }
}

export default function RawJsonPanel({
  value,
  title,
  downloadName = "report.json",
  fillParent,
}: RawJsonPanelProps): React.ReactElement {
  const content = formatJson(value);
  const header =
    title !== undefined && title !== "" ? (
      <h3 className="px-4 pt-4 text-sm font-semibold text-zinc-100">{title}</h3>
    ) : undefined;

  return (
    <div
      data-testid="file-viewer-chip"
      className={fillParent ? "h-full min-h-0" : undefined}
    >
      <ViewerFrame headerSlot={header} fillParent={fillParent}>
        <div className={fillParent ? "h-full min-h-0 p-4" : "p-4"}>
          <TextViewerCore
            content={content}
            language="json"
            noChip
            downloadName={downloadName}
            fillParent={fillParent}
          />
        </div>
      </ViewerFrame>
    </div>
  );
}
