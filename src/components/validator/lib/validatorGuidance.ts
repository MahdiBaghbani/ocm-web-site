/**
 * Guidance copy for validator session steps plus pure action-error copy.
 * Each instruction step, three terminal states, a resolver with an unknown-step
 * fallback, and exact operator-facing error strings. Pure, no React imports.
 */

export type GuidancePhase =
  | "probe"
  | "invite"
  | "reverse"
  | "share"
  | "queue"
  | "result"
  | "unknown";

/** The four operator actions surfaced as call-to-action buttons. */
export type OperatorAction =
  | "copy_invite"
  | "paste_reverse"
  | "open_file"
  | "report_if_permanent";

/** A record either drives a CTA button or has none. */
export type GuidanceCta = OperatorAction | "none";

/** Instruction records carry a mode/activity classification; terminals do not. */
export type InstructionMode = "passive" | "active";
export type InstructionActivity = "wait" | "action" | "auto";

interface GuidanceBase {
  key: string;
  phase: GuidancePhase;
  cta: GuidanceCta;
  status: string;
  body: string;
}

export interface InstructionGuidance extends GuidanceBase {
  kind: "instruction";
  title: string;
  mode: InstructionMode;
  activity: InstructionActivity;
}

export interface TerminalGuidance extends GuidanceBase {
  kind: "terminal";
  mode: "terminal";
  activity: "terminal";
}

export type GuidanceRecord = InstructionGuidance | TerminalGuidance;

export const INSTRUCTION_KEYS = [
  "wait_probe",
  "wait_invite_mint",
  "paste_s1",
  "wait_reverse_start",
  "paste_s2",
  "wait_forward_share",
  "open_forward_file",
  "wait_oq2_open",
  "wait_reverse_share_or_timeout",
  "wait_active_slot",
  "stop",
] as const;
export type InstructionKey = (typeof INSTRUCTION_KEYS)[number];

export const TERMINAL_KEYS = [
  "terminal_pass",
  "terminal_fail",
  "interrupted",
] as const;
export type TerminalKey = (typeof TERMINAL_KEYS)[number];

export type GuidanceKey = InstructionKey | TerminalKey;

/** The full operator-action set, classified once. */
export const OPERATOR_ACTIONS: readonly OperatorAction[] = [
  "copy_invite",
  "paste_reverse",
  "open_file",
  "report_if_permanent",
] as const;

/** Title shown when a step key is not recognized. */
export const UNKNOWN_GUIDANCE_TITLE = "Unknown step; keep this tab open";

type InstructionSpec = Omit<InstructionGuidance, "kind" | "key">;
type TerminalSpec = Omit<TerminalGuidance, "kind" | "key">;

const INSTRUCTION_SPECS: Record<InstructionKey, InstructionSpec> = {
  wait_probe: {
    title: "Wait for the discovery probe",
    mode: "passive",
    activity: "wait",
    phase: "probe",
    cta: "none",
    status: "Checking the server",
    body: "The validator is probing this server's /.well-known/ocm discovery endpoint. No action needed.",
  },
  wait_invite_mint: {
    title: "Wait for the invite to be minted",
    mode: "active",
    activity: "wait",
    phase: "invite",
    cta: "none",
    status: "Preparing the invitation",
    body: "The validator is minting an OCM invitation to start the federation test. No action needed yet.",
  },
  paste_s1: {
    title: "Paste the outgoing invite",
    mode: "active",
    activity: "action",
    phase: "invite",
    cta: "copy_invite",
    status: "Copy and accept the invitation",
    body: "Use Copy invitation, then accept that invitation on the target server under test. You need an account on that server.",
  },
  wait_reverse_start: {
    title: "Wait for reverse invite start",
    mode: "active",
    activity: "wait",
    phase: "invite",
    cta: "none",
    status: "Invitation accepted",
    body: "The target accepted the invitation. The validator is opening the return-invite step.",
  },
  paste_s2: {
    title: "Paste the reverse invite",
    mode: "active",
    activity: "action",
    phase: "reverse",
    cta: "paste_reverse",
    status: "Paste the return invitation",
    body: "On the target server, create or copy an invitation issued by that server, then paste it here. It must come from the server under test.",
  },
  wait_forward_share: {
    title: "Wait for the forward share",
    mode: "active",
    activity: "wait",
    phase: "reverse",
    cta: "none",
    status: "Sending a test file",
    body: "The validator is sharing a test file to the account that accepted the invitation. No action needed.",
  },
  open_forward_file: {
    title: "Open the forwarded file",
    mode: "active",
    activity: "action",
    phase: "share",
    cta: "open_file",
    status: "Open the shared file",
    body: "A test file was shared to the account that accepted the invitation. Open that file on the target server. There is no Open button on this page.",
  },
  wait_oq2_open: {
    title: "Wait for the capability open",
    mode: "active",
    activity: "wait",
    phase: "share",
    cta: "none",
    status: "File open recorded",
    body: "The validator recorded the file open and is starting the share-back wait.",
  },
  wait_reverse_share_or_timeout: {
    title: "Wait for the reverse share or timeout",
    mode: "active",
    activity: "action",
    phase: "share",
    cta: "none",
    status: "Share a file back",
    body: "On the target server, share a file back to the federated contact from this validator. The check waits for that share and times out if nothing arrives.",
  },
  wait_active_slot: {
    title: "Wait for the active slot",
    mode: "active",
    activity: "wait",
    phase: "queue",
    cta: "none",
    status: "Waiting for the active slot",
    body: "Only one active test can run on this target at a time. This session waits until that slot is free.",
  },
  stop: {
    title: "Stop the session",
    mode: "passive",
    activity: "auto",
    phase: "queue",
    cta: "none",
    status: "Finishing the scan",
    body: "The passive check is complete and the validator is wrapping up the result. No action needed.",
  },
};

