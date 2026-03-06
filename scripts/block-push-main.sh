#!/usr/bin/env bash
# PreToolUse hook for Bash — blocks direct pushes to main/master
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

# Check for git push to main or master (with any remote name)
# Matches: git push origin main, git push upstream master, git push -u origin main, etc.
if echo "$COMMAND" | grep -qE 'git\s+push\s+.*\s(main|master)\s*$'; then
  # Allow force push (already gated by permissions.ask) and push --delete
  if echo "$COMMAND" | grep -qE '\-\-force|\-f|\-\-delete'; then
    exit 0
  fi
  echo "Blocked: direct push to main/master. Create a feature branch and PR instead."
  echo ""
  echo "  git checkout -b feat/my-feature"
  echo "  git push -u origin feat/my-feature"
  echo "  gh pr create"
  exit 2
fi

# Block bare "git push" when on main/master (no explicit branch arg)
if echo "$COMMAND" | grep -qE 'git\s+push\s*$'; then
  CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
  if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
    echo "Blocked: bare 'git push' while on $CURRENT_BRANCH. Create a feature branch and PR instead."
    echo ""
    echo "  git checkout -b feat/my-feature"
    echo "  git push -u origin feat/my-feature"
    echo "  gh pr create"
    exit 2
  fi
fi

exit 0
