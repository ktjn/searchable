# Public launch checklist

This checklist separates repository preparation from the visibility change and
the security settings that become available only after Searchable is public.
The maintainer owns the visibility and commit-history decisions.

## Before visibility

- [x] Repository description, documentation homepage, MIT license, Issues, and
  GitHub Pages are configured.
- [x] Verify the repository topics describe static browser search.
- [x] Verify Wiki is disabled because checked-in documentation is canonical.
- [x] Create the main ruleset with pull requests, strict `lint`,
  `python-tests`, `test`, and `test-browser` checks, and force-push/deletion
  protection. If the private plan rejects it, complete this immediately after
  the repository becomes public.
- [ ] Decide whether the non-noreply commit metadata, including a Gmail address,
  may become public. A history rewrite is a separate, explicitly authorized
  operation.
- [x] README and package documentation describe the GitHub Packages release
  path for npm and Python packages.
- [x] The initial `v1.0.0` package release exists and subsequent tagged
  releases publish versioned package artifacts.

## Visibility change

- [x] In **Settings → General → Danger Zone**, change repository visibility to
  public and confirm `ktjn/searchable` is the intended repository.
- [x] Open the repository while signed out and verify README, license, Issues,
  Security, and the documentation homepage are visible.

## Immediately after public

- [x] Enable **secret scanning** and review any alerts across the complete Git
  history.
- [x] Enable secret-scanning **push protection**.
- [x] Enable **private vulnerability reporting** and verify
  `https://github.com/ktjn/searchable/security/advisories/new` is available.
- [x] Enable **Dependabot security updates** and confirm vulnerability alerts
  remain enabled.
- [x] Enable TypeScript and Python **code scanning**, preferably with GitHub's
  default CodeQL setup, and triage the first result.
- [x] Verify the main ruleset exists and its required status-check names match
  the current CI jobs exactly.
- [x] Verify `https://ktjn.github.io/searchable/` and
  `https://ktjn.github.io/searchable/gallery/` return HTTP 200 with Searchable
  branding.
- [x] Verify every README and community-file link as a signed-out visitor.
- [x] Confirm the GitHub Packages npm registry and `PYPI_API_TOKEN` secret are
  configured for tagged releases.

The post-public checks were completed on 2026-07-13. The initial CodeQL scan
covered Actions, TypeScript/JavaScript, and Python; its findings were triaged
into least-privilege CI permissions and traversal containment for test-only
static servers. Secret scanning and Dependabot reported no open alerts.

## Package releases

Package publication is outside the visibility cutover. Before each tagged
release, complete the release checklist in [Project governance](governance.md),
inspect all npm and Python artifacts, and confirm GitHub Packages
authentication and a read-only install from GitHub Packages and PyPI.
