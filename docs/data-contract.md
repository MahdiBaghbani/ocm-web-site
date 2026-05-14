# Data contract (what the site reads)

The site reads JSON contracts and per-run artifacts that are published into
`public/`. The website does not own this data; it mirrors whatever the test
suite emits.

## Inputs under `public/`

| File                            | Source                             | Purpose                                        |
| ------------------------------- | ---------------------------------- | ---------------------------------------------- |
| `matrix-rules.v1.json`          | test suite publish step            | Cell coordinates, display status, flows[] meta |
| `implemented-cells.v1.json`     | test suite publish step            | Cell capability and blocked-by status          |
| `matrix-not-in-scope.v1.json`   | test suite publish step            | Per-flow out-of-scope rationale                |
| `suite-manifest.v1.json`        | test suite publish step            | Latest-per-cell run records and result data    |
| `artifacts/<flow>/<pair>/<id>/` | artifact tree copied as-is         | Screenshots, traces, logs, and meta sidecars   |

## Evidence sidecar

Each per-run artifact directory carries `meta/evidence.v1.json` as the
master sidecar. The UI enumerates evidence items from this file and renders
them by envelope kind (for example `text-log.v1`, `jsonl.v1`,
`event-stream.v1`, `markdown.v1`, `stub.v1`).
