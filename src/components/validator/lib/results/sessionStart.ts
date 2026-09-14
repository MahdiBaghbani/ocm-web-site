/**
 * Pure session-start display projection for the results page.
 * Inputs to outputs only: no React, refs, or session state.
 */

import {
  normalizeHost,
  normalizeSessionId,
  parseValidatorUrlState,
  type ValidatorUrlState,
} from "../urlState";

export const SESSION_START_LOADING_TEXT = "Loading session...";

const INCOMPLETE_LINK_TEXT = "This result link is incomplete.";
const INVALID_SESSION_ID_TEXT = "This result link has an invalid session ID.";

export type SessionStartProjection =
  | { kind: "loading"; text: string }
  | { kind: "failure"; message: string }
  | { kind: "identity"; host: string; id: string };

export function sessionFromProps(host?: string, id?: string): ValidatorUrlState | null {
  if (host === undefined || id === undefined) {
    return null;
  }
  const normalizedHost = normalizeHost(host);
  const normalizedId = normalizeSessionId(id);
  if (normalizedHost === null || normalizedId === null) {
    return null;
  }
  return { host: normalizedHost, id: normalizedId };
}

export function sessionFromLocation(
  host?: string,
  id?: string,
  href?: string | null,
): ValidatorUrlState | null {
  const fromProps = sessionFromProps(host, id);
  if (fromProps !== null) {
    return fromProps;
  }
  if (href === undefined || href === null) {
    return null;
  }
  const parsed = parseValidatorUrlState(href);
  return parsed.ok ? parsed.state : null;
}

export function sessionLinkErrorMessage(href?: string | null): string {
  if (href === undefined || href === null) {
    return INCOMPLETE_LINK_TEXT;
  }
  const parsed = parseValidatorUrlState(href);
  if (parsed.ok) {
    return INCOMPLETE_LINK_TEXT;
  }
  if (
    parsed.reason === "invalid_host" ||
    parsed.reason === "invalid_id" ||
    parsed.reason === "invalid_url"
  ) {
    return INVALID_SESSION_ID_TEXT;
  }
  return INCOMPLETE_LINK_TEXT;
}

/**
 * Null session before mount is loading. Null session after mount is a
 * failure. A resolved session is identity regardless of mounted or href.
 */
export function projectSessionStart(
  session: ValidatorUrlState | null,
  mounted: boolean,
  href?: string | null,
): SessionStartProjection {
  if (session !== null) {
    return { kind: "identity", host: session.host, id: session.id };
  }
  if (!mounted) {
    return { kind: "loading", text: SESSION_START_LOADING_TEXT };
  }
  return { kind: "failure", message: sessionLinkErrorMessage(href) };
}
