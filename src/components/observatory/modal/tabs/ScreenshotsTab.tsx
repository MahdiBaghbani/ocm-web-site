import React, { useMemo } from "react";
import type { SuiteManifest } from "../../lib/contracts";
import { groupEvidence, getImageRenderModel } from "../../lib/evidenceModel";
import MediaGallery from "../../media/MediaGallery";

interface ScreenshotsTabProps {
  runId: string;
  mf: SuiteManifest | null;
  artifactBase: string;
}

export default function ScreenshotsTab({ runId, mf, artifactBase }: ScreenshotsTabProps) {
  const items = useMemo(() => {
    if (!mf) return [];
    const result = runId
      ? Object.values(mf.results ?? {}).find((r) => r.run_id === runId) ?? null
      : null;
    const byKind = groupEvidence(result);
    const screenshots = byKind.get("screenshot") ?? [];
    return screenshots
      .map((item) => {
        const model = getImageRenderModel(item, artifactBase);
        const src = model.fallbackSrc;
        if (!src) return null;
        return {
          key: item.path,
          src,
          sources: model.sources.map((s) => ({ srcset: s.srcSet, type: s.type })),
          caption: item.logical_name || item.path,
          alt: item.logical_name || item.path,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [runId, mf, artifactBase]);

  return (
    <MediaGallery items={items} emptyLabel="No screenshots for this run." />
  );
}
