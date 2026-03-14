/**
 * Renderer for markdown.v1 evidence.
 *
 * Composes ViewerFrame for the chip + TextViewerCore (noChip) for raw mode.
 * Mode toggle (Rendered/Raw) lives in ViewerFrame.headerSlot.
 *
 * Invariant: exactly one chip per file viewer.
 */
import React, { useMemo, useState } from "react";
import type { EvidenceItem } from "../../lib/contracts";
import { micromark } from "micromark";
import { ViewerFrame } from "./ViewerFrame";
import TextViewerCore from "./TextViewerCore";

interface MarkdownRendererProps {
  item: EvidenceItem;
  text: string;
  fillParent?: boolean;
  downloadName?: string;
}

const MICROMARK_OPTS = {
  allowDangerousHtml: false,
  allowDangerousProtocol: false,
} as const;

export default function MarkdownRenderer({ item: _, text, fillParent, downloadName }: MarkdownRendererProps) {
  const [rendered, setRendered] = useState(true);

  const html = useMemo(() => micromark(text, MICROMARK_OPTS), [text]);

  const modeToggle = (
    <div className="flex items-center gap-2 px-3 py-2">
      <button
        type="button"
        onClick={() => setRendered(true)}
        className={[
          "rounded-lg px-3 py-1 text-xs transition-colors",
          rendered
            ? "bg-zinc-800 font-medium text-zinc-100"
            : "text-zinc-400 hover:bg-zinc-800/60",
        ].join(" ")}
      >
        Rendered
      </button>
      <button
        type="button"
        onClick={() => setRendered(false)}
        className={[
          "rounded-lg px-3 py-1 text-xs transition-colors",
          !rendered
            ? "bg-zinc-800 font-medium text-zinc-100"
            : "text-zinc-400 hover:bg-zinc-800/60",
        ].join(" ")}
      >
        Raw
      </button>
    </div>
  );

  return (
    <ViewerFrame fillParent={fillParent} headerSlot={modeToggle}>
      {rendered ? (
        <div
          className="prose prose-invert max-w-none p-4 text-sm overflow-auto h-full"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <TextViewerCore
          content={text}
          language="plain"
          noChip
          fillParent={fillParent}
          downloadName={downloadName}
        />
      )}
    </ViewerFrame>
  );
}
