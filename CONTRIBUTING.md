# Contributing

Thanks for taking a look. This repo is the public website for Open Cloud Mesh,
and it also hosts the Observatory UI, so contributions can be anything from
homepage copy and visual polish to observatory UX, evidence rendering, and docs.
None of it is too small to send.

## What belongs here

This is the right place for:

- homepage and public site content
- Astro pages, layouts, and navigation
- Observatory UI and deep-link behavior
- evidence rendering and presentation
- site-specific docs and public-facing copy

## What mostly belongs in ocm-test-suite

Some things that show up in the Observatory are not actually produced here. The
sibling [cs3org/ocm-test-suite](https://github.com/cs3org/ocm-test-suite) repo
owns most of the data and delivery side:

- compatibility runs
- result aggregation
- site ingest
- public artifact generation
- the build and publish workflow

My rule of thumb: if you are changing UI, links, layout, or presentation, work
here; if you are changing generated JSON, artifacts, or publish behavior, that
change probably lives in `ocm-test-suite`, or needs to be coordinated across
both.

## Local workflow

This repo uses Bun.

```sh
bun install
bun run dev
bun run build
bun run preview
```

For homepage and general site work, that is usually enough.

## Working on the Observatory

The Observatory is a static reader of published data; it does not generate its
own results. To work on it with real data, ingest published inputs from
`ocm-test-suite` into this repo's `public/` tree before building or previewing.
The exact ingest and publish steps are documented in that repo.

If you want to reproduce the GitHub Pages path locally:

```sh
ASTRO_BASE=/ocm-test-suite/ bun run build
```

## Helpful docs

- [docs/development.md](docs/development.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/data-contract.md](docs/data-contract.md)

## Pull requests

A few things make review much easier:

- Keep pull requests focused.
- Say whether the change touches the broader site, the Observatory, or both.
- Call out cross-repo implications when a UI change depends on `ocm-test-suite`
  data or a contract change.
- Update the docs when behavior changes.

## Questions and issues

If something is unclear, wrong, or awkward to work with, that is worth an issue,
and small docs fixes are welcome too. If you are planning something larger,
opening an issue first to talk it through saves everyone time.

By contributing, you agree that your contributions are licensed under
AGPL-3.0-or-later, consistent with this repository.
