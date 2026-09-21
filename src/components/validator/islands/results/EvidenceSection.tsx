/**
 * Evidence panel, raw-JSON triggers, and modal slots.
 * Open/close handlers and area-modal focus restore stay in ResultsShell.
 */
import React from "react";
import AreaModal from "../../atoms/AreaModal";
import EvidenceDisclosure from "../../atoms/EvidenceDisclosure";
import ReportJsonModal from "../../atoms/ReportJsonModal";
import type { EvidenceAvailabilityProjection } from "../../lib/results/capability";
import { CACHED_SESSION_JSON_NOTE } from "../../lib/results/projectResultsPage";
import { EXPIRED_EVIDENCE_NOTE } from "../../lib/results/sessionFailures";
import type { EvidenceItem } from "../../lib/evidence/types";
import type { ReportResponse } from "../../lib/validatorFetch";
import type { CanonicalAreaId, SpecificationAreaGridEntry } from "../../lib/validatorScore";
import { ACTION_BTN } from "./constants";

export const EVIDENCE_NOT_SAVED =
  "No saved evidence is available because this report was not public.";

export const EVIDENCE_EMPTY_SNAPSHOT =
  "No evidence items were included in this session snapshot.";

export const EVIDENCE_EXPIRED = EXPIRED_EVIDENCE_NOTE;

export type EvidenceSectionProps = {
  evidence: EvidenceAvailabilityProjection;
  items: readonly EvidenceItem[];
  hasSourceReport: boolean;
  showMalformedTrigger: boolean;
  rawJsonLabel: string;
  rawJsonOpen: boolean;
  onOpenRawJson: () => void;
  onCloseRawJson: () => void;
  rawJsonTitle: string;
  sourceReport: ReportResponse | null;
  rawJsonNote: string | null;
  downloadName: string;
  showAreaModal: boolean;
  selectedArea: CanonicalAreaId | null;
  selectedEntry: SpecificationAreaGridEntry | null;
  onCloseAreaModal: () => void;
};

export function EvidenceSection({
  evidence,
  items,
  hasSourceReport,
  showMalformedTrigger,
  rawJsonLabel,
  rawJsonOpen,
  onOpenRawJson,
  onCloseRawJson,
  rawJsonTitle,
  sourceReport,
  rawJsonNote,
  downloadName,
  showAreaModal,
  selectedArea,
  selectedEntry,
  onCloseAreaModal,
}: EvidenceSectionProps): React.ReactElement {
  const readyRawJsonTrigger = hasSourceReport ? (
    <button
      type="button"
      className="text-sm text-zinc-400 underline hover:text-zinc-200"
      aria-haspopup="dialog"
      aria-expanded={rawJsonOpen}
      onClick={() => onOpenRawJson()}
    >
      {rawJsonLabel}
    </button>
  ) : null;
  const malformedRawJsonTrigger = showMalformedTrigger ? (
    <button
      type="button"
      className={ACTION_BTN}
      aria-haspopup="dialog"
      aria-expanded={rawJsonOpen}
      onClick={() => onOpenRawJson()}
    >
      {rawJsonLabel}
    </button>
  ) : null;

  return (
    <>
      {evidence.sectionVisible ? (
        <div className="space-y-4">
          {evidence.showDisclosure ? (
            <EvidenceDisclosure
              title="Evidence"
              items={items}
              defaultExpanded={items.length > 0}
            />
          ) : null}
          {evidence.showNotSaved ? (
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Evidence</h2>
              <p className="mt-1 text-sm text-zinc-400">{EVIDENCE_EMPTY_SNAPSHOT}</p>
              <p className="mt-1 text-sm text-zinc-400">{EVIDENCE_NOT_SAVED}</p>
            </div>
          ) : null}
          {evidence.showSessionEmpty ? (
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Evidence</h2>
              <p className="mt-1 text-sm text-zinc-400">{EVIDENCE_EMPTY_SNAPSHOT}</p>
            </div>
          ) : null}
          {evidence.showUnknownEmpty ? (
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Evidence</h2>
              <p className="mt-1 text-sm text-zinc-400">{EVIDENCE_EMPTY_SNAPSHOT}</p>
            </div>
          ) : null}
          {evidence.showExpired ? (
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Evidence</h2>
              <p className="mt-1 text-sm text-zinc-400">{EVIDENCE_EXPIRED}</p>
            </div>
          ) : null}
          {evidence.showCachedSessionNote ? (
            <p className="text-sm text-zinc-400">{CACHED_SESSION_JSON_NOTE}</p>
          ) : null}
          {readyRawJsonTrigger}
        </div>
      ) : null}
      {malformedRawJsonTrigger}
      {rawJsonOpen && hasSourceReport && sourceReport !== null ? (
        <ReportJsonModal
          title={rawJsonTitle}
          sourceReport={sourceReport}
          note={rawJsonNote}
          downloadName={downloadName}
          onClose={() => onCloseRawJson()}
        />
      ) : null}
      {showAreaModal &&
      selectedArea !== null &&
      selectedEntry !== null &&
      sourceReport !== null ? (
        <AreaModal
          area={selectedArea}
          areaLabel={selectedEntry.label}
          items={items}
          sourceReport={sourceReport}
          grade={selectedEntry.grade}
          pillLabel={selectedEntry.pillLabel}
          evidenceCount={selectedEntry.evidenceCount}
          onClose={onCloseAreaModal}
        />
      ) : null}
    </>
  );
}
