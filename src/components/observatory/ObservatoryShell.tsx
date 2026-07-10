import React, { useEffect, useMemo, useState } from "react";
import { getBaseUrl, fetchJson } from "./lib/fetchManifest";
import { STATUS_OPTIONS, displayStatusToCellStatus } from "./lib/statusStyles";
import {
  parseOverlayFromUrl,
  setOverlayInUrl,
  parseExpandedFromUrl,
  setExpandedInUrl,
  type OverlayState,
} from "./lib/urlState";
import type {
  MatrixRules,
  MatrixRuleScenario,
  FlowMetadata,
  MatrixNotInScope,
  SuiteManifest,
  CellStatus,
} from "./lib/contracts";
import { createPlatformLabelResolver } from "./lib/platformLabels";
import { FilterBar } from "./filters/FilterBar";
import { FlowAccordionSection } from "./matrix/FlowAccordionSection";
import { MatrixGrid } from "./matrix/MatrixGrid";
import { NotInScopeNote } from "./matrix/NotInScopeNote";
import { RunModal } from "./modal/RunModal";
import {
  canRenderObservatory,
  evaluateMatrixRulesLoad,
  runModalRenderContext,
} from "./lib/matrixRulesLoad";

interface ObservatoryShellProps {
  initialCellId?: string;
  initialRunId?: string;
}

function latestRunIdForCell(mf: SuiteManifest | null, cellId: string): string {
  const resId = mf?.indexes?.latest_terminal_result_by_cell?.[cellId] ?? "";
  const res = resId ? (mf?.results?.[resId] ?? null) : null;
  return res?.run_id ?? "";
}

