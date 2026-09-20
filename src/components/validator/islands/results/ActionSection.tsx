/**
 * Session-failure, area grid, visibility, and public-action slots.
 * Area selection handlers and heading refs stay in ResultsShell.
 */
import React from "react";
import { CircleCheck, CircleMinus, CircleX, TriangleAlert } from "lucide-react";
import AreaGrid from "../../atoms/AreaGrid";
import {
  RETENTION_POLICY_TEXT,
  type VisibilityNoticeProjection,
} from "../../lib/results/capability";
import type { PublicReportAction } from "../../lib/results/actionRows";
import type { SessionFailureDisplay } from "../../lib/results/sessionFailures";
import type { TransportFailureDisplay } from "../../lib/results/transportFailure";
import type { CanonicalAreaId, SpecificationAreaGridEntry } from "../../lib/validatorScore";

export const ACTION_BTN =
  "inline-flex min-h-11 items-center rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800";

type SummaryChipIcon = "pass" | "warn" | "fail" | "not-tested";

function summaryChipCounts(
  areas: readonly Pick<SpecificationAreaGridEntry, "grade">[],
): { pass: number; warn: number; fail: number; notTested: number } {
  let pass = 0;
  let warn = 0;
  let fail = 0;
  let notTested = 0;
  for (const area of areas) {
    if (area.grade === "pass") {
      pass += 1;
    } else if (area.grade === "warn") {
      warn += 1;
    } else if (area.grade === "fail") {
      fail += 1;
    } else {
      notTested += 1;
    }
  }
  return { pass, warn, fail, notTested };
}

const SUMMARY_CHIPS = [
  { icon: "pass", label: "pass", text: "text-emerald-300", Icon: CircleCheck },
  { icon: "warn", label: "warn", text: "text-amber-200", Icon: TriangleAlert },
  { icon: "fail", label: "fail", text: "text-rose-300", Icon: CircleX },
  { icon: "not-tested", label: "not tested", text: "text-zinc-300", Icon: CircleMinus },
] as const satisfies ReadonlyArray<{
  icon: SummaryChipIcon;
  label: string;
  text: string;
  Icon: typeof CircleCheck;
}>;

function SummaryChipBand({
  areas,
  assessed,
  total,
  coverageLabel,
}: {
  areas: readonly SpecificationAreaGridEntry[];
  assessed: number;
  total: number;
  coverageLabel: string;
}): React.ReactElement {
  const counts = summaryChipCounts(areas);
  const countFor: Record<SummaryChipIcon, number> = {
    pass: counts.pass,
    warn: counts.warn,
    fail: counts.fail,
    "not-tested": counts.notTested,
  };
  const sentence =
    `${assessed} of ${total} areas tested: ${counts.pass} pass, ` +
    `${counts.warn} warn, ${counts.fail} fail, ${counts.notTested} not tested`;
  return (
    <>
      <div
        data-summary-chips=""
        className="grid min-h-[5.5rem] grid-cols-2 gap-2 sm:min-h-11 sm:grid-cols-4"
      >
        {SUMMARY_CHIPS.map((chip) => {
          const Icon = chip.Icon;
          return (
            <span
              key={chip.icon}
              data-icon={chip.icon}
              className={`inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/40 px-2.5 py-0.5 text-xs tabular-nums ${chip.text}`}
              aria-hidden="true"
            >
              <Icon size={16} strokeWidth={2} aria-hidden="true" />
              <span className="min-w-[1ch]">{countFor[chip.icon]}</span>
              <span>{chip.label}</span>
            </span>
          );
        })}
      </div>
      <p className="text-sm text-zinc-300" data-summary-coverage="">
        {coverageLabel} areas tested
      </p>
      <span className="sr-only" data-summary-sr="">
        {sentence}
      </span>
    </>
  );
}

export function RunNewCheck({ href }: { href: string }): React.ReactElement {
  return (
    <a href={href} className={ACTION_BTN}>
      Run a new check
    </a>
  );
}

export function ReloadButton({ label }: { label: string }): React.ReactElement {
  return (
    <button
      type="button"
      className={ACTION_BTN}
      onClick={() => {
        if (typeof window !== "undefined") {
          window.location.reload();
        }
      }}
    >
      {label}
    </button>
  );
}

