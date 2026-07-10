import type { MatrixRules } from "./contracts";
import type { OverlayRun, OverlayState } from "./urlState";
import { validateMatrixRulesFlows } from "./flowValidation";

/** Result of evaluating a fetched matrix-rules payload at load time. */
export interface MatrixRulesLoadOutcome {
  rules: MatrixRules | null;
  error: string | null;
  /** When true, any active overlay/modal must be closed. */
  closeOverlay: boolean;
}

/**
 * Evaluate fetched matrix-rules before ObservatoryShell commits render state.
 * Invalid contract input yields an error, no rules, and a closed-overlay request.
 */
export function evaluateMatrixRulesLoad(rules: MatrixRules): MatrixRulesLoadOutcome {
  const flowErr = validateMatrixRulesFlows(rules);
  if (flowErr) {
    return { rules: null, error: flowErr, closeOverlay: true };
  }
  return { rules, error: null, closeOverlay: false };
}

/** Observatory matrix UI renders only when rules loaded and validation passed. */
export function canRenderObservatory(
  rules: MatrixRules | null,
  error: string,
): boolean {
  return rules !== null && error === "";
}

/** RunModal renders only when observatory is renderable and overlay is open. */
export function canRenderRunModal(
  rules: MatrixRules | null,
  error: string,
  overlay: OverlayState,
): boolean {
  return canRenderObservatory(rules, error) && overlay.kind === "run";
}

/** Narrowed RunModal inputs when the load contract and overlay state allow rendering. */
export function runModalRenderContext(
  rules: MatrixRules | null,
  error: string,
  overlay: OverlayState,
): { rules: MatrixRules; overlay: OverlayRun } | null {
  if (!canRenderRunModal(rules, error, overlay) || !rules || overlay.kind !== "run") {
    return null;
  }
  return { rules, overlay };
}
