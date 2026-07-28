#!/usr/bin/env bash
# PreToolUse hook for Edit/Write — refuse to edit on main/master, suggest a branch.
# Exit codes: 0 = allow, 2 = deny with message
#
# This hook USED TO run `git checkout -b` itself, silently switching the user's
# branch mid-edit in whatever repo they happened to be in. Two problems:
#   1. A toolkit must not mutate a user's working tree as a side effect. If the
#      branch already existed, `git checkout` would carry uncommitted changes
#      across it — or fail silently, since every git call was `2>/dev/null`.
#   2. It surprised people. The fix for "you're about to edit main" is to SAY SO,
#      not to reach in and move them.
#
# So it now denies with a clear message and lets the human (or Claude, with the
# user watching) create the branch. Same protection, no hidden mutation. This
# mirrors block-commit-main.sh, which already denies rather than acting.

set -euo pipefail

INPUT=$(cat)

# Explicit opt-out.
if [ "${CLAUDE_KIT_ALLOW_MAIN_EDITS:-0}" = "1" ]; then
  exit 0
fi

# Only act in git repos
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
if [ -z "$CURRENT_BRANCH" ]; then
  exit 0
fi

# Only trigger on main/master
if [ "$CURRENT_BRANCH" != "main" ] && [ "$CURRENT_BRANCH" != "master" ]; then
  exit 0
fi

# Extract file_path from tool_input
if command -v jq &>/dev/null; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
else
  FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

# Skip non-project files (config, memory, etc.)
if [[ "$FILE_PATH" == *".claude/"* ]] || [[ "$FILE_PATH" == *"memory/"* ]] || [[ "$FILE_PATH" == *"MEMORY.md"* ]]; then
  exit 0
fi

# Derive branch name from file path
BASENAME=$(basename "$FILE_PATH" .md)
BASENAME=$(basename "$BASENAME" .sh)
BASENAME=$(basename "$BASENAME" .js)
BASENAME=$(basename "$BASENAME" .ts)
BASENAME=$(basename "$BASENAME" .json)
# Sanitize for branch name
SLUG=$(echo "$BASENAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/--*/-/g' | cut -c1-30)
BRANCH_NAME="feat/${SLUG}"

# Deny the edit and tell the caller exactly what to run. We do NOT create or
# switch the branch ourselves — see the header. Exit 2 blocks the tool call and
# feeds this message back to Claude, which can then create the branch in the
# open, where the user can see it.
cat >&2 <<MSG
Refusing to edit on '$CURRENT_BRANCH'.

Create a branch from the freshly fetched remote branch first, then retry the edit:

    git fetch origin --quiet && git checkout -b $BRANCH_NAME origin/$CURRENT_BRANCH

If this repository has no origin remote, create the branch from the current
local branch instead:

    git checkout -b $BRANCH_NAME

(Set CLAUDE_KIT_ALLOW_MAIN_EDITS=1 to disable this hook.)
MSG

exit 2
