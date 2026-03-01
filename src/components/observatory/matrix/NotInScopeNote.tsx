import React from "react";
import type { MatrixNotInScope } from "../lib/contracts";

export interface NotInScopeNoteProps {
  flowId: string;
  notInScope: MatrixNotInScope | null;
}

export function NotInScopeNote({
  flowId,
  notInScope,
}: NotInScopeNoteProps): React.ReactElement | null {
  const entries = notInScope?.flows?.[flowId];
  if (!entries || entries.length === 0) return null;

  // Group by exact rationale text, deduplicating platform:version within each group.
  const byRationale = new Map<string, { platform: string; version: string }[]>();
  for (const entry of entries) {
    const rationaleKey = entry.rationale ?? "";
    if (!byRationale.has(rationaleKey)) byRationale.set(rationaleKey, []);
    const group = byRationale.get(rationaleKey)!;
    const pairKey = `${entry.platform}:${entry.version}`;
    if (!group.some((p) => `${p.platform}:${p.version}` === pairKey)) {
      group.push({ platform: entry.platform, version: entry.version });
    }
  }

  return (
    <div className="mt-3 space-y-1">
      {[...byRationale.entries()].map(([rationale, pairs]) => (
        <div key={rationale} className="text-xs text-zinc-400">
          <span
            className="relative -top-0.5 mr-1 cursor-default text-[10px] text-zinc-500"
            title={rationale || undefined}
          >
            [i]
          </span>
          Not in scope:{" "}
          {pairs.map((p, idx) => (
            <span key={`${p.platform}:${p.version}`}>
              {p.platform} {p.version}
              {idx < pairs.length - 1 ? ", " : ""}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
