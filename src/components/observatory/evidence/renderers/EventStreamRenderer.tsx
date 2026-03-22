import React, { useMemo, useState } from "react";
import type { EvidenceItem } from "../../lib/contracts";
import { ViewerFrame } from "./ViewerFrame";
import { RecordList } from "./RecordList";
import TextViewerCore from "./TextViewerCore";

interface EventStreamRendererProps {
  item: EvidenceItem;
  text: string;
  cellPair?: readonly [string, string];
  fillParent?: boolean;
  downloadName?: string;
}

// Single source of truth for traffic column widths - shared by header and rows.
const TRAFFIC_COLUMNS = {
  sender: "w-40 shrink-0",
  method: "w-16 shrink-0",
  url: "min-w-0 flex-1",
  status: "w-12 shrink-0 text-center",
  chevron: "w-5 shrink-0 text-right",
} as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Invalid lines are silently skipped; a single bad line does not abort the render.
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

function stripExt(name: string): string {
  return name.replace(/\.[^./]+$/, "");
}

function statusColor(status: string): string {
  const code = parseInt(status, 10);
  if (code >= 500) return "text-red-400";
  if (code >= 400) return "text-orange-400";
  if (code >= 300) return "text-yellow-400";
  if (code >= 200) return "text-green-400";
  return "text-zinc-400";
}

function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "text-emerald-400";
    case "POST":
      return "text-sky-400";
    case "PUT":
      return "text-amber-400";
    case "DELETE":
      return "text-rose-400";
    case "PATCH":
      return "text-violet-400";
    case "OPTIONS":
    case "HEAD":
      return "text-zinc-400";
    default:
      return "text-zinc-300";
  }
}

function parseDockerDestHost(
  url: string,
): { platform: string; digit: string } | null {
  try {
    const host = new URL(url).hostname;
    const m = /^(.+?)(\d+)\.docker$/.exec(host);
    if (!m) return null;
    return { platform: m[1], digit: m[2] };
  } catch {
    return null;
  }
}

function senderLabel(
  url: string,
  clientIp: string,
  cellPair: readonly [string, string] | undefined,
): string {
  if (!cellPair) return clientIp || "?";
  const dest = parseDockerDestHost(url);
  if (!dest) return clientIp || "?";

  const [senderPlatform, receiverPlatform] = cellPair;

  // Destination digit "1" => destination is the sender party container of the cell.
  // Therefore THIS request was sent by the receiver party container ("<receiverPlatform>2.docker").
  if (dest.platform === senderPlatform && dest.digit === "1") {
    return `${receiverPlatform}2.docker`;
  }
  // Destination digit "2" => destination is the receiver party container.
  // Sender of THIS request is the sender party container ("<senderPlatform>1.docker").
  if (dest.platform === receiverPlatform && dest.digit === "2") {
    return `${senderPlatform}1.docker`;
  }

  return clientIp || "?";
}

interface TrafficRecord {
  method: string;
  url: string;
  status: string;
  clientIp: string;
  raw: Record<string, unknown>;
}

function toTrafficRecord(rec: unknown): TrafficRecord | null {
  if (!isRecord(rec)) return null;
  const req = isRecord(rec.request) ? rec.request : undefined;
  const resp = isRecord(rec.response) ? rec.response : undefined;

  const method =
    getField(rec, "method") || (req ? getField(req, "method") : "");
  const url = getField(rec, "url") || (req ? getField(req, "url") : "");
  const status =
    getField(rec, "status") ||
    (resp ? getField(resp, "status_code", "status") : "");

  const clientField = rec.client;
  const clientIp =
    Array.isArray(clientField) && clientField.length > 0
      ? asStr(clientField[0])
      : "";

  if (!method && !url) return null;
  return { method, url, status, clientIp, raw: rec };
}

function trafficSummary(
  rec: TrafficRecord,
  _idx: number,
  open: boolean,
  cellPair: readonly [string, string] | undefined,
): React.ReactNode {
  const sender = senderLabel(rec.url, rec.clientIp, cellPair);
  return (
    <>
      <span
        className={`${TRAFFIC_COLUMNS.sender} truncate font-mono text-xs text-zinc-300`}
      >
        {sender}
      </span>
      <span
        className={`${TRAFFIC_COLUMNS.method} font-mono text-xs font-bold ${methodColor(rec.method)}`}
      >
        {rec.method || "-"}
      </span>
      <span
        className={`${TRAFFIC_COLUMNS.url} truncate font-mono text-xs text-zinc-200`}
      >
        {rec.url || "-"}
      </span>
      <span
        className={`${TRAFFIC_COLUMNS.status} font-mono text-xs ${statusColor(rec.status)}`}
      >
        {rec.status || "-"}
      </span>
      <span className={`${TRAFFIC_COLUMNS.chevron} text-xs text-zinc-400`}>
        {open ? "\u25BC" : "\u25B6"}
      </span>
    </>
  );
}

