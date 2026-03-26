#!/usr/bin/env bash
# PreToolUse hook for Bash — detects branch drift from multi-tab collisions.
#
# Problem: Tab A does `git checkout -b feat/x`, Tab B does `git checkout feat/y`,
# now Tab A's next `git commit` lands on feat/y instead of feat/x.
#
# Solution: On first git checkout/commit in a session, record the intended branch
# in .git/claude-sessions/<session>.branch. On subsequent git commits, verify the
# current branch still matches. If it drifted, block the commit with a warning.
#
# Exit codes: 0 = allow, 2 = deny with message

set -euo pipefail

INPUT=$(cat)

# Extract command
if command -v jq &>/dev/null; then
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

[ -z "$COMMAND" ] && exit 0

# Extract -C <dir> from command if present (handles cross-repo operations)
TARGET_DIR=$(echo "$COMMAND" | grep -oE 'git\s+-C\s+\S+' | head -1 | awk '{print $3}')
if [ -n "$TARGET_DIR" ]; then
  TARGET_DIR="${TARGET_DIR/#\~/$HOME}"  # expand ~ safely (no eval)
  GIT_ROOT=$(git -C "$TARGET_DIR" rev-parse --show-toplevel 2>/dev/null) || exit 0
  GIT_CMD="git -C $TARGET_DIR"
else
  GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
  GIT_CMD="git"
fi

SESSION_ID="${SESSION_ID:-$$}"
LOCK_DIR="$GIT_ROOT/.git/claude-sessions"
mkdir -p "$LOCK_DIR"
BRANCH_FILE="$LOCK_DIR/$SESSION_ID.branch"

CURRENT_BRANCH=$($GIT_CMD branch --show-current 2>/dev/null || echo "")
[ -z "$CURRENT_BRANCH" ] && exit 0

# On git checkout -b or git checkout <branch>: record the intended branch
if echo "$COMMAND" | grep -qE 'git\s+(checkout|switch)'; then
  # Let the checkout happen, then the post-hook or next call will pick up the new branch.
  # Record AFTER this command runs — so we just clear the old record to re-record next time.
  rm -f "$BRANCH_FILE"
  exit 0
fi

# On git commit or git add: check for drift
if echo "$COMMAND" | grep -qE 'git\s+(commit|add|stash)'; then
  if [ -f "$BRANCH_FILE" ]; then
    EXPECTED=$(cat "$BRANCH_FILE")
    if [ "$CURRENT_BRANCH" != "$EXPECTED" ]; then
      echo "⚠️  BRANCH DRIFT DETECTED — another tab switched from '$EXPECTED' to '$CURRENT_BRANCH'."
      echo ""
      echo "Your session was working on: $EXPECTED"
      echo "Current branch is now:       $CURRENT_BRANCH"
      echo ""
      echo "Fix: run 'git checkout $EXPECTED' first, then retry."
      exit 2
    fi
  else
    # First git operation in session — record the branch
    echo "$CURRENT_BRANCH" > "$BRANCH_FILE"
  fi
fi

exit 0
