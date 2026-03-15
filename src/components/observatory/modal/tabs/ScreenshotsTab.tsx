import React, { useMemo } from "react";
import type { SuiteManifest } from "../../lib/contracts";
import { groupEvidence, getImageRenderModel } from "../../lib/evidenceModel";
import MediaGallery from "../../media/MediaGallery";
import { nicifyScreenshotPath } from "../../lib/nicify";

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
        const nice = nicifyScreenshotPath(item.path);
        const caption = `${nice.index} ${nice.role} / ${nice.state}`;
        return {
          key: item.path,
          src,
          sources: model.sources.map((s) => ({ srcset: s.srcSet, type: s.type })),
          caption,
          alt: caption,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [runId, mf, artifactBase]);

  return (
    <div className="h-full overflow-y-auto">
      <MediaGallery items={items} emptyLabel="No screenshots for this run." />
    </div>
  );
}
