#!/usr/bin/env bash
# Shell Script Linter - Encodes testable learnings as automated checks
# Checks scripts/*.sh for known shell pitfalls discovered in past sessions.
# Run standalone or via test-setup.sh.

set -euo pipefail

SETUP_REPO="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
SCRIPTS_DIR="$SETUP_REPO/scripts"
PASS=0
FAIL=0
WARN=0

echo "Shell Script Lint"
echo "================="
echo "Dir: $SCRIPTS_DIR"
echo ""

check_pass() { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
check_fail() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }
check_warn() { echo "  [WARN] $1"; WARN=$((WARN + 1)); }

# --- 1. macOS awk ternary syntax ---
echo "1. Awk Ternary Syntax (macOS incompatible)"

AWK_TERNARY_HITS=$(grep -rn 'awk.*?.*:' "$SCRIPTS_DIR"/*.sh 2>/dev/null | grep -v '^\s*#' | grep -v 'lint-scripts.sh' || true)
if [ -z "$AWK_TERNARY_HITS" ]; then
  check_pass "No awk ternary (?:) patterns found"
else
  check_fail "Awk ternary syntax found (breaks on macOS):"
  echo "$AWK_TERNARY_HITS" | while IFS= read -r line; do
    echo "    $line"
  done
fi

echo ""

# --- 2. xargs without null delimiter ---
echo "2. Xargs Apostrophe Safety"

XARGS_HITS=$(grep -rn '| *xargs' "$SCRIPTS_DIR"/*.sh 2>/dev/null | grep -v '^\s*#' | grep -v '\-0\|-d\|--null\|--delimiter' | grep -v 'lint-scripts.sh' || true)
if [ -z "$XARGS_HITS" ]; then
  check_pass "All xargs calls use -0/-d/--null flag"
else
  check_warn "xargs without -0/-d flag (may break on apostrophes):"
  echo "$XARGS_HITS" | while IFS= read -r line; do
    echo "    $line"
  done
fi

echo ""

# --- 3. Prettier ignores yml/yaml/husky ---
echo "3. Prettier Config Safety"

PRETTIERIGNORE="$SETUP_REPO/.prettierignore"
if [ -f "$PRETTIERIGNORE" ]; then
  MISSING=""
  for pattern in "*.yml" "*.yaml" ".husky"; do
    if ! grep -q "$pattern" "$PRETTIERIGNORE"; then
      MISSING="$MISSING $pattern"
    fi
  done
  if [ -z "$MISSING" ]; then
    check_pass ".prettierignore covers yml/yaml/husky"
  else
    check_fail ".prettierignore missing:$MISSING"
  fi
else
  check_warn ".prettierignore not found"
fi

echo ""

# --- 4. Gitleaks file-level scanning ---
echo "4. Gitleaks Scan Scope"

POST_EDIT_LINT="$SCRIPTS_DIR/post-edit-lint.sh"
if [ -f "$POST_EDIT_LINT" ]; then
  if grep -q 'gitleaks.*--source.*\$FILE' "$POST_EDIT_LINT" 2>/dev/null; then
    check_pass "post-edit-lint.sh uses file-level gitleaks scanning"
  elif grep -q 'gitleaks.*--source' "$POST_EDIT_LINT" 2>/dev/null; then
    check_warn "post-edit-lint.sh uses --source but may scan directories"
  else
    check_fail "post-edit-lint.sh doesn't use --source flag for gitleaks"
  fi
else
  check_warn "post-edit-lint.sh not found"
fi

echo ""

# --- Summary ---
echo "========================="
echo "Results: $PASS passed, $FAIL failed, $WARN warnings"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "Shell pitfalls detected. Fix issues above."
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo "All critical checks passed. Warnings are non-blocking."
  exit 0
else
  echo "All checks passed!"
  exit 0
fi
