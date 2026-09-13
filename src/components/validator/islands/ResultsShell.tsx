/**
 * RESULTS island. Polls a session, caches the last live report, and projects
 * a private or public terminal result without treating report_not_public as a
 * load error.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CircleCheck, CircleMinus, CircleX, TriangleAlert } from "lucide-react";
import AreaGrid from "../atoms/AreaGrid";
import AreaModal from "../atoms/AreaModal";
import EvidenceDisclosure from "../atoms/EvidenceDisclosure";
import ReportJsonModal from "../atoms/ReportJsonModal";
import StepRow from "../atoms/StepRow";
import VerdictBanner from "../atoms/VerdictBanner";
import {
  fetchConfigSource,
  loadValidatorConfig,
  type ValidatorRuntimeConfig,
} from "../lib/validatorConfig";
import {
  claimInvite,
  joinValidatorUrl,
  postReverseInvite,
  type ReportResponse,
  type SessionPollResponse,
  type ValidatorFailure,
  type ValidatorFetchDeps,
} from "../lib/validatorFetch";
import { runResultsPollLoop } from "../lib/resultsPoll";
import {
  type MachineView,
  type UserStep,
} from "../lib/stateMachine";
import {
  actionErrorCopy,
  guidanceFor,
  type GuidanceRecord,
} from "../lib/validatorGuidance";
import type { ValidatorUrlState } from "../lib/urlState";
import {
  type CanonicalAreaId,
  type SpecificationAreaGridEntry,
} from "../lib/validatorScore";
import {
  progressAnnouncement,
  stripBracketedMarkers,
} from "../lib/results/progress";
import { projectActionable } from "../lib/results/actionable";
import { projectActionRows } from "../lib/results/actionRows";
import {
  projectCapability,
  RETENTION_POLICY_TEXT,
} from "../lib/results/capability";
import { projectProgressCollections } from "../lib/results/collections";
import {
  projectSessionStart,
  sessionFromLocation,
  sessionFromProps,
  SESSION_START_LOADING_TEXT,
} from "../lib/results/sessionStart";
import {
  INITIAL_LIVE_INSTRUCTION_HOLD,
  stabilizeLiveView,
  type LiveInstructionHold,
} from "../lib/results/stabilizeLiveView";
import { projectTransportFailure } from "../lib/results/transportFailure";
import {
  EXPIRED_EVIDENCE_NOTE,
  projectSessionFailure,
} from "../lib/results/sessionFailures";
import { isSameSessionId, isStaleSessionId } from "../lib/results/sessionIdentity";
import {
  CACHED_SESSION_JSON_NOTE,
  projectResultsPage,
  type ResultsPageStatus,
} from "../lib/results/projectResultsPage";

export { AREA_DESCRIPTIONS } from "../lib/score/areas";
export { progressAnnouncement, stripBracketedMarkers };
export { INITIAL_LIVE_INSTRUCTION_HOLD, stabilizeLiveView };
export { resultAreaEntries } from "../lib/results/collections";
export {
  COPY_AGAIN_LABEL,
  COPY_INVITATION_LABEL,
} from "../lib/results/actionRows";
export { VISIBILITY_NOTICE } from "../lib/results/capability";
export {
  bannerBody,
  CACHED_SESSION_JSON_NOTE,
  loadedEvidenceCountsByArea,
  primaryReasonCodesByArea,
  primaryReasonsByArea,
  projectResultsPage,
  specificationInputFromReport,
} from "../lib/results/projectResultsPage";
export type {
  ResultsPageProjection,
  ResultsPageStatus,
} from "../lib/results/projectResultsPage";

export interface ResultsShellProps {
  host?: string;
  id?: string;
  testHref?: string;
}

export const TEST_HREF = "/validator/";

export const EVIDENCE_NOT_SAVED =
  "No saved evidence is available because this report was not public.";

export const EVIDENCE_EMPTY_SNAPSHOT =
  "No evidence items were included in this session snapshot.";

export const EVIDENCE_EXPIRED = EXPIRED_EVIDENCE_NOTE;

export const PAGE_LINK_NOT_SAVED_NOTICE =
  "Not saved. This result was not stored as a public report. A copied page link identifies the session but does not preserve these scores or evidence.";

const PAGE_LINK_READONLY_PARAM = "ro";
const PAGE_LINK_READONLY_VALUE = "1";

const ACTION_BTN =
  "inline-flex min-h-11 items-center rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800";

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

// AG-1.5 bounded length for the unpadded base64url(token@fqdn) reverse
// invite shape. A DNS fqdn is at most 253 ASCII characters; with a generous
// allowance for the token half, unpadded base64url inflates plaintext by
// roughly 4/3. 512 covers that with headroom without accepting arbitrary
// pasted text.
export const MAX_REVERSE_INVITE_LENGTH = 512;

export const REVERSE_INVITE_FIELD_LABEL = "Return invitation";
export const REVERSE_INVITE_SUBMIT_LABEL = "Submit return invitation";
export const REVERSE_INVITE_TOO_LONG_TEXT =
  "That return invitation is too long. Paste the invitation issued by the target server.";

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

/**
 * Pure mapping from a postReverseInvite failure to operator-facing copy.
 * The known backend reasonCodes reuse the shared paste_* guidance strings;
 * anything else (peer_unreachable, not_found, internal_error, or an
 * unrecognized envelope) falls back to the backend message, and finally to
 * a generic string when even that is empty.
 */
