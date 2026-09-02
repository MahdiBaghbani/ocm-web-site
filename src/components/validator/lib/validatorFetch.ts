/**
 * Typed ocmgo validator transport. Expected HTTP errors become results.
 * GET 5xx/network uses injected bounded backoff. POST is not retried.
 */

import {
  DEFAULT_VALIDATOR_CONFIG,
  type FetchLike,
} from "./validatorConfig";

export type { FetchLike };

export const VALIDATOR_SERVICE_PREFIX = "/validator";
const DEFAULT_MAX_RETRIES = 4;

export interface StartSessionRequest {
  target: string;
  optInActive?: boolean;
  optInStats?: boolean;
  optInPermanent?: boolean;
}
export interface StartSessionResponse { id: string; optInStats: boolean; optInPermanent: boolean }
export interface SessionPollResponse {
  state: string;
  ts: number;
  optInActive: boolean;
  nextInstruction?: string;
  failModeLabel?: string;
}
export interface StopSessionResponse { id: string; state: string }
export interface ReportResponse {
  schema: string;
  id: string;
  visibility: string;
  reportUrl?: string;
  url?: string;
  score?: unknown;
  evidence?: unknown;
  retentionTier?: string | null;
}

export type ValidatorFailureKind =
  | "session_not_found"
  | "expired"
  | "http"
  | "network"
  | "invalid_response"
  | "aborted"
  | "timeout";

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
type TimerHandle = ReturnType<typeof setTimeout> | number;
type TimerFn = (handler: () => void, ms: number) => TimerHandle;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function errorName(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "name" in error && typeof error.name === "string") {
    return error.name;
  }
  return undefined;
}

function isWaitResult(value: unknown): value is WaitResult {
  return typeof value === "object" && value !== null && "ok" in value && typeof value.ok === "boolean";
}

