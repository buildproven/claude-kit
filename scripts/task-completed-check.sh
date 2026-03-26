#!/usr/bin/env bash
# TaskCompleted hook — verifies tests pass before marking a task as completed
# Prevents tasks from being marked done with failing tests
# Exit codes: 0 = pass (or no test runner), 2 = block (tests failing)

set -euo pipefail

INPUT=$(cat)

# Extract cwd from hook input
if command -v jq &>/dev/null; then
  CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
else
  CWD=$(echo "$INPUT" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"cwd"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

if [ -z "$CWD" ] || [ ! -d "$CWD" ]; then
  exit 0
fi

# Find project root (has package.json)
PROJECT_DIR="$CWD"
while [ "$PROJECT_DIR" != "/" ] && [ ! -f "$PROJECT_DIR/package.json" ]; do
  PROJECT_DIR=$(dirname "$PROJECT_DIR")
done

if [ "$PROJECT_DIR" = "/" ]; then
  exit 0
fi

# Check if project has a test script
if ! command -v jq &>/dev/null; then
  exit 0
fi

TEST_SCRIPT=$(jq -r '.scripts.test // empty' "$PROJECT_DIR/package.json" 2>/dev/null)
if [ -z "$TEST_SCRIPT" ]; then
  exit 0
fi

# Check if there are any modified JS/TS files (only run tests if code changed)
MODIFIED_FILES=$(git -C "$PROJECT_DIR" diff --name-only --diff-filter=ACMR HEAD 2>/dev/null | grep -E '\.(ts|tsx|js|jsx)$' || true)

if [ -z "$MODIFIED_FILES" ]; then
  exit 0
fi

# Detect package manager
if [ -f "$PROJECT_DIR/pnpm-lock.yaml" ]; then
  PM="pnpm"
elif [ -f "$PROJECT_DIR/yarn.lock" ]; then
  PM="yarn"
elif [ -f "$PROJECT_DIR/bun.lockb" ]; then
  PM="bun"
else
  PM="npm"
fi

# Run tests (with timeout to prevent hanging)
TEST_OUTPUT=$(cd "$PROJECT_DIR" && timeout 60 $PM test -- --passWithNoTests 2>&1) || {
  EXIT_CODE=$?
  if [ $EXIT_CODE -eq 124 ]; then
    printf "Tests timed out after 60 seconds.\nFix or skip slow tests before marking task complete.\n"
  else
    printf "Tests are failing:\n%s\n\nFix failing tests before marking task complete.\n" "$TEST_OUTPUT"
  fi
  exit 2
}

exit 0
