/**
 * Pure public action-row derivation for the results page.
 * Inputs to outputs only: no React, refs, or session state.
 */

import type { UserStep } from "../stateMachine";
import type { StepCollectionItem } from "./collections";

export const COPY_PAGE_LINK_LABEL = "Copy page link";
export const OPEN_PUBLIC_REPORT_LABEL = "Open public report";
export const COPY_PUBLIC_REPORT_LINK_LABEL = "Copy public report link";
export const RUN_NEW_CHECK_LABEL = "Run a new check";
export const COPY_INVITATION_LABEL = "Copy invitation";
export const COPY_AGAIN_LABEL = "Copy again";

export type PageLinkAction = {
  visible: boolean;
  label: string;
  showNotSavedNotice: boolean;
};

export type PublicReportAction =
  | {
      visible: true;
      reportUrl: string;
      openLabel: string;
      copyLabel: string;
    }
  | { visible: false; reportUrl: null };

export type InterruptedRecoveryAction =
  | { visible: true; label: string }
  | { visible: false };

export type LiveRowAction = {
  step: UserStep;
  status: StepCollectionItem["status"];
  index: number;
  isCurrent: boolean;
  isClaimRow: boolean;
  claimLabel: string | undefined;
  claimDisabled: boolean | undefined;
  reverseMounted: boolean;
  reverseActive: boolean;
  reverseBusy: boolean;
  showInviteSlot: boolean;
  liveReportHref: string | undefined;
};

export type LiveRowActionInput = {
  guidanceKey: string | null;
  cachedInvite: string | null;
  claimBusy: boolean;
  claimLocked: boolean;
  reverseBusy: boolean;
  liveReportHref: string | null;
};

export type ActionRowsInput = LiveRowActionInput & {
  status: string;
  visibility: string;
  sourceKind: string;
  showPublicActions: boolean;
  reportUrl: string | null;
  bannerVerdict: string | null;
  steps: readonly StepCollectionItem[];
};

export type ActionRowsProjection = {
  pageLink: PageLinkAction;
  publicReport: PublicReportAction;
  interruptedRecovery: InterruptedRecoveryAction;
  liveRows: LiveRowAction[];
};

/**
 * Header page-link action. Hidden only on the empty not-saved terminal.
 * The honesty notice is ready + not_saved + cached_session only.
 */
export function projectPageLinkAction(
  status: string,
  visibility: string,
  sourceKind: string,
): PageLinkAction {
  return {
    visible: status !== "not_saved_empty",
    label: COPY_PAGE_LINK_LABEL,
    showNotSavedNotice:
      status === "ready" &&
      visibility === "not_saved" &&
      sourceKind === "cached_session",
  };
}

/**
 * Open/Copy public-report pair. Requires ready, showPublicActions, a
 * non-null report URL, and a non-interrupted banner. Malformed permanent
 * reports can still carry showPublicActions plus a URL; the ready guard
 * keeps this row hidden there.
 */
export function projectPublicReportAction(
  status: string,
  showPublicActions: boolean,
  reportUrl: string | null,
  bannerVerdict: string | null,
): PublicReportAction {
  if (
    status === "ready" &&
    showPublicActions &&
    reportUrl !== null &&
    bannerVerdict !== "interrupted"
  ) {
    return {
      visible: true,
      reportUrl,
      openLabel: OPEN_PUBLIC_REPORT_LABEL,
      copyLabel: COPY_PUBLIC_REPORT_LINK_LABEL,
    };
  }
  return { visible: false, reportUrl: null };
}

/**
 * Interrupted recovery action. Follows bannerVerdict alone, matching the
 * current ResultsShell guard.
 */
export function projectInterruptedRecovery(
  bannerVerdict: string | null,
): InterruptedRecoveryAction {
  if (bannerVerdict === "interrupted") {
    return { visible: true, label: RUN_NEW_CHECK_LABEL };
  }
  return { visible: false };
}

/**
 * Claim, reverse, and live-report overlay for one visible step. Callbacks
 * stay in the caller; this only describes labels, disabled state, and
 * which slots mount.
 */
export function projectLiveRowAction(
  row: Pick<StepCollectionItem, "step" | "status" | "index" | "isCurrent">,
  input: LiveRowActionInput,
): LiveRowAction {
  const isClaimRow = row.isCurrent && input.guidanceKey === "paste_s1";
  const reverseMounted = row.step === "reverse";
  const reverseActive = row.isCurrent && input.guidanceKey === "paste_s2";
  return {
    step: row.step,
    status: row.status,
    index: row.index,
    isCurrent: row.isCurrent,
    isClaimRow,
    claimLabel: isClaimRow
      ? input.cachedInvite !== null
        ? COPY_AGAIN_LABEL
        : COPY_INVITATION_LABEL
      : undefined,
    claimDisabled: isClaimRow ? input.claimBusy || input.claimLocked : undefined,
    reverseMounted,
    reverseActive,
    reverseBusy: reverseMounted ? input.reverseBusy : false,
    showInviteSlot: isClaimRow,
    liveReportHref:
      row.isCurrent && input.liveReportHref !== null
        ? input.liveReportHref
        : undefined,
  };
}

/**
 * Header page-link, footer public/recovery actions, and live-row overlays
 * in one snapshot. Session identity and handlers stay in the caller.
 */
export function projectActionRows(input: ActionRowsInput): ActionRowsProjection {
  const pageLink = projectPageLinkAction(
    input.status,
    input.visibility,
    input.sourceKind,
  );
  const publicReport = projectPublicReportAction(
    input.status,
    input.showPublicActions,
    input.reportUrl,
    input.bannerVerdict,
  );
  const interruptedRecovery = projectInterruptedRecovery(input.bannerVerdict);
  return {
    pageLink,
    publicReport,
    interruptedRecovery,
    liveRows: input.steps.map((row) => projectLiveRowAction(row, input)),
  };
}
