#!/usr/bin/env bash
# quality-merge-cleanup.sh — Step 4 post-merge worktree cleanup for the
# quality skill.
#
# Leaves the operator on the primary checkout's main, merged worktree
# removed, local branch deleted, stale refs pruned. Failures here MUST
# surface (CLAUDE.md "zero silent failures") — a partial cleanup is worse
# than a noisy one because it leaks state into the next session.
#
# Run this AFTER `gh pr merge` succeeds, from inside the worktree that was
# just merged.
set -u
PRESERVE_BRANCH=false
[ "${1:-}" = "--preserve-branch" ] && PRESERVE_BRANCH=true

WORKTREE_PATH=$(git rev-parse --show-toplevel)
FEATURE_BRANCH=$(git rev-parse --abbrev-ref HEAD)
PRIMARY_CHECKOUT=$(git worktree list --porcelain | awk '/^worktree / {p=$2} /^branch refs\/heads\/main$/ {print p; exit}')

if [ -z "$PRIMARY_CHECKOUT" ]; then
  echo "[quality] Could not locate primary checkout (no worktree has main checked out)."
  echo "         Skipping cleanup — operator must remove worktree + branch manually:"
  echo "           git worktree remove $WORKTREE_PATH"
  echo "           git branch -D $FEATURE_BRANCH"
  exit 0
fi

if [ "$PRIMARY_CHECKOUT" = "$WORKTREE_PATH" ]; then
  # Running directly in the primary checkout (against project policy, but
  # supported for backwards compatibility).
  git checkout main || { echo "❌ Could not checkout main in primary — aborting cleanup"; exit 1; }
  git pull --ff-only || { echo "❌ git pull --ff-only failed — investigate before retrying"; exit 1; }
  git branch -D "$FEATURE_BRANCH" || \
    echo "[quality] Could not delete branch $FEATURE_BRANCH — remove manually."
  exit 0
fi

# We ran in a linked worktree. Tear it down in the right order: checkout main
# FIRST (so the branch is no longer "in use" by the worktree we are about to
# remove), then remove the worktree, then delete the branch.
cd "$PRIMARY_CHECKOUT" || { echo "❌ Could not cd to $PRIMARY_CHECKOUT — aborting cleanup"; exit 1; }
git checkout main || { echo "❌ Could not checkout main in $PRIMARY_CHECKOUT (likely uncommitted changes there) — aborting cleanup"; exit 1; }
git pull --ff-only || { echo "❌ git pull --ff-only failed — investigate before retrying"; exit 1; }

if ! git worktree remove "$WORKTREE_PATH"; then
  echo "❌ Could not remove worktree $WORKTREE_PATH (likely uncommitted changes inside)."
  echo "   Resolve manually, then run: git worktree remove $WORKTREE_PATH && git branch -D $FEATURE_BRANCH"
  exit 1
fi
if [ "$PRESERVE_BRANCH" = false ] && ! git branch -D "$FEATURE_BRANCH"; then
  echo "❌ Could not delete branch $FEATURE_BRANCH — remove manually with: git branch -D $FEATURE_BRANCH"
  exit 1
fi
git worktree prune -v
