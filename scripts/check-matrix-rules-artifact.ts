import { access } from "node:fs/promises";
import { join } from "node:path";

import {
  checkMatrixRulesArtifactAtPath,
  resolveMatrixRulesArtifactPath,
} from "../src/components/observatory/lib/checkMatrixRulesArtifact";
import { isEnoent } from "../src/components/observatory/lib/observatoryStaticPaths";
import { isPageMounted } from "../src/lib/sitePages";

export type MatrixRulesArtifactCheckResult = {
  exitCode: 0 | 1;
  stream: "log" | "error";
  message: string;
};

export async function runMatrixRulesArtifactCheck(
  artifactPath: string,
  observatoryMounted: boolean,
): Promise<MatrixRulesArtifactCheckResult> {
  if (!observatoryMounted) {
    return {
      exitCode: 0,
      stream: "log",
      message:
        "Skipping matrix-rules artifact check: observatory is not mounted.",
    };
  }

  try {
    await access(artifactPath);
  } catch (error) {
    if (isEnoent(error)) {
      return {
        exitCode: 0,
        stream: "log",
        message: "Skipping matrix-rules artifact check: artifacts are absent.",
      };
    }
    throw error;
  }

  const err = await checkMatrixRulesArtifactAtPath(artifactPath);
  if (err) {
    return {
      exitCode: 1,
      stream: "error",
      message: `matrix-rules artifact contract check failed: ${err}`,
    };
  }

  return {
    exitCode: 0,
    stream: "log",
    message: `matrix-rules artifact OK: ${artifactPath}`,
  };
}

if (import.meta.main) {
  const repoRoot = join(import.meta.dir, "..");
  const artifactPath = resolveMatrixRulesArtifactPath(repoRoot);
  const result = await runMatrixRulesArtifactCheck(
    artifactPath,
    isPageMounted("observatory"),
  );
  if (result.stream === "error") {
    console.error(result.message);
  } else {
    console.log(result.message);
  }
  process.exit(result.exitCode);
}