export function reverseInviteErrorCopy(failure: ValidatorFailure): string {
  if (failure.error === "wrong_target_host") {
    return actionErrorCopy("paste_422_wrong_target_host");
  }
  if (failure.error === "conflict") {
    return actionErrorCopy("paste_409_conflict");
  }
  if (failure.error === "missing_field") {
    return actionErrorCopy("paste_400_invalid_invitation");
  }
  return failure.message !== "" ? failure.message : "Could not import the return invitation.";
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

function liveViewSignature(step: UserStep, guidanceKey: string | null): string {
  return `${step}:${guidanceKey ?? ""}`;
}

function isFocusLossControl(node: Element | null): node is HTMLElement {
  if (node === null) {
    return false;
  }
  const tag = typeof node.tagName === "string" ? node.tagName.toUpperCase() : "";
  return tag === "BUTTON" || tag === "A" || tag === "TEXTAREA" || tag === "FORM";
}

function snapshotFocusLossControl(): Element | null {
  if (typeof document === "undefined") {
    return null;
  }
  const active = document.activeElement;
  return isFocusLossControl(active) ? active : null;
}

/**
 * Defensive bracket stripping for a guidance record's title and body, not
 * just the single-line announcement. Applies to whatever guidance record is
 * handed to the current row, so any bracketed planning marker never reaches
 * the visible guidance slot (which is also what a screen reader announces).
 */
export function sanitizeGuidanceRecord(
  record: GuidanceRecord | null,
): GuidanceRecord | null {
  if (record === null) {
    return null;
  }
  if (record.kind === "instruction") {
    return {
      ...record,
      title: stripBracketedMarkers(record.title),
      body: stripBracketedMarkers(record.body),
    };
  }
  return { ...record, body: stripBracketedMarkers(record.body) };
}

function requestDeps(
  config: ValidatorRuntimeConfig,
  signal?: AbortSignal,
): ValidatorFetchDeps {
  return {
    origin: config.validatorApiOrigin,
    timeoutMs: config.requestTimeoutMs,
    backoffInitialMs: config.backoffInitialMs,
    backoffMaxMs: config.backoffMaxMs,
    signal,
  };
}

/**
 * Live session report href. Shown only when origin is a normalized real
 * origin. An empty origin has no proxy-confirmation contract, so the link
 * stays hidden instead of falling back to a relative /validator path.
 * Built with joinValidatorUrl so that helper supplies the /validator prefix.
 * Do not use resolvePublicReportUrl here: that helper rejects an empty
 * origin, and this live route must stay independent of the permanent
 * public-report URL.
 */
export function liveViewReportHref(origin: string, sessionId: string): string | null {
  const trimmedOrigin = origin.trim();
  if (trimmedOrigin === "") {
    return null;
  }
  return joinValidatorUrl(trimmedOrigin, `/report/${encodeURIComponent(sessionId)}`);
}

export function areaTotals(areas: readonly SpecificationAreaGridEntry[]): {
  passed: number;
  warn: number;
  failed: number;
  rest: number;
} {
  let passed = 0;
  let warn = 0;
  let failed = 0;
  let rest = 0;
  for (const area of areas) {
    if (area.grade === "pass") {
      passed += 1;
    } else if (area.grade === "warn") {
      warn += 1;
    } else if (area.grade === "fail") {
      failed += 1;
    } else {
      rest += 1;
    }
  }
  return { passed, warn, failed, rest };
}

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

function BackToTest({ href }: { href: string }): React.ReactElement {
  return (
    <a href={href} className={`${ACTION_BTN} text-zinc-200`}>
      Back to Test
    </a>
  );
}

function RunNewCheck({ href }: { href: string }): React.ReactElement {
  return (
    <a href={href} className={ACTION_BTN}>
      Run a new check
    </a>
  );
}

function ReloadButton({ label }: { label: string }): React.ReactElement {
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

function pageLinkIsReadOnly(href: string): boolean {
  try {
    return new URL(href).searchParams.get(PAGE_LINK_READONLY_PARAM) === PAGE_LINK_READONLY_VALUE;
  } catch {
    return false;
  }
}

function pageLinkHref(status: ResultsPageStatus, href: string): string {
  if (status !== "live") {
    return href;
  }
  try {
    const url = new URL(href);
    url.searchParams.set(PAGE_LINK_READONLY_PARAM, PAGE_LINK_READONLY_VALUE);
    return url.href;
  } catch {
    return href;
  }
}

function readOnlyStop(): Promise<{
  ok: false;
  kind: "aborted";
  status: null;
  error: string;
  message: string;
}> {
  return Promise.resolve({
    ok: false,
    kind: "aborted",
    status: null,
    error: "aborted",
    message: "",
  });
}

export type CopyNotice = {
  ok: boolean;
  text: string;
};

export const EMPTY_COPY_NOTICE: CopyNotice = { ok: true, text: "" };
export const COPY_SUCCESS_TEXT = "Copied";

// AG-1.4 cached-invite field label. Claim CTA labels live in actionRows.
export const INVITE_FIELD_LABEL = "Invitation";
export const CLAIM_COPY_FAILURE_TEXT =
  "Could not copy the invitation. Select and copy it from the field below.";

const INVITE_STORAGE_PREFIX = "validator:invite:";

function inviteStorageKey(sessionId: string): string {
  return `${INVITE_STORAGE_PREFIX}${sessionId}`;
}

// SessionStorage is a best-effort durable backup of a claimed invitation for a
// single session id. Access and read/write can throw (disabled storage, quota,
// privacy mode); every path is guarded and non-fatal, so the in-memory cache
// remains the source of truth.
export function readStoredInvite(sessionId: string): string | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    const store: Storage | undefined = window.sessionStorage;
    if (store === undefined || store === null) {
      return null;
    }
    const raw = store.getItem(inviteStorageKey(sessionId));
    return typeof raw === "string" && raw !== "" ? raw : null;
  } catch {
    return null;
  }
}

