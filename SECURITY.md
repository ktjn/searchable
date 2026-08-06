# Security policy

Searchable is a public project. The npm packages (`@ktjn/searchable-client`,
`@ktjn/searchable-format`, `@ktjn/searchable-analysis`) publish to GitHub
Packages in lockstep, and the Python packages (`searchable-analysis`,
`searchable-binary`, `searchable-indexer`, `searchable-client`) publish to
PyPI. Security reports may affect the source repository, generated indexes,
the browser runtime, or the live documentation.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Select **Report a vulnerability** (or open
   `https://github.com/ktjn/searchable/security/advisories/new` directly).
3. Include affected code or versions, impact, reproduction steps, and any
   suggested mitigation.

Do not open a public issue, discussion, or pull request for a suspected
vulnerability.

## Response process

The maintainer acknowledges private reports and investigates them
confidentially, coordinating remediation and disclosure by severity. No fixed
response-time SLA is promised while the project is maintained by a single
person.

## Supported versions

Security fixes target the supported lines below. Older lines are patched only
when backporting is trivial, at the maintainer's discretion.

| Channel | Supported line |
|---|---|
| npm `@ktjn/searchable-client`, `@ktjn/searchable-format`, `@ktjn/searchable-analysis` | Latest minor of the current major (`1.x`) |
| PyPI `searchable-analysis` | Latest minor of the current major |
| PyPI `searchable-binary` | Latest released version |
| PyPI `searchable-indexer` | Latest minor of the current major |
| PyPI `searchable-client` | Latest minor of the current major |

## Scope

- **Browser runtime**: the TypeScript client, its Web Worker, and the offline
  Service Worker (`packages/client`) — manifest validation, cancellation,
  worker lifecycle, and cache handling.
- **Index format**: the over-HTTP `Manifest` contract and the JSON/binary
  shard codecs (`Manifest.version` `1`).
- **Python packages**: `searchable-indexer`, `searchable-client`,
  `searchable-analysis`, and `searchable-binary`.
- **npm packages**: `@ktjn/searchable-client`, `@ktjn/searchable-format`,
  `@ktjn/searchable-analysis`.
- **Public content**: the documentation site and its generated index served
  from <https://ktjn.github.io/searchable/>.

Anything placed in a published index is public — including the documentation
site's index. Confidentiality is a property of what is indexed, not of the
search runtime itself.

## Release integrity

Tagged releases build source distributions and wheels for every Searchable
Python package and run an isolated release-artifact smoke test (see the "Smoke
test release artifacts in an isolated environment" step in
`.github/workflows/publish.yml`) before publishing: the built `dist/` must
self-resolve every inter-package dependency and pass a minimal index-build and
client-read scenario without the workspace source tree or PyPI. npm releases
are published once per tag from CI.

PyPI publishing currently authenticates with `PYPI_API_TOKEN`. Trusted
publishing (OIDC, short-lived credentials) is the intended replacement and is
tracked in the release checklist; it requires a trusted publisher mapping on
the PyPI side for the `pypi` environment before it can be switched over.
