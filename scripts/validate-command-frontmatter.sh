#!/usr/bin/env bash
# CS-114: Validate command frontmatter
# Ensures all commands have required frontmatter fields (name, description, category).
# Run as part of pre-commit or setup validation.

set -euo pipefail

COMMANDS_DIR="${1:-$(dirname "$0")/../commands}"
PASS=0
FAIL=0

echo "Command Frontmatter Validation"
echo "==============================="
echo ""

for cmd_file in "$COMMANDS_DIR"/**/*.md; do
  [ -f "$cmd_file" ] || continue
  rel_path="${cmd_file#$COMMANDS_DIR/}"

  # Extract frontmatter
  has_fm=$(awk 'BEGIN{n=0} /^---$/{n++} END{if(n>1) print "yes"; else print "no"}' "$cmd_file")
  if [ "$has_fm" != "yes" ]; then
    echo "  [FAIL] $rel_path - missing frontmatter"
    FAIL=$((FAIL + 1))
    continue
  fi

  name=$(awk 'BEGIN{n=0} /^---$/{n++; if(n==2) exit; next} n==1 && /^name:/{sub(/^name:[[:space:]]*/, ""); gsub(/['"'"'"]/, ""); print}' "$cmd_file")
  desc=$(awk 'BEGIN{n=0} /^---$/{n++; if(n==2) exit; next} n==1 && /^description:/{print "yes"}' "$cmd_file")
  cat=$(awk 'BEGIN{n=0} /^---$/{n++; if(n==2) exit; next} n==1 && /^category:/{print "yes"}' "$cmd_file")

  issues=""
  [ -z "$name" ] && issues="${issues}name, "
  [ "$desc" != "yes" ] && issues="${issues}description, "
  [ "$cat" != "yes" ] && issues="${issues}category, "

  if [ -n "$issues" ]; then
    issues="${issues%, }"
    echo "  [FAIL] $rel_path - missing: $issues"
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
done

echo ""
echo "Summary: $PASS valid, $FAIL issues"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Fix: Add frontmatter block to each file:"
  echo "  ---"
  echo "  name: prefix:command-name"
  echo "  description: 'What the command does'"
  echo "  category: development"
  echo "  ---"
  exit 1
fi
exit 0
