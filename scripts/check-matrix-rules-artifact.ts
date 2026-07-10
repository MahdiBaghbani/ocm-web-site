import { join } from "node:path";

import {
  checkMatrixRulesArtifactAtPath,
  resolveMatrixRulesArtifactPath,
} from "../src/components/observatory/lib/checkMatrixRulesArtifact";

const repoRoot = join(import.meta.dir, "..");
const artifactPath = resolveMatrixRulesArtifactPath(repoRoot);

const err = await checkMatrixRulesArtifactAtPath(artifactPath);
if (err) {
  console.error(`matrix-rules artifact contract check failed: ${err}`);
  process.exit(1);
}

console.log(`matrix-rules artifact OK: ${artifactPath}`);
