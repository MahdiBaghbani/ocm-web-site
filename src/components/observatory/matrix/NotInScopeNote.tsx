import React from "react";
import type { MatrixNotInScope } from "../lib/contracts";

export interface NotInScopeNoteProps {
  flowId: string;
  notInScope: MatrixNotInScope | null;
}

function roleLabel(role: string): string {
  if (role === "sender" || role === "receiver") return role;
  return role || "unknown";
}

export function NotInScopeNote({
  flowId,
  notInScope,
}: NotInScopeNoteProps): React.ReactElement | null {
  const entries = notInScope?.flows?.[flowId];
  if (!entries || entries.length === 0) return null;

  // Group by role + rationale; deduplicate platform:version within each group.
  const byRoleRationale = new Map<
    string,
    { role: string; rationale: string; pairs: { platform: string; version: string }[] }
  >();
  for (const entry of entries) {
    const role = entry.role ?? "";
    const rationaleKey = entry.rationale ?? "";
    const groupKey = `${role}\0${rationaleKey}`;
    if (!byRoleRationale.has(groupKey)) {
      byRoleRationale.set(groupKey, { role, rationale: rationaleKey, pairs: [] });
    }
    const group = byRoleRationale.get(groupKey)!;
    const pairKey = `${entry.platform}:${entry.version}`;
    if (!group.pairs.some((p) => `${p.platform}:${p.version}` === pairKey)) {
      group.pairs.push({ platform: entry.platform, version: entry.version });
    }
  }

  return (
    <div className="mt-3 space-y-1">
      {[...byRoleRationale.values()].map(({ role, rationale, pairs }) => (
        <div
          key={`${role}:${rationale}`}
          className="text-xs text-zinc-400"
        >
          <span
            className="relative -top-0.5 mr-1 cursor-default text-[10px] text-zinc-500"
            title={rationale || undefined}
          >
            [i]
          </span>
          Not in scope ({roleLabel(role)}):{" "}
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
