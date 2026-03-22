import React, { useMemo } from "react";
import { groupEvidence, getImageRenderModel } from "../../lib/evidenceModel";
import type {
  SuiteManifest,
  CellStatus,
} from "../../lib/contracts";
import { statusToUi } from "../../lib/statusStyles";
import {
  BrowserPickerRow,
  type BrowserPickerItem,
} from "../../filters/BrowserPickerRow";
import { VideoPlayer } from "../VideoPlayer";
import SummaryCard from "../../ui/SummaryCard";

interface OverviewTabProps {
  cellId: string;
  runId: string;
  mf: SuiteManifest | null;
  baseUrl: string;
  onSelectRun: (runId: string) => void;
}

export default function OverviewTab({
  cellId,
  runId,
  mf,
  baseUrl,
  onSelectRun,
}: OverviewTabProps) {
  const cell = cellId ? (mf?.cells?.[cellId] ?? null) : null;
  const run = runId ? (mf?.runs?.[runId] ?? null) : null;

  // Use the run's cell if cellId is not directly provided (deep-link case).
  const effectiveCell =
    cell ?? (run?.cell_id ? (mf?.cells?.[run.cell_id] ?? null) : null);
  const effectiveCellId = effectiveCell?.id ?? cellId;

  // Active result: scan by runId first so deep-links always show the right run.
  // Fall back to the latest result for the effective cell when runId is empty.
  const activeResult = useMemo(() => {
    if (!mf) return null;
    if (runId) {
      const found = Object.values(mf.results ?? {}).find(
        (r) => r.run_id === runId,
      );
      if (found) return found;
    }
    const latestResId = effectiveCellId
      ? (mf.indexes?.latest_terminal_result_by_cell?.[effectiveCellId] ?? "")
      : "";
    return latestResId ? (mf.results?.[latestResId] ?? null) : null;
  }, [mf, runId, effectiveCellId]);

  const artifactBase = useMemo(() => {
    const flowId = effectiveCell?.flow_id ?? "";
    const pair = effectiveCell?.pair ?? "";
    const execId = run?.execution_id ?? "";
    if (!flowId || !pair || !execId) return "";
    return `${baseUrl}artifacts/${flowId}/${pair}/${execId}/`;
  }, [baseUrl, effectiveCell, run]);

  // Evidence from the active result (video entries use kind === "video").
  const evidence = useMemo(() => groupEvidence(activeResult), [activeResult]);
  const videos = evidence.get("video") ?? [];

  const posterFromFirstScreenshot = useMemo(() => {
    const screenshotItem = evidence.get("screenshot")?.[0];
    if (!screenshotItem) return undefined;
    return getImageRenderModel(screenshotItem, artifactBase).fallbackSrc || undefined;
  }, [evidence, artifactBase]);

  // Browser picker: all cells sharing the same flow/pair group.
  const browserItems = useMemo<BrowserPickerItem[]>(() => {
    if (!mf || !effectiveCellId) return [];
    const anchor = mf.cells?.[effectiveCellId];
    if (!anchor) return [];
    const group = Object.values(mf.cells ?? {}).filter(
      (c) => c.flow_id === anchor.flow_id && c.pair === anchor.pair,
    );
    return group.map((c) => {
      const sibResId =
        mf.indexes?.latest_terminal_result_by_cell?.[c.id] ?? "";
      const sibRes = sibResId ? (mf.results?.[sibResId] ?? null) : null;
      const sibRunId =
        sibRes?.run_id ?? (c.id === effectiveCellId ? runId : "");
      const status: CellStatus = sibRes?.status ?? "unknown";
      return { browser: c.browser, runId: sibRunId, cellId: c.id, status };
    });
  }, [mf, effectiveCellId, runId]);

  const verdictUi = activeResult?.status
    ? statusToUi(activeResult.status)
    : null;

  // No-run state: show browser picker (if applicable) and a friendly card.
  if (!runId) {
    return (
      <div className="space-y-4">
        {browserItems.length > 1 ? (
          <BrowserPickerRow
            items={browserItems}
            activeCellId={effectiveCellId}
            onSelect={(item) => { if (item.runId) onSelectRun(item.runId); }}
          />
        ) : null}
        <SummaryCard padding="lg"><span className="text-sm text-zinc-300">No run yet for this cell.</span></SummaryCard>
      </div>
    );
  }

  // Run ID present but not found in manifest.
  if (!run) {
    return (
      <SummaryCard><span className="text-sm text-zinc-300">Run {runId} not found in suite-manifest.v1.json.</span></SummaryCard>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <div className="shrink-0">
        <BrowserPickerRow
          items={browserItems}
          activeCellId={effectiveCellId}
          onSelect={(item) => { if (item.runId) onSelectRun(item.runId); }}
        />
      </div>

      <section className="grid shrink-0 gap-4 md:grid-cols-2">
        <SummaryCard title="Run identity" className="min-w-0">
          <div className="space-y-3">
            <div>
              <div className="text-xs text-zinc-400">run id</div>
              <div className="mt-0.5 break-all font-mono text-xs text-zinc-100">
                {runId}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-400">cell</div>
              <div className="mt-0.5 break-all font-mono text-xs text-zinc-100">
                {run.cell_id || effectiveCellId}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-400">lifecycle</div>
              <div className="mt-0.5 break-all font-mono text-xs text-zinc-200">
                {run.lifecycle_status}
              </div>
            </div>
            {verdictUi ? (
              <div>
                <div className="text-xs text-zinc-400">verdict</div>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${verdictUi.dot}`}
                  />
                  <span className={`text-xs font-medium ${verdictUi.text}`}>
                    {activeResult?.status}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </SummaryCard>
        <SummaryCard title="Timing" className="min-w-0">
          <div className="space-y-3">
            <div>
              <div className="text-xs text-zinc-400">started</div>
              <div className="mt-0.5 break-all font-mono text-xs text-zinc-100">
                {run.started_at}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-400">finished</div>
              <div className="mt-0.5 break-all font-mono text-xs text-zinc-100">
                {run.finished_at}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-400">attempt</div>
              <div className="mt-0.5 break-all font-mono text-xs text-zinc-100">
                {run.attempt_number}
              </div>
            </div>
          </div>
        </SummaryCard>
      </section>

      <section className="flex flex-1 min-h-0 flex-col gap-2">
        <h3 className="shrink-0 text-sm font-semibold text-zinc-50">Video</h3>
        <div className="min-h-0 flex-1">
          <VideoPlayer artifactBase={artifactBase} videoItem={videos[0] ?? null} poster={posterFromFirstScreenshot} />
        </div>
      </section>
    </div>
  );
}
