import React from "react";
import type { EvidenceItem } from "../../lib/contracts";
import TextViewerCore, { type TextViewerCoreProps } from "./TextViewerCore";

interface TextLogRendererProps {
  item: EvidenceItem;
  text: string;
  truncated: boolean;
  downloadName?: string;
  fillParent?: boolean;
}

function mapLanguage(hint: string | undefined): TextViewerCoreProps["language"] {
  switch (hint) {
    case "yaml": return "yaml";
    case "env":  return "env";
    case "tsv":  return "plain";
    default:     return "log";
  }
}

export default function TextLogRenderer({ item, text, truncated, downloadName, fillParent }: TextLogRendererProps) {
  return (
    <TextViewerCore
      key={item.path}
      content={text}
      language={mapLanguage(item.language)}
      truncated={truncated || item.truncated === true}
      truncationNote="File truncated - showing first portion only."
      downloadName={downloadName}
      fillParent={fillParent}
    />
  );
}
