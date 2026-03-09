import React from "react";
import type { EvidenceItem } from "../../lib/contracts";
import TextViewerCore, { type TextViewerCoreProps } from "./TextViewerCore";

interface TextLogRendererProps {
  item: EvidenceItem;
  text: string;
  truncated: boolean;
  // downloadUrl kept for EvidenceViewer backward compatibility; download is
  // now handled internally by TextViewerCore via Blob.
  downloadUrl?: string;
}

function mapLanguage(hint: string | undefined): TextViewerCoreProps["language"] {
  switch (hint) {
    case "yaml": return "yaml";
    case "env":  return "env";
    case "tsv":  return "plain";
    default:     return "log";
  }
}

export default function TextLogRenderer({ item, text, truncated }: TextLogRendererProps) {
  return (
    <TextViewerCore
      key={item.path}
      content={text}
      language={mapLanguage(item.language)}
      truncated={truncated || item.truncated === true}
      truncationNote="File truncated - showing first portion only."
    />
  );
}
