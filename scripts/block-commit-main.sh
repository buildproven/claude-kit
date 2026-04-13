#!/usr/bin/env bash
# PreToolUse hook for Bash — blocks git commit on main/master
# Exit codes: 0 = allow, 2 = deny with message

set -euo pipefail

# Read hook JSON from stdin
INPUT=$(cat)

# Extract command from tool_input (prefer jq, fallback to grep)
if command -v jq &>/dev/null; then
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Only match git commit commands (not git commit --amend on feature branches, etc.)
if echo "$COMMAND" | grep -qE 'git\s+commit'; then
  # Extract -C <dir> from command if present (handles cross-repo commits)
  GIT_DIR=$(echo "$COMMAND" | grep -oE 'git\s+-C\s+\S+' | head -1 | awk '{print $3}')
  if [ -n "$GIT_DIR" ]; then
    GIT_DIR="${GIT_DIR/#\~/$HOME}"  # expand ~ safely (no eval)
    CURRENT_BRANCH=$(git -C "$GIT_DIR" branch --show-current 2>/dev/null || echo "")
  else
    CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
  fi
  if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
    echo "Blocked: git commit on $CURRENT_BRANCH. Create a feature branch first."
    echo ""
    echo "  git checkout -b feat/my-feature"
    echo "  # then commit on the feature branch"
    exit 2
  fi
fi

exit 0
