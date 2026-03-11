import React from "react";

interface FlowGlyphProps {
  flowId: string;
  className?: string;
}

/**
 * Subtle 24px outline glyphs for each flow type, used as a corner anchor in MatrixGrid.
 * Stroke is currentColor so the parent class controls tint (intended: zinc-600/700).
 */
export function FlowGlyph({ flowId, className }: FlowGlyphProps): React.ReactElement | null {
  const cls = ["h-7 w-7", className].filter(Boolean).join(" ");

  const baseProps = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: cls,
    "aria-hidden": true,
  };

  switch (flowId) {
    case "login":
      // Key (lucide "key")
      return (
        <svg {...baseProps}>
          <circle cx="7.5" cy="15.5" r="3.5" />
          <path d="m21 2-9.6 9.6" />
          <path d="m15.5 7.5 3 3L22 7l-3-3" />
        </svg>
      );
    case "share-with":
      // Share arrow (lucide "share-2")
      return (
        <svg {...baseProps}>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
      );
    case "contact-token":
      // Ticket (lucide "ticket")
      return (
        <svg {...baseProps}>
          <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
          <path d="M13 5v2" />
          <path d="M13 17v2" />
          <path d="M13 11v2" />
        </svg>
      );
    case "contact-wayf":
      // Compass (lucide "compass")
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="12" r="10" />
          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
        </svg>
      );
    default:
      return null;
  }
}
