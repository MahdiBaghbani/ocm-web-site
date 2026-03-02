import React, { useMemo, useState } from "react";
import type { EvidenceItem } from "../../lib/contracts";

interface EventStreamRendererProps {
  item: EvidenceItem;
  text: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseJsonlRecords(text: string): unknown[] {
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as unknown];
      } catch {
        return [];
      }
    });
}

function asStr(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
}

function getField(rec: unknown, ...keys: string[]): string {
  if (!isRecord(rec)) return "";
  for (const k of keys) {
    if (k in rec) return asStr(rec[k]);
  }
  return "";
}

function statusColor(status: string): string {
  const code = parseInt(status, 10);
  if (code >= 500) return "text-red-400";
  if (code >= 400) return "text-orange-400";
  if (code >= 300) return "text-yellow-400";
  if (code >= 200) return "text-green-400";
  return "text-zinc-400";
}

interface TrafficRecord {
  method: string;
  url: string;
  status: string;
  elapsed: string;
  raw: Record<string, unknown>;
}

function toTrafficRecord(rec: unknown): TrafficRecord | null {
  if (!isRecord(rec)) return null;
  const req = isRecord(rec.request) ? rec.request : undefined;
  const resp = isRecord(rec.response) ? rec.response : undefined;

  const method =
    getField(rec, "method") ||
    (req ? getField(req, "method") : "");
  const url =
    getField(rec, "url") ||
    (req ? getField(req, "url") : "");
  const status =
    getField(rec, "status") ||
    (resp ? getField(resp, "status_code", "status") : "");
  const elapsed =
    getField(rec, "elapsed", "elapsed_ms") ||
    getField(rec, "duration_ms", "duration");

  if (!method && !url) return null;
  return { method, url, status, elapsed, raw: rec };
}

function TrafficRow({ rec, rowIdx }: { rec: TrafficRecord; rowIdx: number }) {
  const [open, setOpen] = useState(false);
  const r = rec.raw;
  const req = isRecord(r.request) ? r.request : undefined;
  const resp = isRecord(r.response) ? r.response : undefined;
  const panelId = `traffic-row-panel-${rowIdx}`;

  return (
    <div className="border-b border-zinc-800 last:border-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-zinc-800/40"
      >
        <span className="w-16 shrink-0 font-mono text-xs font-bold text-sky-400">
          {rec.method || "-"}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200">
          {rec.url || "-"}
        </span>
        <span className={`w-12 shrink-0 font-mono text-xs ${statusColor(rec.status)}`}>
          {rec.status || "-"}
        </span>
        {rec.elapsed ? (
          <span className="w-16 shrink-0 text-right font-mono text-xs text-zinc-500">
            {rec.elapsed}ms
          </span>
        ) : null}
        <span className="ml-1 text-xs text-zinc-600">{open ? "-" : "+"}</span>
      </button>
      {open ? (
        <div
          id={panelId}
          role="region"
          className="space-y-2 bg-zinc-900/40 px-3 pb-3 pt-1"
        >
          {req ? (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Request
              </div>
              <pre className="overflow-auto whitespace-pre-wrap break-words rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-xs text-zinc-300">
                {JSON.stringify(req, null, 2)}
              </pre>
            </div>
          ) : null}
          {resp ? (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Response
              </div>
              <pre className="overflow-auto whitespace-pre-wrap break-words rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-xs text-zinc-300">
                {JSON.stringify(resp, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ConnectErrorsView({ records }: { records: unknown[] }) {
  const groups = useMemo<Map<string, unknown[]>>(() => {
    const m = new Map<string, unknown[]>();
    for (const rec of records) {
      if (!isRecord(rec)) continue;
      const kind = asStr(rec.kind ?? rec.error_kind) || "unknown";
      const bucket = m.get(kind);
      if (bucket) {
        bucket.push(rec);
      } else {
        m.set(kind, [rec]);
      }
    }
    return m;
  }, [records]);

  if (groups.size === 0) {
    return (
      <div className="text-center py-6 text-sm text-zinc-500">
        No connect errors.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {[...groups.entries()].map(([kind, items], groupIdx) => (
        <GroupRow key={kind} kind={kind} items={items} groupIdx={groupIdx} />
      ))}
    </div>
  );
}

function GroupRow({ kind, items, groupIdx }: { kind: string; items: unknown[]; groupIdx: number }) {
  const [open, setOpen] = useState(false);
  const panelId = `connect-group-panel-${groupIdx}`;
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/20">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-zinc-800/40"
      >
        <span className="flex-1 text-xs font-medium text-zinc-200">{kind}</span>
        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
          {items.length}
        </span>
        <span className="text-xs text-zinc-600">{open ? "-" : "+"}</span>
      </button>
      {open ? (
        <div
          id={panelId}
          role="region"
          className="space-y-1 px-3 pb-3"
        >
          {items.map((item, i) => (
            <pre
              key={i}
              className="overflow-auto whitespace-pre-wrap break-words rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-xs text-zinc-300"
            >
              {JSON.stringify(item, null, 2)}
            </pre>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FlatView({ records }: { records: unknown[] }) {
  return (
    <div className="space-y-2">
      {records.map((rec, i) => (
        <pre
          key={i}
          className="overflow-auto whitespace-pre-wrap break-words rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 font-mono text-xs text-zinc-200"
        >
          {JSON.stringify(rec, null, 2)}
        </pre>
      ))}
      {records.length === 0 ? (
        <div className="py-6 text-center text-sm text-zinc-500">
          No records.
        </div>
      ) : null}
    </div>
  );
}

export default function EventStreamRenderer({
  item,
  text,
}: EventStreamRendererProps) {
  const records = useMemo(() => parseJsonlRecords(text), [text]);

  const isTraffic =
    item.logical_name === "traffic" ||
    item.path.endsWith("mitm/flows/traffic.jsonl");

  const isConnectErrors =
    item.logical_name === "connect-errors" ||
    item.path.endsWith("connect-errors.v1.jsonl");

  if (isTraffic) {
    const trafficRecords = records
      .map(toTrafficRecord)
      .filter((r): r is TrafficRecord => r !== null);

    return (
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/20">
        {/* Header row */}
        <div className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900/50 px-3 py-1.5">
          <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Method
          </span>
          <span className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            URL
          </span>
          <span className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Status
          </span>
          <span className="w-16 shrink-0 text-right text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Elapsed
          </span>
        </div>
        {trafficRecords.length === 0 ? (
          <div className="py-6 text-center text-sm text-zinc-500">
            No traffic records.
          </div>
        ) : (
          trafficRecords.map((rec, i) => <TrafficRow key={i} rec={rec} rowIdx={i} />)
        )}
      </div>
    );
  }

  if (isConnectErrors) {
    return <ConnectErrorsView records={records} />;
  }

  return <FlatView records={records} />;
}
