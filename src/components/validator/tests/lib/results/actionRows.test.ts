import { describe, expect, test } from "bun:test";

import type { StepCollectionItem } from "@/components/validator/lib/results/collections";
import { projectStepCollection } from "@/components/validator/lib/results/collections";
import { resolveValidatorMachine } from "@/components/validator/lib/stateMachine";
import {
  COPY_AGAIN_LABEL,
  COPY_INVITATION_LABEL,
  COPY_PAGE_LINK_LABEL,
  COPY_PUBLIC_REPORT_LINK_LABEL,
  OPEN_PUBLIC_REPORT_LABEL,
  RUN_NEW_CHECK_LABEL,
  projectActionRows,
  projectInterruptedRecovery,
  projectLiveRowAction,
  projectPageLinkAction,
  projectPublicReportAction,
  type ActionRowsInput,
  type LiveRowActionInput,
} from "@/components/validator/lib/results/actionRows";

const REPORT_URL = "https://validator.example.com/validator/report/abc";
const LIVE_HREF = "https://validator.example.com/validator/report/live";

function step(
  value: StepCollectionItem["step"],
  status: StepCollectionItem["status"],
  index: number,
): StepCollectionItem {
  return {
    step: value,
    status,
    index,
    isCurrent: status === "current",
  };
}

function liveInput(
  extra: Partial<LiveRowActionInput> = {},
): LiveRowActionInput {
  return {
    guidanceKey: null,
    cachedInvite: null,
    claimBusy: false,
    claimLocked: false,
    reverseBusy: false,
    liveReportHref: null,
    ...extra,
  };
}

function rowsInput(extra: Partial<ActionRowsInput> = {}): ActionRowsInput {
  return {
    status: "ready",
    visibility: "permanent",
    sourceKind: "terminal",
    showPublicActions: true,
    reportUrl: REPORT_URL,
    bannerVerdict: "pass",
    steps: [],
    ...liveInput(),
    ...extra,
  };
}

describe("projectPageLinkAction", () => {
  test("hides the page-link action only on the empty not-saved terminal", () => {
    expect(projectPageLinkAction("not_saved_empty", "not_saved", "none")).toEqual({
      visible: false,
      label: COPY_PAGE_LINK_LABEL,
      showNotSavedNotice: false,
    });
    expect(projectPageLinkAction("ready", "permanent", "terminal").visible).toBe(true);
    expect(projectPageLinkAction("live", "session", "none").visible).toBe(true);
    expect(projectPageLinkAction("malformed", "permanent", "terminal").visible).toBe(
      true,
    );
  });

  test("shows the not-saved honesty notice only on ready cached not-saved results", () => {
    expect(
      projectPageLinkAction("ready", "not_saved", "cached_session").showNotSavedNotice,
    ).toBe(true);
    expect(
      projectPageLinkAction("ready", "not_saved", "terminal").showNotSavedNotice,
    ).toBe(false);
    expect(
      projectPageLinkAction("ready", "permanent", "cached_session").showNotSavedNotice,
    ).toBe(false);
    expect(
      projectPageLinkAction("live", "not_saved", "cached_session").showNotSavedNotice,
    ).toBe(false);
  });
});

describe("projectPublicReportAction", () => {
  test("shows Open then Copy only when ready, public, linked, and not interrupted", () => {
    expect(
      projectPublicReportAction("ready", true, REPORT_URL, "pass"),
    ).toEqual({
      visible: true,
      reportUrl: REPORT_URL,
      openLabel: OPEN_PUBLIC_REPORT_LABEL,
      copyLabel: COPY_PUBLIC_REPORT_LINK_LABEL,
    });
  });

  test("hides public actions when status is not ready even if a public URL is present", () => {
    expect(
      projectPublicReportAction("malformed", true, REPORT_URL, null),
    ).toEqual({ visible: false, reportUrl: null });
    expect(
      projectPublicReportAction("live", true, REPORT_URL, "running"),
    ).toEqual({ visible: false, reportUrl: null });
  });

  test("hides public actions when the URL, public flag, or interrupted banner blocks them", () => {
    expect(
      projectPublicReportAction("ready", false, REPORT_URL, "pass"),
    ).toEqual({ visible: false, reportUrl: null });
    expect(
      projectPublicReportAction("ready", true, null, "pass"),
    ).toEqual({ visible: false, reportUrl: null });
    expect(
      projectPublicReportAction("ready", true, REPORT_URL, "interrupted"),
    ).toEqual({ visible: false, reportUrl: null });
  });
});

describe("projectInterruptedRecovery", () => {
  test("shows Run a new check from an interrupted banner only", () => {
    expect(projectInterruptedRecovery("interrupted")).toEqual({
      visible: true,
      label: RUN_NEW_CHECK_LABEL,
    });
    expect(projectInterruptedRecovery("pass")).toEqual({ visible: false });
    expect(projectInterruptedRecovery(null)).toEqual({ visible: false });
  });
});

