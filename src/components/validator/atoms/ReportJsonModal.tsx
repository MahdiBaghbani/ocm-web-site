/**
 * OverlayFrame inspector for a full report envelope. No area filtering.
 */
import React from "react";
import {
  OverlayFrame,
  type OverlayFrameSize,
} from "../../observatory/modal/OverlayFrame";
import RawJsonPanel from "./RawJsonPanel";

export interface ReportJsonModalProps {
  title: string;
  sourceReport: unknown;
  onClose: () => void;
  downloadName: string;
  note?: string | null;
  size?: OverlayFrameSize;
}

export function ReportJsonModal({
  title,
  sourceReport,
  onClose,
  downloadName,
  note,
  size = "lg",
}: ReportJsonModalProps): React.ReactElement {
  return (
    <OverlayFrame title={title} onClose={onClose} size={size}>
      <div className="flex h-full min-h-0 flex-col gap-3">
        {note != null ? (
          <p className="shrink-0 text-sm text-zinc-400">{note}</p>
        ) : null}
        <RawJsonPanel
          value={sourceReport}
          fillParent
          downloadName={downloadName}
        />
      </div>
    </OverlayFrame>
  );
}

export default ReportJsonModal;
