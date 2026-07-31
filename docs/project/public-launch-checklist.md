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
- [x] No release tag or GitHub release exists for the prepared `1.0.0` package
  manifests.

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
- [ ] Confirm the GitHub Packages npm and Python registries are configured for
  the first tagged release.

The post-public checks were completed on 2026-07-13. The initial CodeQL scan
covered Actions, TypeScript/JavaScript, and Python; its findings were triaged
into least-privilege CI permissions and traversal containment for test-only
static servers. Secret scanning and Dependabot reported no open alerts.

## First package release

Package publication is outside the visibility cutover. Before tagging
`v1.0.0`, complete the release checklist in [Project governance](governance.md),
inspect all three npm and three Python artifacts, and confirm GitHub Packages
authentication with a read-only install from each registry.
