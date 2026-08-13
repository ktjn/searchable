"""Bump the Searchable release version across every published package.

This mirrors the manual release steps but applies a single aligned ``version``
to *all* packages at once (npm and Python are released in step at the same
number):

* ``packages/searchable/package.json``,
* ``python/searchable/pyproject.toml``,
* the two hardcoded-version tests
  (``showcase/test/public-readiness-policy.test.ts`` and
  ``python/searchable/tests/test_package_metadata.py``),
* freezes ``## [Unreleased]`` in ``CHANGELOG.md`` into a dated release section
  and leaves a fresh, empty ``## [Unreleased]`` section above it.

No lockfile regeneration is needed: ``pnpm-lock.yaml`` links workspace members
by ``workspace:*`` (it does not record their concrete version) and the Python
projects have no committed ``uv.lock``.

The script is purely mechanical; the caller reviews the diff it produces.
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

PYPROJECT_VERSION_RE = re.compile(r'(\s*version\s*=\s*")[^"]+(")')
PACKAGE_JSON_VERSION_RE = re.compile(r'("version"\s*:\s*")[^"]+(")')
TYPESCRIPT_ASSERT_VERSION_RE = re.compile(r'toBe\(\s*"(\d+\.\d+\.\d+)"\s*\)')
PYPROJECT_ASSERT_VERSION_RE = re.compile(r'version\s*=\s*"(\d+\.\d+\.\d+)"')

CHANGELOG_HEADING_RE = re.compile(r"^## \[unreleased\]$", re.IGNORECASE)
CHANGELOG_SECTION_RE = re.compile(r"^## \[(?P<version>[^\]]+)\]")

SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")

NPM_MANIFESTS = [
    REPO_ROOT / "packages/searchable/package.json",
]

PYPROJECTS = [
    REPO_ROOT / "python/searchable/pyproject.toml",
]


def _rewrite_first(text: str, pattern: re.Pattern[str], version: str) -> str:
    """Replace the version inside the first match of ``pattern``."""
    match = pattern.search(text)
    if match is None:
        raise ValueError(f"unrecognized version syntax; pattern {pattern.pattern!r}")
    return (
        text[: match.start()] + f"{match.group(1)}{version}{match.group(2)}" + text[match.end() :]
    )


def bump_manifest(path: Path, version: str) -> None:
    text = path.read_text(encoding="utf-8")
    path.write_text(_rewrite_first(text, PACKAGE_JSON_VERSION_RE, version), encoding="utf-8")


def bump_pyproject(path: Path, version: str) -> None:
    text = path.read_text(encoding="utf-8")
    path.write_text(_rewrite_first(text, PYPROJECT_VERSION_RE, version), encoding="utf-8")


def bump_typescript_test(path: Path, version: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = TYPESCRIPT_ASSERT_VERSION_RE.subn(f'toBe("{version}")', text)
    if count == 0:
        raise ValueError(f"no version assertion found in {path}")
    path.write_text(updated, encoding="utf-8")


def bump_python_metadata_test(path: Path, version: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = PYPROJECT_ASSERT_VERSION_RE.subn(f'version = "{version}"', text)
    if count == 0:
        raise ValueError(f"no version assertion found in {path}")
    path.write_text(updated, encoding="utf-8")


def _rewrite_changelog_text(text: str, version: str, release_date: str) -> str:
    """Rename ``## [Unreleased]`` to a dated release section.

    A fresh, empty ``## [Unreleased]`` section is inserted above the dated one.
    The released body (everything under the renamed heading, up to the next
    released ``## [X]`` section) is preserved as the dated section's body.
    """
    lines = text.split("\n")
    try:
        unreleased_index = next(
            index for index, line in enumerate(lines) if CHANGELOG_HEADING_RE.match(line)
        )
    except StopIteration:
        raise ValueError("CHANGELOG.md has no '## [Unreleased]' section to release") from None

    body = lines[unreleased_index + 1 :]
    body_end = next(
        (
            index
            for index, line in enumerate(body)
            if CHANGELOG_SECTION_RE.match(line) and "unreleased" not in line.lower()
        ),
        len(body),
    )
    released_body = body[:body_end]
    older_releases = body[body_end :]

    prefix = "\n".join(lines[:unreleased_index]).rstrip("\n")
    fresh_unreleased = "\n".join(
        ["## [Unreleased]", "", "### Added", "", "### Changed", "", "### Fixed"]
    )

    out = [prefix, "", fresh_unreleased, "", f"## [{version}] - {release_date}"]
    released = "\n".join(released_body).rstrip("\n")
    if released:
        out.append(released)
    if older_releases:
        out.append("")
        out.append("\n".join(older_releases).rstrip("\n"))
    return "\n".join(out) + "\n"


def rewrite_changelog(path: Path, version: str, release_date: str) -> None:
    path.write_text(
        _rewrite_changelog_text(path.read_text(encoding="utf-8"), version, release_date),
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", metavar="VERSION", help="new aligned version, e.g. 1.3.0")
    parser.add_argument("--release-date", default=date.today().isoformat())
    args = parser.parse_args(argv)

    version = args.version
    if not SEMVER_RE.match(version):
        print(f"error: invalid version {version!r}; expected X.Y.Z", file=sys.stderr)
        return 2

    paths = (
        NPM_MANIFESTS
        + PYPROJECTS
        + [
            REPO_ROOT / "showcase/test/public-readiness-policy.test.ts",
            REPO_ROOT / "python/searchable/tests/test_package_metadata.py",
            REPO_ROOT / "CHANGELOG.md",
        ]
    )
    for path in paths:
        if not path.exists():
            print(f"error: {path} does not exist", file=sys.stderr)
            return 2

    try:
        for path in NPM_MANIFESTS:
            bump_manifest(path, version)
        for path in PYPROJECTS:
            bump_pyproject(path, version)
        bump_typescript_test(REPO_ROOT / "showcase/test/public-readiness-policy.test.ts", version)
        bump_python_metadata_test(
            REPO_ROOT / "python/searchable/tests/test_package_metadata.py", version
        )
        rewrite_changelog(REPO_ROOT / "CHANGELOG.md", version, args.release_date)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print(f"bumped all packages and changelog to {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
