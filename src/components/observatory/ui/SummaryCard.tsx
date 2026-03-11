/**
 * Metadata-panel chip primitive.
 *
 * Used for stack summary cards, run-identity panels, image manifests, etc.
 * NOT a file-viewer chip - that contract belongs to ViewerFrame
 * (evidence/renderers/ViewerFrame.tsx). Do not conflate the two.
 *
 * The root has NO default h-full / flex-1; callers control height
 * (e.g., add h-full when placed in a grid with auto-rows-fr).
 */
import React from "react";

const PADDING_MAP = {
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
} as const;

export interface SummaryCardProps {
  title?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** padding scale: "sm" = p-3, "md" = p-4 (default), "lg" = p-6 */
  padding?: "sm" | "md" | "lg";
}

export default function SummaryCard({
  title,
  badge,
  children,
  className,
  bodyClassName,
  padding = "md",
}: SummaryCardProps) {
  const rootClasses = [
    "rounded-xl border border-zinc-800 bg-zinc-900/30 flex flex-col",
    PADDING_MAP[padding],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClasses}>
      {title !== undefined ? (
        <div className="shrink-0 mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          {badge !== undefined ? badge : null}
        </div>
      ) : null}
      <div className={["flex-1 min-h-0", bodyClassName].filter(Boolean).join(" ")}>
        {children}
      </div>
    </div>
  );
}
