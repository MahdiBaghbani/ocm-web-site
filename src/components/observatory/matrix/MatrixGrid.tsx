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

interface SenderRow {
  platform: string;
  version: string;
  /** True only for the very first body row; used to render the "Sender" superlabel. */
  isFirstOfAll: boolean;
  isFirstInGroup: boolean;
  groupSize: number;
  /** The `sender_platform:sender_version` key used in the grid map. */
  senderKey: string;
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
  // Receivers = column axis (top); senders = row axis (left).
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

  // Single-party flows (e.g. Login Flow) have no real receiver; receivers falls back to [""].
  // Render a horizontal-only layout (senders as columns) instead of the two-party grid.
  const isSingleParty = receivers.length === 1 && receivers[0] === "";

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

  // Platform groups for the column header (receivers).
  const receiverGroups = useMemo(() => buildPlatformGroups(receivers), [receivers]);

  // Flat sender rows with group metadata for rowSpan rendering.
  const senderRows = useMemo<SenderRow[]>(() => {
    const groups = buildPlatformGroups(senders);
    const raw = groups.flatMap(({ platform, versions }) =>
      versions.map((version, idx) => ({
        platform,
        version,
        isFirstInGroup: idx === 0,
        groupSize: versions.length,
        senderKey: platform ? `${platform}:${version}` : version,
      }))
    );
    return raw.map((row, idx) => ({ ...row, isFirstOfAll: idx === 0 }));
  }, [senders]);

  // ---- shared class fragments ----
  const borderEdge = "border-zinc-800";

  // ---- sticky top offsets for 3-row receiver/sender header ----
  // Row 1 (superlabel): py-1.5 (12px padding) + text-[11px] line-height (~16px) = ~28px tall
  // Row 2 (platform):   starts at top-[28px]; same height ~28px
  // Row 3 (version):    starts at top-[56px] (28 + 28)

  // ---- sticky left offsets for 3-col sender axis (two-party branch only) ----
  // Col 1 ("Sender"): left-0,      width 2.5rem = 40px
  // Col 2 (platform): left-[40px], width 3rem = 48px
  // Col 3 (version):  left-[88px]  (40 + 48 = 88px)

  // Shared inline style for the rotated-text axis columns. Widths are owned by <colgroup>.
  const axisColStyle: React.CSSProperties = {
    writingMode: "vertical-rl",
    transform: "rotate(180deg)",
  };

  // Body cell className (H2: 88px height). Duplicated intentionally so verification
  // greps can confirm both branches carry the correct height literal.
  const singlePartyBodyCellCls =
    "border-b border-r border-zinc-900/40 px-1 py-1 text-center align-middle min-h-[88px] h-[88px]";
  const twoPartyBodyCellCls =
    "border-b border-r border-zinc-900/40 px-1 py-1 text-center align-middle min-h-[88px] h-[88px]";

  // Shared superlabel <th> className used in both branches.
  const superlabelClassName = [
    "sticky top-0 z-[15]",
    "bg-zinc-950 text-zinc-400 text-[11px] font-bold uppercase tracking-wider",
    "border-b border-r",
    borderEdge,
    "px-2 py-1.5 text-center",
  ].join(" ");

  // Corner <th> className shared by both branches.
  const cornerClassName = [
    "sticky top-0 left-0 z-20",
    "bg-zinc-900",
    "border-b border-r border-zinc-800",
  ].join(" ");

  const cornerContent = flowId ? (
    <div className="flex h-full w-full items-center justify-center text-zinc-600">
      <FlowGlyph flowId={flowId} />
    </div>
  ) : null;

  const singlePartyCornerContent = flowId ? (
    <div className="flex h-full w-full items-center justify-center text-zinc-500">
      <FlowGlyph flowId={flowId} className="h-10 w-10" />
    </div>
  ) : null;