describe("projectLiveRowAction", () => {
  test("marks only the current paste_s1 row as the claim CTA with cache-based labels", () => {
    const currentInvite = step("invite", "current", 3);
    const pendingInvite = step("invite", "pending", 3);
    const first = projectLiveRowAction(
      currentInvite,
      liveInput({ guidanceKey: "paste_s1" }),
    );
    expect(first.isClaimRow).toBe(true);
    expect(first.claimLabel).toBe(COPY_INVITATION_LABEL);
    expect(first.claimDisabled).toBe(false);
    expect(first.showInviteSlot).toBe(true);

    const again = projectLiveRowAction(
      currentInvite,
      liveInput({ guidanceKey: "paste_s1", cachedInvite: "ocm-invite" }),
    );
    expect(again.claimLabel).toBe(COPY_AGAIN_LABEL);

    const notCurrent = projectLiveRowAction(
      pendingInvite,
      liveInput({ guidanceKey: "paste_s1" }),
    );
    expect(notCurrent.isClaimRow).toBe(false);
    expect(notCurrent.claimLabel).toBeUndefined();
    expect(notCurrent.claimDisabled).toBeUndefined();
    expect(notCurrent.showInviteSlot).toBe(false);
  });

  test("disables the claim CTA for busy and locked reasons without moving handlers", () => {
    const currentInvite = step("invite", "current", 3);
    const busy = projectLiveRowAction(
      currentInvite,
      liveInput({ guidanceKey: "paste_s1", claimBusy: true }),
    );
    expect(busy.claimDisabled).toBe(true);

    const locked = projectLiveRowAction(
      currentInvite,
      liveInput({ guidanceKey: "paste_s1", claimLocked: true }),
    );
    expect(locked.claimDisabled).toBe(true);

    const both = projectLiveRowAction(
      currentInvite,
      liveInput({
        guidanceKey: "paste_s1",
        claimBusy: true,
        claimLocked: true,
      }),
    );
    expect(both.claimDisabled).toBe(true);
  });

  test("mounts the reverse form on the reverse step and activates it only on current paste_s2", () => {
    const currentReverse = step("reverse", "current", 4);
    const pendingReverse = step("reverse", "pending", 4);
    const currentInvite = step("invite", "current", 3);

    const active = projectLiveRowAction(
      currentReverse,
      liveInput({ guidanceKey: "paste_s2", reverseBusy: true }),
    );
    expect(active.reverseMounted).toBe(true);
    expect(active.reverseActive).toBe(true);
    expect(active.reverseBusy).toBe(true);
    expect(active.isClaimRow).toBe(false);

    const reserved = projectLiveRowAction(
      pendingReverse,
      liveInput({ guidanceKey: "paste_s2", reverseBusy: true }),
    );
    expect(reserved.reverseMounted).toBe(true);
    expect(reserved.reverseActive).toBe(false);
    expect(reserved.reverseBusy).toBe(true);

    const invite = projectLiveRowAction(
      currentInvite,
      liveInput({ guidanceKey: "paste_s2" }),
    );
    expect(invite.reverseMounted).toBe(false);
    expect(invite.reverseActive).toBe(true);
    expect(invite.reverseBusy).toBe(false);
  });

  test("shows the live report href only on the current row when a href is present", () => {
    const current = step("invite", "current", 3);
    const pending = step("probe", "complete", 1);
    expect(
      projectLiveRowAction(current, liveInput({ liveReportHref: LIVE_HREF }))
        .liveReportHref,
    ).toBe(LIVE_HREF);
    expect(
      projectLiveRowAction(pending, liveInput({ liveReportHref: LIVE_HREF }))
        .liveReportHref,
    ).toBeUndefined();
    expect(
      projectLiveRowAction(current, liveInput({ liveReportHref: null })).liveReportHref,
    ).toBeUndefined();
  });
});

describe("projectActionRows", () => {
  test("keeps live-row order and overlays claim state on the current invite step", () => {
    const view = resolveValidatorMachine({
      state: "invite_minted",
      optInActive: true,
      nextInstruction: "paste_s1",
    });
    const steps = projectStepCollection(view);
    const projected = projectActionRows(
      rowsInput({
        status: "live",
        visibility: "session",
        sourceKind: "none",
        showPublicActions: false,
        reportUrl: null,
        bannerVerdict: "running",
        guidanceKey: "paste_s1",
        steps,
      }),
    );
    expect(projected.liveRows.map((row) => row.step)).toEqual(
      steps.map((row) => row.step),
    );
    const current = projected.liveRows.find((row) => row.isCurrent);
    expect(current?.step).toBe("invite");
    expect(current?.isClaimRow).toBe(true);
    expect(current?.claimLabel).toBe(COPY_INVITATION_LABEL);
    expect(projected.pageLink.visible).toBe(true);
    expect(projected.publicReport.visible).toBe(false);
    expect(projected.interruptedRecovery.visible).toBe(false);
  });

  test("projects the public footer pair on a permanent ready result and hides it when interrupted", () => {
    const ready = projectActionRows(rowsInput());
    expect(ready.pageLink.visible).toBe(true);
    expect(ready.publicReport.visible).toBe(true);
    expect(ready.interruptedRecovery.visible).toBe(false);

    const interrupted = projectActionRows(
      rowsInput({
        showPublicActions: true,
        reportUrl: REPORT_URL,
        bannerVerdict: "interrupted",
      }),
    );
    expect(interrupted.publicReport.visible).toBe(false);
    expect(interrupted.interruptedRecovery.visible).toBe(true);
    expect(interrupted.pageLink.visible).toBe(true);
  });
});
