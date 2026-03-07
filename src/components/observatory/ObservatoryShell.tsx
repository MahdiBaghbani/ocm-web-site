import React, { useEffect, useMemo, useState } from "react";
import { getBaseUrl, fetchJson } from "./lib/fetchManifest";
import { STATUS_OPTIONS } from "./lib/statusStyles";
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
  ImplementedCells,
  ImplementedCell,
  CellStatus,
} from "./lib/contracts";
import { FilterBar } from "./filters/FilterBar";
import { FlowAccordionSection } from "./matrix/FlowAccordionSection";
import { MatrixGrid } from "./matrix/MatrixGrid";
import { NotInScopeNote } from "./matrix/NotInScopeNote";
import { RunModal } from "./modal/RunModal";

interface ObservatoryShellProps {
  initialCellId?: string;
  initialRunId?: string;
}

export default function ObservatoryShell({
  initialCellId = "",
  initialRunId = "",
}: ObservatoryShellProps) {
  const baseUrl = getBaseUrl();

  const [rules, setRules] = useState<MatrixRules | null>(null);
  const [mf, setMf] = useState<SuiteManifest | null>(null);
  const [impl, setImpl] = useState<ImplementedCells | null>(null);
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
        const [r, m, i, nis] = await Promise.all([
          fetchJson<MatrixRules>(`${baseUrl}matrix-rules.v1.json`),
          fetchJson<SuiteManifest>(`${baseUrl}suite-manifest.v1.json`),
          fetchJson<ImplementedCells>(`${baseUrl}implemented-cells.v1.json`).catch(() => null),
          fetchJson<MatrixNotInScope>(`${baseUrl}matrix-not-in-scope.v1.json`).catch(() => null),
        ]);
        if (!alive) return;
        setRules(r);
        setMf(m);
        setImpl(i);
        setNotInScope(nis);
      } catch (e) {
        if (!alive) return;
        setErr(String(e instanceof Error ? e.message : e));
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
  }, [initialCellId, initialRunId]);

  // Debounce query; clear immediately when empty.
  useEffect(() => {
    if (filters.query === "") { setQueryDebounced(""); return; }
    const t = setTimeout(() => setQueryDebounced(filters.query), 300);
    return () => clearTimeout(t);
  }, [filters.query]);

  const scenarios = Array.isArray(rules?.scenarios) ? rules.scenarios : [];

  const matrixByCell = useMemo(() => {
    const m = new Map<string, MatrixRuleScenario>();
    for (const s of scenarios) {
      if (s?.cell_id) m.set(s.cell_id, s);
    }
    return m;
  }, [scenarios]);

  const implementedByCell = useMemo<Record<string, ImplementedCell>>(
    () => (impl?.cells && typeof impl.cells === "object" ? impl.cells : {}),
    [impl],
  );

  const flowOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of scenarios) set.add(s?.flow_id || "unknown");
    return [...set].sort((a, b) => String(a).localeCompare(String(b)));
  }, [scenarios]);

  const browserOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of scenarios) {
      if (s?.browser) set.add(s.browser);
    }
    return [...set].sort();
  }, [scenarios]);

  const getCellStatus = (cellId: string): CellStatus => {
    const scenario = matrixByCell.get(cellId);
    if (scenario?.display_status === "vendor-out-of-scope") return "vendor-out-of-scope";
    if (scenario?.enabled === false) return "placeholder";
    const resId = mf?.indexes?.latest_terminal_result_by_cell?.[cellId] ?? "";
    if (resId) return mf?.results?.[resId]?.status ?? "unknown";
    const implEntry = implementedByCell?.[cellId] ?? null;
    if (implEntry && implEntry.implemented === false) return "test-implementation-pending";
    if (impl && !implEntry) return "test-implementation-pending";
    return "not-run";
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

  const flows = useMemo(() => {
    const byFlow = new Map<string, MatrixRuleScenario[]>();
    const q = queryDebounced.trim().toLowerCase();
    for (const s of scenarios) {
      if (filters.flow !== "all" && (s?.flow_id || "unknown") !== filters.flow) continue;
      if (q) {
        const hay = [
          s?.cell_id, s?.scenario, s?.flow_id, s?.browser,
          s?.sender_platform, s?.sender_version, s?.receiver_platform,
          s?.receiver_version, s?.artifact_name,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const f = s?.flow_id || "unknown";
      if (!byFlow.has(f)) byFlow.set(f, []);
      byFlow.get(f)!.push(s);
    }
    for (const rows of byFlow.values())
      rows.sort((a, b) => String(a?.cell_id || "").localeCompare(String(b?.cell_id || "")));

    // T18.4: sort by display_order; flows not in metadata fall to the end alphabetically.
    const sorted = [...byFlow.entries()].sort((a, b) => {
      const ma = flowMetaById.get(a[0]);
      const mb = flowMetaById.get(b[0]);
      if (ma != null && mb != null) return ma.display_order - mb.display_order;
      if (ma != null) return -1;
      if (mb != null) return 1;
      return String(a[0]).localeCompare(String(b[0]));
    });

    return sorted
      .map(([flowId, cells]) => {
        const meta = flowMetaById.get(flowId);
        return {
          flowId,
          cells,
          label: meta?.label || "",
          subtitle: meta?.subtitle || "",
          rollupBadges: STATUS_OPTIONS.map((status) => ({
            status,
            count: cells.filter((c) => getCellStatus(c.cell_id) === status).length,
          })),
        };
      })
      // T18.6: skip flows with zero visible cells after all filters.
      .filter(({ cells }) => cells.length > 0);
  }, [scenarios, filters.flow, queryDebounced, mf, matrixByCell, impl, implementedByCell, flowMetaById]);

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
    const resId = mf?.indexes?.latest_terminal_result_by_cell?.[cellId] ?? "";
    const res = resId ? (mf?.results?.[resId] ?? null) : null;
    const latestRunId = res?.run_id ?? "";
    pushOverlay({ kind: "run", runId: latestRunId, cellId });
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

  return (
    <div className="space-y-6">
      {err ? (
        <div className="rounded-2xl border border-rose-900/50 bg-rose-950/30 p-5 text-sm text-rose-200">
          Missing inputs. Run `ocmts site ingest` before build/deploy.
          <div className="mt-2 font-mono text-xs text-rose-200/90">{err}</div>
        </div>
      ) : null}

      {!rules ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/20 p-6 text-sm text-zinc-300">
          Loading matrix...
        </div>
      ) : (
        <>
          <FilterBar
            browserOptions={browserOptions}
            flowOptions={flowOptions}
            filters={filters}
            onChange={setFilters}
            onClear={() => setFilters({ browser: "all", flow: "all", query: "" })}
          />

          <div className="space-y-4">
            {flows.map(({ flowId, cells, label, subtitle, rollupBadges }) => (
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
                />
                <NotInScopeNote flowId={flowId} notInScope={notInScope} />
              </FlowAccordionSection>
            ))}
          </div>
        </>
      )}

      {overlay.kind === "run" ? (
        <RunModal
          cellId={overlay.cellId}
          runId={overlay.runId}
          mf={mf}
          baseUrl={baseUrl}
          flows={rules?.flows ?? []}
          onClose={closeOverlay}
          onSelectRun={handleSelectRun}
        />
      ) : null}
    </div>
  );
}
