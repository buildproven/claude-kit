#!/usr/bin/env bash
# PreToolUse hook for Edit/Write — auto-creates a feature branch if on main/master
# Exit codes: 0 = allow (after branching), 2 = deny with message
#
# When Claude tries to edit/write files while on main, this hook:
# 1. Detects the current branch is main/master
# 2. Auto-creates a feature branch named from the file being edited
# 3. Allows the edit to proceed on the new branch

set -euo pipefail

INPUT=$(cat)

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

# Check if branch already exists (maybe from a previous auto-branch in this session)
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME" 2>/dev/null; then
  # Branch exists, switch to it
  git checkout "$BRANCH_NAME" 2>/dev/null
else
  # Create and switch
  git checkout -b "$BRANCH_NAME" 2>/dev/null
fi

# Output context so Claude knows what happened
cat <<JSON
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "Auto-branched from $CURRENT_BRANCH to $BRANCH_NAME before editing. All edits will land on $BRANCH_NAME."
  }
}
JSON

exit 0
