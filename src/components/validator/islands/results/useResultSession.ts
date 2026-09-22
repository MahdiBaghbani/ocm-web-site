/**
 * Session lifecycle for the RESULTS island: location resolution, session-change
 * reset, and the session-identity refs. Render-phase ref writes stay in
 * ResultsShell via syncSessionIdentity.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  sessionFromLocation,
  sessionFromProps,
} from "../../lib/results/sessionStart";
import type { ValidatorUrlState } from "../../lib/urlState";

export type SessionIdentityRefs = {
  currentSessionIdRef: React.MutableRefObject<string | null>;
  guidanceKeyRef: React.MutableRefObject<string | null>;
  prevGuidanceKeyRef: React.MutableRefObject<string | null>;
};

/**
 * Guard 15 session-identity API. Call synchronously from the ResultsShell
 * render body after hooks. Never from a useEffect or a child.
 */
export function syncSessionIdentity(
  identity: SessionIdentityRefs,
  sessionId: string | null,
  guidanceKey: string | null,
  setPostError: React.Dispatch<React.SetStateAction<string | null>>,
): void {
  identity.currentSessionIdRef.current = sessionId;
  identity.guidanceKeyRef.current = guidanceKey;
  if (identity.prevGuidanceKeyRef.current !== guidanceKey) {
    identity.prevGuidanceKeyRef.current = guidanceKey;
    setPostError(null);
  }
}

export function useResultSession({
  host,
  id,
  sessionChangeResetRef,
}: {
  host?: string;
  id?: string;
  sessionChangeResetRef: React.MutableRefObject<() => void>;
}): {
  session: ValidatorUrlState | null;
  mounted: boolean;
  currentSessionIdRef: React.MutableRefObject<string | null>;
  guidanceKeyRef: React.MutableRefObject<string | null>;
  prevGuidanceKeyRef: React.MutableRefObject<string | null>;
} {
  const [session, setSession] = useState<ValidatorUrlState | null>(() =>
    sessionFromProps(host, id),
  );
  const [mounted, setMounted] = useState(false);
  const currentSessionIdRef = useRef<string | null>(null);
  const guidanceKeyRef = useRef<string | null>(null);
  const prevGuidanceKeyRef = useRef<string | null>(null);

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
    sessionChangeResetRef.current();
  }, [session?.host, session?.id]);

  return {
    session,
    mounted,
    currentSessionIdRef,
    guidanceKeyRef,
    prevGuidanceKeyRef,
  };
}
