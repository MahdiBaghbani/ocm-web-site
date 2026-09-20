/**
 * paste_s1 claim CTA for the RESULTS island. Reads session-identity refs after
 * await; the orchestrator still performs the render-phase writes.
 */
import React, { useRef, useState } from "react";
import type { ValidatorRuntimeConfig } from "../../lib/validatorConfig";
import {
  claimInvite,
  type ValidatorFetchDeps,
} from "../../lib/validatorFetch";
import { isSameSessionId, isStaleSessionId } from "../../lib/results/sessionIdentity";
import { actionErrorCopy } from "../../lib/validatorGuidance";
import type { ValidatorUrlState } from "../../lib/urlState";
import { copyText } from "./useClipboardActions";

export const CLAIM_COPY_FAILURE_TEXT =
  "Could not copy the invitation. Select and copy it from the field below.";

const INVITE_STORAGE_PREFIX = "validator:invite:";

function inviteStorageKey(sessionId: string): string {
  return `${INVITE_STORAGE_PREFIX}${sessionId}`;
}

function requestDeps(config: ValidatorRuntimeConfig): ValidatorFetchDeps {
  return {
    origin: config.validatorApiOrigin,
    timeoutMs: config.requestTimeoutMs,
    backoffInitialMs: config.backoffInitialMs,
    backoffMaxMs: config.backoffMaxMs,
  };
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

export function useClaimAction({
  session,
  config,
  currentSessionIdRef,
  guidanceKeyRef,
  settleCopyOutcome,
  setPostError,
}: {
  session: ValidatorUrlState | null;
  config: ValidatorRuntimeConfig | null;
  currentSessionIdRef: React.MutableRefObject<string | null>;
  guidanceKeyRef: React.MutableRefObject<string | null>;
  settleCopyOutcome: (ok: boolean, value: string, failureText: string) => void;
  setPostError: React.Dispatch<React.SetStateAction<string | null>>;
}): {
  cachedInvite: string | null;
  claimBusy: boolean;
  claimLocked: boolean;
  handleClaimInvite: () => Promise<void>;
  reset: () => void;
} {
  const [cachedInvite, setCachedInvite] = useState<string | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  // Terminal lock. An uncached 410 means the invitation is already claimed and
  // unrecoverable in this browser, so the CTA must stay disabled after the
  // in-flight claimBusy clears. It persists until a session/navigation reset.
  const [claimLocked, setClaimLocked] = useState(false);
  // Holds the session id of the in-flight claim, or null when idle. Using the
  // id (not a bool) lets an old claim's finally avoid clearing a newer
  // session's lock after a navigation reset cleared the shared ref.
  const claimLockRef = useRef<string | null>(null);

  function reset(): void {
    setCachedInvite(null);
    setClaimBusy(false);
    setClaimLocked(false);
    claimLockRef.current = null;
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

  return {
    cachedInvite,
    claimBusy,
    claimLocked,
    handleClaimInvite,
    reset,
  };
}
