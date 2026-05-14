# Architecture notes

This doc is for contributors working on the UI.

## Toolchain

- Astro 6 with React integration.
- React 19.
- Tailwind CSS + Flowbite UI primitives.
- Bun is the package manager and runner. `bun.lock` is the lockfile.

## Component tree (Observatory UI)

The Observatory UI lives under `src/components/observatory/` as focused
modules. The top-level `ObservatoryShell.tsx` is a thin orchestrator (data
fetch, top-level state, mounts).

```text
src/components/observatory/
  ObservatoryShell.tsx
  lib/
    contracts.ts
    fetchManifest.ts
    statusStyles.ts
    versionSorting.ts
    urlState.ts
    evidenceModel.ts
    nicify.ts
  matrix/
    MatrixCell.tsx
    MatrixGrid.tsx
    FlowAccordionSection.tsx
    NotInScopeNote.tsx
  filters/
    FilterBar.tsx
    BrowserPickerRow.tsx
  modal/
    OverlayFrame.tsx
    RunModal.tsx
    VideoPlayer.tsx
    FilePane.tsx
    tabs/
      OverviewTab.tsx
      ScreenshotsTab.tsx
      MitmTab.tsx
      LogsTab.tsx
      MetaTab.tsx
      StackTab.tsx
  evidence/
    EvidenceViewer.tsx
    renderers/
      TextViewerCore.tsx
      TextLogRenderer.tsx
      JsonlRenderer.tsx
      EventStreamRenderer.tsx
      MarkdownRenderer.tsx
      StubRenderer.tsx
      ansi.ts
  media/
    MediaGallery.tsx
  stack/
    StackSummaryPane.tsx
    ImagesUsedPanel.tsx
```

## URL state

Deep-linkable query params are owned by `src/components/observatory/lib/`
`urlState.ts`. Filter updates use `replaceState`; modal open/close uses
`pushState`.

| Param      | Source                | Purpose                                 |
| ---------- | --------------------- | --------------------------------------- |
| `browser`  | FilterBar             | Browser filter (`all` or one slug)      |
| `flow`     | FilterBar             | Flow filter (`all` or one flow id)      |
| `q`        | FilterBar             | Free-text search                        |
| `expanded` | FlowAccordionSection  | Comma-separated expanded flow ids       |
| `cell`     | Matrix grid click     | Active cell id                          |
| `run`      | Matrix grid click     | Active run id (latest by default)       |
| `tab`      | RunModal              | Active tab (overview by default)        |
| `mitm`     | MitmTab               | Sub-tab (`traffic` or `files`)          |

## Evidence state machine (RunModal)

`RunModal` owns a tagged-union state for `meta/evidence.v1.json`:

```text
EvidenceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; manifest }
  | { status: "missing" }
  | { status: "error"; message }
```

Evidence-driven tabs only mount when `status === "ready"`, so child
components do not see an empty initial items array. `overview` and
`screenshots` have their own data sources and are not gated.
