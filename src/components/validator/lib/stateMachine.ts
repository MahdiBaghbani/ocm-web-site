/**
 * Pure six-step validator UI machine. Poll nextInstruction is the driver;
 * persisted optInActive controls whether Invite/Reverse/Share render.
 * manifest.optIn.start.optInActive is the form gate, not poll state.
 */

import { DEFAULT_VALIDATOR_CONFIG } from "./validatorConfig";

export const OPT_IN_MANIFEST_PATH = "optIn.start.optInActive";

export const NEXT_INSTRUCTIONS = [
  "wait_probe",
  "stop",
  "wait_invite_mint",
  "paste_s1",
  "wait_reverse_start",
  "paste_s2",
  "wait_forward_share",
  "open_forward_file",
  "wait_oq2_open",
  "wait_reverse_share_or_timeout",
  "wait_active_slot",
] as const;

export type NextInstruction = (typeof NEXT_INSTRUCTIONS)[number];

export const CTA_INSTRUCTIONS = [
  "paste_s1",
  "paste_s2",
  "open_forward_file",
  "stop",
] as const;

export type CtaInstruction = (typeof CTA_INSTRUCTIONS)[number];

export const USER_STEPS = [
  "probe",
  "queue_or_rest",
  "invite",
  "reverse",
  "share",
  "result",
] as const;

export type UserStep = (typeof USER_STEPS)[number];

export const USER_STEP_LABELS = {
  probe: "Check server",
  queue_or_rest: "Continue or finish",
  invite: "Create invitation",
  reverse: "Accept return invitation",
  share: "Test sharing",
  result: "Prepare result",
} as const satisfies Record<UserStep, string>;

export const SESSION_STATES = [
  "created",
  "passive_running",
  "passive_complete",
  "active_running",
  "invite_minted",
  "invite_accepted",
  "reverse_awaiting_invite",
  "reverse_invite_accepted",
  "forward_share_sent",
  "capability_exercise",
  "reverse_awaiting_share",
  "terminal_pass",
  "terminal_fail",
  "interrupted",
] as const;

export type SessionState = (typeof SESSION_STATES)[number];

export const TERMINAL_STATES = [
  "terminal_pass",
  "terminal_fail",
  "interrupted",
] as const;

export type TerminalState = (typeof TERMINAL_STATES)[number];

export type StepStatus = "pending" | "current" | "complete" | "hidden";

export interface MachineCadence {
  pollIntervalMs?: number;
  activePollIntervalMs?: number;
}

export interface MachineInput {
  state: string;
  nextInstruction?: string | null;
  optInActive: boolean;
}

export interface MachineView {
  step: UserStep;
  statuses: Record<UserStep, StepStatus>;
  instruction: NextInstruction | null;
  cta: CtaInstruction | null;
  pollIntervalMs: number;
  continuePolling: boolean;
  terminalize: boolean;
  shouldPostStop: boolean;
  showActiveSteps: boolean;
}

export interface InstructionForSessionInput {
  state: string;
  optInActive: boolean;
  isReadyOptInWaiter?: boolean;
}

const INSTRUCTION_SET: ReadonlySet<string> = new Set(NEXT_INSTRUCTIONS);
const CTA_SET: ReadonlySet<string> = new Set(CTA_INSTRUCTIONS);
const TERMINAL_SET: ReadonlySet<string> = new Set(TERMINAL_STATES);
const SESSION_STATE_SET: ReadonlySet<string> = new Set(SESSION_STATES);
const ACTIVE_STEPS = new Set<UserStep>(["invite", "reverse", "share"]);

const INSTRUCTION_STEP = {
  wait_probe: "probe",
  stop: "queue_or_rest",
  wait_active_slot: "queue_or_rest",
  wait_invite_mint: "invite",
  paste_s1: "invite",
  wait_reverse_start: "invite",
  paste_s2: "reverse",
  wait_forward_share: "reverse",
  open_forward_file: "share",
  wait_oq2_open: "share",
  wait_reverse_share_or_timeout: "share",
} as const satisfies Record<NextInstruction, UserStep>;

