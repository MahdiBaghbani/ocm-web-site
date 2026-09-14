/**
 * Pure session-identity predicates for the results page.
 * Inputs to outputs only: no React, refs, or session state.
 */

/**
 * True when both sides name the same session. Comparison is raw identity:
 * null never matches a real id, and ids are not normalized.
 */
export function isSameSessionId(
  left: string | null,
  right: string | null,
): boolean {
  return left === right;
}

/**
 * True when work started in one session would now land on another. An unset
 * live id is stale relative to a started id. Dual of isSameSessionId.
 */
export function isStaleSessionId(
  startedSessionId: string | null,
  currentSessionId: string | null,
): boolean {
  return !isSameSessionId(startedSessionId, currentSessionId);
}
