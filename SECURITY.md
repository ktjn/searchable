# Security policy

Searchable publishes one npm package (`@ktjn/searchable`) to GitHub Packages
and one Python package (`searchable`) to PyPI. Reports may affect source code,
generated indexes, either client runtime, the index builder, or the live
documentation.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Select **Report a vulnerability**, or open
   <https://github.com/ktjn/searchable/security/advisories/new>.
3. Include affected versions, impact, reproduction steps, and any suggested
   mitigation.

Do not open a public issue, discussion, or pull request for a suspected
vulnerability.

## Response process

The maintainer acknowledges private reports and investigates them
confidentially, coordinating remediation and disclosure by severity. No fixed
response-time SLA is promised while the project is maintained by one person.

## Supported versions

Security fixes target the latest minor release of the current major version
for both published packages. Older lines are patched only when backporting is
trivial, at the maintainer's discretion.

| Channel | Supported line |
|---|---|
| npm `@ktjn/searchable` | Latest `2.x` minor release |
| PyPI `searchable` | Latest `2.x` minor release |

## Scope

- **TypeScript client** (`packages/searchable`): manifest validation,
  cancellation, disposal, shard fetching, caching, and query evaluation.
- **Python toolkit** (`python/searchable`): index construction, manifest and
  shard writing, validation, fetching, and query evaluation.
- **Index format**: the JSON `Manifest.version` 2 contract and generated
  shards.
- **Public content**: the documentation site and its generated index at
  <https://ktjn.github.io/searchable/>.

Anything placed in a published index is public, including the documentation
site's index. Confidentiality is a property of what is indexed, not of the
search runtime.

## Release integrity

Tagged releases build and test the npm and Python artifacts in CI before
publishing. The Python job installs the built wheel in an isolated environment
and exercises an index-build and client-read scenario without relying on the
workspace source tree. npm releases are likewise built from the tag in CI.

PyPI currently authenticates with `PYPI_API_TOKEN`. Trusted publishing via
OIDC is the intended replacement and requires a PyPI trusted-publisher mapping
for this repository's `pypi` environment.
