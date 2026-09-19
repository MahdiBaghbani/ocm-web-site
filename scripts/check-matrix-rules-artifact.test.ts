import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { runMatrixRulesArtifactCheck } from "./check-matrix-rules-artifact";

describe("runMatrixRulesArtifactCheck", () => {
  test("skips when observatory is not mounted", async () => {
    const result = await runMatrixRulesArtifactCheck(
      "/tmp/does-not-matter/matrix-rules.v1.json",
      false,
    );

    expect(result).toEqual({
      exitCode: 0,
      stream: "log",
      message: "Skipping matrix-rules artifact check: observatory is not mounted.",
    });
  });

  test("skips when observatory is mounted and the artifact is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "matrix-rules-check-"));
    try {
      const artifactPath = join(dir, "matrix-rules.v1.json");
      const result = await runMatrixRulesArtifactCheck(artifactPath, true);

      expect(result).toEqual({
        exitCode: 0,
        stream: "log",
        message: "Skipping matrix-rules artifact check: artifacts are absent.",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("fails when an existing artifact is malformed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "matrix-rules-check-"));
    try {
      const artifactPath = join(dir, "matrix-rules.v1.json");
      await writeFile(
        artifactPath,
        JSON.stringify({
          schema_version: 1,
          flows: "not-an-array",
          matrix: [],
        }),
      );

      const result = await runMatrixRulesArtifactCheck(artifactPath, true);

      expect(result.exitCode).toBe(1);
      expect(result.stream).toBe("error");
      expect(result.message).toBe(
        "matrix-rules artifact contract check failed: flows[]: missing or not an array",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
