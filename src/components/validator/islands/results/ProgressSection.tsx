/**
 * Live progress, copy notice, poll failure, and step-row slots.
 * Hooks, claim/reverse handlers, and refs stay in ResultsShell.
 */
import React from "react";
import StepRow from "../../atoms/StepRow";
import VerdictBanner from "../../atoms/VerdictBanner";
import type { LiveRowAction } from "../../lib/results/actionRows";
import type { ResultsPageStatus } from "../../lib/results/projectResultsPage";
import type { TransportFailureDisplay } from "../../lib/results/transportFailure";
import type { VerdictKind } from "../../lib/results/verdict";
import type { MachineView } from "../../lib/stateMachine";
import type { GuidanceRecord } from "../../lib/validatorGuidance";
import { ReloadButton, RunNewCheck } from "./ActionSection";
import { ACTION_BTN } from "./constants";

export {
  MAX_REVERSE_INVITE_LENGTH,
  REVERSE_INVITE_TOO_LONG_TEXT,
} from "./constants";

export const REVERSE_INVITE_FIELD_LABEL = "Return invitation";
export const REVERSE_INVITE_SUBMIT_LABEL = "Submit return invitation";

export const INVITE_FIELD_LABEL = "Invitation";

export type CopyNotice = {
  ok: boolean;
  text: string;
};

// AG-2.2 reserved the in-row `data-cta-slot` column StepRow already
// renders for every row (sized for "Copy invitation", "Copy again", and
// the secondary report link). AG-2.3 wires the live "View report"
// secondary link on the current row. AG-1.4 wires the primary
// "Copy invitation" / "Copy again" claim CTA plus the cached-invite field on
// the current paste_s1 row (see InvitePasteSlot). AG-1.5 wires the bounded
// reverse-invite form into this same slot, but only while the displayed
// instruction is exactly paste_s2; every other reverse-row state (pending,
// complete, or current at wait_forward_share) keeps the invisible reserved
// placeholder below so the layout never shifts. The slot mounts inside the
// reverse row's own StepRow card (via its formSlot prop), not as a sibling
// element.
const RESERVED_REVERSE_FORM_CLASS = "invisible min-h-56 w-full";
const REVERSE_FORM_CLASS = "mt-3 min-h-56 w-full space-y-3";

/**
 * AG-1.5 reverse-invite form slot. Renders the invisible reserved
 * placeholder unless `active` is true (the displayed instruction is exactly
 * paste_s2), in which case it renders the real, controlled textarea form.
 * Both branches keep the same `data-reserved-form-slot` / `data-reserved
 * -alert-slot` markers so the reserved-layout contract does not change
 * shape when the form goes live.
 */
