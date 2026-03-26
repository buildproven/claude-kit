#!/bin/bash
# Stop hook: validate final output before Claude Code finishes
# Checks for common quality issues that shouldn't ship

set -euo pipefail

# Early exit if not in a git repo
if ! git rev-parse --git-dir &>/dev/null; then
  exit 0
fi

ISSUES=()

# Check both staged (--cached) and unstaged diffs — Claude edits are typically unstaged
DIFF_OUTPUT=$(git diff --cached 2>/dev/null; git diff 2>/dev/null)

# Check for leftover console.logs
if echo "$DIFF_OUTPUT" | grep -E '^\+.*\bconsole\.log\b' | grep -q .; then
  ISSUES+=("console.log found in changes")
fi

# Check for TODO/FIXME/HACK
if echo "$DIFF_OUTPUT" | grep -E '^\+.*\b(TODO|FIXME|HACK|XXX)\b' | grep -q .; then
  ISSUES+=("TODO/FIXME/HACK found in changes")
fi

# Check for 'any' type in TypeScript changes
TS_DIFF=$(git diff --cached -- '*.ts' '*.tsx' 2>/dev/null; git diff -- '*.ts' '*.tsx' 2>/dev/null)
if echo "$TS_DIFF" | grep -E '^\+.*: any\b' | grep -q .; then
  ISSUES+=("TypeScript 'any' type found in changes")
fi

# Check for debugger statements
if echo "$DIFF_OUTPUT" | grep -E '^\+.*\bdebugger\b' | grep -q .; then
  ISSUES+=("debugger statement found in changes")
fi

# Output warnings (non-blocking — informational for Claude)
if [ ${#ISSUES[@]} -gt 0 ]; then
  echo "STOP VALIDATION:"
  printf '  - %s\n' "${ISSUES[@]}"
  echo "Consider fixing before completing."
fi

exit 0
