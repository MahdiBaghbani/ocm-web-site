import type { PlatformMetadata } from "./contracts";

/** Resolve a platform slug id to its published display name. */
export type PlatformLabelResolver = (platformId: string) => string;

/** Historical labels for artifacts that omit `platforms[]`. */
const LEGACY_PLATFORM_LABELS: Readonly<Record<string, string>> = {
  nextcloud: "Nextcloud",
  ocis: "oCIS",
  opencloud: "OpenCloud",
  ocmgo: "OpenCloudMesh Go",
  seafile: "Seafile",
  cernbox: "CERNBox",
};

/**
 * Build a lookup from matrix-rules `platforms[]`. Missing metadata or unknown
 * ids fall back to legacy branded names, then capitalize the slug.
 */
export function createPlatformLabelResolver(
  platforms?: PlatformMetadata[] | null,
): PlatformLabelResolver {
  const byId = new Map<string, string>();
  if (platforms) {
    for (const entry of platforms) {
      const id = entry?.id;
      const displayName = entry?.display_name;
      if (id && displayName) byId.set(id, displayName);
    }
  }

  return (platformId: string): string => {
    if (!platformId) return platformId;
    const fromRules = byId.get(platformId);
    if (fromRules) return fromRules;
    const legacy = LEGACY_PLATFORM_LABELS[platformId];
    if (legacy) return legacy;
    return platformId.charAt(0).toUpperCase() + platformId.slice(1);
  };
}