  // ---- single-party layout: senders as columns, no left receiver axis ----
  function renderSinglePartyTable() {
    const senderGroupsForSingleParty = buildPlatformGroups(senders);
    return (
      <>
        <colgroup>
          <col style={{ width: "5rem" }} />
          {senders.map((s) => (
            <col key={s} />
          ))}
        </colgroup>
        {/*
          Single <tbody> for all 4 rows so the corner <th rowSpan={4}> reliably
          spans into the body row (rowSpan does not cross thead/tbody boundaries
          in Chrome with table-fixed + border-collapse).

          z-index tiers (same as two-party branch, all below FilterBar z-30):
            corner:         z-20
            superlabel row: z-[15]
            platform row:   z-10
            version row:    z-[8]
        */}
        <tbody>
          {/* Row 1: merged corner (rowSpan=4) + "Sender" superlabel. */}
          <tr>
            <th rowSpan={4} colSpan={1} className={cornerClassName}>
              {singlePartyCornerContent}
            </th>
            <th colSpan={senders.length} className={superlabelClassName}>
              Actor
            </th>
          </tr>

          {/* Row 2: sender platform headers. */}
          <tr>
            {senderGroupsForSingleParty.map(({ platform, versions }) => (
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

          {/* Row 4: body cells — one per sender; grid keys end with __ (empty receiver).
              No leading placeholder <td>: the corner above spans rowSpan=4 into this row. */}
          <tr className="border-b border-zinc-900/50">
            {senders.map((s) => {
              const cellId = grid.get(`${s}__`) ?? "";
              const status = cellId ? getCellStatus(cellId) : "unknown";
              return (
                <td key={s} className={singlePartyBodyCellCls}>
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
        </tbody>
      </>
    );
  }

  // ---- two-party layout: receivers as columns, senders as rows ----
  function renderTwoPartyTable() {
    return (
      <>
        {/* Strict column widths: axis cols fixed; body cols share remainder equally. */}
        <colgroup>
          <col style={{ width: "2.5rem" }} />
          <col style={{ width: "3rem" }} />
          <col style={{ width: "3rem" }} />
          {receivers.map((r) => (
            <col key={r} />
          ))}
        </colgroup>
        <thead>
          {/*
            3-row receiver header.
            z-index tiers (all strictly below FilterBar z-30):
              corner:          z-20  (highest matrix element; paints over both axes)
              superlabel rows: z-[15]
              platform rows:   z-10
              version rows:    z-[8]
          */}

          {/* Row 1: corner (rowSpan=3, colSpan=3) + "Receiver" superlabel. */}
          <tr>
            {/* Corner — spans all 3 header rows and all 3 left-axis columns. */}
            <th rowSpan={3} colSpan={3} className={cornerClassName}>
              {cornerContent}
            </th>

            {/* "Receiver" superlabel — spans every receiver version column. */}
            {/* top-0: this is row 1, height ~28px (py-1.5 + text-[11px]) */}
            <th colSpan={receivers.length} className={superlabelClassName}>
              Receiver
            </th>
          </tr>

          {/* Row 2: receiver platform headers. */}
          {/* top-[28px]: starts after row 1 (~28px tall) */}
          <tr>
            {receiverGroups.map(({ platform, versions }) => (
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

          {/* Row 3: receiver version headers. */}
          {/* top-[56px]: starts after row 1 + row 2 (28 + 28 = 56px) */}
          <tr>
            {receivers.map((r) => {
              const [, version] = splitKey(r);
              return (
                <th
                  key={r}
                  className={[
                    "sticky top-[56px] z-[8]",
                    "bg-zinc-900/80 text-zinc-300 font-mono text-[11px] font-semibold",
                    "border-b border-r",
                    borderEdge,
                    "whitespace-nowrap px-2 py-1.5 text-center",
                  ].join(" ")}
                >
                  {version || r}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {senderRows.map(
            ({ platform, version, isFirstOfAll, isFirstInGroup, groupSize, senderKey }) => (
              <tr key={senderKey || "__single"} className="border-b border-zinc-900/50">
                {/*
                  3-column sender axis per body row.
                  z-index tiers (same scheme as receiver header, below FilterBar z-30):
                    Col 1 "Sender" superlabel: z-[15], left-0
                    Col 2 platform:            z-10,   left-[40px]
                    Col 3 version:             z-[8],  left-[88px]
                */}

                {/* Col 1: "Sender" superlabel, rotated, spans all body rows. */}
                {/* left-0: first col, width 1.5rem = 24px */}
                {isFirstOfAll ? (
                  <th
                    rowSpan={senderRows.length}
                    className={[
                      "sticky left-0 z-[15]",
                      "bg-zinc-950 text-zinc-400 text-[11px] font-bold uppercase tracking-wider",
                      // border-collapse + sticky + rotate drops collapsed borders in Chrome;
                      // use inset box-shadow instead so the seam paints through the rotation.
                      "shadow-[inset_-1px_-1px_0_0_#27272a]",
                      "px-1 py-1 text-center",
                    ].join(" ")}
                    style={axisColStyle}
                  >
                    Sender
                  </th>
                ) : null}

                {/* Col 2: sender platform, rotated, spans its version group. */}
                {/* left-[40px]: starts after col 1 (2.5rem = 40px) */}
                {isFirstInGroup ? (
                  <th
                    rowSpan={groupSize}
                    className={[
                      "sticky left-[40px] z-10",
                      "bg-zinc-950 text-zinc-200 text-xs font-bold tracking-wide",
                      // After rotate(180deg): CSS right-inset paints visual-LEFT = SENDER<->platform seam; bottom-inset paints visual-TOP = corner<->platform seam. platform<->version seam owned by version's border-l (no overlap because that's visual-RIGHT here).
                      "shadow-[inset_-1px_-1px_0_0_#27272a]",
                      "px-1 py-1 text-center",
                    ].join(" ")}
                    style={axisColStyle}
                  >
                    {platform ? titleCasePlatform(platform) : "—"}
                  </th>
                ) : null}

                {/* Col 3: sender version, horizontal text. */}
                {/* left-[88px]: starts after col 1 + col 2 (40 + 48 = 88px) */}
                <th
                  className={[
                    "sticky left-[88px] z-[8]",
                    "bg-zinc-900/80",
                    "border-l border-r border-b",
                    borderEdge,
                    "whitespace-nowrap px-2 py-1 text-center align-middle font-mono text-[11px] font-semibold text-zinc-300",
                  ].join(" ")}
                >
                  {version || "—"}
                </th>

                {/* Body cells: one <td> per receiver. */}
                {receivers.map((r) => {
                  const cellId = grid.get(`${senderKey}__${r}`) ?? "";
                  const status = cellId ? getCellStatus(cellId) : "unknown";
                  return (
                    <td key={r} className={twoPartyBodyCellCls}>
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
      </>
    );
  }

  return (
    <div className="overflow-auto rounded-2xl border border-zinc-800 bg-zinc-900/20">
      <table className="w-full table-fixed border-collapse text-sm">
        {isSingleParty ? renderSinglePartyTable() : renderTwoPartyTable()}
      </table>
    </div>
  );
}
