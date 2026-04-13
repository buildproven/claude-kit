#!/usr/bin/env bash
# PostToolUse hook for Write|Edit — runs gitleaks + eslint on changed files
# Target: < 3 seconds total execution time
# Exit codes: 0 = pass (or skip), 2 = block (secrets/lint errors found)

set -euo pipefail

# Read hook JSON from stdin
INPUT=$(cat)

# Extract file path from tool_input (prefer jq, fallback to grep)
if command -v jq &>/dev/null; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
else
  FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only process JS/TS files
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx) ;;
  *) exit 0 ;;
esac

# Check file exists
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

PROJECT_DIR=$(dirname "$FILE_PATH")
# Walk up to find project root (has package.json)
while [ "$PROJECT_DIR" != "/" ] && [ ! -f "$PROJECT_DIR/package.json" ]; do
  PROJECT_DIR=$(dirname "$PROJECT_DIR")
done

ERRORS=""

# --- gitleaks: check for secrets ---
if command -v gitleaks &>/dev/null; then
  GITLEAKS_OUTPUT=$(gitleaks detect --no-git --source "$FILE_PATH" 2>&1)
  GITLEAKS_EXIT=$?
  if [ $GITLEAKS_EXIT -ne 0 ]; then
    if echo "$GITLEAKS_OUTPUT" | grep -q "leaks found"; then
      ERRORS="${ERRORS}Secrets detected by gitleaks in $FILE_PATH:\n${GITLEAKS_OUTPUT}\n\nRemove secrets before continuing.\n\n"
    else
      ERRORS="${ERRORS}gitleaks scan failed (exit $GITLEAKS_EXIT) for $FILE_PATH:\n${GITLEAKS_OUTPUT}\n\nInvestigate before continuing.\n\n"
    fi
  fi
fi

# --- eslint: lint the file ---
if [ "$PROJECT_DIR" != "/" ]; then
  ESLINT_BIN="$PROJECT_DIR/node_modules/.bin/eslint"
  # Check for eslint binary and any eslint config
  HAS_CONFIG=false
  for cfg in .eslintrc .eslintrc.js .eslintrc.cjs .eslintrc.json .eslintrc.yml eslint.config.js eslint.config.mjs eslint.config.cjs eslint.config.ts; do
    if [ -f "$PROJECT_DIR/$cfg" ]; then
      HAS_CONFIG=true
      break
    fi
  done

  if [ -x "$ESLINT_BIN" ] && [ "$HAS_CONFIG" = true ]; then
    ESLINT_OUTPUT=$("$ESLINT_BIN" --no-warn-ignored "$FILE_PATH" 2>&1) || {
      ERRORS="${ERRORS}ESLint errors in $FILE_PATH:\n${ESLINT_OUTPUT}\n\nFix these lint errors before continuing.\n"
    }
  fi
fi

# Report results
if [ -n "$ERRORS" ]; then
  printf '%b' "$ERRORS"
  exit 2
fi

exit 0
