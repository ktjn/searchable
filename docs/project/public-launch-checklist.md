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
- [x] README and package documentation state that npm and Python packages are
  not yet published.
- [x] No release tag or GitHub release exists for the prepared `1.0.0` package
  manifests.

## Visibility change

- [ ] In **Settings → General → Danger Zone**, change repository visibility to
  public and confirm `ktjn/searchable` is the intended repository.
- [ ] Open the repository while signed out and verify README, license, Issues,
  Security, and the documentation homepage are visible.

## Immediately after public

- [ ] Enable **secret scanning** and review any alerts across the complete Git
  history.
- [ ] Enable secret-scanning **push protection**.
- [ ] Enable **private vulnerability reporting** and verify
  `https://github.com/ktjn/searchable/security/advisories/new` is available.
- [ ] Enable **Dependabot security updates** and confirm vulnerability alerts
  remain enabled.
- [ ] Enable TypeScript and Python **code scanning**, preferably with GitHub's
  default CodeQL setup, and triage the first result.
- [ ] Verify the main ruleset exists and its required status-check names match
  the current CI jobs exactly.
- [ ] Verify `https://ktjn.github.io/searchable/` and
  `https://ktjn.github.io/searchable/gallery/` return HTTP 200 with Searchable
  branding.
- [ ] Verify every README and community-file link as a signed-out visitor.
- [ ] Confirm `npm view @ktjn/searchable-client version` still returns `E404`;
  registry publication is a later coordinated release.

## First npm release

Package publication is outside the visibility cutover. Before tagging
`v1.0.0`, complete the release checklist in [Project governance](governance.md),
inspect all four npm tarballs, confirm npm authentication or trusted publishing,
and update preview wording only after the registry confirms publication.