export type ActionSectionProps = {
  sessionFailure: SessionFailureDisplay | null;
  testHref: string;
  reportFailure: TransportFailureDisplay | null;
  showAreas: boolean;
  scoreAreas: readonly SpecificationAreaGridEntry[];
  resultAreas: readonly SpecificationAreaGridEntry[];
  assessed: number;
  total: number;
  coverageLabel: string;
  selectedArea: CanonicalAreaId | null;
  onAreaClick: (areaId: CanonicalAreaId) => void;
  registerTriggerRef: (area: CanonicalAreaId, el: HTMLButtonElement | null) => void;
  gridHeadingRef: React.RefObject<HTMLHeadingElement | null>;
  visibilityNotice: VisibilityNoticeProjection;
  publicReport: PublicReportAction;
  onCopyReport: () => void;
  interruptedRecoveryVisible: boolean;
};

export function ActionSection({
  sessionFailure,
  testHref,
  reportFailure,
  showAreas,
  scoreAreas,
  resultAreas,
  assessed,
  total,
  coverageLabel,
  selectedArea,
  onAreaClick,
  registerTriggerRef,
  gridHeadingRef,
  visibilityNotice,
  publicReport,
  onCopyReport,
  interruptedRecoveryVisible,
}: ActionSectionProps): React.ReactElement {
  return (
    <>
      {sessionFailure?.kind === "not_saved_empty" ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-100">{sessionFailure.title}</h2>
          <p className="text-sm text-zinc-300">{sessionFailure.body}</p>
          {sessionFailure.guidance !== null && sessionFailure.guidance.kind === "instruction" ? (
            <div className="space-y-1">
              <p className="text-sm font-semibold text-zinc-100">{sessionFailure.guidance.title}</p>
              <p className="text-sm text-zinc-300">{sessionFailure.guidance.body}</p>
            </div>
          ) : null}
          {sessionFailure.guidance !== null && sessionFailure.guidance.kind === "terminal" ? (
            <p className="text-sm text-zinc-300">{sessionFailure.guidance.body}</p>
          ) : null}
          {sessionFailure.failModeLabel !== "" ? (
            <p className="text-sm text-zinc-300">{sessionFailure.failModeLabel}</p>
          ) : null}
          <RunNewCheck href={testHref} />
        </div>
      ) : null}
      {sessionFailure?.kind === "malformed" ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-100">{sessionFailure.title}</h2>
          <p className="text-sm text-zinc-300">{sessionFailure.body}</p>
          <div className="flex flex-wrap gap-2">
            {sessionFailure.showRetry ? (
              <ReloadButton label={sessionFailure.retryLabel} />
            ) : null}
            <RunNewCheck href={testHref} />
          </div>
        </div>
      ) : null}
      {sessionFailure?.kind === "expired" ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">{sessionFailure.notice}</p>
          <p className="text-sm text-zinc-400">{sessionFailure.evidenceNote}</p>
          <RunNewCheck href={testHref} />
        </div>
      ) : null}
      {reportFailure !== null ? (
        <div className="space-y-3">
          <p className="text-sm text-rose-200" role="alert">
            {reportFailure.message}
          </p>
          <div className="flex flex-wrap gap-2">
            {reportFailure.showRetry ? (
              <ReloadButton label={reportFailure.retryLabel} />
            ) : null}
            <RunNewCheck href={testHref} />
          </div>
        </div>
      ) : null}
      {showAreas ? (
        <div className="space-y-4">
          <SummaryChipBand
            areas={scoreAreas}
            assessed={assessed}
            total={total}
            coverageLabel={coverageLabel}
          />
          <div>
            <h2
              ref={gridHeadingRef}
              tabIndex={-1}
              className="mb-3 text-sm font-semibold text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
            >
              What was tested
            </h2>
            <AreaGrid
              areas={resultAreas}
              variant="results"
              openArea={selectedArea}
              onAreaClick={(areaId) => onAreaClick(areaId)}
              registerTriggerRef={registerTriggerRef}
            />
          </div>
        </div>
      ) : null}
      {visibilityNotice.visible ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">{visibilityNotice.text}</p>
          {visibilityNotice.showRetentionPolicy ? (
            <p className="text-sm text-zinc-400">{RETENTION_POLICY_TEXT}</p>
          ) : null}
        </div>
      ) : null}
      {publicReport.visible ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            href={publicReport.reportUrl}
            className={ACTION_BTN}
            target="_blank"
            rel="noreferrer"
          >
            {publicReport.openLabel}
          </a>
          <button
            type="button"
            className={ACTION_BTN}
            onClick={() => {
              onCopyReport();
            }}
          >
            {publicReport.copyLabel}
          </button>
        </div>
      ) : null}
      {interruptedRecoveryVisible ? (
        <div className="flex flex-wrap gap-2"><RunNewCheck href={testHref} /></div>
      ) : null}
    </>
  );
}
