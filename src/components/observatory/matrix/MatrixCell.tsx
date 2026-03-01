import React from "react";
import type { CellStatus } from "../lib/contracts";
import { statusToUi } from "../lib/statusStyles";

export interface MatrixCellProps {
  cellId: string;
  status: CellStatus;
  onClick: (cellId: string) => void;
  dimmed?: boolean;
}

export function MatrixCell({
  cellId,
  status,
  onClick,
  dimmed = false,
}: MatrixCellProps): React.ReactElement | null {
  if (status === "vendor-out-of-scope") return null;

  const placeholder = status === "placeholder";
  const ui = statusToUi(status);

  return (
    <button
      className={[
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm transition-colors",
        "hover:bg-zinc-800/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400",
        "focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
        placeholder ? "opacity-75" : "",
        ui.decoration,
        dimmed ? "opacity-40 grayscale" : "",
      ].join(" ")}
      onClick={() => onClick(cellId)}
      aria-label={ui.label}
      title={dimmed ? "Filtered out by browser selection" : undefined}
    >
      <span className="flex shrink-0 items-center gap-1">
        {dimmed ? (
          <span className="font-mono text-[10px] text-zinc-400">[ ]</span>
        ) : null}
        {ui.glyph ? (
          <span className={`font-mono text-[10px] ${ui.text}`}>{ui.glyph}</span>
        ) : null}
        <span className={`h-2 w-2 rounded-full ${ui.dot}`} />
      </span>
    </button>
  );
}
