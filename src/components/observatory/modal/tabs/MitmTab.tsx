import React, { useEffect, useMemo, useRef, useState } from "react";
import type { EvidenceItem } from "../../lib/contracts";
import FilePane from "../FilePane";
import EvidenceViewer from "../../evidence/EvidenceViewer";
import type { EvidenceTabProps } from "../RunModal";
import { parseMitmFromUrl, setMitmInUrl } from "../../lib/urlState";
import type { MitmSubTab } from "../../lib/urlState";

const SUBTAB_ORDER: readonly MitmSubTab[] = ["traffic", "files"];

export default function MitmTab({
  evidenceItems,
  artifactBase,
}: EvidenceTabProps) {
  const items = useMemo(
    () => evidenceItems.filter((i): i is EvidenceItem => i.tab === "mitm"),
    [evidenceItems],
  );

  const traffic = useMemo(
    () =>
      items.find(
        (i) =>
          i.logical_name === "traffic" ||
          i.path.endsWith("mitm/flows/traffic.jsonl"),
      ),
    [items],
  );

  const otherItems = useMemo(
    () => items.filter((i) => i !== traffic),
    [items, traffic],
  );

  const [mitmSubTab, setMitmSubTab] = useState<MitmSubTab>(() => {
    const fromUrl =
      typeof window !== "undefined"
        ? parseMitmFromUrl(window.location.href)
        : null;
    return fromUrl ?? (traffic ? "traffic" : "files");
  });

  const [selectedPath, setSelectedPath] = useState(otherItems[0]?.path ?? "");

  useEffect(() => {
    setSelectedPath(otherItems[0]?.path ?? "");
  }, [otherItems]);

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function selectSubTab(value: MitmSubTab) {
    setMitmSubTab(value);
    setMitmInUrl(value);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const enabledTabs = SUBTAB_ORDER.filter(
      (t) => t !== "traffic" || traffic !== undefined,
    );
    const currentIdx = enabledTabs.indexOf(mitmSubTab);
    let next: MitmSubTab | undefined;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      next = enabledTabs[(currentIdx + 1) % enabledTabs.length];
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      next =
        enabledTabs[(currentIdx - 1 + enabledTabs.length) % enabledTabs.length];
    }
    if (next) {
      selectSubTab(next);
      const allIdx = SUBTAB_ORDER.indexOf(next);
      tabRefs.current[allIdx]?.focus();
    }
  }

  const pillBase =
    "rounded-md px-3 py-1 text-xs font-medium transition-colors";
  const pillActive = `${pillBase} bg-zinc-800 text-zinc-50`;
  const pillInactive = `${pillBase} text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60`;
  const pillDisabled = `${pillBase} text-zinc-600 cursor-not-allowed`;

  return (
    <div>
      <div
        role="tablist"
        className="inline-flex gap-1 rounded-lg bg-zinc-900/40 p-1"
        onKeyDown={handleKeyDown}
      >
        <button
          ref={(el) => {
            tabRefs.current[0] = el;
          }}
          role="tab"
          id="mitm-subtab-traffic"
          aria-controls="mitm-subtab-panel-traffic"
          aria-selected={mitmSubTab === "traffic"}
          tabIndex={!traffic ? -1 : mitmSubTab === "traffic" ? 0 : -1}
          type="button"
          disabled={!traffic}
          title={traffic ? undefined : "No traffic file in this run"}
          className={
            !traffic
              ? pillDisabled
              : mitmSubTab === "traffic"
                ? pillActive
                : pillInactive
          }
          onClick={() => {
            if (traffic) selectSubTab("traffic");
          }}
        >
          Traffic
        </button>
        <button
          ref={(el) => {
            tabRefs.current[1] = el;
          }}
          role="tab"
          id="mitm-subtab-files"
          aria-controls="mitm-subtab-panel-files"
          aria-selected={mitmSubTab === "files"}
          tabIndex={mitmSubTab === "files" ? 0 : -1}
          type="button"
          className={mitmSubTab === "files" ? pillActive : pillInactive}
          onClick={() => selectSubTab("files")}
        >
          Files{otherItems.length > 0 ? ` (${otherItems.length})` : ""}
        </button>
      </div>

      <div
        role="tabpanel"
        id={`mitm-subtab-panel-${mitmSubTab}`}
        aria-labelledby={`mitm-subtab-${mitmSubTab}`}
        className="mt-3"
      >
        {mitmSubTab === "traffic" ? (
          traffic ? (
            <EvidenceViewer item={traffic} artifactBase={artifactBase} />
          ) : (
            <div className="flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/30 p-10">
              <span className="text-sm text-zinc-400">
                No traffic captured for this run.
              </span>
            </div>
          )
        ) : otherItems.length > 0 ? (
          <FilePane
            items={otherItems}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
            renderViewer={(item) => (
              <EvidenceViewer item={item} artifactBase={artifactBase} />
            )}
            emptyLabel="No additional MITM files."
          />
        ) : (
          <div className="flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/30 p-10">
            <span className="text-sm text-zinc-400">
              No additional MITM files.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