export function writeStoredInvite(sessionId: string, value: string): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    const store: Storage | undefined = window.sessionStorage;
    if (store === undefined || store === null) {
      return;
    }
    store.setItem(inviteStorageKey(sessionId), value);
  } catch {
    // Storing the invite is best-effort; the in-memory cache stays valid.
  }
}

function clipboardWriter(): Clipboard | undefined {
  if (
    typeof window === "undefined" ||
    window.isSecureContext !== true ||
    typeof navigator === "undefined"
  ) {
    return undefined;
  }
  const clipboard = navigator.clipboard;
  if (clipboard === undefined || typeof clipboard.writeText !== "function") {
    return undefined;
  }
  return clipboard;
}

function createOffscreenCopyTextarea(value: string): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  // 1px offscreen. display:none and the old opacity:0 fixed trick both break
  // selection in some browsers, so the node stays measurable for the copy.
  textarea.style.position = "absolute";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.padding = "0";
  textarea.style.border = "0";
  textarea.style.overflow = "hidden";
  return textarea;
}

function restorePriorFocus(previousActive: Element | null, textarea: HTMLTextAreaElement): void {
  if (
    previousActive instanceof HTMLElement &&
    previousActive !== textarea &&
    previousActive.isConnected
  ) {
    try {
      previousActive.focus({ preventScroll: true });
    } catch {
      // Focus restore is best-effort.
    }
  }
}

// Shared page-link / report-link / later AG-1.4 copy helper. Tier 2 execCommand
// is best-effort only; a true return is not a guarantee on every browser.
export async function copyText(value: string): Promise<boolean> {
  const clipboard = clipboardWriter();
  if (clipboard !== undefined) {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // Clipboard API rejected; try the execCommand fallback.
    }
  }
  if (typeof document === "undefined") {
    return false;
  }
  const previousActive = document.activeElement;
  const textarea = createOffscreenCopyTextarea(value);
  document.body.appendChild(textarea);
  try {
    if (typeof textarea.focus === "function") {
      textarea.focus({ preventScroll: true });
    }
    if (typeof textarea.select === "function") {
      textarea.select();
    }
    if (typeof document.execCommand !== "function") {
      return false;
    }
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    try {
      const parent = textarea.parentNode;
      if (parent !== null) {
        parent.removeChild(textarea);
      }
    } catch {
      // Textarea cleanup is best-effort.
    }
    restorePriorFocus(previousActive, textarea);
  }
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

