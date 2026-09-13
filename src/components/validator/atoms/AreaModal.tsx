/**
 * Accessible area-detail overlay. Wraps OverlayFrame and shows three
 * pre-mounted tab panels (Summary, Evidence, Raw JSON). Evidence is filtered
 * to the area; Raw JSON always shows the full unfiltered source report.
 */
import React, { useId, useRef, useState } from "react";
import { OverlayFrame } from "../../observatory/modal/OverlayFrame";
import EvidenceDisclosure from "./EvidenceDisclosure";
import Pill, { type GradeKind } from "./Pill";
import RawJsonPanel from "./RawJsonPanel";
import type { EvidenceItem } from "../lib/evidence/types";
import { reasonCopyFor, selectPrimaryReasonItem } from "../lib/validatorReasons";
import type { CanonicalAreaId } from "../lib/validatorScore";

// Short plain-language question shown beside each area label. Kept local so the
// atom does not depend on the ResultsShell island.
const AREA_QUESTIONS: Record<CanonicalAreaId, string> = {
  discovery: "Can other servers find this server's OCM endpoint?",
  tls: "Can the validator connect securely over HTTPS?",
  jwks: "Does the server publish a usable JWKS document?",
  httpsig: "Do HTTP signatures validate as the specification requires?",
  sharing: "Does it expose the expected remote sharing operations?",
  notification: "Does it send and accept the required notifications?",
  token: "Can it issue and accept the required access tokens?",
  capability: "Does the server advertise the required sharing features?",
};

const REDACTED_NOTE = "Supporting details were redacted from this report.";

type AreaTabKey = "summary" | "evidence" | "rawjson";

const TAB_DEFS: readonly { key: AreaTabKey; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "evidence", label: "Evidence" },
  { key: "rawjson", label: "Raw JSON" },
];

const TAB_ORDER: readonly AreaTabKey[] = TAB_DEFS.map((def) => def.key);

export interface AreaModalProps {
  area: CanonicalAreaId;
  areaLabel: string;
  items: readonly EvidenceItem[];
  sourceReport: unknown;
  onClose: () => void;
  grade?: GradeKind | null;
  pillLabel?: string;
  evidenceCount?: number;
  loadedEvidenceCount?: number;
}

export type AreaModalContentProps = Omit<AreaModalProps, "onClose">;

// The area an evidence row belongs to. scoreArea wins; area is the fallback.
// A row with neither field returns undefined and is excluded from area views.
function itemAreaOf(item: EvidenceItem): string | undefined {
  return item.scoreArea ?? item.area;
}

