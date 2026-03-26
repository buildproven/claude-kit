#!/bin/bash
# Git hook to check for submodule updates
# Install: ln -s ../../scripts/check-submodule-updates.sh .git/hooks/post-merge
# Also install as: post-checkout, post-rebase

# Exit if not in a git repo
if [ ! -d .git ]; then
  exit 0
fi

# Exit if no submodules
if [ ! -f .gitmodules ]; then
  exit 0
fi

echo "📦 Checking submodule updates..."

# Get list of submodules
SUBMODULES=$(git config --file .gitmodules --get-regexp path | awk '{ print $2 }')

OUTDATED_FOUND=false

for SUBMODULE_PATH in $SUBMODULES; do
  if [ ! -d "$SUBMODULE_PATH" ]; then
    continue
  fi

  # Get submodule name
  SUBMODULE_NAME=$(basename "$SUBMODULE_PATH")

  # Get current commit in submodule
  cd "$SUBMODULE_PATH" || continue
  CURRENT_COMMIT=$(git rev-parse HEAD)

  # Get latest tag/release
  LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

  if [ -z "$LATEST_TAG" ]; then
    # No tags, check latest commit on default branch
    DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
    if [ -z "$DEFAULT_BRANCH" ]; then
      DEFAULT_BRANCH="main"
    fi

    # Fetch to get latest remote info
    git fetch origin "$DEFAULT_BRANCH" --quiet 2>/dev/null
    LATEST_COMMIT=$(git rev-parse "origin/$DEFAULT_BRANCH" 2>/dev/null || echo "$CURRENT_COMMIT")
  else
    LATEST_COMMIT=$(git rev-parse "$LATEST_TAG" 2>/dev/null || echo "$CURRENT_COMMIT")
  fi

  cd - > /dev/null || exit

  # Compare commits
  if [ "$CURRENT_COMMIT" != "$LATEST_COMMIT" ]; then
    OUTDATED_FOUND=true

    if [ -n "$LATEST_TAG" ]; then
      echo "⚠️  $SUBMODULE_NAME: Update available ($LATEST_TAG)"
    else
      COMMITS_BEHIND=$(cd "$SUBMODULE_PATH" && git rev-list --count HEAD..origin/"$DEFAULT_BRANCH" 2>/dev/null || echo "?")
      echo "⚠️  $SUBMODULE_NAME: $COMMITS_BEHIND commits behind latest"
    fi
  fi
done

if [ "$OUTDATED_FOUND" = true ]; then
  echo ""
  echo "To update submodules:"
  echo "  git submodule update --remote"
  echo "  git add ."
  echo "  git commit -m 'chore: update submodules'"
  echo ""
fi