const STATE_INSTRUCTION = {
  created: "wait_probe",
  passive_running: "wait_probe",
  passive_complete: "stop",
  active_running: "wait_invite_mint",
  invite_minted: "paste_s1",
  invite_accepted: "wait_reverse_start",
  reverse_awaiting_invite: "paste_s2",
  reverse_invite_accepted: "wait_forward_share",
  forward_share_sent: "open_forward_file",
  capability_exercise: "wait_oq2_open",
  reverse_awaiting_share: "wait_reverse_share_or_timeout",
  terminal_pass: null,
  terminal_fail: null,
  interrupted: null,
} as const satisfies Record<SessionState, NextInstruction | null>;

function isNextInstruction(value: string): value is NextInstruction {
  return INSTRUCTION_SET.has(value);
}

function isSessionState(value: string): value is SessionState {
  return SESSION_STATE_SET.has(value);
}

function isCtaInstruction(value: NextInstruction): value is CtaInstruction {
  return CTA_SET.has(value);
}

export function isTerminalState(state: string): state is TerminalState {
  return TERMINAL_SET.has(state);
}

export function isCta(instruction: string | null): instruction is CtaInstruction {
  return instruction !== null && CTA_SET.has(instruction);
}

/** Server nextInstruction for a persisted row. Ready waiters need the flag. */
export function instructionForSession(
  input: InstructionForSessionInput,
): NextInstruction | null {
  if (
    input.optInActive &&
    input.isReadyOptInWaiter === true &&
    input.state === "passive_running"
  ) {
    return "wait_active_slot";
  }

  if (input.state === "passive_complete" && input.optInActive) {
    return null;
  }

  if (!isSessionState(input.state)) {
    return null;
  }

  return STATE_INSTRUCTION[input.state];
}

function stepForInstruction(instruction: NextInstruction | null, terminal: boolean): UserStep {
  if (instruction !== null) {
    return INSTRUCTION_STEP[instruction];
  }
  return terminal ? "result" : "probe";
}

function buildStatuses(
  current: UserStep,
  showActiveSteps: boolean,
): Record<UserStep, StepStatus> {
  const currentIndex = USER_STEPS.indexOf(current);
  const statuses: Record<UserStep, StepStatus> = {
    probe: "pending",
    queue_or_rest: "pending",
    invite: "pending",
    reverse: "pending",
    share: "pending",
    result: "pending",
  };

  for (const [index, step] of USER_STEPS.entries()) {
    if (ACTIVE_STEPS.has(step) && !showActiveSteps) {
      statuses[step] = "hidden";
      continue;
    }
    if (index < currentIndex) {
      statuses[step] = "complete";
      continue;
    }
    if (index === currentIndex) {
      statuses[step] = "current";
      continue;
    }
    statuses[step] = "pending";
  }

  return statuses;
}

function pollIntervalFor(instruction: NextInstruction | null, cadence?: MachineCadence): number {
  const poll = cadence?.pollIntervalMs ?? DEFAULT_VALIDATOR_CONFIG.pollIntervalMs;
  const active = cadence?.activePollIntervalMs ?? DEFAULT_VALIDATOR_CONFIG.activePollIntervalMs;
  if (instruction === "wait_probe" || instruction === "stop") {
    return poll;
  }
  if (instruction !== null) {
    return active;
  }
  return 0;
}

/** Map one poll payload to the six-step view, cadence, and terminal flags. */
export function resolveValidatorMachine(
  input: MachineInput,
  cadence?: MachineCadence,
): MachineView {
  const terminal = isTerminalState(input.state);
  const rawInstruction = input.nextInstruction;
  const instruction =
    !terminal && typeof rawInstruction === "string" && isNextInstruction(rawInstruction)
      ? rawInstruction
      : null;
  const showActiveSteps = input.optInActive;
  const step = stepForInstruction(instruction, terminal);
  const shouldPostStop = instruction === "stop";
  const terminalize = terminal && instruction === null;
  const continuePolling = instruction !== null && !shouldPostStop && !terminalize;

  return {
    step,
    statuses: buildStatuses(step, showActiveSteps),
    instruction,
    cta: instruction !== null && isCtaInstruction(instruction) ? instruction : null,
    pollIntervalMs: continuePolling || shouldPostStop ? pollIntervalFor(instruction, cadence) : 0,
    continuePolling,
    terminalize,
    shouldPostStop,
    showActiveSteps,
  };
}
