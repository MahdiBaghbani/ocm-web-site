/**
 * Single shared file-viewer surface.
 *
 * Architectural invariant: exactly one chip per file viewer.
 * Renderers compose via ViewerFrame (default) or via TextViewerCore with
 * `noChip` when they need to provide their own outer container.
 * Never wrap a TextViewerCore that has its default chip enabled in another
 * bordered container - that produces double-chip regressions.
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
