# Data contract (what the site reads)

The site reads JSON contracts and per-run artifacts that are published into
`public/`. The website does not own this data; it mirrors whatever the test
suite emits.

## Inputs under `public/`

| File                            | Source                     | Purpose                                       |
| ------------------------------- | -------------------------- | --------------------------------------------- |
| `matrix-rules.v1.json`          | test suite publish step    | Matrix cells, platform catalog, flow metadata |
| `matrix-not-in-scope.v1.json`   | test suite publish step    | Per-flow out-of-scope rationale by role       |
| `suite-manifest.v1.json`        | test suite publish step    | Latest-per-cell run records and result data   |
| `artifacts/<flow>/<pair>/<id>/` | artifact tree copied as-is | Screenshots, traces, logs, and meta sidecars  |

Cell capability and blocked-by status now live on each kept matrix cell as
`display_status` inside `matrix-rules.v1.json`. The site no longer reads
`implemented-cells.v1.json`.

## `matrix-rules.v1.json`

Top-level fields consumed by the observatory UI:

- `flows[]`: flow metadata (`flow_id`, `label`, `subtitle`, `display_order`,
  `enabled`, `two_party`, `mitm`).
- `platforms[]`: canonical platform catalog for rendered labels. Each entry
  includes `id`, `display_name`, and `version_lines`. The UI resolves human
  labels from this catalog; older published artifacts may omit it.
- `matrix[]`: one entry per kept matrix cell. Each entry includes
  `matrix_key`, `flow_id`, `pair`, platform/version coordinates, `browser`,
  `mitm`, `cell_id`, `artifact_name`, and `display_status`.

Platform identity vs display labels:

- `platforms[]` is the source of truth for rendered platform names in the UI.
- Matrix cells keep machine-readable slug ids, not display labels:
  `sender_platform`, `receiver_platform`, `cell_id`, and `tracking_url` (when
  present) all use those ids.
- `matrix-not-in-scope.v1.json` entries also use slug `platform` ids; the UI
  resolves labels from `platforms[]` when rendering them.

`display_status` values:

- `supported` - cell is in scope and expected to run.
- `test-pending` - vendor supports the flow but test work is not done yet.
- `vendor-unsupported` - vendor does not support the flow for this pair.
- `placeholder` - reserved or stub cell.

Vendor-out-of-scope cells are omitted from `matrix[]` and documented in
`matrix-not-in-scope.v1.json` instead.

## `suite-manifest.v1.json`

Aggregated latest-per-cell manifest. The UI reads:

- `cells` - cell identity keyed by `cell_id`.
- `runs` - run records keyed by run id (`execution_id`, timing, lifecycle).
- `results` - terminal verdicts and evidence index entries.
- `indexes.latest_terminal_result_by_cell` - latest result id per cell.

Run records expose `matrix_key` but do not embed image tags or stack hash
fields; those live under per-run artifact sidecars (`meta/images.v1.json`,
`compose/manifest.v1.json`).

## Evidence sidecar

Each per-run artifact directory carries `meta/evidence.v1.json` as the
master sidecar. The UI enumerates evidence items from this file and renders
them by envelope kind (for example `text-log.v1`, `jsonl.v1`,
`event-stream.v1`, `markdown.v1`, `stub.v1`).
