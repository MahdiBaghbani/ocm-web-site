# OCM Website

Astro + React UI for the OCM Test Suite Compatibility Observatory. Renders
the latest matrix run, per-cell evidence (screenshots, MITM traffic, logs,
metadata, compose manifest), and contributor-facing copy.

## Toolchain

- Astro 6 (TypeScript-strict; `tsconfig.json` extends `astro/tsconfigs/strict`).
- React 19 with `jsx: "react-jsx"` and `jsxImportSource: "react"`.
- Tailwind CSS + Flowbite UI primitives.
- Bun is the package manager and dev runner. `bun.lock` is the lockfile.

```sh
bun install
bun run dev    # http://localhost:4321
bun run build  # static site to ./dist
```

## Public data contract

The site is a static reader of JSON contracts published by the OCM Test
Suite (`repos/ots-rebooted/`) into `public/`. It does not own this data; it
mirrors what the suite emits.

| File                             | Source                                   | Purpose                                          |
| -------------------------------- | ---------------------------------------- | ------------------------------------------------ |
| `matrix-rules.v1.json`           | `nu scripts/ocmts.nu site publish`       | Cell coordinates, display status, flows[] meta   |
| `implemented-cells.v1.json`      | same                                     | Cell capability + blocked-by status              |
| `matrix-not-in-scope.v1.json`    | same                                     | Per-flow vendor-out-of-scope rationale           |
| `suite-manifest.v1.json`         | same                                     | Latest-per-cell run records + result envelopes   |
| `artifacts/<flow>/<pair>/<id>/`  | per-cell artifact tree copied as-is      | Screenshots, MITM, logs, meta sidecars           |

Each per-run artifact directory carries `meta/evidence.v1.json` as the
master sidecar; the site enumerates evidence items from there and dispatches
them to renderers by `envelope` kind (`text-log.v1`, `jsonl.v1`,
`event-stream.v1`, `markdown.v1`, `stub.v1`).

## Component tree

The Observatory UI lives under `src/components/observatory/` as focused
modules. The top-level `ObservatoryShell.tsx` is a thin orchestrator (data
fetch, top-level state, mounts).

```text
src/components/observatory/
  ObservatoryShell.tsx        - orchestrator
  lib/
    contracts.ts              - TypeScript types for every public JSON
                                contract the site consumes
    fetchManifest.ts          - getBaseUrl, fetchJson, fetchTruncatedText,
                                HttpError class
    statusStyles.ts           - statusToUi + 10-state palette + decoration
    versionSorting.ts         - parseVersionLine, compare* helpers
    urlState.ts               - parseOverlay/Tab/Mitm/Expanded URL helpers
    evidenceModel.ts          - groupEvidence, image/video render helpers
    nicify.ts                 - nicifyCellId, nicifyScreenshotPath,
                                titleCasePlatform
  matrix/
    MatrixCell.tsx            - status dot + glyph + decoration
    MatrixGrid.tsx            - Excel-style merged sender + receiver headers
    FlowAccordionSection.tsx  - per-flow accordion with roll-up badges
    NotInScopeNote.tsx        - inline out-of-scope rationale
  filters/
    FilterBar.tsx             - sticky browser/flow/search filter
    BrowserPickerRow.tsx      - shared multi-browser picker
  modal/
    OverlayFrame.tsx          - centered card (max-w-6xl, max-h-90vh)
    RunModal.tsx              - tabs scaffold + EvidenceState gate
    VideoPlayer.tsx
    FilePane.tsx              - left selector + right viewer fixed-grid
    tabs/
      OverviewTab.tsx
      ScreenshotsTab.tsx
      MitmTab.tsx             - Traffic / Files internal sub-tabs
      LogsTab.tsx
      MetaTab.tsx
      StackTab.tsx
  evidence/
    EvidenceViewer.tsx        - dispatcher (routes by envelope kind)
    KeyValueSummary.tsx
    renderers/
      TextViewerCore.tsx      - shared chrome: line numbers, search,
                                wrap, copy, download, ANSI (log),
                                JSON colorizer (json)
      TextLogRenderer.tsx     - delegates body to TextViewerCore (log)
      JsonlRenderer.tsx       - delegates body to TextViewerCore (json)
      EventStreamRenderer.tsx - MITM traffic columns + colored payloads
      MarkdownRenderer.tsx    - rendered/raw toggle
      StubRenderer.tsx
      ansi.ts                 - ANSI parser used by TextViewerCore
  media/
    MediaGallery.tsx          - lightbox: keyboard nav, zoom, fullscreen,
                                overlay arrows, thumbnail strip
  stack/
    StackPane.tsx             - compose manifest summary + file selector
    ImagesUsedPanel.tsx       - service-keyed image identity
```

## URL state

Deep-linkable query params owned by `lib/urlState.ts`. Filter updates use
`replaceState`; modal open/close uses `pushState`.

| Param      | Source              | Purpose                                  |
| ---------- | ------------------- | ---------------------------------------- |
| `browser`  | FilterBar           | Browser filter (`all` or one slug)       |
| `flow`     | FilterBar           | Flow filter (`all` or one flow_id)       |
| `q`        | FilterBar           | Free-text search                         |
| `expanded` | FlowAccordionSection| Comma-separated expanded flow ids        |
| `cell`     | matrix click        | Active cell id                           |
| `run`      | matrix click        | Active run id (latest by default)        |
| `tab`      | RunModal            | Active tab (overview default)            |
| `mitm`     | MitmTab             | Sub-tab (`traffic` default, or `files`)  |

## Evidence state machine (RunModal)

`RunModal` owns a tagged-union state for `meta/evidence.v1.json`:

```text
EvidenceState =
  | { status: "idle" }                          // no artifactBase yet
  | { status: "loading" }                       // fetch in flight
  | { status: "ready"; manifest }               // items[] available
  | { status: "missing" }                       // 404 (HttpError.status === 404)
  | { status: "error"; message }                // any other failure
```

Evidence-driven tabs (`mitm`, `logs`, `meta`, `stack`) only mount when
`status === "ready"`, so child components never see an empty initial items
array. `overview` and `screenshots` have their own data sources and are not
gated.

## Conventions

- Every file under `src/components/observatory/` is TypeScript: `lib/*` is
  `.ts`, components are `.tsx`. No `.js` or `.jsx`.
- Public JSON contracts have explicit types in `lib/contracts.ts`. Component
  props are explicit; internal locals infer.
- New shared chrome (line numbers, search, copy, download) goes through
  `TextViewerCore`. Do not re-implement those primitives in another
  renderer.
- New screenshot or cell-id display strings go through `lib/nicify.ts`. Do
  not parse the cell-id shape inline.
- ASCII-only punctuation; no emojis or curly quotes (matches the OTS repo
  policy).