const TERMINAL_SPECS: Record<TerminalKey, TerminalSpec> = {
  terminal_pass: {
    mode: "terminal",
    activity: "terminal",
    phase: "result",
    cta: "report_if_permanent",
    status: "Check complete",
    body: "The federation checks passed. View the report when one was saved, or run a new check.",
  },
  terminal_fail: {
    mode: "terminal",
    activity: "terminal",
    phase: "result",
    cta: "report_if_permanent",
    status: "Check failed",
    body: "One or more required checks failed. View the report for details when one was saved, or run a new check.",
  },
  interrupted: {
    mode: "terminal",
    activity: "terminal",
    phase: "result",
    cta: "report_if_permanent",
    status: "Check interrupted",
    body: "The scan ended before a result was available. Run a new check.",
  },
};

function buildGuidance(): Record<GuidanceKey, GuidanceRecord> {
  const out = {} as Record<GuidanceKey, GuidanceRecord>;
  for (const key of INSTRUCTION_KEYS) {
    out[key] = { kind: "instruction", key, ...INSTRUCTION_SPECS[key] };
  }
  for (const key of TERMINAL_KEYS) {
    out[key] = { kind: "terminal", key, ...TERMINAL_SPECS[key] };
  }
  return out;
}

/** Every guidance record, keyed by step id. Each key is defined exactly once. */
export const VALIDATOR_GUIDANCE: Record<GuidanceKey, GuidanceRecord> =
  buildGuidance();

function isKnownKey(key: string): key is GuidanceKey {
  return Object.hasOwn(VALIDATOR_GUIDANCE, key);
}

function unknownGuidance(key: string): InstructionGuidance {
  return {
    kind: "instruction",
    key,
    title: UNKNOWN_GUIDANCE_TITLE,
    mode: "passive",
    activity: "wait",
    phase: "unknown",
    cta: "none",
    status: "Keep this tab open",
    body: "This step is not recognized by this page. Keep this tab open, then run a new check if it does not update.",
  };
}

/**
 * Resolve guidance for a step key. A recognized key returns its record. Null,
 * undefined, or empty input returns null. Any other non-empty value returns
 * the unknown-step fallback so the page can keep the operator oriented.
 */
export function guidanceFor(
  key: string | null | undefined,
): GuidanceRecord | null {
  if (key === null || key === undefined) {
    return null;
  }
  const trimmed = key.trim();
  if (trimmed === "") {
    return null;
  }
  if (isKnownKey(trimmed)) {
    return VALIDATOR_GUIDANCE[trimmed];
  }
  return unknownGuidance(trimmed);
}

/** Exact operator-facing error cases raised by claim and paste actions. */
export type ActionErrorKind =
  | "claim_410_no_cache"
  | "claim_409_session_not_ready"
  | "paste_422_wrong_target_host"
  | "paste_409_conflict"
  | "paste_400_invalid_invitation";

/** The exact error copy for each action-error case. No interpolation. */
export const ACTION_ERROR_COPY: Record<ActionErrorKind, string> = {
  claim_410_no_cache:
    "This invitation was already claimed, and this browser cannot retrieve it. Run a new check.",
  claim_409_session_not_ready:
    "This step is no longer available. Waiting for the scan to update.",
  paste_422_wrong_target_host:
    "That invitation is from a different server than the one under test. Paste the return invitation issued by the target.",
  paste_409_conflict:
    "The validator is not ready for this step, or a return invitation is already imported.",
  paste_400_invalid_invitation:
    "That does not look like a valid invitation string.",
};

/** Pure resolver for action-error copy. */
export function actionErrorCopy(kind: ActionErrorKind): string {
  return ACTION_ERROR_COPY[kind];
}