function ReverseFormSlot({
  active,
  value,
  onChange,
  busy,
  error,
  onSubmit,
}: {
  active: boolean;
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
}): React.ReactElement {
  if (!active) {
    return (
      <div data-reserved-form-slot="" aria-hidden="true" className={RESERVED_REVERSE_FORM_CLASS}>
        <div data-reserved-alert-slot="" />
      </div>
    );
  }
  return (
    <div data-reserved-form-slot="" className={REVERSE_FORM_CLASS}>
      <form
        data-reverse-form=""
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="space-y-1">
          <label
            htmlFor="results-reverse-invite-field"
            className="block text-xs font-semibold text-zinc-300"
          >
            {REVERSE_INVITE_FIELD_LABEL}
          </label>
          <textarea
            id="results-reverse-invite-field"
            data-reverse-invite-field=""
            rows={3}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
        </div>
        <button type="submit" className={ACTION_BTN} disabled={busy}>
          {REVERSE_INVITE_SUBMIT_LABEL}
        </button>
      </form>
      <div data-reserved-alert-slot="">
        {error !== null ? (
          <p
            data-post-error=""
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="text-sm text-rose-200"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// AG-1.4 invite paste slot. Mounts inside the current invite row's card via
// StepRow's formSlot. Shows the locked claim error when a claim failed with no
// usable cache, and the cached invitation in a labeled, read-only, selectable
// field that stays available even when the clipboard copy fails.
function InvitePasteSlot({
  invite,
  error,
}: {
  invite: string | null;
  error: string | null;
}): React.ReactElement | null {
  if (invite === null && error === null) {
    return null;
  }
  return (
    <div data-invite-slot="" className="mt-3 space-y-2">
      {error !== null ? (
        <p
          data-post-error=""
          className="text-sm text-rose-200"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {error}
        </p>
      ) : null}
      {invite !== null ? (
        <div className="space-y-1">
          <label
            htmlFor="results-invite-field"
            className="block text-xs font-semibold text-zinc-300"
          >
            {INVITE_FIELD_LABEL}
          </label>
          <input
            id="results-invite-field"
            type="text"
            readOnly
            value={invite}
            data-invite-field=""
            data-invite-value={invite}
            className="w-full select-all rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
        </div>
      ) : null}
    </div>
  );
}

export function CopyNoticeRegion({
  notice,
  fallbackValue,
}: {
  notice: CopyNotice;
  fallbackValue: string | null;
}): React.ReactElement {
  const successText = notice.ok ? notice.text : "";
  const failureText = notice.ok ? "" : notice.text;
  return (
    <div className="space-y-2">
      <p
        id="results-copy-notice"
        className="text-sm text-zinc-300"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {successText}
      </p>
      {failureText !== "" ? (
        <p
          id="results-copy-failure"
          className="text-sm text-rose-200"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {failureText}
        </p>
      ) : null}
      {fallbackValue !== null ? (
        <input
          type="text"
          readOnly
          value={fallbackValue}
          aria-describedby={failureText !== "" ? "results-copy-failure" : "results-copy-notice"}
          data-copy-fallback=""
          className="w-full rounded-xl border border-rose-400 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
      ) : null}
    </div>
  );
}

export type ProgressSectionProps = {
  bannerVerdict: VerdictKind | null;
  bannerTitle: string;
  bannerMessage: string;
  view: MachineView | null;
  status: ResultsPageStatus;
  statusText: string | null;
  copyNotice: CopyNotice;
  copyFallback: string | null;
  pollFailure: TransportFailureDisplay | null;
  testHref: string;
  liveRows: readonly LiveRowAction[];
  currentRowGuidance: GuidanceRecord | null;
  reverseValue: string;
  onReverseChange: (value: string) => void;
  postError: string | null;
  onReverseSubmit: () => void;
  cachedInvite: string | null;
  onClaimInvite: () => void;
  currentCardRef: React.RefObject<HTMLDivElement | null>;
  restoreCurrentCardFocus: boolean;
};

export function ProgressSection({
  bannerVerdict,
  bannerTitle,
  bannerMessage,
  view,
  status,
  statusText,
  copyNotice,
  copyFallback,
  pollFailure,
  testHref,
  liveRows,
  currentRowGuidance,
  reverseValue,
  onReverseChange,
  postError,
  onReverseSubmit,
  cachedInvite,
  onClaimInvite,
  currentCardRef,
  restoreCurrentCardFocus,
}: ProgressSectionProps): React.ReactElement {
  return (
    <>
      {bannerVerdict !== null &&
      view !== null &&
      (status === "live" || status === "ready") ? (
        <div data-banner-region="">
          <VerdictBanner
            verdict={bannerVerdict}
            title={bannerTitle}
            message={bannerMessage}
          />
        </div>
      ) : null}
      {statusText !== null ? (
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-step-status=""
          className="text-sm text-zinc-400"
        >
          {statusText}
        </p>
      ) : null}
      <CopyNoticeRegion notice={copyNotice} fallbackValue={copyFallback} />
      {pollFailure !== null ? (
        <div className="space-y-3">
          <p className="text-sm text-rose-200" role="alert">
            {pollFailure.message}
          </p>
          <div className="flex flex-wrap gap-2">
            {pollFailure.showRetry ? (
              <ReloadButton label={pollFailure.retryLabel} />
            ) : null}
            <RunNewCheck href={testHref} />
          </div>
        </div>
      ) : null}
      {view === null ? (
        <p className="text-sm text-zinc-400">Loading session...</p>
      ) : status === "live" ? (
        <div className="space-y-3" data-step-list="">
          {liveRows.map((row) => {
            const rowFormSlot =
              row.reverseMounted ? (
                <ReverseFormSlot
                  active={row.reverseActive}
                  value={reverseValue}
                  onChange={onReverseChange}
                  busy={row.reverseBusy}
                  error={postError}
                  onSubmit={() => {
                    onReverseSubmit();
                  }}
                />
              ) : row.showInviteSlot ? (
                <InvitePasteSlot invite={cachedInvite} error={postError} />
              ) : undefined;
            return (
              <StepRow
                key={row.step}
                step={row.step}
                status={row.status}
                index={row.index}
                guidance={row.isCurrent ? currentRowGuidance : undefined}
                ctaLabel={row.claimLabel}
                onCta={
                  row.isClaimRow
                    ? () => {
                        onClaimInvite();
                      }
                    : undefined
                }
                disabled={row.claimDisabled}
                ctaHref={row.liveReportHref}
                formSlot={rowFormSlot}
                cardRef={row.isCurrent ? currentCardRef : undefined}
                cardTabIndex={row.isCurrent && restoreCurrentCardFocus ? -1 : undefined}
              />
            );
          })}
        </div>
      ) : null}
      {status === "loading_report" ? (
        <p className="text-sm text-zinc-400">Loading report...</p>
      ) : null}
    </>
  );
}
