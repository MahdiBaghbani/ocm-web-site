import React, { useEffect, useMemo, useState } from "react";
import { fetchJson } from "../../lib/fetchManifest";
import { groupEvidence, getImageRenderModel } from "../../lib/evidenceModel";
import type {
  ImagesManifest,
  SuiteManifest,
  CellStatus,
} from "../../lib/contracts";
import { statusToUi } from "../../lib/statusStyles";
import {
  BrowserPickerRow,
  type BrowserPickerItem,
} from "../../filters/BrowserPickerRow";
import { VideoPlayer } from "../VideoPlayer";

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

  // Lazy fetch of meta/images.v1.json for the current run.
  const [imagesData, setImagesData] = useState<ImagesManifest | null>(null);
  const [imagesFetchDone, setImagesFetchDone] = useState(false);

  useEffect(() => {
    setImagesData(null);
    setImagesFetchDone(false);
    if (!artifactBase) {
      setImagesFetchDone(true);
      return;
    }
    let alive = true;
    fetchJson<ImagesManifest>(`${artifactBase}meta/images.v1.json`)
      .then((data) => {
        if (alive) {
          setImagesData(data);
          setImagesFetchDone(true);
        }
      })
      .catch(() => {
        if (alive) setImagesFetchDone(true);
      });
    return () => {
      alive = false;
    };
  }, [artifactBase]);

  const verdictUi = activeResult?.status
    ? statusToUi(activeResult.status)
    : null;

  function renderImages() {
    if (imagesData?.services?.length) {
      // Group services by role for clarity.
      const services = imagesData.services;
      const byRole: Map<string, (typeof services)[number][]> = new Map();
      for (const svc of services) {
        const bucket = byRole.get(svc.role);
        if (bucket) {
          bucket.push(svc);
        } else {
          byRole.set(svc.role, [svc]);
        }
      }
      return (
        <div className="space-y-4">
          {[...byRole.entries()].map(([role, svcs]) => (
            <div key={role}>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                {role}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {svcs.map((svc) => {
                  const shortDigest = svc.digest
                    ? svc.digest.slice(0, 19)
                    : null;
                  return (
                    <div key={svc.service} className="space-y-0.5">
                      <div className="text-xs font-medium text-zinc-300">
                        {svc.service}
                      </div>
                      <div className="font-mono text-xs text-zinc-100">
                        {svc.tag}
                      </div>
                      {shortDigest ? (
                        <div className="font-mono text-[11px] text-zinc-500">
                          digest: {shortDigest}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      );
    }

    // Still loading.
    if (!imagesFetchDone) {
      return (
        <div className="text-xs text-zinc-500">Loading image metadata...</div>
      );
    }

    // Fallback: suite-manifest run.images.
    if (!run?.images || !Object.keys(run.images).length) {
      return (
        <div className="text-sm text-zinc-400">No image metadata available.</div>
      );
    }
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {Object.entries(run.images).map(([k, v]) => {
          const prov = run.images_provenance?.[k] ?? null;
          const id = prov?.local_image_id ?? "";
          const shortId = id.startsWith("sha256:")
            ? id.slice(0, 19)
            : id.slice(0, 12);
          const digests = Array.isArray(prov?.repo_digests)
            ? prov.repo_digests
            : [];
          return (
            <div key={k} className="space-y-0.5">
              <div className="text-xs text-zinc-400">{k}</div>
              <div className="font-mono text-xs text-zinc-100">{String(v)}</div>
              {shortId ? (
                <div className="font-mono text-[11px] text-zinc-400">
                  id: {shortId}
                </div>
              ) : null}
              {digests.length ? (
                <div className="font-mono text-[11px] text-zinc-500">
                  digest: {String(digests[0])}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

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
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-6 text-sm text-zinc-300">
          No run yet for this cell.
        </div>
      </div>
    );
  }

  // Run ID present but not found in manifest.
  if (!run) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 text-sm text-zinc-300">
        Run {runId} not found in suite-manifest.v1.json.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BrowserPickerRow
        items={browserItems}
        activeCellId={effectiveCellId}
        onSelect={(item) => { if (item.runId) onSelectRun(item.runId); }}
      />

      {/* Run identity panel */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <div>
            <div className="text-xs text-zinc-400">run id</div>
            <div className="mt-0.5 break-all font-mono text-xs text-zinc-100">
              {runId}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-400">cell</div>
            <div className="mt-0.5 font-mono text-xs text-zinc-100">
              {run.cell_id || effectiveCellId}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-400">lifecycle</div>
            <div className="mt-0.5 font-mono text-xs text-zinc-200">
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
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <div>
            <div className="text-xs text-zinc-400">started</div>
            <div className="mt-0.5 font-mono text-xs text-zinc-100">
              {run.started_at}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-400">finished</div>
            <div className="mt-0.5 font-mono text-xs text-zinc-100">
              {run.finished_at}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-400">attempt</div>
            <div className="mt-0.5 font-mono text-xs text-zinc-100">
              {run.attempt_number}
            </div>
          </div>
        </div>
      </section>

      {/* Video */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-50">Video</h3>
        <VideoPlayer artifactBase={artifactBase} videoItem={videos[0] ?? null} poster={posterFromFirstScreenshot} />
      </section>

      {/* Images */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-50">Images</h3>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          {renderImages()}
          {run.stack_def_sha256 ? (
            <div className="mt-4 border-t border-zinc-800 pt-3">
              <div className="text-xs text-zinc-400">stack_def_sha256</div>
              <div className="mt-1 font-mono text-[11px] text-zinc-200">
                {run.stack_def_sha256}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Action links */}
      <div className="flex flex-wrap gap-2">
        <a
          className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
          href={`${baseUrl}observatory/runs/${encodeURIComponent(runId)}/`}
        >
          Open as page
        </a>
        {artifactBase ? (
          <a
            className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
            href={artifactBase}
            target="_blank"
            rel="noreferrer"
          >
            Raw artifacts
          </a>
        ) : null}
      </div>
    </div>
  );
}