export function AreaModalContent({
  area,
  areaLabel,
  items,
  sourceReport,
  grade,
  pillLabel,
  evidenceCount,
  loadedEvidenceCount,
}: AreaModalContentProps): React.ReactElement {
  const [selected, setSelected] = useState<AreaTabKey>("summary");
  const tabRefs = useRef<Record<AreaTabKey, HTMLButtonElement | null>>({
    summary: null,
    evidence: null,
    rawjson: null,
  });
  const baseId = useId();

  const tabId = (key: AreaTabKey): string => `${baseId}-tab-${key}`;
  const panelId = (key: AreaTabKey): string => `${baseId}-panel-${key}`;

  // Rows scoped to this area. Rows with neither scoreArea nor area are dropped
  // here so they never affect the Summary or Evidence views; the full report is
  // still shown unfiltered in the Raw JSON tab.
  const areaItems = items.filter((item) => itemAreaOf(item) === area);

  const primaryItem = selectPrimaryReasonItem(areaItems);
  const resolved =
    primaryItem === undefined
      ? null
      : reasonCopyFor({
          reasonCode: primaryItem.reasonCode,
          grade: primaryItem.grade,
          severity: primaryItem.severity,
          affectsGrade: primaryItem.affectsGrade,
        });
  const redacted = areaItems.some((item) => item.payloadRedacted === true);

  const loaded = loadedEvidenceCount ?? areaItems.length;
  const reported = evidenceCount;
  const countsDiffer = reported !== undefined && reported !== loaded;

  const question = AREA_QUESTIONS[area];

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    const current = TAB_ORDER.indexOf(selected);
    let next = current;
    if (event.key === "ArrowRight") {
      next = (current + 1) % TAB_ORDER.length;
    } else if (event.key === "ArrowLeft") {
      next = (current - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = TAB_ORDER.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const nextKey = TAB_ORDER[next] ?? selected;
    setSelected(nextKey);
    // Automatic activation: focus follows the selected tab.
    tabRefs.current[nextKey]?.focus();
  }

  const tabBase =
    "min-h-11 rounded-t-lg border-b-2 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300";
  const tabActive = "border-sky-400 text-zinc-50";
  const tabInactive = "border-transparent text-zinc-400 hover:text-zinc-200";
  const panelBodyBase = "min-h-0 flex-1";
  const sectionBase =
    "flex min-h-0 flex-1 flex-col rounded-2xl border border-zinc-800 bg-zinc-900/20 p-4";

  return (
    <div data-area-modal className="flex h-full min-h-0 flex-col gap-4">
      <div
        role="tablist"
        aria-label="Area details"
        className="flex shrink-0 gap-2 border-b border-zinc-800"
      >
        {TAB_DEFS.map((def) => {
          const isActive = selected === def.key;
          return (
            <button
              key={def.key}
              type="button"
              role="tab"
              id={tabId(def.key)}
              data-area-tab={def.key}
              aria-controls={panelId(def.key)}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              ref={(node) => {
                tabRefs.current[def.key] = node;
              }}
              onKeyDown={handleTabKeyDown}
              onClick={() => setSelected(def.key)}
              className={[tabBase, isActive ? tabActive : tabInactive].join(" ")}
            >
              {def.label}
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {TAB_DEFS.map((def) => {
          const isActive = selected === def.key;
          const bodyClass =
            def.key === "rawjson"
              ? `${panelBodyBase} overflow-hidden`
              : `${panelBodyBase} overflow-y-auto`;
          return (
            <section key={def.key} hidden={!isActive} className={sectionBase}>
              <h3 className="mb-3 shrink-0 text-sm font-semibold text-zinc-100">
                {def.label}
              </h3>
              <div
                role="tabpanel"
                id={panelId(def.key)}
                data-area-panel={def.key}
                aria-labelledby={tabId(def.key)}
                hidden={!isActive}
                tabIndex={0}
                className={bodyClass}
              >
                {def.key === "summary" ? (
                  <div className="space-y-3 text-sm text-zinc-300">
                    <p className="text-base font-semibold text-zinc-100">
                      {areaLabel}
                    </p>
                    <p className="text-zinc-400">{question}</p>
                    {grade === "pass" || grade === "warn" || grade === "fail" ? (
                      <Pill kind={grade} label={pillLabel} />
                    ) : null}
                    {countsDiffer ? (
                      <div className="space-y-1">
                        <p>Reported evidence: {reported}</p>
                        <p>Available evidence: {loaded}</p>
                      </div>
                    ) : (
                      <p>Evidence items: {loaded}</p>
                    )}
                    {resolved !== null ? (
                      <div
                        className="space-y-1"
                        data-reason-source={resolved.source}
                      >
                        <p className="font-semibold text-zinc-100">
                          {resolved.title}
                        </p>
                        <p className="text-zinc-400">{resolved.why}</p>
                        {resolved.remedy !== undefined &&
                        resolved.remedy !== "" ? (
                          <p className="text-zinc-400">{resolved.remedy}</p>
                        ) : null}
                      </div>
                    ) : null}
                    {redacted ? (
                      <p className="text-zinc-400">{REDACTED_NOTE}</p>
                    ) : null}
                  </div>
                ) : def.key === "evidence" ? (
                  <EvidenceDisclosure title={areaLabel} items={areaItems} />
                ) : (
                  <RawJsonPanel value={sourceReport} fillParent />
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default function AreaModal({
  area,
  areaLabel,
  items,
  sourceReport,
  onClose,
  grade,
  pillLabel,
  evidenceCount,
  loadedEvidenceCount,
}: AreaModalProps): React.ReactElement {
  return (
    <OverlayFrame title={areaLabel} onClose={onClose} size="lg">
      <AreaModalContent
        area={area}
        areaLabel={areaLabel}
        items={items}
        sourceReport={sourceReport}
        grade={grade}
        pillLabel={pillLabel}
        evidenceCount={evidenceCount}
        loadedEvidenceCount={loadedEvidenceCount}
      />
    </OverlayFrame>
  );
}
