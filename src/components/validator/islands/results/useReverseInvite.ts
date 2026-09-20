/**
 * paste_s2 reverse-invite submit for the RESULTS island. Reads session-identity
 * refs after await; the textarea stays controlled from ResultsShell.
 */
import React, { useRef, useState } from "react";
import type { ValidatorRuntimeConfig } from "../../lib/validatorConfig";
import {
  postReverseInvite,
  type ValidatorFailure,
  type ValidatorFetchDeps,
} from "../../lib/validatorFetch";
import { isSameSessionId, isStaleSessionId } from "../../lib/results/sessionIdentity";
import { actionErrorCopy } from "../../lib/validatorGuidance";
import type { ValidatorUrlState } from "../../lib/urlState";
import { MAX_REVERSE_INVITE_LENGTH, REVERSE_INVITE_TOO_LONG_TEXT } from "./ProgressSection";

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

function requestDeps(config: ValidatorRuntimeConfig): ValidatorFetchDeps {
  return {
    origin: config.validatorApiOrigin,
    timeoutMs: config.requestTimeoutMs,
    backoffInitialMs: config.backoffInitialMs,
    backoffMaxMs: config.backoffMaxMs,
  };
}

export function useReverseInvite({
  session,
  config,
  currentSessionIdRef,
  guidanceKeyRef,
  setPostError,
}: {
  session: ValidatorUrlState | null;
  config: ValidatorRuntimeConfig | null;
  currentSessionIdRef: React.MutableRefObject<string | null>;
  guidanceKeyRef: React.MutableRefObject<string | null>;
  setPostError: React.Dispatch<React.SetStateAction<string | null>>;
}): {
  reverseValue: string;
  reverseBusy: boolean;
  setReverseValue: React.Dispatch<React.SetStateAction<string>>;
  handleReverseInvite: () => Promise<void>;
  reset: () => void;
} {
  const [reverseValue, setReverseValue] = useState("");
  const [reverseBusy, setReverseBusy] = useState(false);
  // Holds the session id of the in-flight reverse POST, or null when idle.
  // Reverse POST is not cached, so unlike claimLockRef this only guards
  // against a double submit while one request is outstanding.
  const reverseLockRef = useRef<string | null>(null);

  function reset(): void {
    setReverseValue("");
    setReverseBusy(false);
    reverseLockRef.current = null;
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

  return {
    reverseValue,
    reverseBusy,
    setReverseValue,
    handleReverseInvite,
    reset,
  };
}
