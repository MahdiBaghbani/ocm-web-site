/**
 * Session lifecycle endpoints: start (POST), poll (GET), stop (POST).
 */

import { isRecord } from "../validatorShared";
import { readString, validatorRequest } from "./transport";
import type {
  SessionPollResponse,
  StartSessionRequest,
  StartSessionResponse,
  StopSessionResponse,
  ValidatorFetchDeps,
  ValidatorResult,
} from "./types";

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

function startBody(input: StartSessionRequest): Record<string, string | boolean> {
  const body: Record<string, string | boolean> = { target: input.target };
  if (typeof input.optInActive === "boolean") body.optInActive = input.optInActive;
  if (typeof input.optInStats === "boolean") body.optInStats = input.optInStats;
  if (typeof input.optInPermanent === "boolean") body.optInPermanent = input.optInPermanent;
  return body;
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