function trafficExpanded(
  rec: TrafficRecord,
  idx: number,
  downloadName: string | undefined,
): React.ReactNode {
  const r = rec.raw;
  const req = isRecord(r.request) ? r.request : undefined;
  const resp = isRecord(r.response) ? r.response : undefined;
  return (
    <>
      {req ? (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Request
          </div>
          <TextViewerCore
            content={JSON.stringify(req, null, 2)}
            language="json"
            noChip
            noInnerScroll
            downloadName={
              downloadName
                ? `${stripExt(downloadName)}-row${idx}-request.json`
                : undefined
            }
          />
        </div>
      ) : null}
      {resp ? (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Response
          </div>
          <TextViewerCore
            content={JSON.stringify(resp, null, 2)}
            language="json"
            noChip
            noInnerScroll
            downloadName={
              downloadName
                ? `${stripExt(downloadName)}-row${idx}-response.json`
                : undefined
            }
          />
        </div>
      ) : null}
    </>
  );
}

function ConnectErrorsView({
  records,
  fillParent,
  downloadName,
}: {
  records: unknown[];
  fillParent?: boolean;
  downloadName?: string;
}) {
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
    <div
      className={[
        "flex flex-col gap-2 overflow-hidden",
        fillParent ? "h-full min-h-0" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className={
          fillParent ? "flex-1 min-h-0 overflow-y-auto space-y-2" : "space-y-2"
        }
      >
        {[...groups.entries()].map(([kind, items], groupIdx) => (
          <GroupRow key={kind} kind={kind} items={items} groupIdx={groupIdx} downloadName={downloadName} />
        ))}
      </div>
    </div>
  );
}

function GroupRow({
  kind,
  items,
  groupIdx,
  downloadName,
}: {
  kind: string;
  items: unknown[];
  groupIdx: number;
  downloadName?: string;
}) {
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
            <div key={i} className="rounded border border-zinc-800 bg-zinc-950 overflow-hidden">
              <TextViewerCore
                content={JSON.stringify(item, null, 2)}
                language="json"
                noChip
                noInnerScroll
                downloadName={downloadName ? `${stripExt(downloadName)}-${kind}-${i}.json` : `${kind}-${i}.json`}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FlatView({
  records,
  fillParent,
  downloadName,
}: {
  records: unknown[];
  fillParent?: boolean;
  downloadName?: string;
}) {
  return (
    <div
      className={[
        "flex flex-col gap-2 overflow-hidden",
        fillParent ? "h-full min-h-0" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className={
          fillParent ? "flex-1 min-h-0 overflow-y-auto space-y-2" : "space-y-2"
        }
      >
        {records.map((rec, i) => (
          <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden">
            <TextViewerCore
              content={JSON.stringify(rec, null, 2)}
              language="json"
              noChip
              noInnerScroll
              downloadName={downloadName ? `${stripExt(downloadName)}-${i}.json` : `record-${i}.json`}
            />
          </div>
        ))}
        {records.length === 0 ? (
          <div className="py-6 text-center text-sm text-zinc-500">
            No records.
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function EventStreamRenderer({
  item,
  text,
  cellPair,
  fillParent,
  downloadName,
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

    const columnHeader = (
      <div className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900/50 px-3 py-1.5">
        <span
          className={`${TRAFFIC_COLUMNS.sender} text-[10px] font-semibold uppercase tracking-widest text-zinc-500`}
        >
          Sender
        </span>
        <span
          className={`${TRAFFIC_COLUMNS.method} text-[10px] font-semibold uppercase tracking-widest text-zinc-500`}
        >
          Method
        </span>
        <span
          className={`${TRAFFIC_COLUMNS.url} text-[10px] font-semibold uppercase tracking-widest text-zinc-500`}
        >
          URL
        </span>
        <span
          className={`${TRAFFIC_COLUMNS.status} text-[10px] font-semibold uppercase tracking-widest text-zinc-500`}
        >
          Status
        </span>
        <span className={TRAFFIC_COLUMNS.chevron} />
      </div>
    );

    const hint = (
      <p className="border-b border-zinc-800 bg-zinc-900/30 px-3 py-1 text-[10px] text-zinc-500">
        Click any row to inspect request and response details.
      </p>
    );

    const headerSlot = (
      <>
        {hint}
        {columnHeader}
      </>
    );

    return (
      <ViewerFrame fillParent={fillParent} headerSlot={headerSlot}>
        <RecordList
          records={trafficRecords}
          getKey={(r, i) => {
            const raw = r.raw;
            const eid =
              isRecord(raw) && typeof raw.event_id === "string"
                ? raw.event_id
                : null;
            const xid =
              isRecord(raw) && typeof raw.exchange_id === "string"
                ? raw.exchange_id
                : null;
            return eid ?? xid ?? `idx-${i}`;
          }}
          renderSummary={(r, i, open) => trafficSummary(r, i, open, cellPair)}
          renderExpanded={(r, i) => trafficExpanded(r, i, downloadName)}
          emptyState={
            <span className="text-sm text-zinc-500">No traffic records.</span>
          }
          fillParent={fillParent}
          balanceWhenCollapsed
          balanceThreshold={6}
        />
      </ViewerFrame>
    );
  }

  if (isConnectErrors) {
    return <ConnectErrorsView records={records} fillParent={fillParent} downloadName={downloadName} />;
  }

  return <FlatView records={records} fillParent={fillParent} downloadName={downloadName} />;
}
