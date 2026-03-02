import React, { useMemo, useState } from "react";
import type { EvidenceItem } from "../../lib/contracts";
import KeyValueSummary from "../KeyValueSummary";
import TextViewerCore from "./TextViewerCore";

interface JsonlRendererProps {
  item: EvidenceItem;
  text: string;
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

function recordSummaryEntries(
  records: unknown[],
): Array<{ label: string; value: string; mono: boolean }> | null {
  if (records.length === 0) return null;
  const first = records[0];
  if (typeof first !== "object" || first === null) return null;

  const rec = first as Record<string, unknown>;
  const entries: Array<{ label: string; value: string; mono: boolean }> = [];

  for (const key of ["kind", "result", "run", "cell", "summary", "schema_version", "status"]) {
    if (key in rec && rec[key] !== null && rec[key] !== undefined) {
      entries.push({ label: key, value: String(rec[key]), mono: true });
    }
  }
  return entries.length > 0 ? entries : null;
}

function Row({ record }: { record: unknown }) {
  return (
    <div className="p-3">
      <TextViewerCore content={JSON.stringify(record, null, 2)} language="json" />
    </div>
  );
}

export default function JsonlRenderer({ item: _, text }: JsonlRendererProps) {
  const records = useMemo(() => parseRecords(text), [text]);
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filter) return records;
    const needle = filter.toLowerCase();
    return records.filter((r) =>
      JSON.stringify(r).toLowerCase().includes(needle),
    );
  }, [records, filter]);

  const summaryEntries = useMemo(() => recordSummaryEntries(records), [records]);

  return (
    <div className="space-y-3">
      {summaryEntries ? (
        <KeyValueSummary
          entries={summaryEntries}
          columns={summaryEntries.length > 3 ? 2 : 1}
        />
      ) : null}

      {records.length > 1 && (
        <div className="flex items-center gap-2">
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
      )}

      <div className="overflow-y-auto max-h-[60vh] divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900/30">
        {filtered.map((rec, i) => <Row key={i} record={rec} />)}
      </div>
    </div>
  );
}
