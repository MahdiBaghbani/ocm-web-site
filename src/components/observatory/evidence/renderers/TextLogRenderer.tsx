import React from "react";
import type { EvidenceItem } from "../../lib/contracts";
import TextViewerCore from "./TextViewerCore";

interface TextLogRendererProps {
  item: EvidenceItem;
  text: string;
  truncated: boolean;
  // downloadUrl kept for EvidenceViewer backward compatibility; download is
  // now handled internally by TextViewerCore via Blob.
  downloadUrl?: string;
}

export default function TextLogRenderer({ item, text, truncated }: TextLogRendererProps) {
  const showTruncated = truncated || item.truncated === true;

  return (
    <TextViewerCore
      key={item.path}
      content={text}
      language="log"
      followTail={false}
      truncated={showTruncated}
      truncationNote="File truncated - showing first portion only."
    />
  );
}
