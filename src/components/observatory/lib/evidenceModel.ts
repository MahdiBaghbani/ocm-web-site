import type { ResultSummaryEvidenceEntry } from "./contracts";

export interface MediaVariant {
  role?: string;
  path?: string;
  mime?: string;
  codecs?: string;
}

// Runtime evidence items carry optional media fields not modeled in the
// summary entry type (populated by the artifact pipeline).
export interface RichEvidenceItem extends ResultSummaryEvidenceEntry {
  source_path?: string;
  media_variants?: MediaVariant[];
}

export interface ImageSource {
  key: string;
  srcSet: string;
  type: string;
}

export interface VideoSource {
  key: string;
  src: string;
  type: string;
}

export interface ImageRenderModel {
  sources: ImageSource[];
  fallbackSrc: string;
  hasDerivedMedia: boolean;
}

export interface VideoRenderModel {
  sources: VideoSource[];
  fallbackSrc: string;
  hasDerivedMedia: boolean;
}

export function groupEvidence(
  result: { evidence?: unknown[] } | null | undefined,
): Map<string, RichEvidenceItem[]> {
  const ev = Array.isArray(result?.evidence)
    ? (result.evidence as RichEvidenceItem[])
    : [];
  const sorted = [...ev].sort((a, b) =>
    String(a?.path ?? "").localeCompare(String(b?.path ?? "")),
  );
  const byKind = new Map<string, RichEvidenceItem[]>();
  for (const row of sorted) {
    const k = row?.kind || "other";
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k)!.push(row);
  }
  return byKind;
}

export function getMediaVariants(
  item: RichEvidenceItem | null | undefined,
): MediaVariant[] {
  return Array.isArray(item?.media_variants)
    ? item.media_variants.filter(Boolean)
    : [];
}

export function getVariantUrl(
  artifactBase: string,
  variant: MediaVariant,
): string {
  if (!artifactBase || !variant?.path) return "";
  return `${artifactBase}${variant.path}`;
}

export function getVariantType(variant: MediaVariant): string {
  if (!variant?.mime) return "";
  if (variant?.codecs) return `${variant.mime}; codecs="${variant.codecs}"`;
  return variant.mime;
}

export function getImageRenderModel(
  item: RichEvidenceItem | null | undefined,
  artifactBase: string,
): ImageRenderModel {
  const variants = getMediaVariants(item);
  if (!variants.length) {
    if (!artifactBase || !item?.path)
      return { sources: [], fallbackSrc: "", hasDerivedMedia: false };
    return {
      sources: [],
      fallbackSrc: `${artifactBase}${item.path}`,
      hasDerivedMedia: true,
    };
  }

  const sources = variants
    .map((variant) => ({
      key: `${variant.role ?? "variant"}:${variant.path ?? ""}`,
      srcSet: getVariantUrl(artifactBase, variant),
      type: getVariantType(variant),
    }))
    .filter((s) => s.srcSet);

  return {
    sources,
    fallbackSrc: sources[0]?.srcSet ?? "",
    hasDerivedMedia: sources.length > 0,
  };
}

export function getVideoRenderModel(
  item: RichEvidenceItem | null | undefined,
  artifactBase: string,
): VideoRenderModel {
  const variants = getMediaVariants(item);
  if (!variants.length) {
    if (!artifactBase || !item?.path)
      return { sources: [], fallbackSrc: "", hasDerivedMedia: false };
    return {
      sources: [],
      fallbackSrc: `${artifactBase}${item.path}`,
      hasDerivedMedia: true,
    };
  }

  const sources = variants
    .map((variant) => ({
      key: `${variant.role ?? "variant"}:${variant.path ?? ""}`,
      src: getVariantUrl(artifactBase, variant),
      type: getVariantType(variant),
    }))
    .filter((s) => s.src);

  return {
    sources,
    fallbackSrc: "",
    hasDerivedMedia: sources.length > 0,
  };
}
