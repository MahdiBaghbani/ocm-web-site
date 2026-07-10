import type { FlowMetadata, MatrixRules } from "./contracts";
import { isSupportedGlyphId } from "./glyphRegistry";

/** Flow metadata fields required before MatrixGrid may render glyphs. */
export interface FlowGlyphMetadata {
  label?: string;
  glyph_id?: string;
}

/**
 * Returns a user-visible error when flow metadata cannot be rendered, or null
 * when label and glyph_id satisfy the strict published contract.
 */
export function getFlowMetadataValidationError(
  flowId: string,
  meta: FlowGlyphMetadata | undefined,
): string | null {
  if (!meta) {
    return `flow "${flowId}": missing metadata in matrix-rules flows[]`;
  }
  if (!meta.label?.trim()) {
    return `flow "${flowId}": missing or empty label`;
  }
  const glyphId = meta.glyph_id;
  if (typeof glyphId !== "string" || !glyphId) {
    return `flow "${flowId}": missing or empty glyph_id`;
  }
  if (glyphIdHasSurroundingWhitespace(glyphId)) {
    return flowMetadataGlyphIdWhitespaceError(flowId, glyphId);
  }
  if (!isSupportedGlyphId(glyphId)) {
    return `flow "${flowId}": unsupported glyph_id "${glyphId}"`;
  }
  return null;
}

function matrixEntryFlowIdError(index: number, cellId?: string): string {
  const cellHint = cellId ? ` (cell_id "${cellId}")` : "";
  return `matrix[${index}]: missing or empty flow_id${cellHint}`;
}

function matrixEntryFlowIdWhitespaceError(index: number, flowId: string, cellId?: string): string {
  const cellHint = cellId ? ` (cell_id "${cellId}")` : "";
  return `matrix[${index}]: flow_id "${flowId}" must not have leading or trailing whitespace${cellHint}`;
}

function flowMetadataFlowIdWhitespaceError(flowId: string): string {
  return `flows[]: flow_id "${flowId}" must not have leading or trailing whitespace`;
}

function flowMetadataGlyphIdWhitespaceError(flowId: string, glyphId: string): string {
  return `flow "${flowId}": glyph_id "${glyphId}" must not have leading or trailing whitespace`;
}

/** Contract identity fields; reject padding instead of trimming at use sites. */
function glyphIdHasSurroundingWhitespace(glyphId: string): boolean {
  return glyphId !== glyphId.trim();
}

function flowIdHasSurroundingWhitespace(flowId: string): boolean {
  return flowId !== flowId.trim();
}

function flowsNotArrayError(): string {
  return `flows[]: missing or not an array`;
}

function matrixNotArrayError(): string {
  return `matrix[]: missing or not an array`;
}

function duplicateFlowIdError(flowId: string): string {
  return `flows[]: duplicate flow_id "${flowId}"`;
}

/**
 * Validate every matrix scenario and referenced flow metadata at load time.
 * Invalid input returns a user-visible error string; null means render-safe.
 */
export function validateMatrixRulesFlows(rules: MatrixRules): string | null {
  if (!Array.isArray(rules.flows)) {
    return flowsNotArrayError();
  }
  if (!Array.isArray(rules.matrix)) {
    return matrixNotArrayError();
  }

  const flowMetaById = new Map<string, FlowMetadata>();
  for (const f of rules.flows) {
    const metaFlowId = f?.flow_id;
    if (typeof metaFlowId !== "string" || !metaFlowId) {
      return `flows[]: missing or empty flow_id`;
    }
    if (flowIdHasSurroundingWhitespace(metaFlowId)) {
      return flowMetadataFlowIdWhitespaceError(metaFlowId);
    }
    if (flowMetaById.has(metaFlowId)) {
      return duplicateFlowIdError(metaFlowId);
    }
    flowMetaById.set(metaFlowId, f);
  }

  for (let i = 0; i < rules.matrix.length; i++) {
    const scenario = rules.matrix[i];
    const flowId = scenario?.flow_id;
    if (typeof flowId !== "string" || !flowId) {
      return matrixEntryFlowIdError(i, scenario?.cell_id);
    }
    if (flowIdHasSurroundingWhitespace(flowId)) {
      return matrixEntryFlowIdWhitespaceError(i, flowId, scenario?.cell_id);
    }

    const err = getFlowMetadataValidationError(flowId, flowMetaById.get(flowId));
    if (err) return err;
  }

  return null;
}
