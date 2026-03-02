import React, { useMemo, useState } from "react";
import type { EvidenceItem } from "../../lib/contracts";
import { micromark } from "micromark";
import TextViewerCore from "./TextViewerCore";

interface MarkdownRendererProps {
  item: EvidenceItem;
  text: string;
}

const MICROMARK_OPTS = {
  allowDangerousHtml: false,
  allowDangerousProtocol: false,
} as const;

export default function MarkdownRenderer({ item: _, text }: MarkdownRendererProps) {
  const [rendered, setRendered] = useState(true);

  const html = useMemo(() => micromark(text, MICROMARK_OPTS), [text]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
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

      {rendered ? (
        <div
          className="prose prose-invert max-w-none rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 text-sm"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <TextViewerCore content={text} language="plain" />
      )}
    </div>
  );
}
