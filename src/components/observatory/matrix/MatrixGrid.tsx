import React, { useMemo } from "react";
import type { MatrixRuleScenario, CellStatus } from "../lib/contracts";
import {
  compareAxisSenderKey,
  compareAxisReceiverKey,
} from "../lib/versionSorting";
import { titleCasePlatform } from "../lib/nicify";
import { MatrixCell } from "./MatrixCell";
import { FlowGlyph } from "./FlowGlyph";

export interface MatrixGridProps {
  cells: MatrixRuleScenario[];
  getCellStatus: (cellId: string) => CellStatus;
  onOpenCell: (cellId: string) => void;
  getCellDimmed: (cellId: string) => boolean;
  flowId?: string;
}

interface PlatformGroup {
  platform: string;
  versions: string[];
}

interface ReceiverRow {
  platform: string;
  version: string;
  /** True only for the very first body row; used to render the "Receiver" superlabel. */
  isFirstOfAll: boolean;
  isFirstInGroup: boolean;
  groupSize: number;
  /** The `receiver_platform:receiver_version` key used in the grid map. */
  receiverKey: string;
}

function splitKey(key: string): [string, string] {
  const colon = key.indexOf(":");
  return colon === -1 ? [key, ""] : [key.slice(0, colon), key.slice(colon + 1)];
}

function buildPlatformGroups(sortedKeys: string[]): PlatformGroup[] {
  const groups: PlatformGroup[] = [];
  for (const k of sortedKeys) {
    const [platform, version] = splitKey(k);
    const last = groups[groups.length - 1];
    if (last && last.platform === platform) {
      last.versions.push(version);
    } else {
      groups.push({ platform, versions: [version] });
    }
  }
  return groups;
}

