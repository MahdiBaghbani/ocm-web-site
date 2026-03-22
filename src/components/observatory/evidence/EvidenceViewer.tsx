import React, { useEffect, useRef, useState } from "react";
import type { EvidenceItem } from "../lib/contracts";
import { fetchTruncatedText } from "../lib/fetchManifest";
import TextLogRenderer from "./renderers/TextLogRenderer";
import JsonlRenderer from "./renderers/JsonlRenderer";
import EventStreamRenderer from "./renderers/EventStreamRenderer";
import MarkdownRenderer from "./renderers/MarkdownRenderer";
import StubRenderer from "./renderers/StubRenderer";

const CAP_BYTES = 4 * 1024 * 1024;

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.substring(idx + 1) : path;
}

interface EvidenceViewerProps {
  item: EvidenceItem;
  artifactBase: string;
  cellPair?: readonly [string, string];
  fillParent?: boolean;
}

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; text: string; truncated: boolean };

function needsFetch(envelope: EvidenceItem["envelope"]): boolean {
  return (
    envelope === "text-log.v1" ||
    envelope === "jsonl.v1" ||
    envelope === "event-stream.v1" ||
    envelope === "markdown.v1"
  );
}

/**
 * Envelope dispatch for evidence files. Derives downloadName from item.path
 * and threads it through so downloads use real file names. See ViewerFrame and
 * TextViewerCore for the single-chip invariant (no nested bordered containers).
 */
export default function EvidenceViewer({
  item,
  artifactBase,
  cellPair,
  fillParent,
}: EvidenceViewerProps) {
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const reqIdRef = useRef(0);

  const shouldFetch = needsFetch(item.envelope);

  useEffect(() => {
    if (!shouldFetch) {
      setFetchState({ status: "idle" });
      return;
    }
    if (!artifactBase) {
      setFetchState({ status: "error", message: "No artifact base URL." });
      return;
    }

    const id = ++reqIdRef.current;
    const controller = new AbortController();
    setFetchState({ status: "loading" });

    fetchTruncatedText(`${artifactBase}${item.path}`, CAP_BYTES, controller.signal)
      .then(({ text, truncated }) => {
        if (reqIdRef.current !== id) return;
        setFetchState({ status: "done", text, truncated });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        if (reqIdRef.current !== id) return;
        const msg = err instanceof Error ? err.message : String(err);
        setFetchState({ status: "error", message: msg });
      });

    return () => {
      controller.abort();
    };
  }, [item.path, artifactBase, shouldFetch]);

  const placeholderWrapper = fillParent
    ? "flex h-full items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/30 p-8 text-sm text-zinc-400"
    : "flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/30 p-8 text-sm text-zinc-400";

  const errorWrapper = fillParent
    ? "flex h-full items-start justify-center rounded-xl border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-400"
    : "rounded-xl border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-400";

  if (!shouldFetch) {
    // stub.v1 needs no fetch
    switch (item.envelope) {
      case "stub.v1":
        return <StubRenderer item={item} />;
      default: {
        const _never: never = item.envelope;
        return (
          <div className={placeholderWrapper}>
            Unknown envelope: {String(_never)}
          </div>
        );
      }
    }
  }

  if (fetchState.status === "idle" || fetchState.status === "loading") {
    return (
      <div className={placeholderWrapper}>
        Loading...
      </div>
    );
  }

  if (fetchState.status === "error") {
    return (
      <div className={errorWrapper}>
        Failed to load: {fetchState.message}
      </div>
    );
  }

  const { text, truncated } = fetchState;
  const combinedTruncated = truncated || item.truncated === true;
  const downloadName =
    basename(item.path) || item.logical_name || "content.txt";

  switch (item.envelope) {
    case "text-log.v1":
      return (
        <TextLogRenderer
          item={item}
          text={text}
          truncated={combinedTruncated}
          downloadName={downloadName}
          fillParent={fillParent}
        />
      );
    case "jsonl.v1":
      return <JsonlRenderer item={item} text={text} fillParent={fillParent} downloadName={downloadName} />;
    case "event-stream.v1":
      return (
        <EventStreamRenderer
          item={item}
          text={text}
          cellPair={cellPair}
          fillParent={fillParent}
          downloadName={downloadName}
        />
      );
    case "markdown.v1":
      return <MarkdownRenderer item={item} text={text} fillParent={fillParent} downloadName={downloadName} />;
    case "stub.v1":
      return <StubRenderer item={item} />;
    default: {
      const _never: never = item.envelope;
      return (
        <div className={placeholderWrapper}>
          Unknown envelope: {String(_never)}
        </div>
      );
    }
  }
}
