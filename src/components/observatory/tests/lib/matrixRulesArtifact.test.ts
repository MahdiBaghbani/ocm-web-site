import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  checkMatrixRulesArtifactAtPath,
  checkMatrixRulesPayload,
  defaultMatrixRulesArtifactPath,
  loadMatrixRulesArtifact,
} from "@/components/observatory/lib/checkMatrixRulesArtifact";
import { evaluateMatrixRulesLoad } from "@/components/observatory/lib/matrixRulesLoad";

const artifactPath = defaultMatrixRulesArtifactPath();
const artifactPresent = await Bun.file(artifactPath).exists();
const skipAbsent =
  "matrix-rules.v1.json not generated in this checkout; run site ingest";

describe("generated matrix-rules.v1.json", () => {
  if (!artifactPresent) {
    test.skip(skipAbsent, () => {});
    return;
  }

  test("loads from public/ and satisfies evaluateMatrixRulesLoad", async () => {
    const rules = await loadMatrixRulesArtifact(artifactPath);
    const outcome = evaluateMatrixRulesLoad(rules);

    expect(outcome.error).toBeNull();
    expect(outcome.rules).toBe(rules);
    expect(outcome.closeOverlay).toBe(false);
    expect(checkMatrixRulesPayload(rules)).toBeNull();
  });
});

describe("checkMatrixRulesArtifactAtPath", () => {
  test("returns validation error for malformed artifact at a temporary path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "matrix-rules-artifact-test-"));
    const artifactPath = join(dir, "matrix-rules.v1.json");
    try {
      await writeFile(
        artifactPath,
        JSON.stringify({
          schema_version: 1,
          flows: "not-an-array",
          matrix: [],
        }),
      );

      const err = await checkMatrixRulesArtifactAtPath(artifactPath);
      expect(err).toBe("flows[]: missing or not an array");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
