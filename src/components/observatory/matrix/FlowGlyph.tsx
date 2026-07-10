import React from "react";
import {
  type SupportedGlyphId,
  isSupportedGlyphId,
} from "../lib/glyphRegistry";

interface FlowGlyphProps {
  glyphId: string;
  className?: string;
}

const baseSvgProps = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

type GlyphRenderer = (className: string) => React.ReactElement;

const GLYPH_RENDERERS: Record<SupportedGlyphId, GlyphRenderer> = {
  key: (className) => (
    <svg {...baseSvgProps} className={className}>
      <circle cx="7.5" cy="15.5" r="3.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  ),
  "share-2": (className) => (
    <svg {...baseSvgProps} className={className}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  ),
  ticket: (className) => (
    <svg {...baseSvgProps} className={className}>
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M13 5v2" />
      <path d="M13 17v2" />
      <path d="M13 11v2" />
    </svg>
  ),
  compass: (className) => (
    <svg {...baseSvgProps} className={className}>
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  ),
  "app-window": (className) => (
    <svg {...baseSvgProps} className={className}>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="M6 8h.01" />
      <path d="M10 8h.01" />
      <path d="M14 8h.01" />
      <path d="M2 12h20" />
    </svg>
  ),
};

/**
 * Subtle 24px outline glyphs keyed by published `glyph_id`, used as a corner
 * anchor in MatrixGrid. Stroke is currentColor so the parent class controls tint.
 */
export function FlowGlyph({ glyphId, className }: FlowGlyphProps): React.ReactElement {
  if (!isSupportedGlyphId(glyphId)) {
    throw new Error(`Unknown flow glyph_id: "${glyphId}"`);
  }

  const cls = ["h-7 w-7", className].filter(Boolean).join(" ");
  return GLYPH_RENDERERS[glyphId](cls);
}