// Loads observatory JSON artifacts, owns filter and overlay URL state, and
// renders scenarios grouped by flow. Overlay open/close uses pushState; all
// other URL mutations (tab, mitm, stack, expanded) use replaceState.
export default function ObservatoryShell({
  initialCellId = "",
  initialRunId = "",
}: ObservatoryShellProps) {
  const baseUrl = getBaseUrl();

  const [rules, setRules] = useState<MatrixRules | null>(null);
  const [mf, setMf] = useState<SuiteManifest | null>(null);
  const [notInScope, setNotInScope] = useState<MatrixNotInScope | null>(null);
  const [err, setErr] = useState("");

  const [overlay, setOverlay] = useState<OverlayState>(() => {
    if (initialRunId) return { kind: "run", runId: initialRunId, cellId: "" };
    if (initialCellId) return { kind: "run", runId: "", cellId: initialCellId };
    return { kind: "closed" };
  });

  const [filters, setFilters] = useState({ browser: "all", flow: "all", query: "" });
  const [queryDebounced, setQueryDebounced] = useState("");

  const [expandedFlows, setExpandedFlows] = useState<Set<string> | null>(() => {
    if (typeof window === "undefined") return null;
    const from = parseExpandedFromUrl(window.location.href);
    return from !== null ? new Set(from) : null;
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [r, m, nis] = await Promise.all([
          fetchJson<MatrixRules>(`${baseUrl}matrix-rules.v1.json`),
          fetchJson<SuiteManifest>(`${baseUrl}suite-manifest.v1.json`),
          fetchJson<MatrixNotInScope>(`${baseUrl}matrix-not-in-scope.v1.json`).catch(() => null),
        ]);
        if (!alive) return;
        const outcome = evaluateMatrixRulesLoad(r);
        setMf(m);
        setNotInScope(nis);
        if (outcome.error) {
          setErr(outcome.error);
          setRules(outcome.rules);
          if (outcome.closeOverlay) {
            const closed: OverlayState = { kind: "closed" };
            setOverlay(closed);
            setOverlayInUrl(closed, { replace: true });
          }
        } else {
          setRules(outcome.rules);
        }
      } catch (e) {
        if (!alive) return;
        setErr(String(e instanceof Error ? e.message : e));
        setRules(null);
        const closed: OverlayState = { kind: "closed" };
        setOverlay(closed);
        setOverlayInUrl(closed, { replace: true });
      }
    })();
    return () => { alive = false; };
  }, [baseUrl]);

  useEffect(() => {
    const apply = () => setOverlay(parseOverlayFromUrl(window.location.href));
    window.addEventListener("popstate", apply);
    apply();
    return () => window.removeEventListener("popstate", apply);
  }, []);

  useEffect(() => {
    if (err || !rules) return;
    const fromUrl = parseOverlayFromUrl(window.location.href);
    if (fromUrl.kind !== "closed") return;
    if (initialRunId) {
      const next: OverlayState = { kind: "run", runId: initialRunId, cellId: "" };
      setOverlayInUrl(next);
      setOverlay(next);
    } else if (initialCellId) {
      const next: OverlayState = { kind: "run", runId: "", cellId: initialCellId };
      setOverlayInUrl(next);
      setOverlay(next);
    }
  }, [initialCellId, initialRunId, err, rules]);

  // Deep-link boot: resolve latest run once manifest is available (same as openCell).
  useEffect(() => {
    if (!mf || err || !rules) return;
    if (overlay.kind !== "run" || overlay.runId || !overlay.cellId) return;
    const latestRunId = latestRunIdForCell(mf, overlay.cellId);
    if (!latestRunId) return;
    const next: OverlayState = {
      kind: "run",
      runId: latestRunId,
      cellId: overlay.cellId,
    };
    setOverlay(next);
    setOverlayInUrl(next, { replace: true });
  }, [mf, overlay, err, rules]);

  // Debounce query; clear immediately when empty.
  useEffect(() => {
    if (filters.query === "") { setQueryDebounced(""); return; }
    const t = setTimeout(() => setQueryDebounced(filters.query), 300);
    return () => clearTimeout(t);
  }, [filters.query]);

  const scenarios = Array.isArray(rules?.matrix) ? rules.matrix : [];

  const matrixByCell = useMemo(() => {
    const m = new Map<string, MatrixRuleScenario>();
    for (const s of scenarios) {
      if (s?.cell_id) m.set(s.cell_id, s);
    }
    return m;
  }, [scenarios]);

  const flowFilterOptions = useMemo(() => {
    const idsInScenarios = new Set<string>();
    for (const s of scenarios) {
      idsInScenarios.add(s.flow_id);
    }
    return (rules?.flows ?? [])
      .filter((f) => idsInScenarios.has(f.flow_id))
      .sort((a, b) => a.display_order - b.display_order)
      .map((f) => ({ flowId: f.flow_id, label: f.label }));
  }, [rules?.flows, scenarios]);

  const flowOptions = useMemo(
    () => flowFilterOptions.map((f) => f.flowId),
    [flowFilterOptions],
  );

  const browserOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of scenarios) {
      if (s?.browser) set.add(s.browser);
    }
    return [...set].sort();
  }, [scenarios]);

  const getCellStatus = (cellId: string): CellStatus => {
    const scenario = matrixByCell.get(cellId);
    if (!scenario) return "unknown";
    const resId = mf?.indexes?.latest_terminal_result_by_cell?.[cellId] ?? "";
    if (resId) {
      const resultStatus = mf?.results?.[resId]?.status;
      if (resultStatus) return resultStatus;
    }
    return displayStatusToCellStatus(scenario.display_status);
  };

  const getCellDimmed = (cellId: string): boolean => {
    if (filters.browser === "all") return false;
    return matrixByCell.get(cellId)?.browser !== filters.browser;
  };

  // Build a lookup map from flow_id to FlowMetadata for sort + label use.
  const flowMetaById = useMemo<Map<string, FlowMetadata>>(() => {
    const m = new Map<string, FlowMetadata>();
    for (const f of (rules?.flows ?? [])) m.set(f.flow_id, f);
    return m;
  }, [rules]);

  const platformLabel = useMemo(
    () => createPlatformLabelResolver(rules?.platforms),
    [rules?.platforms],
  );

  const flows = useMemo(() => {
    const byFlow = new Map<string, MatrixRuleScenario[]>();
    const q = queryDebounced.trim().toLowerCase();
    for (const s of scenarios) {
      if (filters.flow !== "all" && s.flow_id !== filters.flow) continue;
      if (q) {
        const hay = [
          s?.cell_id, s?.matrix_key, s?.flow_id, s?.browser,
          s?.sender_platform, s?.sender_version, s?.receiver_platform,
          s?.receiver_version, s?.artifact_name,
          platformLabel(s?.sender_platform ?? ""),
          platformLabel(s?.receiver_platform ?? ""),
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const f = s.flow_id;
      if (!byFlow.has(f)) byFlow.set(f, []);
      byFlow.get(f)!.push(s);
    }
    for (const rows of byFlow.values())
      rows.sort((a, b) => String(a?.cell_id || "").localeCompare(String(b?.cell_id || "")));

    // Sort by published display_order (load validation guarantees metadata exists).
    const sorted = [...byFlow.entries()].sort((a, b) => {
      const ma = flowMetaById.get(a[0]);
      const mb = flowMetaById.get(b[0]);
      return (ma?.display_order ?? 0) - (mb?.display_order ?? 0);
    });

    return sorted.flatMap(([flowId, cells]) => {
      if (cells.length === 0) return [];
      const meta = flowMetaById.get(flowId);
      // Load validation guarantees metadata; omit impossible entries at runtime.
      if (!meta) return [];
      return [{
        flowId,
        glyphId: meta.glyph_id,
        cells,
        label: meta.label,
        subtitle: meta.subtitle,
        rollupBadges: STATUS_OPTIONS.map((status) => ({
          status,
          count: cells.filter((c) => getCellStatus(c.cell_id) === status).length,
        })),
      }];
    });
  }, [scenarios, filters.flow, queryDebounced, mf, matrixByCell, flowMetaById, platformLabel]);

  const isExpanded = (flowId: string): boolean =>
    expandedFlows === null || expandedFlows.has(flowId);

  function toggleFlow(flowId: string) {
    const prev = expandedFlows;
    let next: Set<string>;
    if (prev === null) {
      next = new Set(flowOptions.filter((id) => id !== flowId));
    } else {
      next = new Set(prev);
      if (next.has(flowId)) next.delete(flowId);
      else next.add(flowId);
    }
    if (flowOptions.every((id) => next.has(id))) {
      setExpandedFlows(null);
      setExpandedInUrl(null);
    } else {
      setExpandedFlows(next);
      setExpandedInUrl([...next].sort());
    }
  }

  function pushOverlay(next: OverlayState) {
    setOverlay(next);
    setOverlayInUrl(next);
  }

  function openCell(cellId: string) {
    pushOverlay({
      kind: "run",
      runId: latestRunIdForCell(mf, cellId),
      cellId,
    });
  }

  function closeOverlay() {
    pushOverlay({ kind: "closed" });
  }

  function handleSelectRun(newRunId: string) {
    const newRun = newRunId ? (mf?.runs?.[newRunId] ?? null) : null;
    const newCellId =
      newRun?.cell_id ??
      (overlay.kind === "run" ? overlay.cellId : "");
    pushOverlay({ kind: "run", runId: newRunId, cellId: newCellId });
  }

  const runModal = runModalRenderContext(rules, err, overlay);

  return (
    <div className="space-y-6">
      {err ? (
        <div className="rounded-2xl border border-rose-900/50 bg-rose-950/30 p-5 text-sm text-rose-200">
          Observatory data is missing or does not satisfy the published site
          contract. Run `ocmts site ingest` before build/deploy when inputs are
          absent; otherwise fix the published matrix-rules payload.
          <div className="mt-2 font-mono text-xs text-rose-200/90">{err}</div>
        </div>
      ) : null}

      {!rules && !err ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/20 p-6 text-sm text-zinc-300">
          Loading matrix...
        </div>
      ) : canRenderObservatory(rules, err) ? (
        <>
          <FilterBar
            browserOptions={browserOptions}
            flowFilterOptions={flowFilterOptions}
            filters={filters}
            onChange={setFilters}
            onClear={() => setFilters({ browser: "all", flow: "all", query: "" })}
          />

          <div className="space-y-4">
            {flows.map(({ flowId, glyphId, cells, label, subtitle, rollupBadges }) => (
              <FlowAccordionSection
                key={flowId}
                flowId={flowId}
                label={label}
                subtitle={subtitle}
                cellCount={cells.length}
                rollupBadges={rollupBadges}
                expanded={isExpanded(flowId)}
                onToggle={toggleFlow}
              >
                <MatrixGrid
                  cells={cells}
                  getCellStatus={getCellStatus}
                  onOpenCell={openCell}
                  getCellDimmed={getCellDimmed}
                  flowId={flowId}
                  glyphId={glyphId}
                  platformLabel={platformLabel}
                />
                <NotInScopeNote
                  flowId={flowId}
                  notInScope={notInScope}
                  platformLabel={platformLabel}
                />
              </FlowAccordionSection>
            ))}
          </div>
        </>
      ) : null}

      {runModal ? (
        <RunModal
          cellId={runModal.overlay.cellId}
          runId={runModal.overlay.runId}
          mf={mf}
          baseUrl={baseUrl}
          flows={runModal.rules.flows ?? []}
          platformLabel={platformLabel}
          onClose={closeOverlay}
          onSelectRun={handleSelectRun}
        />
      ) : null}
    </div>
  );
}
