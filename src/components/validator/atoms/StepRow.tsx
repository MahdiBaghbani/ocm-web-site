/**
 * One row in the six-step validator machine. CTA handlers stay parent-owned.
 */
import React from "react";
import {
  USER_STEP_LABELS,
  type StepStatus,
  type UserStep,
} from "../lib/stateMachine";
import type { GuidanceRecord } from "../lib/validatorGuidance";

export interface StepRowProps {
  step: UserStep;
  status: StepStatus;
  /** 1-based numeral among visible steps. */
  index: number;
  ctaLabel?: string;
  onCta?: () => void;
  /** Real disabled state for the primary local action (claim in flight). */
  disabled?: boolean;
  /** Secondary live-report href. Independent of the primary button. */
  ctaHref?: string;
  /** Current-instruction guidance. Rendered only on the current row. */
  guidance?: GuidanceRecord | null;
  /** Extra content mounted inside this row's card, for example a reserved
   * or live reverse-invite form. Rendered regardless of row status. */
  formSlot?: React.ReactNode;
  /** Card root ref. ResultsShell uses this to restore focus after a
   * focus-loss instruction change. */
  cardRef?: React.Ref<HTMLDivElement>;
  /** Programmatic focus target after a focus-loss instruction change.
   * Applied only on the current card; not a normal tab stop. */
  cardTabIndex?: -1;
}

const STATUS_LABEL: Record<Exclude<StepStatus, "hidden">, string> = {
  pending: "pending",
  current: "current",
  complete: "complete",
};

const LABEL_CLASS: Record<Exclude<StepStatus, "hidden">, string> = {
  pending: "text-zinc-400",
  current: "text-zinc-100",
  complete: "text-zinc-400",
};

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300";

export default function StepRow({
  step,
  status,
  index,
  ctaLabel,
  onCta,
  disabled = false,
  ctaHref,
  guidance,
  formSlot,
  cardRef,
  cardTabIndex,
}: StepRowProps): React.ReactElement | null {
  if (status === "hidden") {
    return null;
  }

  const showPrimary =
    onCta !== undefined && ctaLabel !== undefined && ctaLabel !== "";
  const showSecondary = ctaHref !== undefined && ctaHref !== "";
  const showCta = showPrimary || showSecondary;
  const showGuidance =
    status === "current" && guidance !== null && guidance !== undefined;
  const guidanceTitle =
    showGuidance && guidance.kind === "instruction" ? guidance.title : "";
  const guidanceBody = showGuidance ? guidance.body : "";

  return (
    <div
      ref={cardRef}
      className={`rounded-2xl border border-zinc-800 bg-zinc-900/20 px-5 py-4 ${FOCUS_RING}`}
      aria-current={status === "current" ? "step" : undefined}
      tabIndex={status === "current" && cardTabIndex === -1 ? -1 : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-medium text-zinc-200">
            {index}
          </span>
          <div className="min-w-0">
            <div className={`text-sm font-semibold ${LABEL_CLASS[status]}`}>
              {USER_STEP_LABELS[step]}
            </div>
            <div className="text-xs text-zinc-400">{STATUS_LABEL[status]}</div>
          </div>
        </div>
        <div
          data-cta-slot=""
          className="flex min-h-11 min-w-[10rem] shrink-0 flex-col items-end gap-2"
          aria-hidden={showCta ? undefined : true}
        >
          {showPrimary ? (
            <button
              type="button"
              className={`rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 ${FOCUS_RING}`}
              disabled={disabled}
              onClick={onCta}
            >
              {ctaLabel}
            </button>
          ) : null}
          {showSecondary ? (
            <a
              href={ctaHref}
              className={`rounded-xl border border-zinc-800 px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-900 ${FOCUS_RING}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View report
            </a>
          ) : null}
        </div>
      </div>
      <div
        data-guidance-slot=""
        // Sized for a title line plus the longest wrapped guidance body
        // (see GuidancePhase bodies in validatorGuidance.ts) so the card does
        // not resize when guidance appears; taller on mobile widths where the
        // body wraps to more lines. Actionable guidance is never line-clamped.
        className="min-h-28 pt-2 text-xs text-zinc-400 sm:min-h-20"
        aria-hidden={showGuidance ? undefined : true}
      >
        {guidanceTitle !== "" ? (
          <div className="font-semibold text-zinc-300">{guidanceTitle}</div>
        ) : null}
        {guidanceBody !== "" ? <p>{guidanceBody}</p> : null}
      </div>
      {formSlot ?? null}
    </div>
  );
}
