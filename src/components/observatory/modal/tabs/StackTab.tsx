import React, { useRef, useState } from "react";
import type { EvidenceTabProps } from "../types";
import StackSummaryPane from "../../stack/StackSummaryPane";
import EvidenceFilePaneTab from "./EvidenceFilePaneTab";
import { parseStackFromUrl, setStackInUrl } from "../../lib/urlState";
import type { StackSubTab } from "../../lib/urlState";

const SUBTAB_ORDER: readonly StackSubTab[] = ["summary", "files"];

export default function StackTab({ evidenceItems, artifactBase }: EvidenceTabProps) {
  const [stackSubTab, setStackSubTab] = useState<StackSubTab>(() => {
    const fromUrl =
      typeof window !== "undefined"
        ? parseStackFromUrl(window.location.href)
        : null;
    return fromUrl ?? "summary";
  });

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function selectSubTab(value: StackSubTab) {
    setStackSubTab(value);
    setStackInUrl(value);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const currentIdx = SUBTAB_ORDER.indexOf(stackSubTab);
    let next: StackSubTab | undefined;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      next = SUBTAB_ORDER[(currentIdx + 1) % SUBTAB_ORDER.length];
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      next =
        SUBTAB_ORDER[(currentIdx - 1 + SUBTAB_ORDER.length) % SUBTAB_ORDER.length];
    }
    if (next) {
      selectSubTab(next);
      const allIdx = SUBTAB_ORDER.indexOf(next);
      tabRefs.current[allIdx]?.focus();
    }
  }

  const pillBase = "rounded-md px-3 py-1 text-xs font-medium transition-colors";
  const pillActive = `${pillBase} bg-zinc-800 text-zinc-50`;
  const pillInactive = `${pillBase} text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60`;

  return (
    <div className="flex h-full flex-col gap-3">
      <div
        role="tablist"
        className="inline-flex shrink-0 gap-1 rounded-lg bg-zinc-900/40 p-1"
        onKeyDown={handleKeyDown}
      >
        <button
          ref={(el) => {
            tabRefs.current[0] = el;
          }}
          role="tab"
          id="stack-subtab-summary"
          aria-controls="stack-subtab-panel-summary"
          aria-selected={stackSubTab === "summary"}
          tabIndex={stackSubTab === "summary" ? 0 : -1}
          type="button"
          className={stackSubTab === "summary" ? pillActive : pillInactive}
          onClick={() => selectSubTab("summary")}
        >
          Summary
        </button>
        <button
          ref={(el) => {
            tabRefs.current[1] = el;
          }}
          role="tab"
          id="stack-subtab-files"
          aria-controls="stack-subtab-panel-files"
          aria-selected={stackSubTab === "files"}
          tabIndex={stackSubTab === "files" ? 0 : -1}
          type="button"
          className={stackSubTab === "files" ? pillActive : pillInactive}
          onClick={() => selectSubTab("files")}
        >
          Files
        </button>
      </div>

      <div
        role="tabpanel"
        id={`stack-subtab-panel-${stackSubTab}`}
        aria-labelledby={`stack-subtab-${stackSubTab}`}
        className="min-h-0 flex-1"
      >
        {stackSubTab === "summary" ? (
          <StackSummaryPane artifactBase={artifactBase} />
        ) : (
          <EvidenceFilePaneTab
            evidenceItems={evidenceItems}
            artifactBase={artifactBase}
            tab="stack"
            emptyLabel="No stack files."
          />
        )}
      </div>
    </div>
  );
}
