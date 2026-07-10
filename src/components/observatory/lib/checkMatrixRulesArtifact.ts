import { join } from "node:path";

import type { MatrixRules } from "./contracts";
import { evaluateMatrixRulesLoad } from "./matrixRulesLoad";

/** Relative path from repo root to the published matrix-rules artifact. */
export const MATRIX_RULES_ARTIFACT_REL_PATH = "public/matrix-rules.v1.json";

export function resolveMatrixRulesArtifactPath(repoRoot: string): string {
  return join(repoRoot, MATRIX_RULES_ARTIFACT_REL_PATH);
}

/** Repo root inferred from this module location (src/components/observatory/lib). */
export function defaultMatrixRulesArtifactPath(): string {
  const repoRoot = join(import.meta.dir, "..", "..", "..", "..");
  return resolveMatrixRulesArtifactPath(repoRoot);
}

export function checkMatrixRulesPayload(rules: MatrixRules): string | null {
  return evaluateMatrixRulesLoad(rules).error;
}

export async function loadMatrixRulesArtifact(
  artifactPath: string,
): Promise<MatrixRules> {
  const file = Bun.file(artifactPath);
  if (!(await file.exists())) {
    throw new Error(`matrix-rules artifact not found: ${artifactPath}`);
  }
  return (await file.json()) as MatrixRules;
}

/** Returns a user-visible error string, or null when the artifact satisfies the contract. */
export async function checkMatrixRulesArtifactAtPath(
  artifactPath: string,
): Promise<string | null> {
  try {
    const rules = await loadMatrixRulesArtifact(artifactPath);
    return checkMatrixRulesPayload(rules);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
