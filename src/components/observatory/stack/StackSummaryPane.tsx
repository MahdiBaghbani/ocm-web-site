import React, { useEffect, useState } from "react";
import type { ComposeManifest } from "../lib/contracts";
import { fetchJson, isAbortError } from "../lib/fetchManifest";
import SummaryCard from "../ui/SummaryCard";
import IdentityCard from "./cards/IdentityCard";
import IntegrityCard from "./cards/IntegrityCard";
import AppliedInputsCard from "./cards/AppliedInputsCard";
import ImagesUsedPanel from "./ImagesUsedPanel";

interface StackSummaryPaneProps {
  artifactBase: string;
}

type ComposeFetchState =
  | { status: "loading" }
  | { status: "done"; data: ComposeManifest }
  | { status: "unavailable" };

export default function StackSummaryPane({ artifactBase }: StackSummaryPaneProps) {
  const [composeState, setComposeState] = useState<ComposeFetchState>({
    status: "loading",
  });

  useEffect(() => {
    setComposeState({ status: "loading" });
    if (!artifactBase) {
      setComposeState({ status: "unavailable" });
      return;
    }
    const controller = new AbortController();
    fetchJson<ComposeManifest>(
      `${artifactBase}compose/manifest.v1.json`,
      controller.signal,
    )
      .then((data) => {
        setComposeState({ status: "done", data });
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setComposeState({ status: "unavailable" });
      });

    return () => {
      controller.abort();
    };
  }, [artifactBase]);

  return (
    <div className="grid h-full gap-4 md:grid-cols-2 md:auto-rows-fr">
      {composeState.status === "loading" ? (
        <>
          <SummaryCard title="Identity" className="h-full">
            <span className="text-sm text-zinc-400">Loading compose manifest...</span>
          </SummaryCard>
          <SummaryCard title="Integrity" className="h-full">
            <span className="text-sm text-zinc-400">Loading compose manifest...</span>
          </SummaryCard>
          <SummaryCard title="Applied inputs" className="h-full">
            <span className="text-sm text-zinc-400">Loading compose manifest...</span>
          </SummaryCard>
          <ImagesUsedPanel artifactBase={artifactBase} />
        </>
      ) : composeState.status === "unavailable" ? (
        <>
          <SummaryCard title="Identity" className="h-full">
            <span className="text-sm text-zinc-400">Compose manifest not available for this run.</span>
          </SummaryCard>
          <SummaryCard title="Integrity" className="h-full">
            <span className="text-sm text-zinc-400">Compose manifest not available for this run.</span>
          </SummaryCard>
          <SummaryCard title="Applied inputs" className="h-full">
            <span className="text-sm text-zinc-400">Compose manifest not available for this run.</span>
          </SummaryCard>
          <ImagesUsedPanel artifactBase={artifactBase} />
        </>
      ) : (
        <>
          <IdentityCard manifest={composeState.data} />
          <IntegrityCard manifest={composeState.data} />
          <AppliedInputsCard manifest={composeState.data} />
          <ImagesUsedPanel artifactBase={artifactBase} />
        </>
      )}
    </div>
  );
}
