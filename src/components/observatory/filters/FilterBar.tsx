import React from "react";
import { STATUS_OPTIONS, statusToUi } from "../lib/statusStyles";

export interface FilterBarProps {
  browserOptions: string[];
  flowOptions: string[];
  filters: { browser: string; flow: string; query: string };
  onChange: (next: { browser: string; flow: string; query: string }) => void;
  onClear: () => void;
}

export function FilterBar({
  browserOptions,
  flowOptions,
  filters,
  onChange,
  onClear,
}: FilterBarProps): React.ReactElement {
  const clearDisabled =
    filters.browser === "all" && filters.flow === "all" && filters.query === "";

  return (
    <div className="sticky top-16 z-30 rounded-2xl border border-zinc-800 bg-gray-950/95 px-5 py-4 backdrop-blur-sm">
      <div className="mb-3 flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((s) => {
          const ui = statusToUi(s);
          return (
            <span
              key={s}
              className={`inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/40 px-2.5 py-0.5 text-xs ${ui.text}`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${ui.dot}`} />
              {ui.label}
            </span>
          );
        })}
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <label className="space-y-1">
          <div className="text-xs font-semibold text-zinc-400">Browser</div>
          <select
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-200"
            value={filters.browser}
            onChange={(e) => onChange({ ...filters, browser: e.target.value })}
          >
            <option value="all">all</option>
            {browserOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <div className="text-xs font-semibold text-zinc-400">Flow</div>
          <select
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-200"
            value={filters.flow}
            onChange={(e) => onChange({ ...filters, flow: e.target.value })}
          >
            <option value="all">all</option>
            {flowOptions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <div className="text-xs font-semibold text-zinc-400">Search</div>
          <input
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
            placeholder="platform/version/cell-id..."
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
          />
        </label>

        <div className="flex items-end">
          <button
            type="button"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={clearDisabled}
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
