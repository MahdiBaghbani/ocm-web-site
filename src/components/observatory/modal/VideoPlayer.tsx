import React from "react";
import { getVideoRenderModel } from "../lib/evidenceModel";
import type { RichEvidenceItem } from "../lib/evidenceModel";

interface VideoPlayerProps {
  artifactBase: string;
  videoItem: RichEvidenceItem | null;
  poster?: string;
}

export function VideoPlayer({ artifactBase, videoItem, poster }: VideoPlayerProps) {
  const render = getVideoRenderModel(videoItem ?? undefined, artifactBase);

  if (!videoItem) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/30 p-6 text-sm text-zinc-400">
        No video evidence.
      </div>
    );
  }

  if (!render.hasDerivedMedia) {
    return (
      <div className="rounded-xl border border-amber-700/60 bg-amber-950/30 p-4 text-sm text-amber-100">
        Video evidence exists, but no playable derived media is available for
        this run.
      </div>
    );
  }

  return (
    <video
      className="w-full rounded-xl border border-zinc-800 bg-black"
      controls
      preload="metadata"
      poster={poster}
    >
      {render.sources.length > 0
        ? render.sources.map((source) => (
            <source
              key={source.key}
              src={source.src}
              type={source.type || undefined}
            />
          ))
        : render.fallbackSrc
          ? <source src={render.fallbackSrc} />
          : null}
    </video>
  );
}
