import type { MatrixRules, SuiteManifest } from "./contracts";

/** Published suite-manifest filename under `public/`. */
export const SUITE_MANIFEST_FILENAME = "suite-manifest.v1.json";

export type ObservatoryView = "index" | "cell" | "run";

export interface ObservatoryRouteProps {
  view: ObservatoryView;
  cellId?: string;
  runId?: string;
}

export interface ObservatoryStaticPath {
  params: { slug?: string };
  props: ObservatoryRouteProps;
}

/** True when `error` is a Node-style ENOENT (missing file) failure. */
export function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/**
 * Build observatory `[...slug]` static paths from parsed artifacts.
 * Always emits the index path first, then unique non-empty `cell_id`s in
 * matrix source order, then `run_id`s in `Object.keys` order. Empty matrix
 * and missing or empty `runs` still yield the index path only.
 */
export function buildObservatoryStaticPaths(
  rules: MatrixRules,
  manifest: SuiteManifest,
): ObservatoryStaticPath[] {
  const cellIds = [
    ...new Set(
      rules.matrix.map((scenario) => scenario.cell_id).filter((cellId) => cellId.length > 0),
    ),
  ];
  const runIds = manifest.runs ? Object.keys(manifest.runs) : [];

  const paths: ObservatoryStaticPath[] = [
    { params: { slug: undefined }, props: { view: "index" } },
  ];

  for (const cellId of cellIds) {
    paths.push({
      params: { slug: `cells/${cellId}` },
      props: { view: "cell", cellId },
    });
  }

  for (const runId of runIds) {
    paths.push({
      params: { slug: `runs/${runId}` },
      props: { view: "run", runId },
    });
  }

  return paths;
}