export function waitForBackoff(
  ms: number,
  options: { signal?: AbortSignal; setTimeoutFn?: TimerFn; clearTimeoutFn?: ValidatorFetchDeps["clearTimeout"] } = {},
): Promise<WaitResult> {
  const setTimer = options.setTimeoutFn ?? setTimeout;
  const clearTimer = options.clearTimeoutFn ?? clearTimeout;
  const signal = options.signal;
  if (signal?.aborted) return Promise.resolve({ ok: false, reason: "aborted" });
  return new Promise((resolve) => {
    let settled = false;
    let handle: TimerHandle | undefined;
    const finish = (result: WaitResult): void => {
      if (settled) return;
      settled = true;
      if (handle !== undefined) clearTimer(handle);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = (): void => finish({ ok: false, reason: "aborted" });
    handle = setTimer(() => finish({ ok: true }), ms);
    if (settled && handle !== undefined) clearTimer(handle);
    if (signal === undefined) return;
    if (signal.aborted) finish({ ok: false, reason: "aborted" });
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

function backoffWait(ms: number, deps: ValidatorFetchDeps): Promise<WaitResult> {
  if (deps.signal?.aborted) return Promise.resolve({ ok: false, reason: "aborted" });
  if (deps.sleep === undefined) {
    return waitForBackoff(ms, {
      signal: deps.signal,
      setTimeoutFn: deps.setTimeout,
      clearTimeoutFn: deps.clearTimeout,
    });
  }
  const sleep = deps.sleep;
  const signal = deps.signal;
  const rejectedWait = (): WaitResult =>
    signal?.aborted ? { ok: false, reason: "aborted" } : { ok: false, reason: "failed" };
  if (signal === undefined) {
    return Promise.resolve(sleep(ms)).then(
      (value) => (isWaitResult(value) ? value : { ok: true }),
      rejectedWait,
    );
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: WaitResult): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = (): void => finish({ ok: false, reason: "aborted" });
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(sleep(ms, signal)).then(
      (value) => finish(signal.aborted ? { ok: false, reason: "aborted" } : isWaitResult(value) ? value : { ok: true }),
      () => finish(rejectedWait()),
    );
  });
}

export function joinValidatorUrl(origin: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const fullPath = `${VALIDATOR_SERVICE_PREFIX}${normalizedPath}`;
  const trimmedOrigin = origin.trim().replace(/\/+$/, "");
  return trimmedOrigin === "" ? fullPath : `${trimmedOrigin}${fullPath}`;
}

export function parseErrorEnvelope(body: unknown): ParsedErrorEnvelope | null {
  if (!isRecord(body)) {
    return null;
  }
  const flatError = readString(body.error);
  const flatMessage = readString(body.message);
  if (flatError !== null && flatMessage !== null) {
    return { error: flatError, message: flatMessage };
  }
  if (!isRecord(body.error)) {
    return null;
  }
  const nestedMessage = readString(body.error.message);
  if (nestedMessage === null) {
    return null;
  }
  const reasonCode = readString(body.error.reasonCode);
  const code = readString(body.error.code);
  return { error: reasonCode ?? code ?? "error", message: nestedMessage, reasonCode: reasonCode ?? undefined };
}

export function parseRetryAfter(header: string | null, nowMs: number): number | undefined {
  const trimmed = header?.trim() ?? "";
  if (trimmed === "") {
    return undefined;
  }
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? undefined : Math.max(0, parsed - nowMs);
}

function backoffDelay(attempt: number, initialMs: number, maxMs: number): number {
  return Math.min(initialMs * 2 ** attempt, maxMs);
}

type AbortCause = "caller" | "timeout" | undefined;

function attachTimeout(
  timeoutMs: number,
  external: AbortSignal | undefined,
  timers: { setTimeout: TimerFn; clearTimeout: NonNullable<ValidatorFetchDeps["clearTimeout"]> },
): { signal: AbortSignal | undefined; cleanup: () => void; cause: () => AbortCause } {
  if (timeoutMs <= 0 && external === undefined) {
    return { signal: undefined, cleanup() {}, cause: () => undefined };
  }
  const controller = new AbortController();
  let cause: AbortCause;
  let timer: TimerHandle | undefined;
  if (timeoutMs > 0) {
    timer = timers.setTimeout(() => {
      cause ??= "timeout";
      controller.abort();
    }, timeoutMs);
  }
  const onAbort = (): void => {
    cause = "caller";
    controller.abort();
  };
  if (external?.aborted) {
    cause = "caller";
    controller.abort();
  } else {
    external?.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cause: () => cause,
    cleanup() {
      if (timer !== undefined) timers.clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

async function readJsonBody(response: Response): Promise<{ ok: true; body: unknown } | { ok: false }> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { ok: false };
  }
  if (text.trim() === "") {
    return { ok: true, body: undefined };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return { ok: true, body: parsed };
  } catch {
    return response.ok ? { ok: false } : { ok: true, body: undefined };
  }
}

function failure(
  kind: ValidatorFailureKind,
  status: number | null,
  error: string,
  message: string,
  retryAfterMs?: number,
): ValidatorFailure {
  const result: ValidatorFailure = { ok: false, kind, status, error, message };
  if (retryAfterMs !== undefined) {
    result.retryAfterMs = retryAfterMs;
  }
  return result;
}

function failureFromWait(waited: WaitResult): ValidatorFailure | undefined {
  if (waited.ok) return undefined;
  return waited.reason === "aborted"
    ? failure("aborted", null, "aborted", "request aborted")
    : failure("network", null, "backoff_failed", "backoff wait failed");
}

async function afterWait(ms: number, deps: ValidatorFetchDeps): Promise<ValidatorFailure | undefined> {
  return failureFromWait(await backoffWait(ms, deps));
}

function classifyHttpFailure(status: number, body: unknown, retryAfterMs?: number): ValidatorFailure {
  const envelope = parseErrorEnvelope(body);
  if (status === 404 && envelope !== null && envelope.error === "SESSION_NOT_FOUND") {
    return failure("session_not_found", status, envelope.error, envelope.message);
  }
  if (status === 410) {
    return failure("expired", status, envelope?.error ?? "gone", envelope?.message ?? "resource expired", retryAfterMs);
  }
  return envelope === null
    ? failure("http", status, "http_error", `HTTP ${status}`, retryAfterMs)
    : failure("http", status, envelope.error, envelope.message, retryAfterMs);
}

function parseStartResponse(body: unknown): StartSessionResponse | null {
  if (!isRecord(body) || typeof body.optInStats !== "boolean" || typeof body.optInPermanent !== "boolean") {
    return null;
  }
  const id = readString(body.id);
  return id === null || id.trim() === ""
    ? null
    : { id, optInStats: body.optInStats, optInPermanent: body.optInPermanent };
}

function parsePollResponse(body: unknown): SessionPollResponse | null {
  if (!isRecord(body) || typeof body.ts !== "number" || !Number.isFinite(body.ts) || typeof body.optInActive !== "boolean") {
    return null;
  }
  const state = readString(body.state);
  if (state === null) return null;
  const parsed: SessionPollResponse = { state, ts: body.ts, optInActive: body.optInActive };
  const nextInstruction = readString(body.nextInstruction);
  if (nextInstruction) parsed.nextInstruction = nextInstruction;
  const failModeLabel = readString(body.failModeLabel);
  if (failModeLabel) parsed.failModeLabel = failModeLabel;
  return parsed;
}

function parseStopResponse(body: unknown): StopSessionResponse | null {
  if (!isRecord(body)) {
    return null;
  }
  const id = readString(body.id);
  const state = readString(body.state);
  return id === null || id.trim() === "" || state === null || state === "" ? null : { id, state };
}

function parseReportResponse(body: unknown): ReportResponse | null {
  if (!isRecord(body)) {
    return null;
  }
  const schema = readString(body.schema);
  const id = readString(body.id);
  const visibility = readString(body.visibility);
  if (schema === null || id === null || visibility === null) {
    return null;
  }
  const parsed: ReportResponse = { schema, id, visibility };
  const reportUrl = readString(body.reportUrl);
  if (reportUrl !== null) parsed.reportUrl = reportUrl;
  const url = readString(body.url);
  if (url !== null) parsed.url = url;
  if ("score" in body) parsed.score = body.score;
  if ("evidence" in body) parsed.evidence = body.evidence;
  if ("retentionTier" in body && (typeof body.retentionTier === "string" || body.retentionTier === null)) {
    parsed.retentionTier = body.retentionTier;
  }
  return parsed;
}

function startBody(input: StartSessionRequest): Record<string, string | boolean> {
  const body: Record<string, string | boolean> = { target: input.target };
  if (typeof input.optInActive === "boolean") body.optInActive = input.optInActive;
  if (typeof input.optInStats === "boolean") body.optInStats = input.optInStats;
  if (typeof input.optInPermanent === "boolean") body.optInPermanent = input.optInPermanent;
  return body;
}

async function validatorRequest<T>(
  spec: { method: "GET" | "POST"; path: string; body?: unknown; parse: (body: unknown) => T | null; retry: boolean },
  deps: ValidatorFetchDeps = {},
): Promise<ValidatorResult<T>> {
  const fetchLike = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_VALIDATOR_CONFIG.requestTimeoutMs;
  const initialMs = deps.backoffInitialMs ?? DEFAULT_VALIDATOR_CONFIG.backoffInitialMs;
  const maxMs = deps.backoffMaxMs ?? DEFAULT_VALIDATOR_CONFIG.backoffMaxMs;
  const maxRetries = spec.retry ? Math.max(0, deps.maxRetries ?? DEFAULT_MAX_RETRIES) : 0;
  const timers = { setTimeout: deps.setTimeout ?? setTimeout, clearTimeout: deps.clearTimeout ?? clearTimeout };
  const url = joinValidatorUrl(deps.origin ?? "", spec.path);
  const headers: HeadersInit = spec.method === "POST"
    ? { Accept: "application/json", "Content-Type": "application/json" }
    : { Accept: "application/json" };

  let attempt = 0;
  while (true) {
    if (deps.signal?.aborted) {
      return failure("aborted", null, "aborted", "request aborted");
    }
    const attached = attachTimeout(timeoutMs, deps.signal, timers);
    let response: Response;
    try {
      response = await fetchLike(url, {
        method: spec.method,
        cache: "no-store",
        signal: attached.signal,
        headers,
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
      });
    } catch (error) {
      attached.cleanup();
      const timedOut = attached.cause() === "timeout";
      const callerAborted = deps.signal?.aborted === true || attached.cause() === "caller";
      if (callerAborted || (errorName(error) === "AbortError" && !timedOut)) {
        return failure("aborted", null, "aborted", "request aborted");
      }
      if (attempt >= maxRetries) {
        return timedOut
          ? failure("timeout", null, "timeout", "request timeout")
          : failure("network", null, "network", "network request failed");
      }
      const waitFail = await afterWait(backoffDelay(attempt, initialMs, maxMs), deps);
      if (waitFail) return waitFail;
      attempt += 1;
      continue;
    }
    const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"), now());
    const read = await readJsonBody(response);
    const callerAborted = deps.signal?.aborted === true || attached.cause() === "caller";
    const timedOutAfterRead = attached.cause() === "timeout";
    attached.cleanup();
    if (callerAborted) return failure("aborted", null, "aborted", "request aborted");
    if (!read.ok) {
      const canRetry5xx = spec.retry && response.status >= 500 && attempt < maxRetries;
      if (timedOutAfterRead || canRetry5xx) {
        if (timedOutAfterRead && attempt >= maxRetries) {
          return failure("timeout", null, "timeout", "request timeout");
        }
        const waitMs = !timedOutAfterRead && retryAfterMs !== undefined
          ? Math.min(retryAfterMs, maxMs)
          : backoffDelay(attempt, initialMs, maxMs);
        const waitFail = await afterWait(waitMs, deps);
        if (waitFail) return waitFail;
        attempt += 1;
        continue;
      }
      if (response.status === 404 || response.status === 410) {
        return failure("expired", response.status, "gone", "resource expired", retryAfterMs);
      }
      return spec.retry && response.status >= 500
        ? failure("http", response.status, "unreadable_body", "failed to read response body", retryAfterMs)
        : failure("invalid_response", response.status, "invalid_response", "failed to read response body");
    }
    if (response.ok) {
      const data = spec.parse(read.body);
      return data === null
        ? failure("invalid_response", response.status, "invalid_response", "unexpected response body")
        : { ok: true, status: response.status, data };
    }
    if (spec.retry && response.status >= 500 && attempt < maxRetries) {
      const waitMs = retryAfterMs === undefined
        ? backoffDelay(attempt, initialMs, maxMs)
        : Math.min(retryAfterMs, maxMs);
      const waitFail = await afterWait(waitMs, deps);
      if (waitFail) return waitFail;
      attempt += 1;
      continue;
    }
    return classifyHttpFailure(response.status, read.body, retryAfterMs);
  }
}

export function startSession(
  input: StartSessionRequest,
  deps?: ValidatorFetchDeps,
): Promise<ValidatorResult<StartSessionResponse>> {
  return validatorRequest({
    method: "POST",
    path: "/start",
    body: startBody(input),
    parse: parseStartResponse,
    retry: false,
  }, deps);
}

export function pollSession(id: string, deps?: ValidatorFetchDeps): Promise<ValidatorResult<SessionPollResponse>> {
  return validatorRequest({
    method: "GET",
    path: `/api/session/${encodeURIComponent(id)}`,
    parse: parsePollResponse,
    retry: true,
  }, deps);
}

export function stopSession(id: string, deps?: ValidatorFetchDeps): Promise<ValidatorResult<StopSessionResponse>> {
  return validatorRequest({ method: "POST", path: "/stop", body: { id }, parse: parseStopResponse, retry: false }, deps);
}

export function fetchReport(id: string, deps?: ValidatorFetchDeps): Promise<ValidatorResult<ReportResponse>> {
  return validatorRequest({
    method: "GET",
    path: `/api/report/${encodeURIComponent(id)}`,
    parse: parseReportResponse,
    retry: true,
  }, deps);
}
