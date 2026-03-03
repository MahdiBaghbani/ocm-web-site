import React, { useEffect, useState } from "react";
import type { ComposeManifest, EvidenceItem } from "../lib/contracts";
import { fetchJson, isAbortError } from "../lib/fetchManifest";
import KeyValueSummary from "../evidence/KeyValueSummary";
import FilePane from "../modal/FilePane";
import EvidenceViewer from "../evidence/EvidenceViewer";
import ImagesUsedPanel from "./ImagesUsedPanel";

interface StackPaneProps {
  stackItems: EvidenceItem[];
  artifactBase: string;
}

type ComposeFetchState =
  | { status: "loading" }
  | { status: "done"; data: ComposeManifest }
  | { status: "unavailable" };

function truncateSha(value: string | null | undefined): React.ReactNode {
  if (!value) return null;
  const short = value.slice(0, 16) + "...";
  return (
    <span className="font-mono" title={value}>
      {short}
    </span>
  );
}

export default function StackPane({ stackItems, artifactBase }: StackPaneProps) {
  const [composeState, setComposeState] = useState<ComposeFetchState>({ status: "loading" });
  const [selectedPath, setSelectedPath] = useState("");

  const fileItems = stackItems.filter(
    (it) =>
      it.path.startsWith("compose/") || it.path === "compose/inputs/stack.env",
  );

  useEffect(() => {
    setComposeState({ status: "loading" });
    if (!artifactBase) {
      setComposeState({ status: "unavailable" });
      return;
    }

    const controller = new AbortController();
    fetchJson<ComposeManifest>(`${artifactBase}compose/manifest.v1.json`, controller.signal)
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

  // Reset file selector when the artifact changes.
  useEffect(() => {
    setSelectedPath(fileItems[0]?.path ?? "");
  }, [artifactBase]); // artifactBase drives fileItems; stackItems is derived from evidence manifest

  const effectivePath = selectedPath || (fileItems[0]?.path ?? "");

  function renderComposeSection() {
    if (composeState.status === "loading") {
      return (
        <div className="border border-zinc-800 bg-zinc-900/30 rounded-xl p-4 text-sm text-zinc-400">
          Loading compose manifest...
        </div>
      );
    }

    if (composeState.status === "unavailable") {
      return (
        <div className="border border-zinc-800 bg-zinc-900/30 rounded-xl p-4 text-sm text-zinc-400">
          Compose manifest not available for this run.
        </div>
      );
    }

    const mf = composeState.data;
    const entries = [
      { label: "stack_id", value: mf.stack_id, mono: true },
      { label: "base", value: mf.base, mono: true },
      { label: "stack_def_sha256", value: truncateSha(mf.stack_def_sha256), mono: true },
      { label: "stack_env_sha256", value: truncateSha(mf.stack_env_sha256), mono: true },
      {
        label: "applied_inputs",
        value: mf.applied_inputs.length
          ? `${mf.applied_inputs.length}, ${mf.applied_inputs.join(", ")}`
          : "0",
        mono: true,
      },
      { label: "resolved_files", value: String(mf.resolved_files.length), mono: false },
    ];

    return <KeyValueSummary title="Compose manifest" entries={entries} />;
  }

  return (
    <div className="space-y-4">
      {renderComposeSection()}
      <ImagesUsedPanel artifactBase={artifactBase} />
      <FilePane
        items={fileItems}
        selectedPath={effectivePath}
        onSelect={setSelectedPath}
        renderViewer={(item) => (
          <EvidenceViewer item={item} artifactBase={artifactBase} />
        )}
        emptyLabel="No stack files."
      />
    </div>
  );
}
