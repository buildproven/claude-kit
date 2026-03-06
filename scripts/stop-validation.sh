#!/bin/bash
# Stop hook: validate final output before Claude Code finishes
# Checks for common quality issues that shouldn't ship

set -euo pipefail

# Early exit if not in a git repo
if ! git rev-parse --git-dir &>/dev/null; then
  exit 0
fi

ISSUES=()

# Check for leftover console.logs in staged changes (diff only, not entire files)
if git diff --cached 2>/dev/null | grep -E '^\+.*\bconsole\.log\b' | grep -q .; then
  ISSUES+=("console.log found in staged changes")
fi

# Check for TODO/FIXME/HACK in staged changes
if git diff --cached 2>/dev/null | grep -E '^\+.*\b(TODO|FIXME|HACK|XXX)\b' | grep -q .; then
  ISSUES+=("TODO/FIXME/HACK found in staged changes")
fi

# Check for 'any' type in staged TypeScript changes (diff only, not entire files)
if git diff --cached -- '*.ts' '*.tsx' 2>/dev/null | grep -E '^\+.*: any\b' | grep -q .; then
  ISSUES+=("TypeScript 'any' type found in staged changes")
fi

# Check for debugger statements
if git diff --cached 2>/dev/null | grep -E '^\+.*\bdebugger\b' | grep -q .; then
  ISSUES+=("debugger statement found in staged changes")
fi

# Output warnings (non-blocking — informational for Claude)
if [ ${#ISSUES[@]} -gt 0 ]; then
  echo "STOP VALIDATION:"
  printf '  - %s\n' "${ISSUES[@]}"
  echo "Consider fixing before completing."
fi

exit 0
