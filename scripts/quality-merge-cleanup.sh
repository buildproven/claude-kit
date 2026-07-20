#!/usr/bin/env bash
# Post-merge cleanup. A completed merge stays successful even when cleanup
# cannot finish; every incomplete path prints one exact recovery command.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PRESERVE_BRANCH=false
MANIFEST=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --preserve-branch) PRESERVE_BRANCH=true; shift ;;
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    *) echo "[quality] merge succeeded; cleanup incomplete: unknown cleanup argument '$1'." >&2; exit 0 ;;
  esac
done

WORKTREE_PATH="$(git rev-parse --show-toplevel 2>/dev/null || true)"
FEATURE_BRANCH="$(git branch --show-current 2>/dev/null || true)"
MANAGER="$SCRIPT_DIR/worktree-manager.js"
if [ -z "$WORKTREE_PATH" ] || [ -z "$FEATURE_BRANCH" ] || [ ! -f "$MANAGER" ]; then
  echo "[quality] merge succeeded; cleanup incomplete: target or worktree manager unavailable." >&2
  exit 0
fi

PLAN="$(node "$MANAGER" resolve --repo "$WORKTREE_PATH" --branch "$FEATURE_BRANCH" 2>/dev/null || true)"
PRIMARY_CHECKOUT="$(printf '%s' "$PLAN" | jq -r '.repoRoot // empty' 2>/dev/null)"
DEFAULT_BRANCH="$(printf '%s' "$PLAN" | jq -r '.defaultBranch // empty' 2>/dev/null)"
if [ -z "$PRIMARY_CHECKOUT" ]; then
  echo "[quality] merge succeeded; cleanup incomplete: primary checkout could not be resolved." >&2
  echo "  Recovery: node \"$MANAGER\" reconcile --repo \"$WORKTREE_PATH\" --apply" >&2
  exit 0
fi

if [ "$PRIMARY_CHECKOUT" = "$WORKTREE_PATH" ]; then
  echo "[quality] merge succeeded; cleanup incomplete: merge ran in the primary checkout." >&2
  echo "  Recovery: inspect \"$PRIMARY_CHECKOUT\" and move future work to a linked worktree." >&2
  exit 0
fi

INVOCATION_ID=""
if [ -n "$MANIFEST" ] && [ -f "$MANIFEST" ]; then
  INVOCATION_ID="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" invocationId 2>/dev/null || true)"
fi

# Leave the worktree before asking Git to remove its exact registered path.
cd "$PRIMARY_CHECKOUT" || {
  echo "[quality] merge succeeded; cleanup incomplete: cannot enter $PRIMARY_CHECKOUT." >&2
  echo "  Recovery: node \"$MANAGER\" reconcile --repo \"$WORKTREE_PATH\" --apply" >&2
  exit 0
}

[ -n "$DEFAULT_BRANCH" ] || {
  echo "[quality] merge succeeded; cleanup incomplete: default branch could not be resolved." >&2
  echo "  Recovery: node \"$MANAGER\" reconcile --repo \"$PRIMARY_CHECKOUT\" --apply" >&2
  exit 0
}
PRIMARY_STATUS="$(git status --porcelain 2>&1)"
PRIMARY_STATUS_RC=$?
if [ "$PRIMARY_STATUS_RC" -ne 0 ]; then
  echo "[quality] merge succeeded; cleanup incomplete: primary checkout status could not be inspected: $PRIMARY_STATUS" >&2
  echo "  Recovery: node \"$MANAGER\" reconcile --repo \"$PRIMARY_CHECKOUT\" --apply" >&2
  exit 0
fi
if [ -n "$PRIMARY_STATUS" ]; then
  echo "[quality] merge succeeded; cleanup incomplete: primary checkout is dirty; it was not changed." >&2
  echo "  Recovery: node \"$MANAGER\" reconcile --repo \"$PRIMARY_CHECKOUT\" --apply" >&2
  exit 0
fi
git fetch origin "$DEFAULT_BRANCH" -q || {
  echo "[quality] merge succeeded; cleanup incomplete: could not fetch origin/$DEFAULT_BRANCH." >&2
  echo "  Recovery: node \"$MANAGER\" reconcile --repo \"$PRIMARY_CHECKOUT\" --apply" >&2
  exit 0
}
if [ "$(git branch --show-current)" = "$DEFAULT_BRANCH" ]; then
  git merge --ff-only "origin/$DEFAULT_BRANCH" >/dev/null || {
    echo "[quality] merge succeeded; cleanup incomplete: primary $DEFAULT_BRANCH did not fast-forward." >&2
    echo "  Recovery: node \"$MANAGER\" reconcile --repo \"$PRIMARY_CHECKOUT\" --apply" >&2
    exit 0
  }
fi

if [ -n "$INVOCATION_ID" ]; then
  node "$MANAGER" unlock \
    --repo "$PRIMARY_CHECKOUT" \
    --branch "$FEATURE_BRANCH" \
    --owner "bs:quality/$INVOCATION_ID" \
    --terminal >/dev/null 2>&1 || {
    echo "[quality] merge succeeded; cleanup incomplete: worktree ownership could not be released." >&2
    echo "  Recovery: node \"$MANAGER\" unlock --repo \"$PRIMARY_CHECKOUT\" --branch \"$FEATURE_BRANCH\" --owner \"bs:quality/$INVOCATION_ID\" --terminal" >&2
    exit 0
  }
fi

REMOVE_ARGS=(remove --repo "$PRIMARY_CHECKOUT" --branch "$FEATURE_BRANCH" --allow-unknown)
[ "$PRESERVE_BRANCH" = false ] && REMOVE_ARGS+=(--delete-branch)
REMOVE_JSON="$(node "$MANAGER" "${REMOVE_ARGS[@]}" 2>&1)"
REMOVE_RC=$?
if [ "$REMOVE_RC" -ne 0 ]; then
  echo "[quality] merge succeeded; cleanup incomplete: $REMOVE_JSON" >&2
  echo "  Recovery: node \"$MANAGER\" reconcile --repo \"$PRIMARY_CHECKOUT\" --apply" >&2
  exit 0
fi
BRANCH_DELETED="$(printf '%s' "$REMOVE_JSON" | jq -r '.branchDeleted // false' 2>/dev/null)"
BRANCH_DELETE_ERROR="$(printf '%s' "$REMOVE_JSON" | jq -r '.branchDeletionError // empty' 2>/dev/null)"
if [ "$PRESERVE_BRANCH" = false ] && [ "$BRANCH_DELETED" != true ]; then
  echo "[quality] merge succeeded; worktree removed; local branch cleanup incomplete: ${BRANCH_DELETE_ERROR:-git branch -d refused deletion}." >&2
  echo "  Recovery: git -C \"$PRIMARY_CHECKOUT\" branch -d \"$FEATURE_BRANCH\"" >&2
  echo "  primary: $PRIMARY_CHECKOUT ($DEFAULT_BRANCH)"
  echo "  removed: $WORKTREE_PATH"
  echo "  remaining worktrees:"
  git worktree list
  exit 0
fi

echo "[quality] merge cleanup complete."
echo "  primary: $PRIMARY_CHECKOUT ($DEFAULT_BRANCH)"
echo "  removed: $WORKTREE_PATH"
echo "  remaining worktrees:"
git worktree list
exit 0
