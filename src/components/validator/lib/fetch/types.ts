/**
 * Fetch-specific types for the ocmgo validator transport. Values and shapes
 * only; no atoms/islands imports.
 */

import type { FetchLike } from "../validatorConfig";

export type { FetchLike };

export const VALIDATOR_SERVICE_PREFIX = "/validator";

export interface StartSessionRequest { target: string; optInActive?: boolean; optInStats?: boolean; optInPermanent?: boolean }
export interface StartSessionResponse { id: string; optInStats: boolean; optInPermanent: boolean }
export interface SessionPollResponse { state: string; ts: number; optInActive: boolean; nextInstruction?: string; failModeLabel?: string }
export interface StopSessionResponse { id: string; state: string }
export interface ClaimInviteResponse {
  inviteString: string;
  issuerFqdn: string;
  pasteTargetOrigin: string;
  pasteTargetHost: string;
  expiresAt: string;
}
export interface ReverseInviteResponse { status: string }

export const REPORT_VISIBILITY = [
  "session",
  "permanent",
  "not_saved",
  "expired",
  "unknown",
] as const;

export type ReportVisibility = (typeof REPORT_VISIBILITY)[number];

export const REPORT_NOT_PUBLIC_ERROR = "report_not_public";

export interface ReportResponse {
  schema: string;
  id: string;
  visibility: ReportVisibility;
  reportUrl?: string;
  url?: string;
  score?: unknown;
  evidence?: unknown;
  retentionTier?: string | null;
}

export type ValidatorFailureKind =
  | "session_not_found" | "expired" | "http" | "network" | "invalid_response" | "aborted" | "timeout";

export interface ValidatorFailure {
  ok: false;
  kind: ValidatorFailureKind;
  status: number | null;
  error: string;
  message: string;
  retryAfterMs?: number;
}

export interface ValidatorSuccess<T> { ok: true; status: number; data: T }

export type ValidatorResult<T> = ValidatorSuccess<T> | ValidatorFailure;
export type WaitResult = { ok: true } | { ok: false; reason: "aborted" | "failed" };
export type TimerHandle = ReturnType<typeof setTimeout> | number;
export type TimerFn = (handler: () => void, ms: number) => TimerHandle;
type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void | WaitResult>;

export interface ValidatorFetchDeps {
  fetch?: FetchLike;
  sleep?: SleepFn;
  now?: () => number;
  setTimeout?: TimerFn;
  clearTimeout?: (handle: TimerHandle) => void;
  origin?: string;
  timeoutMs?: number;
  backoffInitialMs?: number;
  backoffMaxMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

export interface ParsedErrorEnvelope { error: string; message: string; reasonCode?: string }
