# Open Cloud Mesh Website

This repository contains the website for the OCM Test Suite Compatibility
Observatory. It is a static site that visualizes published test runs as a
compatibility matrix, and lets you drill into per-cell evidence like
screenshots, network traces, logs, and run metadata.

## What this site is for

- **A public reader**: render a published compatibility snapshot in a way that
  is easy to browse and link to.
- **Evidence-first debugging**: for each cell, show the artifacts that explain
  why the result is PASS/FAIL/BLOCKED.
- **Deep links**: share links to a specific cell, run, and tab.

## Docs (technical details)

The implementation details that used to live in this README are now in
`docs/`:

- `docs/development.md`: local setup and common workflows
- `docs/data-contract.md`: what the site reads from `public/`
- `docs/architecture.md`: UI structure and URL state conventions

## Repo layout (high level)

- `src/`: Astro pages and UI components
- `public/`: published JSON contracts and per-run artifacts

## License

See `LICENSE.md`.
