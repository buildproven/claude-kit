#!/usr/bin/env bash
# doc-staleness-check.sh — Pre-push warning for potentially stale documentation
#
# Usage:
#   ./scripts/doc-staleness-check.sh          # Check current branch vs main
#   ./scripts/doc-staleness-check.sh --strict  # Exit 1 on warnings (for CI)
#
# Emits warnings (not errors) when:
#   1. Commands/skills changed but CHANGELOG.md didn't
#   2. Settings/config changed but CHANGELOG.md didn't
#   3. New commands/skills added but help.md wasn't updated
#   4. Scripts changed but no docs updated
#
# Portable: works in any repo. Checks are based on file patterns, not project-specific paths.

set -euo pipefail

STRICT=false
[[ "${1:-}" == "--strict" ]] && STRICT=true

# Ensure git repo
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "Not in a git repo"; exit 1; }
cd "$GIT_ROOT"

# Get changed files vs main (or vs last push if on main)
BRANCH=$(git branch --show-current 2>/dev/null || echo "")
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  CHANGED_FILES=$(git diff --name-only HEAD~1 2>/dev/null || echo "")
else
  BASE=$(git merge-base main HEAD 2>/dev/null || git merge-base master HEAD 2>/dev/null || echo "HEAD~1")
  CHANGED_FILES=$(git diff --name-only "$BASE" HEAD 2>/dev/null || echo "")
fi

[ -z "$CHANGED_FILES" ] && exit 0

WARNINGS=()

# Check 1: Commands or skills changed but CHANGELOG.md didn't
CMD_CHANGED=$(echo "$CHANGED_FILES" | grep -c '^commands/' || true)
SKILL_CHANGED=$(echo "$CHANGED_FILES" | grep -c '^skills/' || true)
CHANGELOG_CHANGED=$(echo "$CHANGED_FILES" | grep -c '^CHANGELOG' || true)

if [ $((CMD_CHANGED + SKILL_CHANGED)) -gt 0 ] && [ "$CHANGELOG_CHANGED" -eq 0 ]; then
  WARNINGS+=("Commands/skills changed but CHANGELOG.md not updated")
fi

# Check 2: Settings or config changed but CHANGELOG.md didn't
CONFIG_CHANGED=$(echo "$CHANGED_FILES" | grep -cE '^config/|^\.husky/|settings\.json' || true)
if [ "$CONFIG_CHANGED" -gt 0 ] && [ "$CHANGELOG_CHANGED" -eq 0 ]; then
  WARNINGS+=("Config/settings changed but CHANGELOG.md not updated")
fi

# Check 3: New commands added but help.md not updated
NEW_CMDS=$(echo "$CHANGED_FILES" | grep '^commands/.*\.md$' || true)
HELP_CHANGED=$(echo "$CHANGED_FILES" | grep -c 'help\.md' || true)
if [ -n "$NEW_CMDS" ] && [ "$HELP_CHANGED" -eq 0 ]; then
  # Only warn for truly new files (not modifications)
  for f in $NEW_CMDS; do
    if ! git show "HEAD~1:$f" >/dev/null 2>&1; then
      WARNINGS+=("New command file $f added but help.md not updated")
    fi
  done
fi

# Check 4: README might be stale (major changes without README update)
TOTAL_CHANGED=$(echo "$CHANGED_FILES" | wc -l | tr -d ' ')
README_CHANGED=$(echo "$CHANGED_FILES" | grep -c '^README' || true)
if [ "$TOTAL_CHANGED" -gt 10 ] && [ "$README_CHANGED" -eq 0 ]; then
  WARNINGS+=("Large changeset (${TOTAL_CHANGED} files) — consider updating README")
fi

# Output warnings
if [ ${#WARNINGS[@]} -gt 0 ]; then
  echo ""
  echo "⚠️  Doc Staleness Warnings:"
  for w in "${WARNINGS[@]}"; do
    echo "   - $w"
  done
  echo ""
  echo "   Run: ./scripts/generate-changelog.sh --apply"
  echo "   Or skip with: DOC_STALENESS_SKIP=1 git push"
  echo ""

  if [ "$STRICT" = true ]; then
    exit 1
  fi
fi

exit 0
