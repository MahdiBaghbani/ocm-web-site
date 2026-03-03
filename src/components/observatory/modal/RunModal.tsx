import React, { useEffect, useMemo, useRef, useState } from "react";
import type { EvidenceItem, EvidenceManifest, EvidenceTab, SuiteManifest } from "../lib/contracts";
import { fetchJson, isAbortError } from "../lib/fetchManifest";
import { parseTabFromUrl, setTabInUrl } from "../lib/urlState";
import { OverlayFrame } from "./OverlayFrame";
import OverviewTab from "./tabs/OverviewTab";
import ScreenshotsTab from "./tabs/ScreenshotsTab";
import MitmTab from "./tabs/MitmTab";
import LogsTab from "./tabs/LogsTab";
import MetaTab from "./tabs/MetaTab";
import StackTab from "./tabs/StackTab";

interface RunModalProps {
  cellId: string;
  runId: string;
  mf: SuiteManifest | null;
  baseUrl: string;
  onClose: () => void;
  onSelectRun: (runId: string) => void;
}

export interface EvidenceTabProps {
  evidenceItems: EvidenceItem[];
  artifactBase: string;
}

const TAB_ORDER: readonly EvidenceTab[] = [
  "overview",
  "screenshots",
  "mitm",
  "logs",
  "meta",
  "stack",
];

const TAB_LABELS: Record<EvidenceTab, string> = {
  overview: "Overview",
  screenshots: "Screenshots",
  mitm: "MITM",
  logs: "Logs",
  meta: "Meta",
  stack: "Stack",
};

export function RunModal({
  cellId,
  runId,
  mf,
  baseUrl,
  onClose,
  onSelectRun,
}: RunModalProps) {
  const [activeTab, setActiveTab] = useState<EvidenceTab>(() => {
    if (typeof window === "undefined") return "overview";
    return parseTabFromUrl(window.location.href) ?? "overview";
  });

  const [evidenceManifest, setEvidenceManifest] = useState<EvidenceManifest | null>(null);

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // When runId changes, stay on the URL-selected tab if present, else Overview.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromUrl = parseTabFromUrl(window.location.href);
    setActiveTab(fromUrl ?? "overview");
  }, [runId]);

  // Derive effective cell and run from manifest.
  const effectiveCellId =
    cellId || (runId ? (mf?.runs?.[runId]?.cell_id ?? "") : "");
  const effectiveCell = effectiveCellId
    ? (mf?.cells?.[effectiveCellId] ?? null)
    : null;
  const run = runId ? (mf?.runs?.[runId] ?? null) : null;

  // Compute artifact base URL using same logic as OverviewTab.
  const artifactBase = useMemo(() => {
    const flowId = effectiveCell?.flow_id ?? "";
    const pair = effectiveCell?.pair ?? "";
    const execId = run?.execution_id ?? "";
    if (!flowId || !pair || !execId) return "";
    return `${baseUrl}artifacts/${flowId}/${pair}/${execId}/`;
  }, [baseUrl, effectiveCell, run]);

  // Fetch evidence manifest when artifactBase changes.
  useEffect(() => {
    setEvidenceManifest(null);
    if (!artifactBase) return;

    const controller = new AbortController();
    fetchJson<EvidenceManifest>(`${artifactBase}meta/evidence.v1.json`, controller.signal)
      .then((data) => {
        setEvidenceManifest(data);
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setEvidenceManifest(null);
      });
    return () => {
      controller.abort();
    };
  }, [artifactBase]);

  const evidenceItems = useMemo<EvidenceItem[]>(
    () => evidenceManifest?.items ?? [],
    [evidenceManifest],
  );

  function selectTab(tab: EvidenceTab) {
    setActiveTab(tab);
    setTabInUrl(tab === "overview" ? null : tab);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const currentIndex = TAB_ORDER.indexOf(activeTab);
    let nextIndex: number | null = null;
    if (e.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % TAB_ORDER.length;
    } else if (e.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = TAB_ORDER.length - 1;
    }
    if (nextIndex !== null) {
      e.preventDefault();
      const tab = TAB_ORDER[nextIndex];
      if (tab) {
        selectTab(tab);
        tabRefs.current[nextIndex]?.focus();
      }
    }
  }

  const sharedProps: EvidenceTabProps = { evidenceItems, artifactBase };

  const title = `Run: ${runId}`;

  function renderBody() {
    switch (activeTab) {
      case "overview":
        return (
          <OverviewTab
            cellId={effectiveCellId}
            runId={runId}
            mf={mf}
            baseUrl={baseUrl}
            onSelectRun={onSelectRun}
          />
        );
      case "screenshots":
        return <ScreenshotsTab runId={runId} mf={mf} artifactBase={artifactBase} />;
      case "mitm":
        return <MitmTab {...sharedProps} />;
      case "logs":
        return <LogsTab {...sharedProps} />;
      case "meta":
        return <MetaTab {...sharedProps} />;
      case "stack":
        return <StackTab {...sharedProps} />;
    }
  }

  return (
    <OverlayFrame title={title} onClose={onClose}>
      <div className="space-y-5">
        {/* Tab bar */}
        <div
          role="tablist"
          className="flex flex-wrap gap-1 border-b border-zinc-800 pb-1"
          onKeyDown={handleKeyDown}
        >
          {TAB_ORDER.map((tab, idx) => {
            const isActive = tab === activeTab;
            return (
              <button
                key={tab}
                ref={(el) => { tabRefs.current[idx] = el; }}
                role="tab"
                id={`runmodal-tab-${tab}`}
                aria-controls={`runmodal-panel-${tab}`}
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                type="button"
                className={[
                  "rounded-lg px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-zinc-800 font-medium text-zinc-50"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
                ].join(" ")}
                onClick={() => selectTab(tab)}
              >
                {TAB_LABELS[tab]}
              </button>
            );
          })}
        </div>

        {/* Active tab body */}
        <div
          role="tabpanel"
          id={`runmodal-panel-${activeTab}`}
          aria-labelledby={`runmodal-tab-${activeTab}`}
        >
          {renderBody()}
        </div>
      </div>
    </OverlayFrame>
  );
}