export default function ResultsShell({
  host,
  id,
  testHref = TEST_HREF,
}: ResultsShellProps): React.ReactElement {
  const [session, setSession] = useState<ValidatorUrlState | null>(() =>
    sessionFromProps(host, id),
  );
  const [mounted, setMounted] = useState(false);
  const [config, setConfig] = useState<ValidatorRuntimeConfig | null>(null);
  const [poll, setPoll] = useState<SessionPollResponse | null>(null);
  const [view, setView] = useState<MachineView | null>(null);
  const [guidanceKey, setGuidanceKey] = useState<string | null>(null);
  const [lastLiveReport, setLastLiveReport] = useState<ReportResponse | null>(null);
  const [terminalReport, setTerminalReport] = useState<ReportResponse | null>(null);
  const [reportFailure, setReportFailure] = useState<ValidatorFailure | null>(null);
  const [error, setError] = useState("");
  const [copyNotice, setCopyNotice] = useState<CopyNotice>(EMPTY_COPY_NOTICE);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const [cachedInvite, setCachedInvite] = useState<string | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  // Terminal lock. An uncached 410 means the invitation is already claimed and
  // unrecoverable in this browser, so the CTA must stay disabled after the
  // in-flight claimBusy clears. It persists until a session/navigation reset.
  const [claimLocked, setClaimLocked] = useState(false);
  // AG-2.4 sole POST-error channel for the current row. The claim CTA and
  // the reverse-invite form both write here; only one of them can be the
  // active row at a time, so the two failure paths never collide.
  const [postError, setPostError] = useState<string | null>(null);
  // Holds the session id of the in-flight claim, or null when idle. Using the
  // id (not a bool) lets an old claim's finally avoid clearing a newer
  // session's lock after a navigation reset cleared the shared ref.
  const claimLockRef = useRef<string | null>(null);
  // Mirrors the current session id every render so an async claim callback can
  // compare the session it started in against the live session with no
  // effect-timing gap.
  const currentSessionIdRef = useRef<string | null>(null);
  // AG-1.5 reverse-invite form state. The textarea stays controlled and its
  // busy/lock pair mirrors the AG-1.4 claim race-safety shape; its error now
  // shares the postError channel above.
  const [reverseValue, setReverseValue] = useState("");
  const [reverseBusy, setReverseBusy] = useState(false);
  // Holds the session id of the in-flight reverse POST, or null when idle.
  // Reverse POST is not cached, so unlike claimLockRef this only guards
  // against a double submit while one request is outstanding.
  const reverseLockRef = useRef<string | null>(null);
  // Mirrors the current guidanceKey every render so an async reverse-invite
  // callback can tell whether polling already left paste_s2 while its POST
  // was in flight, with no effect-timing gap.
  const guidanceKeyRef = useRef<string | null>(null);
  // AG-2.4 sole POST-error channel. Cleared synchronously during render
  // (see the guidanceKeyRef assignment below) whenever the displayed
  // instruction changes, so a stale claim or reverse failure never survives
  // past the row it happened on, not even for one committed frame. A fresh
  // POST attempt clears it directly (see handleClaimInvite /
  // handleReverseInvite), and a repeat poll of the same instruction leaves
  // guidanceKey unchanged, so this does not fire on every poll.
  const prevGuidanceKeyRef = useRef(guidanceKey);
  const [rawJsonOpen, setRawJsonOpen] = useState(false);
  const [selectedArea, setSelectedArea] = useState<CanonicalAreaId | null>(null);
  const viewRef = useRef<MachineView | null>(null);
  const liveHoldRef = useRef<LiveInstructionHold>(INITIAL_LIVE_INSTRUCTION_HOLD);
  const currentCardRef = useRef<HTMLDivElement | null>(null);
  const liveViewSeededRef = useRef(false);
  const lastLiveSignatureRef = useRef<string | null>(null);
  const pendingFocusLossElRef = useRef<Element | null>(null);
  const [restoreCurrentCardFocus, setRestoreCurrentCardFocus] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyMountedRef = useRef(true);
  // Live trigger buttons keyed by canonical area id, plus a grid-heading
  // fallback. On close we restore focus by area id so the correct trigger wins
  // even if the modal remounted a fresh button; OverlayFrame does its own
  // restore first and this deferred restore wins afterward.
  const triggerRefs = useRef(new Map<CanonicalAreaId, HTMLButtonElement | null>());
  const gridHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const registerTriggerRef = useCallback(
    (area: CanonicalAreaId, el: HTMLButtonElement | null): void => {
      if (el === null) {
        triggerRefs.current.delete(area);
        return;
      }
      triggerRefs.current.set(area, el);
    },
    [],
  );

  useEffect(() => {
    setMounted(true);
    setSession(
      sessionFromLocation(
        host,
        id,
        typeof window === "undefined" ? null : window.location.href,
      ),
    );
  }, [host, id]);

  useEffect(() => {
    viewRef.current = null;
    liveHoldRef.current = INITIAL_LIVE_INSTRUCTION_HOLD;
    liveViewSeededRef.current = false;
    lastLiveSignatureRef.current = null;
    pendingFocusLossElRef.current = null;
    setRestoreCurrentCardFocus(false);
    setPoll(null);
    setView(null);
    setGuidanceKey(null);
    setLastLiveReport(null);
    setTerminalReport(null);
    setReportFailure(null);
    setError("");
    setRawJsonOpen(false);
    setSelectedArea(null);
    setCopyNotice(EMPTY_COPY_NOTICE);
    setCopyFallback(null);
    setCachedInvite(null);
    setClaimBusy(false);
    setClaimLocked(false);
    setPostError(null);
    claimLockRef.current = null;
    setReverseValue("");
    setReverseBusy(false);
    reverseLockRef.current = null;
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  }, [session?.host, session?.id]);

  useEffect(() => {
    copyMountedRef.current = true;
    return () => {
      copyMountedRef.current = false;
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const loaded = await loadValidatorConfig(fetchConfigSource(fetch.bind(globalThis)));
      if (controller.signal.aborted) {
        return;
      }
      setConfig(loaded);
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (config === null || session === null) {
      return;
    }
    const controller = new AbortController();
    const readOnly =
      typeof window !== "undefined" && pageLinkIsReadOnly(window.location.href);
    void runResultsPollLoop(
      {
        sessionId: session.id,
        cadence: {
          pollIntervalMs: config.pollIntervalMs,
          activePollIntervalMs: config.activePollIntervalMs,
        },
        deps: requestDeps(config, controller.signal),
        signal: controller.signal,
        // Copied live links use ?ro=1 so this view keeps GET polling but
        // never POSTs /stop.
        readOnly,
        stop: readOnly ? readOnlyStop : undefined,
      },
      {
        onPoll: (data) => {
          setPoll(data);
        },
        onView: (machine, pollData) => {
          const { stabilized, hold } = stabilizeLiveView(
            machine,
            pollData.nextInstruction,
            liveHoldRef.current,
          );
          liveHoldRef.current = hold;
          viewRef.current = stabilized.view;
          const signature = liveViewSignature(stabilized.view.step, stabilized.guidanceKey);
          const seeded = liveViewSeededRef.current;
          const previous = lastLiveSignatureRef.current;
          lastLiveSignatureRef.current = signature;
          liveViewSeededRef.current = true;
          if (seeded && previous !== signature) {
            pendingFocusLossElRef.current = snapshotFocusLossControl();
          } else {
            pendingFocusLossElRef.current = null;
          }
          setView(stabilized.view);
          setGuidanceKey(stabilized.guidanceKey);
        },
        onReport: (data) => {
          if (viewRef.current?.terminalize === true) {
            setTerminalReport(data);
          } else {
            setLastLiveReport(data);
          }
        },
        onReportFailure: setReportFailure,
        onError: setError,
      },
    );
    return () => controller.abort();
  }, [config, session]);

  useLayoutEffect(() => {
    const pending = pendingFocusLossElRef.current;
    if (pending === null) {
      return;
    }
    pendingFocusLossElRef.current = null;
    if (pending.isConnected) {
      setRestoreCurrentCardFocus(false);
      return;
    }
    setRestoreCurrentCardFocus(true);
    const card = currentCardRef.current;
    if (card === null) {
      return;
    }
    card.tabIndex = -1;
    try {
      card.focus({ preventScroll: true });
    } catch {
      // Focus restore is best-effort.
    }
  }, [guidanceKey, view]);

  currentSessionIdRef.current = session?.id ?? null;
  guidanceKeyRef.current = guidanceKey;
  if (prevGuidanceKeyRef.current !== guidanceKey) {
    prevGuidanceKeyRef.current = guidanceKey;
    setPostError(null);
  }

  const projection = projectResultsPage({
    poll,
    view,
    lastLiveReport,
    terminalReport,
    reportFailure,
    validatorApiOrigin: config?.validatorApiOrigin ?? "",
  });

  function clearCopyTimer(): void {
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  }

  function settleCopyOutcome(ok: boolean, value: string, failureText: string): void {
    clearCopyTimer();
    if (ok) {
      setCopyFallback(null);
      // Commit an empty live-region tick so a repeat copy can re-announce.
      setCopyNotice({ ok: true, text: "" });
      copyTimerRef.current = setTimeout(() => {
        if (!copyMountedRef.current) {
          copyTimerRef.current = null;
          return;
        }
        setCopyNotice({ ok: true, text: COPY_SUCCESS_TEXT });
        copyTimerRef.current = setTimeout(() => {
          if (!copyMountedRef.current) {
            copyTimerRef.current = null;
            return;
          }
          setCopyNotice((current) => (current.ok ? { ok: true, text: "" } : current));
          copyTimerRef.current = null;
        }, 2000);
      }, 0);
      return;
    }
    setCopyFallback(value);
    setCopyNotice({ ok: false, text: failureText });
  }

  async function handleCopyPageLink(): Promise<void> {
    if (session === null || typeof window === "undefined") {
      return;
    }
    const value = pageLinkHref(projection.status, window.location.href);
    const ok = await copyText(value);
    settleCopyOutcome(ok, value, "Could not copy the page link.");
  }

  async function handleCopyReport(): Promise<void> {
    if (projection.reportUrl === null) {
      return;
    }
    const ok = await copyText(projection.reportUrl);
    settleCopyOutcome(
      ok,
      projection.reportUrl,
      "Could not copy the report link. Open the report and copy its address instead.",
    );
  }

  // AG-1.4 primary CTA for the paste_s1 step. First use claims the invitation
  // (one POST), caches it before any clipboard access, then copies it. Once a
  // cache exists, this is "Copy again": it copies the cached value only and
  // never POSTs. A fast double click issues exactly one claim because the ref
  // lock is acquired synchronously before the await.
  async function handleClaimInvite(): Promise<void> {
    if (session === null || config === null) {
      return;
    }
    // An uncached 410 terminally locked this browser out of claiming; never
    // re-POST even if a stray click reaches the disabled CTA.
    if (claimLocked) {
      return;
    }
    // Capture the session this claim belongs to. Every post-await write is
    // guarded against it so a POST for session A that resolves after
    // navigation to session B cannot touch B's cache, error, notice, or state.
    const claimSessionId = session.id;
    if (cachedInvite !== null) {
      const ok = await copyText(cachedInvite);
      // A copy that resolves after navigation must not re-announce for B.
      if (isStaleSessionId(claimSessionId, currentSessionIdRef.current)) {
        return;
      }
      settleCopyOutcome(ok, cachedInvite, CLAIM_COPY_FAILURE_TEXT);
      return;
    }
    if (claimLockRef.current !== null) {
      return;
    }
    claimLockRef.current = claimSessionId;
    setClaimBusy(true);
    setPostError(null);
    try {
      const result = await claimInvite(claimSessionId, requestDeps(config));
      // Ignore a stale resolution entirely once the session changed.
      if (isStaleSessionId(claimSessionId, currentSessionIdRef.current)) {
        return;
      }
      if (result.ok) {
        const invite = result.data.inviteString;
        // Cache before clipboard so the invite survives a copy failure and
        // later polls; sessionStorage is a best-effort durable backup.
        setCachedInvite(invite);
        writeStoredInvite(claimSessionId, invite);
        const ok = await copyText(invite);
        // Navigation during the copy await must not re-announce for B.
        if (isStaleSessionId(claimSessionId, currentSessionIdRef.current)) {
          return;
        }
        settleCopyOutcome(ok, invite, CLAIM_COPY_FAILURE_TEXT);
        return;
      }
      // A late failure response must not overwrite postError once the
      // instruction has already advanced past paste_s1 for this session.
      // Caching above is unaffected: only these announcement writes guard on
      // guidanceKey, matching AG-1.5's reverse-handler pattern.
      if (
        isStaleSessionId(claimSessionId, currentSessionIdRef.current)
        || guidanceKeyRef.current !== "paste_s1"
      ) {
        return;
      }
      if (result.error === "INVITE_ALREADY_CLAIMED") {
        const cached = readStoredInvite(claimSessionId);
        if (cached !== null) {
          setCachedInvite(cached);
          const ok = await copyText(cached);
          if (
            isStaleSessionId(claimSessionId, currentSessionIdRef.current)
            || guidanceKeyRef.current !== "paste_s1"
          ) {
            return;
          }
          settleCopyOutcome(ok, cached, CLAIM_COPY_FAILURE_TEXT);
        } else {
          // Already claimed and unrecoverable here: show locked copy and keep
          // the CTA disabled permanently for this session.
          setPostError(actionErrorCopy("claim_410_no_cache"));
          setClaimLocked(true);
        }
        return;
      }
      if (result.error === "SESSION_NOT_READY") {
        setPostError(actionErrorCopy("claim_409_session_not_ready"));
        return;
      }
      setPostError(
        result.message !== "" ? result.message : "Could not claim the invitation.",
      );
    } finally {
      // Only release the in-flight lock this claim actually still owns; a
      // newer session may have reset the shared ref or acquired its own lock.
      if (isSameSessionId(claimLockRef.current, claimSessionId)) {
        claimLockRef.current = null;
      }
      // Never clear a newer session's transient busy state. claimLocked is
      // intentionally left untouched here so an uncached-410 lock persists.
      if (isSameSessionId(claimSessionId, currentSessionIdRef.current)) {
        setClaimBusy(false);
      }
    }
  }

  // AG-1.5 submit for the paste_s2 reverse-invite form. Reuses AG-1.4's ref
  // lock plus busy state so a fast double click issues exactly one POST, but
  // unlike the claim CTA the reverse POST result is never cached: each
  // submit from paste_s2 can post again once the prior request settles. A
  // 200 never advances the UI on its own (only the poll leaving paste_s2
  // does that), and any write after this POST settles is dropped once either
  // the session changed or polling already left paste_s2 while it was in
  // flight.
  async function handleReverseInvite(): Promise<void> {
    if (session === null || config === null) {
      return;
    }
    // Trim only the surrounding whitespace; inner whitespace/content is part
    // of the invite string and must reach the backend unchanged.
    const trimmed = reverseValue.trim();
    if (trimmed.length > MAX_REVERSE_INVITE_LENGTH) {
      setPostError(REVERSE_INVITE_TOO_LONG_TEXT);
      return;
    }
    if (reverseLockRef.current !== null) {
      return;
    }
    const reverseSessionId = session.id;
    reverseLockRef.current = reverseSessionId;
    setReverseBusy(true);
    setPostError(null);
    try {
      const result = await postReverseInvite(reverseSessionId, trimmed, requestDeps(config));
      // Ignore a stale resolution: either the session changed, or polling
      // already left paste_s2 while this POST was in flight. Neither the
      // 200 nor the error is state truth; only the poll loop is.
      if (
        isStaleSessionId(reverseSessionId, currentSessionIdRef.current) ||
        guidanceKeyRef.current !== "paste_s2"
      ) {
        return;
      }
      if (result.ok) {
        setPostError(null);
        return;
      }
      setPostError(reverseInviteErrorCopy(result));
    } finally {
      // Only release the in-flight lock this submit actually still owns.
      if (isSameSessionId(reverseLockRef.current, reverseSessionId)) {
        reverseLockRef.current = null;
      }
      // Busy clears on session identity alone (matching AG-1.4): once this
      // session's own POST settles, the submit button must re-enable even
      // if polling already moved past paste_s2 and unmounted the form.
      if (isSameSessionId(reverseSessionId, currentSessionIdRef.current)) {
        setReverseBusy(false);
      }
    }
  }

  if (session === null) {
    const sessionStart = projectSessionStart(
      null,
      mounted,
      typeof window === "undefined" ? null : window.location.href,
    );
    if (sessionStart.kind === "failure") {
      return (
        <div className="space-y-4">
          <BackToTest href={testHref} />
          <p className="text-sm text-rose-200" role="alert">
            {sessionStart.message}
          </p>
        </div>
      );
    }
    return <p className="text-sm text-zinc-400">{SESSION_START_LOADING_TEXT}</p>;
  }

  const collections = projectProgressCollections({
    status: projection.status,
    areas: projection.score.areas,
    evidence: projection.evidence,
    view,
    guidanceKey,
  });
  const resultAreas = collections.areas;
  const actionable = projectActionable({
    status: projection.status,
    hasSourceReport: projection.sourceReport !== null,
    selectedArea,
    areas: resultAreas,
  });
  const selectedEntry = actionable.areaModal.selectedEntry;
  const statusText = collections.progress;
  const transportFailure = projectTransportFailure(
    error,
    projection.status,
    projection.reportFailure,
  );
  const currentRowGuidance: GuidanceRecord | null = sanitizeGuidanceRecord(
    guidanceFor(guidanceKey),
  );
  const sessionFailure = projectSessionFailure(
    projection.status,
    poll?.state,
    poll?.failModeLabel,
  );
  const liveReportHref =
    projection.status === "live"
      ? liveViewReportHref(config?.validatorApiOrigin ?? "", session.id)
      : null;
  const actionRows = projectActionRows({
    status: projection.status,
    visibility: projection.visibility,
    sourceKind: projection.sourceKind,
    showPublicActions: projection.showPublicActions,
    reportUrl: projection.reportUrl,
    bannerVerdict: projection.bannerVerdict,
    guidanceKey,
    cachedInvite,
    claimBusy,
    claimLocked,
    reverseBusy,
    liveReportHref,
    steps: collections.steps,
  });
  const capability = projectCapability({
    status: projection.status,
    visibility: projection.visibility,
    evidenceMode: projection.evidenceMode,
    sourceKind: projection.sourceKind,
    hasSourceReport: projection.sourceReport !== null,
  });
  const rawJsonLabel = actionable.rawJson.label;
  // Normal ready/live results surface the full report JSON as a low-emphasis
  // footer action; the malformed terminal keeps a prominent action button.
  const readyRawJsonTrigger =
    actionable.rawJson.hasSourceReport ? (
      <button
        type="button"
        className="text-sm text-zinc-400 underline hover:text-zinc-200"
        aria-haspopup="dialog"
        aria-expanded={rawJsonOpen}
        onClick={() => setRawJsonOpen(true)}
      >
        {rawJsonLabel}
      </button>
    ) : null;
  const malformedRawJsonTrigger = actionable.rawJson.showMalformedTrigger ? (
    <button
      type="button"
      className={ACTION_BTN}
      aria-haspopup="dialog"
      aria-expanded={rawJsonOpen}
      onClick={() => setRawJsonOpen(true)}
    >
      {rawJsonLabel}
    </button>
  ) : null;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-zinc-100">
            Result for {session.host}
          </p>
          <p className="mt-1 break-all text-sm text-zinc-400">
            Session {session.id}
          </p>
          {actionRows.pageLink.visible ? (
            <>
              <button
                type="button"
                className={`${ACTION_BTN} mt-2`}
                onClick={() => {
                  void handleCopyPageLink();
                }}
              >
                {actionRows.pageLink.label}
              </button>
              {actionRows.pageLink.showNotSavedNotice ? (
                <p className="mt-2 text-sm text-zinc-400">
                  {PAGE_LINK_NOT_SAVED_NOTICE}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      {projection.bannerVerdict !== null &&
      view !== null &&
      (projection.status === "live" || projection.status === "ready") ? (
        <div data-banner-region="">
          <VerdictBanner
            verdict={projection.bannerVerdict}
            title={projection.bannerTitle}
            message={projection.bannerMessage}
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
      {transportFailure.poll !== null ? (
        <div className="space-y-3">
          <p className="text-sm text-rose-200" role="alert">
            {transportFailure.poll.message}
          </p>
          <div className="flex flex-wrap gap-2">
            {transportFailure.poll.showRetry ? (
              <ReloadButton label={transportFailure.poll.retryLabel} />
            ) : null}
            <RunNewCheck href={testHref} />
          </div>
        </div>
      ) : null}
      {view === null ? (
        <p className="text-sm text-zinc-400">Loading session...</p>
      ) : projection.status === "live" ? (
        <div className="space-y-3" data-step-list="">
          {actionRows.liveRows.map((row) => {
            const rowFormSlot =
              row.reverseMounted ? (
                <ReverseFormSlot
                  active={row.reverseActive}
                  value={reverseValue}
                  onChange={setReverseValue}
                  busy={row.reverseBusy}
                  error={postError}
                  onSubmit={() => {
                    void handleReverseInvite();
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
                        void handleClaimInvite();
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
      {projection.status === "loading_report" ? (
        <p className="text-sm text-zinc-400">Loading report...</p>
      ) : null}
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
      {transportFailure.report !== null ? (
        <div className="space-y-3">
          <p className="text-sm text-rose-200" role="alert">
            {transportFailure.report.message}
          </p>
          <div className="flex flex-wrap gap-2">
            {transportFailure.report.showRetry ? (
              <ReloadButton label={transportFailure.report.retryLabel} />
            ) : null}
            <RunNewCheck href={testHref} />
          </div>
        </div>
      ) : null}
      {projection.showAreas ? (
        <div className="space-y-4">
          <SummaryChipBand
            areas={projection.score.areas}
            assessed={projection.score.assessed}
            total={projection.score.total}
            coverageLabel={projection.score.coverageLabel}
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
              onAreaClick={(areaId) => setSelectedArea(areaId)}
              registerTriggerRef={registerTriggerRef}
            />
          </div>
        </div>
      ) : null}
      {capability.visibilityNotice.visible ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">{capability.visibilityNotice.text}</p>
          {capability.visibilityNotice.showRetentionPolicy ? (
            <p className="text-sm text-zinc-400">{RETENTION_POLICY_TEXT}</p>
          ) : null}
        </div>
      ) : null}
      {actionRows.publicReport.visible ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            href={actionRows.publicReport.reportUrl}
            className={ACTION_BTN}
            target="_blank"
            rel="noreferrer"
          >
            {actionRows.publicReport.openLabel}
          </a>
          <button
            type="button"
            className={ACTION_BTN}
            onClick={() => {
              void handleCopyReport();
            }}
          >
            {actionRows.publicReport.copyLabel}
          </button>
        </div>
      ) : null}
      {actionRows.interruptedRecovery.visible ? (
        <div className="flex flex-wrap gap-2"><RunNewCheck href={testHref} /></div>
      ) : null}
      {capability.evidence.sectionVisible ? (
        <div className="space-y-4">
          {capability.evidence.showDisclosure ? (
            <EvidenceDisclosure
              title="Evidence"
              items={collections.evidence}
              defaultExpanded={collections.evidence.length > 0}
            />
          ) : null}
          {capability.evidence.showNotSaved ? (
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Evidence</h2>
              <p className="mt-1 text-sm text-zinc-400">{EVIDENCE_EMPTY_SNAPSHOT}</p>
              <p className="mt-1 text-sm text-zinc-400">{EVIDENCE_NOT_SAVED}</p>
            </div>
          ) : null}
          {capability.evidence.showSessionEmpty ? (
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Evidence</h2>
              <p className="mt-1 text-sm text-zinc-400">{EVIDENCE_EMPTY_SNAPSHOT}</p>
            </div>
          ) : null}
          {capability.evidence.showUnknownEmpty ? (
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Evidence</h2>
              <p className="mt-1 text-sm text-zinc-400">{EVIDENCE_EMPTY_SNAPSHOT}</p>
            </div>
          ) : null}
          {capability.evidence.showExpired ? (
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Evidence</h2>
              <p className="mt-1 text-sm text-zinc-400">{EVIDENCE_EXPIRED}</p>
            </div>
          ) : null}
          {capability.evidence.showCachedSessionNote ? (
            <p className="text-sm text-zinc-400">{CACHED_SESSION_JSON_NOTE}</p>
          ) : null}
          {readyRawJsonTrigger}
        </div>
      ) : null}
      {malformedRawJsonTrigger}
      {rawJsonOpen && actionable.rawJson.hasSourceReport && projection.sourceReport !== null ? (
        <ReportJsonModal
          title={projection.rawJsonTitle}
          sourceReport={projection.sourceReport}
          note={projection.rawJsonNote}
          downloadName={`report-${session.id}.json`}
          onClose={() => setRawJsonOpen(false)}
        />
      ) : null}
      {actionable.areaModal.showModal &&
      selectedArea !== null &&
      selectedEntry !== null &&
      projection.sourceReport !== null ? (
        <AreaModal
          area={selectedArea}
          areaLabel={selectedEntry.label}
          items={collections.evidence}
          sourceReport={projection.sourceReport}
          grade={selectedEntry.grade}
          pillLabel={selectedEntry.pillLabel}
          evidenceCount={selectedEntry.evidenceCount}
          onClose={() => {
            const area = selectedArea;
            setSelectedArea(null);
            // OverlayFrame removes inert and restores its captured element in a
            // passive-effect cleanup. A microtask would run before that cleanup,
            // so the focus could land while the body is still inert. Defer with
            // setTimeout(0): a macrotask that runs after OverlayFrame's inert
            // cleanup (React flushes passive effects via MessageChannel, which
            // beats the clamped setTimeout) and that the happy-dom tests flush
            // through their act/timer loop. This deferred focus is remount
            // insurance and wins afterward, refocusing the current trigger for
            // the stored area id or the grid heading when the trigger is gone.
            setTimeout(() => {
              if (area === null) {
                return;
              }
              const btn = triggerRefs.current.get(area);
              if (btn !== undefined && btn !== null && btn.isConnected) {
                btn.focus();
              } else {
                gridHeadingRef.current?.focus();
              }
            }, 0);
          }}
        />
      ) : null}
    </div>
  );
}
