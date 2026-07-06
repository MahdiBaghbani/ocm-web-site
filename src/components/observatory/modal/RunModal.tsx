import React, { useEffect, useMemo, useRef, useState } from "react";
import type { EvidenceItem, EvidenceManifest, EvidenceTab, FlowMetadata, SuiteManifest } from "../lib/contracts";
import { fetchJson, HttpError, isAbortError } from "../lib/fetchManifest";
import { nicifyCellId } from "../lib/nicify";
import type { PlatformLabelResolver } from "../lib/platformLabels";
import { parseTabFromUrl, setTabInUrl } from "../lib/urlState";
import { OverlayFrame } from "./OverlayFrame";
import OverviewTab from "./tabs/OverviewTab";
import ScreenshotsTab from "./tabs/ScreenshotsTab";
import MitmTab from "./tabs/MitmTab";
import LogsTab from "./tabs/LogsTab";
import MetaTab from "./tabs/MetaTab";
import StackTab from "./tabs/StackTab";
import type { EvidenceTabProps } from "./types";
export type { EvidenceTabProps } from "./types";

interface RunModalProps {
  cellId: string;
  runId: string;
  mf: SuiteManifest | null;
  baseUrl: string;
  flows: FlowMetadata[];
  platformLabel: PlatformLabelResolver;
  onClose: () => void;
  onSelectRun: (runId: string) => void;
}

type EvidenceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; manifest: EvidenceManifest }
  | { status: "missing" }
  | { status: "error"; message: string };

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

function EvidenceLoadingCard() {
  return (
    <div className="flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/30 p-10 text-sm text-zinc-400">
      Loading evidence...
    </div>
  );
}

function EvidenceMissingCard() {
  return (
    <div className="flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/30 p-10 text-sm text-zinc-400">
      No evidence manifest for this run.
    </div>
  );
}

function EvidenceErrorCard({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-400">
      Failed to load evidence: {message}
    </div>
  );
}

// Syncs active tab from URL, fetches the evidence manifest from the artifact
// base URL, and keeps visited tab bodies mounted (lazy-mount, then hidden).
export function RunModal({
  cellId,
  runId,
  mf,
  baseUrl,
  flows,
  platformLabel,
  onClose,
  onSelectRun,
}: RunModalProps) {
  const [activeTab, setActiveTab] = useState<EvidenceTab>(() => {
    if (typeof window === "undefined") return "overview";
    return parseTabFromUrl(window.location.href) ?? "overview";
  });
  const [everMounted, setEverMounted] = useState<Set<EvidenceTab>>(
    () => new Set([activeTab]),
  );

  const [evidenceState, setEvidenceState] = useState<EvidenceState>({ status: "idle" });

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // When runId changes, stay on the URL-selected tab if present, else Overview.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromUrl = parseTabFromUrl(window.location.href) ?? "overview";
    setActiveTab(fromUrl);
    setEverMounted(new Set([fromUrl]));
  }, [runId]);

  useEffect(() => {
    setEverMounted((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

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

  const cellPair = useMemo<readonly [string, string] | undefined>(() => {
    const sp = effectiveCell?.sender_platform;
    const rp = effectiveCell?.receiver_platform;
    if (!sp || !rp) return undefined;
    return [sp, rp] as const;
  }, [effectiveCell]);

  // Fetch evidence manifest when artifactBase changes.
  useEffect(() => {
    if (!artifactBase) {
      setEvidenceState({ status: "idle" });
      return;
    }
    setEvidenceState({ status: "loading" });
    const controller = new AbortController();
    fetchJson<EvidenceManifest>(
      `${artifactBase}meta/evidence.v1.json`,
      controller.signal,
    )
      .then((manifest) => setEvidenceState({ status: "ready", manifest }))
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        if (err instanceof HttpError && err.status === 404) {
          setEvidenceState({ status: "missing" });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setEvidenceState({ status: "error", message });
      });
    return () => controller.abort();
  }, [artifactBase]);

  const evidenceItems = useMemo<EvidenceItem[]>(
    () => (evidenceState.status === "ready" ? evidenceState.manifest.items : []),
    [evidenceState],
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

  const title = nicifyCellId(effectiveCellId, flows, platformLabel);

  function renderEvidenceTab(makeTab: () => React.ReactNode): React.ReactNode {
    switch (evidenceState.status) {
      case "idle":
      case "loading":
        return <EvidenceLoadingCard />;
      case "missing":
        return <EvidenceMissingCard />;
      case "error":
        return <EvidenceErrorCard message={evidenceState.message} />;
      case "ready":
        return makeTab();
    }
  }

  function renderTabPanel(tab: EvidenceTab, content: React.ReactNode): React.ReactNode {
    const isActive = tab === activeTab;
    return (
      <div
        key={tab}
        role="tabpanel"
        id={`runmodal-panel-${tab}`}
        aria-labelledby={`runmodal-tab-${tab}`}
        hidden={!isActive}
        className={isActive ? "h-full min-h-0" : "hidden"}
      >
        {content}
      </div>
    );
  }

  return (
    <OverlayFrame title={title} onClose={onClose}>
      <div className="flex h-full flex-col gap-5">
        <div
          role="tablist"
          className="flex shrink-0 flex-wrap gap-1 border-b border-zinc-800 pb-1"
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

        {/* Tab bodies: lazy-mounted on first visit, kept alive thereafter via `hidden` toggling. */}
        <div className="flex-1 min-h-0 relative">
          {everMounted.has("overview") &&
            renderTabPanel(
              "overview",
              <OverviewTab
                cellId={effectiveCellId}
                runId={runId}
                mf={mf}
                baseUrl={baseUrl}
                onSelectRun={onSelectRun}
              />,
            )}
          {everMounted.has("screenshots") &&
            renderTabPanel(
              "screenshots",
              <ScreenshotsTab runId={runId} mf={mf} artifactBase={artifactBase} />,
            )}
          {everMounted.has("mitm") &&
            renderTabPanel(
              "mitm",
              renderEvidenceTab(() => (
                <MitmTab {...sharedProps} cellPair={cellPair} />
              )),
            )}
          {everMounted.has("logs") &&
            renderTabPanel(
              "logs",
              renderEvidenceTab(() => <LogsTab {...sharedProps} />),
            )}
          {everMounted.has("meta") &&
            renderTabPanel(
              "meta",
              renderEvidenceTab(() => <MetaTab {...sharedProps} />),
            )}
          {everMounted.has("stack") &&
            renderTabPanel(
              "stack",
              renderEvidenceTab(() => <StackTab {...sharedProps} />),
            )}
        </div>
      </div>
    </OverlayFrame>
  );
}
