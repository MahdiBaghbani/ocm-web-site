/**
 * Shared bordered surface for file renderers. Provides a sticky headerSlot
 * and a scrollable body region. Pass fillParent to fill the parent height.
 * See TextViewerCore's noChip prop for the single-chip invariant.
 */
import React from "react";

export interface ViewerFrameProps {
  /** Optional content rendered above the body (filter input, mode toggle, etc). Use shrink-0 inside. */
  headerSlot?: React.ReactNode;
  /** When true, frame fills parent height via flex; when false, sizes to content. */
  fillParent?: boolean;
  /** Extra classes merged onto the bordered surface. */
  className?: string;
  /** Body content. The body region scrolls on its own when fillParent=true. */
  children: React.ReactNode;
}

export function ViewerFrame({
  headerSlot,
  fillParent,
  className,
  children,
}: ViewerFrameProps) {
  const surfaceCls = [
    "rounded-xl border border-zinc-800 bg-zinc-900/30 flex flex-col",
    fillParent ? "h-full min-h-0" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const bodyCls = fillParent ? "flex-1 min-h-0 overflow-hidden" : "";

  return (
    <div className={surfaceCls}>
      {headerSlot != null && (
        <div className="shrink-0">{headerSlot}</div>
      )}
      <div className={bodyCls || undefined}>{children}</div>
    </div>
  );
}