export function MatrixGrid({
  cells,
  getCellStatus,
  onOpenCell,
  getCellDimmed,
  flowId,
}: MatrixGridProps): React.ReactElement {
  // Senders = column axis (top); receivers = row axis (left).
  const senders = useMemo(() => {
    const keys = new Set<string>();
    for (const c of cells) keys.add(`${c.sender_platform}:${c.sender_version}`);
    return [...keys].sort(compareAxisSenderKey);
  }, [cells]);

  const receivers = useMemo(() => {
    const keys = new Set<string>();
    for (const c of cells) {
      if (c.receiver_platform) {
        keys.add(`${c.receiver_platform}:${c.receiver_version}`);
      }
    }
    const out = [...keys].sort(compareAxisReceiverKey);
    return out.length ? out : [""];
  }, [cells]);

  // (sender_key)__(receiver_key) -> cell_id
  const grid = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const c of cells) {
      const s = `${c.sender_platform}:${c.sender_version}`;
      const r = c.receiver_platform
        ? `${c.receiver_platform}:${c.receiver_version}`
        : "";
      if (!byKey.has(`${s}__${r}`)) byKey.set(`${s}__${r}`, c.cell_id);
    }
    return byKey;
  }, [cells]);

  // Platform groups for the column header (senders).
  const senderGroups = useMemo(() => buildPlatformGroups(senders), [senders]);

  // Flat receiver rows with group metadata for rowSpan rendering.
  const receiverRows = useMemo<ReceiverRow[]>(() => {
    const groups = buildPlatformGroups(receivers);
    const raw = groups.flatMap(({ platform, versions }) =>
      versions.map((version, idx) => ({
        platform,
        version,
        isFirstInGroup: idx === 0,
        groupSize: versions.length,
        receiverKey: platform ? `${platform}:${version}` : version,
      }))
    );
    return raw.map((row, idx) => ({ ...row, isFirstOfAll: idx === 0 }));
  }, [receivers]);

  // ---- shared class fragments ----
  const borderEdge = "border-zinc-800";

  // ---- sticky top offsets for 3-row sender header ----
  // Row 1 ("Sender" superlabel): py-1.5 (12px padding) + text-[11px] line-height (~16px) = ~28px tall
  // Row 2 (platform):            starts at top-[28px]; same height ~28px
  // Row 3 (version):             starts at top-[56px] (28 + 28)

  // ---- sticky left offsets for 3-col receiver axis ----
  // Col 1 ("Receiver"): left-0,      width 1.5rem = 24px
  // Col 2 (platform):   left-[24px], width 1.5rem = 24px
  // Col 3 (version):    left-[48px]

  // Shared inline style for the rotated-text axis columns. Widths are owned by <colgroup> above.
  const axisColStyle: React.CSSProperties = {
    writingMode: "vertical-rl",
    transform: "rotate(180deg)",
  };

  return (
    <div className="overflow-auto rounded-2xl border border-zinc-800 bg-zinc-900/20">
      <table className="w-full table-fixed border-collapse text-sm">
        {/* Strict column widths: axis cols fixed; body cols share remainder equally. */}
        <colgroup>
          <col style={{ width: "1.5rem" }} />
          <col style={{ width: "1.5rem" }} />
          <col style={{ width: "3rem" }} />
          {senders.map((s) => <col key={s} />)}
        </colgroup>
        <thead>
          {/*
            3-row sender header.
            z-index tiers (all strictly below FilterBar z-30):
              corner:          z-20  (highest matrix element; paints over both axes)
              superlabel rows: z-[15]
              platform rows:   z-10
              version rows:    z-[8]
          */}

          {/* Row 1: corner (rowSpan=3, colSpan=3) + "Sender" superlabel. */}
          <tr>
            {/* Corner — spans all 3 header rows and all 3 left-axis columns. */}
            <th
              rowSpan={3}
              colSpan={3}
              className={[
                "sticky top-0 left-0 z-20",
                "bg-zinc-900",
                "border-b-2 border-r-2 border-zinc-700",
              ].join(" ")}
            >
              {flowId ? (
                <div className="flex h-full w-full items-center justify-center text-zinc-600">
                  <FlowGlyph flowId={flowId} />
                </div>
              ) : null}
            </th>

            {/* "Sender" superlabel — spans every sender version column. */}
            {/* top-0: this is row 1, height ~28px (py-1.5 + text-[11px]) */}
            <th
              colSpan={senders.length}
              className={[
                "sticky top-0 z-[15]",
                "bg-zinc-950 text-zinc-400 text-[11px] font-bold uppercase tracking-wider",
                "border-b border-r",
                borderEdge,
                "px-2 py-1.5 text-center",
              ].join(" ")}
            >
              Sender
            </th>
          </tr>

          {/* Row 2: sender platform headers. */}
          {/* top-[28px]: starts after row 1 (~28px tall) */}
          <tr>
            {senderGroups.map(({ platform, versions }) => (
              <th
                key={platform || "__single"}
                colSpan={versions.length}
                className={[
                  "sticky top-[28px] z-10",
                  "bg-zinc-950 text-zinc-200 text-xs font-bold",
                  "border-b border-r",
                  borderEdge,
                  "whitespace-nowrap px-2 py-1.5 text-center",
                ].join(" ")}
              >
                {platform ? titleCasePlatform(platform) : "—"}
              </th>
            ))}
          </tr>

          {/* Row 3: sender version headers. */}
          {/* top-[56px]: starts after row 1 + row 2 (28 + 28 = 56px) */}
          <tr>
            {senders.map((s) => {
              const [, version] = splitKey(s);
              return (
                <th
                  key={s}
                  className={[
                    "sticky top-[56px] z-[8]",
                    "bg-zinc-900/80 text-zinc-300 font-mono text-[11px] font-semibold",
                    "border-b border-r",
                    borderEdge,
                    "whitespace-nowrap px-2 py-1.5 text-center",
                  ].join(" ")}
                >
                  {version || s}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {receiverRows.map(
            ({ platform, version, isFirstOfAll, isFirstInGroup, groupSize, receiverKey }) => (
              <tr key={receiverKey || "__single"} className="border-b border-zinc-900/50">
                {/*
                  3-column receiver axis per body row.
                  z-index tiers (same scheme as sender header, below FilterBar z-30):
                    Col 1 "Receiver" superlabel: z-[15], left-0
                    Col 2 platform:              z-10,   left-[24px]
                    Col 3 version:               z-[8],  left-[48px]
                */}

                {/* Col 1: "Receiver" superlabel, rotated, spans all body rows. */}
                {/* left-0: first col, width 1.5rem = 24px */}
                {isFirstOfAll ? (
                  <th
                    rowSpan={receiverRows.length}
                    className={[
                      "sticky left-0 z-[15]",
                      "bg-zinc-950 text-zinc-400 text-[11px] font-bold uppercase tracking-wider",
                      "border-r",
                      borderEdge,
                      "text-center",
                    ].join(" ")}
                    style={axisColStyle}
                  >
                    Receiver
                  </th>
                ) : null}

                {/* Col 2: receiver platform, rotated, spans its version group. */}
                {/* left-[24px]: starts after col 1 (1.5rem = 24px) */}
                {isFirstInGroup ? (
                  <th
                    rowSpan={groupSize}
                    className={[
                      "sticky left-[24px] z-10",
                      "bg-zinc-950 text-zinc-200 text-xs font-bold tracking-wide",
                      "border-r",
                      borderEdge,
                      "text-center",
                    ].join(" ")}
                    style={axisColStyle}
                  >
                    {platform ? titleCasePlatform(platform) : "—"}
                  </th>
                ) : null}

                {/* Col 3: receiver version, horizontal text. */}
                {/* left-[48px]: starts after col 1 + col 2 (24 + 24 = 48px) */}
                <th
                  className={[
                    "sticky left-[48px] z-[8]",
                    "bg-zinc-900/80",
                    "border-r border-b",
                    borderEdge,
                    "whitespace-nowrap px-2 py-1 text-center align-middle font-mono text-[11px] font-semibold text-zinc-300",
                  ].join(" ")}
                >
                  {version || "—"}
                </th>

                {/* Body cells: one <td> per sender. */}
                {senders.map((s) => {
                  const cellId = grid.get(`${s}__${receiverKey}`) ?? "";
                  const status = cellId ? getCellStatus(cellId) : "unknown";
                  return (
                    <td
                      key={s}
                      className="border-b border-r border-zinc-900/40 px-1 py-1 text-center align-middle min-h-[120px] h-[120px]"
                    >
                      {cellId ? (
                        <MatrixCell
                          cellId={cellId}
                          status={status}
                          onClick={onOpenCell}
                          dimmed={getCellDimmed(cellId)}
                        />
                      ) : (
                        <span className="block text-center text-xs text-zinc-700">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
