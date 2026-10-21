#!/usr/bin/env bash
# Builds the generated pieces of this example: the @ktjn/searchable browser
# bundle and the static search index over content/tinyshakespeare.txt.
# Both are gitignored (generated artifacts, not source) -- run this after
# cloning, or whenever content/tinyshakespeare.txt changes.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"

echo "==> Building @ktjn/searchable"
(cd "$repo_root" && pnpm --filter @ktjn/searchable build)
cp "$repo_root/packages/searchable/dist/index.js" "$here/searchable.js"

echo "==> Building the search index from content/tinyshakespeare.txt"
(cd "$repo_root/python/searchable" && uv sync --quiet)
(cd "$repo_root/python/searchable" && uv run python "$here/build_corpus.py")

echo
echo "Done. Serve this directory and open it in a recent desktop Chrome or Edge:"
echo "  cd $here && npx serve ."
