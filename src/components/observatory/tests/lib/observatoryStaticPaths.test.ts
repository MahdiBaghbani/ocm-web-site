import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import type {
  RunEntry,
  SuiteManifest,
} from "@/components/observatory/lib/contracts";
import {
  SUITE_MANIFEST_FILENAME,
  buildObservatoryStaticPaths,
  isEnoent,
  loadObservatoryStaticPaths,
} from "@/components/observatory/lib/observatoryStaticPaths";
import {
  makeRules,
  makeScenario,
} from "@/components/observatory/tests/lib/helpers/observatoryFactories";

function makeRun(id: string, overrides: Partial<RunEntry> = {}): RunEntry {
  return {
    id,
    cell_id: "login__nextcloud__chrome",
    execution_id: "exec-1",
    artifact_name: "login",
    matrix_key: "login__nextcloud",
    attempt_number: 1,
    retry_of_run_id: null,
    superseded_by_run_id: null,
    lifecycle_status: "terminal",
    started_at: "2026-01-01T00:00:00Z",
    finished_at: "2026-01-01T00:01:00Z",
    stack_id: "stack-1",
    execution_context: {
      kind: "test",
      is_ci: false,
      is_act: false,
      github: {},
    },
    ...overrides,
  };
}

function makeManifest(runs: SuiteManifest["runs"] = {}): SuiteManifest {
  return {
    schema_version: 1,
    generated_at: "2026-01-01T00:00:00Z",
    generator: "test",
    producer: { name: "test", version: "0" },
    sources: [],
    execution_context: {},
    flows: {},
    cells: {},
    runs,
    results: {},
    indexes: { latest_terminal_result_by_cell: {} },
  };
}

describe("SUITE_MANIFEST_FILENAME", () => {
  test("names the published suite-manifest artifact", () => {
    expect(SUITE_MANIFEST_FILENAME).toBe("suite-manifest.v1.json");
  });
});

describe("isEnoent", () => {
  test("detects Node-style ENOENT errors", () => {
    expect(isEnoent({ code: "ENOENT" })).toBe(true);
    expect(isEnoent(Object.assign(new Error("missing"), { code: "ENOENT" }))).toBe(
      true,
    );
  });

  test("rejects other values", () => {
    expect(isEnoent(null)).toBe(false);
    expect(isEnoent(undefined)).toBe(false);
    expect(isEnoent(new Error("fail"))).toBe(false);
    expect(isEnoent({ code: "EACCES" })).toBe(false);
  });
});

describe("buildObservatoryStaticPaths", () => {
  test("index first, then unique cell ids in source order, then run ids in Object.keys order", () => {
    const rules = makeRules([
      makeScenario({ cell_id: "cell-b" }),
      makeScenario({ cell_id: "cell-a" }),
      makeScenario({ cell_id: "cell-b" }),
      makeScenario({ cell_id: "" }),
      makeScenario({ cell_id: "cell-c" }),
    ]);
    const manifest = makeManifest({
      "run-z": makeRun("run-z"),
      "run-a": makeRun("run-a"),
    });

    const paths = buildObservatoryStaticPaths(rules, manifest);

    expect(paths).toEqual([
      { params: { slug: undefined }, props: { view: "index" } },
      { params: { slug: "cells/cell-b" }, props: { view: "cell", cellId: "cell-b" } },
      { params: { slug: "cells/cell-a" }, props: { view: "cell", cellId: "cell-a" } },
      { params: { slug: "cells/cell-c" }, props: { view: "cell", cellId: "cell-c" } },
      { params: { slug: "runs/run-z" }, props: { view: "run", runId: "run-z" } },
      { params: { slug: "runs/run-a" }, props: { view: "run", runId: "run-a" } },
    ]);
  });

  test("uses every actual cell and run id and omits literal placeholder segments", () => {
    const cellIds = ["login__nextcloud__chrome", "invite-link__owncloud__firefox"];
    const runIds = ["run-2026-01-01", "run-2026-01-02"];
    const rules = makeRules(cellIds.map((cell_id) => makeScenario({ cell_id })));
    const manifest = makeManifest(
      Object.fromEntries(runIds.map((id) => [id, makeRun(id)])),
    );

    const paths = buildObservatoryStaticPaths(rules, manifest);
    const slugs = paths.map((path) => path.params.slug);

    expect(paths[0]).toEqual({
      params: { slug: undefined },
      props: { view: "index" },
    });
    for (const cellId of cellIds) {
      expect(paths).toContainEqual({
        params: { slug: `cells/${cellId}` },
        props: { view: "cell", cellId },
      });
    }
    for (const runId of runIds) {
      expect(paths).toContainEqual({
        params: { slug: `runs/${runId}` },
        props: { view: "run", runId },
      });
    }
    expect(slugs).not.toContain("cells/[cell_id]");
    expect(slugs).not.toContain("runs/[run_id]");
    expect(slugs.some((slug) => slug?.includes("[cell_id]"))).toBe(false);
    expect(slugs.some((slug) => slug?.includes("[run_id]"))).toBe(false);
  });

  test("empty matrix and empty runs still emit only the index path", () => {
    const paths = buildObservatoryStaticPaths(makeRules([]), makeManifest({}));

    expect(paths).toEqual([
      { params: { slug: undefined }, props: { view: "index" } },
    ]);
  });
});

describe("loadObservatoryStaticPaths", () => {
  test("returns empty paths when the matrix-rules artifact is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "observatory-static-paths-"));
    try {
      const rulesPath = join(dir, "matrix-rules.v1.json");
      const manifestPath = join(dir, "suite-manifest.v1.json");
      await writeFile(manifestPath, JSON.stringify(makeManifest({})));

      await expect(loadObservatoryStaticPaths(rulesPath, manifestPath)).resolves.toEqual(
        [],
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns empty paths when the suite-manifest artifact is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "observatory-static-paths-"));
    try {
      const rulesPath = join(dir, "matrix-rules.v1.json");
      const manifestPath = join(dir, "suite-manifest.v1.json");
      await writeFile(rulesPath, JSON.stringify(makeRules([])));

      await expect(loadObservatoryStaticPaths(rulesPath, manifestPath)).resolves.toEqual(
        [],
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns empty paths when both artifacts are missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "observatory-static-paths-"));
    try {
      const rulesPath = join(dir, "matrix-rules.v1.json");
      const manifestPath = join(dir, "suite-manifest.v1.json");

      await expect(loadObservatoryStaticPaths(rulesPath, manifestPath)).resolves.toEqual(
        [],
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("throws when an existing artifact is corrupt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "observatory-static-paths-"));
    try {
      const rulesPath = join(dir, "matrix-rules.v1.json");
      const manifestPath = join(dir, "suite-manifest.v1.json");
      await writeFile(rulesPath, "{not-json");
      await writeFile(manifestPath, JSON.stringify(makeManifest({})));

      await expect(loadObservatoryStaticPaths(rulesPath, manifestPath)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("builds paths when both artifacts exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "observatory-static-paths-"));
    try {
      const rules = makeRules([makeScenario({ cell_id: "cell-a" })]);
      const manifest = makeManifest({ "run-1": makeRun("run-1") });
      const rulesPath = join(dir, "matrix-rules.v1.json");
      const manifestPath = join(dir, "suite-manifest.v1.json");
      await writeFile(rulesPath, JSON.stringify(rules));
      await writeFile(manifestPath, JSON.stringify(manifest));

      await expect(loadObservatoryStaticPaths(rulesPath, manifestPath)).resolves.toEqual(
        buildObservatoryStaticPaths(rules, manifest),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
