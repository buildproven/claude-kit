#!/usr/bin/env bash
# TeammateIdle hook — runs lint + type-check on files modified by teammate
# Prevents teammates from going idle with lint errors or type failures
# Exit codes: 0 = pass, 2 = block (errors found — teammate should fix)

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

# Get modified JS/TS files (staged + unstaged)
MODIFIED_FILES=$(git -C "$PROJECT_DIR" diff --name-only --diff-filter=ACMR HEAD 2>/dev/null | grep -E '\.(ts|tsx|js|jsx)$' || true)

if [ -z "$MODIFIED_FILES" ]; then
  exit 0
fi

ERRORS=""

# Run ESLint on modified files
ESLINT_BIN="$PROJECT_DIR/node_modules/.bin/eslint"
HAS_ESLINT_CONFIG=false
for cfg in .eslintrc .eslintrc.js .eslintrc.cjs .eslintrc.json .eslintrc.yml eslint.config.js eslint.config.mjs eslint.config.cjs eslint.config.ts; do
  if [ -f "$PROJECT_DIR/$cfg" ]; then
    HAS_ESLINT_CONFIG=true
    break
  fi
done

if [ -x "$ESLINT_BIN" ] && [ "$HAS_ESLINT_CONFIG" = true ]; then
  FILE_ARGS=""
  while IFS= read -r f; do
    FULL_PATH="$PROJECT_DIR/$f"
    if [ -f "$FULL_PATH" ]; then
      FILE_ARGS="$FILE_ARGS $FULL_PATH"
    fi
  done <<< "$MODIFIED_FILES"

  if [ -n "$FILE_ARGS" ]; then
    ESLINT_OUTPUT=$($ESLINT_BIN --no-warn-ignored $FILE_ARGS 2>&1) || {
      ERRORS="${ERRORS}ESLint errors in modified files:\n${ESLINT_OUTPUT}\n\nFix lint errors before going idle.\n\n"
    }
  fi
fi

# Run TypeScript type-check if tsconfig exists
TSC_BIN="$PROJECT_DIR/node_modules/.bin/tsc"
if [ -x "$TSC_BIN" ] && [ -f "$PROJECT_DIR/tsconfig.json" ]; then
  TSC_OUTPUT=$($TSC_BIN --noEmit --pretty 2>&1) || {
    ERRORS="${ERRORS}TypeScript errors:\n${TSC_OUTPUT}\n\nFix type errors before going idle.\n"
  }
fi

if [ -n "$ERRORS" ]; then
  printf '%b' "$ERRORS"
  exit 2
fi

exit 0
