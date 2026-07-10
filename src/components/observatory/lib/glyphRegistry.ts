/** Published `glyph_id` values the observatory may render (single source of truth). */
export const SUPPORTED_GLYPH_IDS = [
  "key",
  "share-2",
  "ticket",
  "compass",
  "app-window",
] as const;

export type SupportedGlyphId = (typeof SUPPORTED_GLYPH_IDS)[number];

const SUPPORTED_GLYPH_ID_SET: ReadonlySet<string> = new Set(SUPPORTED_GLYPH_IDS);

/** True when `glyphId` maps to a renderable glyph in the site registry. */
export function isSupportedGlyphId(glyphId: string): glyphId is SupportedGlyphId {
  return SUPPORTED_GLYPH_ID_SET.has(glyphId);
}
