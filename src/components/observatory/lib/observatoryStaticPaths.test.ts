import { describe, expect, test } from "bun:test";

import type {
  FlowMetadata,
  MatrixRuleScenario,
  MatrixRules,
  RunEntry,
  SuiteManifest,
} from "./contracts";
import {
  SUITE_MANIFEST_FILENAME,
  buildObservatoryStaticPaths,
  isEnoent,
} from "./observatoryStaticPaths";

function makeFlow(overrides: Partial<FlowMetadata> = {}): FlowMetadata {
  return {
    flow_id: "login",
    label: "Login",
    subtitle: "",
    glyph_id: "key",
    display_order: 1,
    enabled: true,
    two_party: false,
    mitm: false,
    ...overrides,
  };
}

function makeScenario(overrides: Partial<MatrixRuleScenario> = {}): MatrixRuleScenario {
  return {
    matrix_key: "login__nextcloud",
    flow_id: "login",
    pair: "nextcloud",
    enabled: true,
    browser: "chrome",
    sender_platform: "nextcloud",
    sender_version: "32",
    receiver_platform: "",
    receiver_version: "",
    mitm: false,
    cell_id: "login__nextcloud__chrome",
    artifact_name: "login",
    display_status: "supported",
    ...overrides,
  };
}

function makeRules(matrix: MatrixRuleScenario[]): MatrixRules {
  return {
    schema_version: 1,
    generated_at: "2026-01-01T00:00:00Z",
    generator: "test",
    producer: { name: "test", version: "0" },
    sources: [],
    source: "test",
    flows: [makeFlow()],
    matrix,
  };
}

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
