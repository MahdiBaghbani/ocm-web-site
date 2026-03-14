/**
 * Renderer for jsonl.v1 evidence (one JSON per line, or single JSON object).
 *
 * Multi-record path: ViewerFrame (with filter input as headerSlot) + RecordList
 * of expandable record rows. Each row shows a shape-aware summary (HTTP, OCM
 * details, kind/type, or fallback); expanding renders the full pretty JSON
 * inside a noChip TextViewerCore.
 *
 * Single-record path: TextViewerCore with default chip - identical look to
 * TextLogRenderer for visual consistency.
 *
 * Invariant: exactly one chip per file viewer (provided by ViewerFrame or by
 * TextViewerCore default chip; never both).
 */
import React, { useMemo, useState } from "react";
import type { EvidenceItem } from "../../lib/contracts";
import { ViewerFrame } from "./ViewerFrame";
import { RecordList } from "./RecordList";
import TextViewerCore from "./TextViewerCore";

interface JsonlRendererProps {
  item: EvidenceItem;
  text: string;
  fillParent?: boolean;
  downloadName?: string;
}

function parseRecords(text: string): unknown[] {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const perLine: unknown[] = [];
  let allParsed = true;
  for (const line of lines) {
    try {
      perLine.push(JSON.parse(line) as unknown);
    } catch {
      allParsed = false;
      break;
    }
  }
  if (allParsed && perLine.length > 0) return perLine;

  // Fallback: try to parse the whole text as a single JSON value.
  try {
    const val = JSON.parse(text) as unknown;
    if (Array.isArray(val)) return val as unknown[];
    return [val];
  } catch {
    return [];
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asScalar(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function summarizeJsonRecord(rec: unknown, idx: number): string {
  if (!isRecord(rec)) return `Record ${idx + 1}`;

  // Priority 1: Nested HTTP shape (e.g., 99-traffic-pretty.json)
  const req = isRecord(rec.request) ? rec.request : null;
  const resp = isRecord(rec.response) ? rec.response : null;
  if (req && asScalar(req.method) && asScalar(req.url)) {
    const method = asScalar(req.method);
    const url = asScalar(req.url);
    const status = resp ? asScalar(resp.status_code) : "";
    return status ? `${method}  ${url}  ${status}` : `${method}  ${url}`;
  }

  // Priority 2: OCM details flat shape with role context (e.g., 03-02-ocm-details.json)
  const fromRole = asScalar(rec.from_role);
  const toRole = asScalar(rec.to_role);
  const endpointId = asScalar(rec.endpoint_id);
  if (fromRole && toRole && endpointId) {
    const method = asScalar(rec.method);
    const status = asScalar(rec.status_code);
    const parts = [`${fromRole} -> ${toRole}`, endpointId];
    if (method) parts.push(method);
    if (status) parts.push(status);
    return parts.join("  ");
  }

  // Priority 3: Flat HTTP shape (no role context)
  if (asScalar(rec.method) && asScalar(rec.url)) {
    const method = asScalar(rec.method);
    const url = asScalar(rec.url);
    const status = asScalar(rec.status_code);
    return status ? `${method}  ${url}  ${status}` : `${method}  ${url}`;
  }

  // Priority 4: kind/type with first scalar fields
  const kind =
    asScalar(rec.kind) || asScalar(rec.type) || asScalar(rec.event_type);
  if (kind) {
    const extras: string[] = [];
    for (const [k, v] of Object.entries(rec)) {
      if (k === "kind" || k === "type" || k === "event_type") continue;
      const s = asScalar(v);
      if (s) extras.push(`${k}=${s}`);
      if (extras.length >= 2) break;
    }
    return extras.length ? `${kind}  ${extras.join("  ")}` : kind;
  }

  // Fallback
  const json = JSON.stringify(rec);
  return `Record ${idx + 1}: ${json.length > 80 ? json.slice(0, 80) + "..." : json}`;
}

function getRecordKey(rec: unknown, idx: number): string {
  if (!isRecord(rec)) return `idx-${idx}`;
  const eid = asScalar(rec.event_id);
  if (eid) return eid;
  const xid = asScalar(rec.exchange_id);
  if (xid) return xid;
  const id = asScalar(rec.id);
  if (id) return id;
  return `idx-${idx}`;
}

export default function JsonlRenderer({ item: _, text, fillParent, downloadName }: JsonlRendererProps) {
  const records = useMemo(() => parseRecords(text), [text]);
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filter) return records;
    const needle = filter.toLowerCase();
    return records.filter((r) =>
      JSON.stringify(r).toLowerCase().includes(needle),
    );
  }, [records, filter]);

  if (records.length > 1) {
    const filterRow = (
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          type="text"
          placeholder="Filter records..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-7 rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        <span className="text-xs text-zinc-500">
          {filtered.length} / {records.length}
        </span>
      </div>
    );

    return (
      <ViewerFrame fillParent={fillParent} headerSlot={filterRow}>
        <RecordList
          records={filtered}
          getKey={getRecordKey}
          renderSummary={(rec, idx) => (
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200">
              {summarizeJsonRecord(rec, idx)}
            </span>
          )}
          renderExpanded={(rec) => (
            <TextViewerCore
              content={JSON.stringify(rec, null, 2)}
              language="json"
              noChip
              noInnerScroll
              downloadName={downloadName}
            />
          )}
          emptyState={
            <span className="text-sm text-zinc-500">No matching records.</span>
          }
          fillParent={fillParent}
          balanceWhenCollapsed
          balanceThreshold={6}
        />
      </ViewerFrame>
    );
  }

  return (
    <TextViewerCore
      content={records.length === 1 ? JSON.stringify(records[0], null, 2) : ""}
      language="json"
      fillParent={fillParent}
      downloadName={downloadName}
    />
  );
}
