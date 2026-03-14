import React, { useEffect, useState } from "react";
import type { ImagesManifest, ImageServiceEntry } from "../lib/contracts";
import { fetchJson, isAbortError } from "../lib/fetchManifest";
import SummaryCard from "../ui/SummaryCard";

interface ImagesUsedPanelProps {
  artifactBase: string;
}

type FetchState =
  | { status: "loading" }
  | { status: "done"; data: ImagesManifest }
  | { status: "unavailable" };

function shortSha(value: string | null | undefined): string {
  if (!value) return "";
  const stripped = value.startsWith("sha256:") ? value.slice(7) : value;
  return stripped.slice(0, 16);
}

function renderIdCell(svc: ImageServiceEntry) {
  if (svc.digest !== null) {
    const short = shortSha(svc.digest);
    return (
      <span className="font-mono text-xs text-zinc-200" title={svc.digest}>
        {short}
      </span>
    );
  }
  const short = shortSha(svc.local_image_id);
  return (
    <span className="font-mono text-xs text-zinc-200" title={svc.local_image_id}>
      {short}
      <span
        className="text-amber-400 ml-2"
        aria-describedby="images-used-local-built-footnote"
      >
        <span className="sr-only">Locally built (no published digest). </span>
        [*]
      </span>
    </span>
  );
}

export default function ImagesUsedPanel({ artifactBase }: ImagesUsedPanelProps) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    setState({ status: "loading" });
    if (!artifactBase) {
      setState({ status: "unavailable" });
      return;
    }

    const controller = new AbortController();
    fetchJson<ImagesManifest>(`${artifactBase}meta/images.v1.json`, controller.signal)
      .then((data) => {
        setState({ status: "done", data });
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setState({ status: "unavailable" });
      });

    return () => {
      controller.abort();
    };
  }, [artifactBase]);

  if (state.status === "unavailable") {
    return (
      <SummaryCard title="Images used" className="h-full">
        <span className="text-sm text-zinc-400">Image manifest not available for this run.</span>
      </SummaryCard>
    );
  }

  if (state.status === "loading") {
    return (
      <SummaryCard title="Images used" className="h-full">
        <span className="text-sm text-zinc-400">Loading image manifest...</span>
      </SummaryCard>
    );
  }

  return (
    <SummaryCard title="Images used" className="h-full" bodyClassName="overflow-y-auto">
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="py-1.5 pr-3 text-left font-semibold text-zinc-500">service</th>
              <th className="py-1.5 pr-3 text-left font-semibold text-zinc-500">role</th>
              <th className="py-1.5 pr-3 text-left font-semibold text-zinc-500">tag</th>
              <th className="py-1.5 text-left font-semibold text-zinc-500">id / digest</th>
            </tr>
          </thead>
          <tbody>
            {state.data.services.map((svc) => (
              <tr key={svc.service} className="border-b border-zinc-800/50">
                <td className="py-1.5 pr-3 font-mono text-zinc-200">{svc.service}</td>
                <td className="py-1.5 pr-3 text-zinc-300">{svc.role}</td>
                <td className="py-1.5 pr-3 font-mono text-zinc-200">{svc.tag}</td>
                <td className="py-1.5">{renderIdCell(svc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p
        id="images-used-local-built-footnote"
        className="text-xs text-zinc-500 mt-2"
      >
        [*] = locally built (no published digest)
      </p>
    </SummaryCard>
  );
}
