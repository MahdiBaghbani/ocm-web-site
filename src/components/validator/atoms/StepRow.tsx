/**
 * One row in the six-step validator machine. CTA handlers stay parent-owned.
 */
import React from "react";
import {
  USER_STEP_LABELS,
  type StepStatus,
  type UserStep,
} from "../lib/stateMachine";

export interface StepRowProps {
  step: UserStep;
  status: StepStatus;
  /** 1-based numeral among visible steps. */
  index: number;
  ctaLabel?: string;
  onCta?: () => void;
}

const STATUS_LABEL: Record<Exclude<StepStatus, "hidden">, string> = {
  pending: "pending",
  current: "current",
  complete: "complete",
};

const LABEL_CLASS: Record<Exclude<StepStatus, "hidden">, string> = {
  pending: "text-zinc-500",
  current: "text-zinc-100",
  complete: "text-zinc-400",
};

export default function StepRow({
  step,
  status,
  index,
  ctaLabel,
  onCta,
}: StepRowProps): React.ReactElement | null {
  if (status === "hidden") {
    return null;
  }

  const showCta = onCta !== undefined && ctaLabel !== undefined && ctaLabel !== "";

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/20 px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-medium text-zinc-200">
            {index}
          </span>
          <div className="min-w-0">
            <div className={`text-sm font-semibold ${LABEL_CLASS[status]}`}>
              {USER_STEP_LABELS[step]}
            </div>
            <div className="text-xs text-zinc-500">{STATUS_LABEL[status]}</div>
          </div>
        </div>
        {showCta ? (
          <button
            type="button"
            className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            onClick={onCta}
          >
            {ctaLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
