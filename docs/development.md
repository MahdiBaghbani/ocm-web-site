# Development

This site is built with Astro and React.

## Prerequisites

- Node.js: see `package.json` for the minimum version.
- Bun: used as the package manager and runner in this repo.

## Common commands

```sh
bun install
bun run dev      # http://localhost:4321
bun run build    # outputs static site to ./dist
bun run preview  # serves the built site locally
```

## Notes

- `public/` contains published run data and artifacts. The website is a
  static reader of those files.
