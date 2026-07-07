# OpenCloudMesh Website

> The public website for Open Cloud Mesh, home to the OCM Test Suite Observatory.

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/MahdiBaghbani/ocm-web-site)

This is the public front door for Open Cloud Mesh (OCM): a place to learn what
OCM is, find the spec and community, and see how well implementations actually
work together.

The part I am most proud of is the Observatory. When two platforms are tested
for OCM interoperability, a red or green box is rarely the interesting part. The
interesting part is why. So in the Observatory a result is not a dead end: open
any cell and you get the evidence behind it, the screenshots, the network
traces, the logs, the run metadata, and the container stack that produced it.

- Live site: <https://cs3org.github.io/ocm-test-suite/>
- Observatory: <https://cs3org.github.io/ocm-test-suite/observatory/>

## The two surfaces

### Home

The homepage is the broad OCM landing page. It is here to orient people: what
Open Cloud Mesh is, why it matters, and where to go next for the specification,
the community, and related implementation work. It is a hub, not the spec
itself; the normative protocol lives in
[cs3org/OCM-API](https://github.com/cs3org/OCM-API).

### Observatory

The Observatory is where interoperability becomes reviewable. It is a reader,
not a test runner. It takes published results and turns them into a compatibility
matrix you can browse, filter, and link straight to a single failing cell and the
evidence tab that explains it. It shows the latest terminal result per cell, so
the picture stays honest and current.

## How the data gets here

This repo owns the website and the Observatory UI. It does not run the tests.

The runs, aggregation, ingest, and publish pipeline live in the sibling
[cs3org/ocm-test-suite](https://github.com/cs3org/ocm-test-suite) repo, which
generates the JSON and artifacts the Observatory reads from `public/`. That repo
is also what builds and deploys this site to GitHub Pages.

## Local development

Built with Astro, React, Tailwind, and Bun.

```sh
bun install
bun run dev
bun run build
bun run preview
```

For the homepage, layout, and general site work, that is all you need.

For Observatory work with real data, you also need published inputs ingested
into `public/` from `ocm-test-suite`; the Observatory reads that data rather than
creating it. Without it, the site still runs, but the matrix shows an empty-state
notice.

To mirror the GitHub Pages subpath locally:

```sh
ASTRO_BASE=/ocm-test-suite/ bun run build
```

## Documentation

- [docs/development.md](docs/development.md): local setup and workflows
- [docs/architecture.md](docs/architecture.md): UI structure and URL state
- [docs/data-contract.md](docs/data-contract.md): what the Observatory reads

## Related repos

Open Cloud Mesh spans a few repositories:

- [cs3org/OCM-API](https://github.com/cs3org/OCM-API): the protocol and spec
- [cs3org/ocm-test-suite](https://github.com/cs3org/ocm-test-suite): runs,
  ingest, and publish pipeline
- [MahdiBaghbani/opencloudmesh-go](https://github.com/MahdiBaghbani/opencloudmesh-go):
  a Go implementation in the same ecosystem

## Acknowledgements

This website and the Observatory exist because someone chose to fund open source
infrastructure. A big thank you to the Sovereign Tech Agency for backing this
work, which Mahdi Baghbani develops as part of Open Cloud Mesh.

<p>
  <a href="https://www.sovereign.tech/tech/open-cloud-mesh">
    <img alt="Sovereign Tech Agency" src="public/logos/funders/sovereign-tech-agency.svg" height="64">
  </a>
</p>

You can read the full story in [FUNDING.md](FUNDING.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the local
workflow, the repo boundary with `ocm-test-suite`, and what makes review easy.

## License

Licensed under the GNU Affero General Public License v3.0 or later
(AGPL-3.0-or-later). See [LICENSE.md](LICENSE.md).
