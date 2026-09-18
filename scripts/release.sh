#!/bin/bash

# @author Artem Lytvynov
# @copyright Artem Lytvynov
# @license Apache-2.0

# Prepares a release of @hdml/components LOCALLY and stops before any
# push. Usage: scripts/release.sh <version>   (e.g. 0.0.2-alpha.25)
#
# It sets the version, runs the full build gate, prints the tarball
# file list, commits `build(release): <version>` and creates the
# annotated tag. It never pushes: pushing the tag triggers
# .github/workflows/release.yml, which runs `npm publish` with the
# org token, and an npm version once published can never be reused.

set -euo pipefail

RELEASE="${1:-}"
if [ -z "$RELEASE" ]; then
  echo "Error: release number must be specified" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
  echo "Error: must be run from the 'main' branch (on '$BRANCH')" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Error: the working tree is not clean" >&2
  git status --short >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$RELEASE" >/dev/null; then
  echo "Error: tag '$RELEASE' already exists" >&2
  exit 1
fi

# Moves package.json's and package-lock.json's root `version` only.
npm version "$RELEASE" --no-git-tag-version

# clear → lint → test → compile_all → manifest → check_dist → docs
npm run build

# The build must not have rewritten any other tracked file, or the
# tagged tree is not the tree that was built.
CHANGED="$(git status --porcelain --untracked-files=no | awk '{print $2}' | sort)"
EXPECTED="$(printf '%s\n' package-lock.json package.json)"
if [ "$CHANGED" != "$EXPECTED" ]; then
  echo "Error: the build changed tracked files other than the version:" >&2
  echo "$CHANGED" >&2
  exit 1
fi

npm pack --dry-run

git commit -m "build(release): $RELEASE" package.json package-lock.json
git tag -a "$RELEASE" -m "$RELEASE"

echo
echo "Committed and tagged $RELEASE locally. Nothing has been pushed."
echo "Publishing is NOT revertible. To publish, run:"
echo
echo "  git push origin main"
echo "  git push origin $RELEASE"
