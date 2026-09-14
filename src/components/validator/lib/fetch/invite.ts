/**
 * Invite endpoints: claim invite (POST) and reverse invite paste (POST).
 */

import { isRecord } from "../validatorShared";
import { readString, validatorRequest } from "./transport";
import type {
  ClaimInviteResponse,
  ReverseInviteResponse,
  ValidatorFetchDeps,
  ValidatorResult,
} from "./types";

function parseClaimInviteResponse(body: unknown): ClaimInviteResponse | null {
  if (!isRecord(body)) {
    return null;
  }
  const inviteString = readString(body.inviteString);
  const issuerFqdn = readString(body.issuerFqdn);
  const pasteTargetOrigin = readString(body.pasteTargetOrigin);
  const pasteTargetHost = readString(body.pasteTargetHost);
  const expiresAt = readString(body.expiresAt);
  if (
    inviteString === null || inviteString.trim() === ""
    || issuerFqdn === null || issuerFqdn.trim() === ""
    || pasteTargetOrigin === null || pasteTargetOrigin.trim() === ""
    || pasteTargetHost === null || pasteTargetHost.trim() === ""
    || expiresAt === null || expiresAt.trim() === ""
    || Number.isNaN(Date.parse(expiresAt))
  ) {
    return null;
  }
  return { inviteString, issuerFqdn, pasteTargetOrigin, pasteTargetHost, expiresAt };
}

function parseReverseInviteResponse(body: unknown): ReverseInviteResponse | null {
  if (!isRecord(body)) {
    return null;
  }
  const status = readString(body.status);
  return status === null || status.trim() === "" ? null : { status };
}

export function claimInvite(id: string, deps?: ValidatorFetchDeps): Promise<ValidatorResult<ClaimInviteResponse>> {
  return validatorRequest({
    method: "POST",
    path: `/api/session/${encodeURIComponent(id)}/invite`,
    parse: parseClaimInviteResponse,
    retry: false,
  }, deps);
}

export function postReverseInvite(
  id: string,
  inviteString: string,
  deps?: ValidatorFetchDeps,
): Promise<ValidatorResult<ReverseInviteResponse>> {
  return validatorRequest({
    method: "POST",
    path: `/api/session/${encodeURIComponent(id)}/reverse-invite`,
    body: { inviteString },
    parse: parseReverseInviteResponse,
    retry: false,
  }, deps);
}
