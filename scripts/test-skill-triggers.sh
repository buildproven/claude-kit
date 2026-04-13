#!/usr/bin/env bash
# CS-109: Auto-Invoke Skill Trigger Testing
# Verifies that auto-invoke skills have matching trigger keywords in their descriptions.
# Run after editing any skill's SKILL.md frontmatter.

set -euo pipefail

SKILLS_DIR="${1:-$(dirname "$0")/../skills}"
PASS=0
FAIL=0

echo "Skill Trigger Verification"
echo "=========================="
echo ""

# Skills that should auto-invoke (have trigger phrases in descriptions)
# Map: skill_name -> required keywords (comma-separated)
declare -A TRIGGER_MAP
TRIGGER_MAP=(
  ["api-conventions"]="API,route,endpoint,REST"
  ["error-handling"]="try/catch,error,catch,validation"
  ["test-strategy"]="test,coverage,function,component"
  ["recover"]="crash,broken,hang,freeze"
  ["cleanup"]="slow,memory,disk,zombie,resource"
)

for skill_dir in "$SKILLS_DIR"/*/; do
  skill_name=$(basename "$skill_dir")
  skill_file="$skill_dir/SKILL.md"

  if [ ! -f "$skill_file" ]; then
    continue
  fi

  # Extract description from frontmatter
  desc=$(awk 'BEGIN{n=0} /^---$/{n++; if(n==2) exit; next} n==1 && /^description:/{sub(/^description:[[:space:]]*/, ""); gsub(/'"'"'/, ""); print}' "$skill_file")

  if [ -z "$desc" ]; then
    echo "  [$skill_name] SKIP - no description in frontmatter"
    continue
  fi

  # Check if this skill has expected triggers
  triggers="${TRIGGER_MAP[$skill_name]:-}"

  if [ -z "$triggers" ]; then
    echo "  [$skill_name] OK - no trigger requirements defined"
    PASS=$((PASS + 1))
    continue
  fi

  # Verify at least one keyword from each group appears in description
  missing=""
  IFS=',' read -ra KEYWORDS <<< "$triggers"
  for kw in "${KEYWORDS[@]}"; do
    kw_trimmed=$(echo "$kw" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    if ! echo "$desc" | grep -qiF "$kw_trimmed"; then
      missing="${missing}${kw_trimmed}, "
    fi
  done

  if [ -n "$missing" ]; then
    missing="${missing%, }"
    echo "  [$skill_name] WARN - description missing keywords: $missing"
    FAIL=$((FAIL + 1))
  else
    echo "  [$skill_name] OK - all trigger keywords present"
    PASS=$((PASS + 1))
  fi
done

echo ""
echo "Summary: $PASS passed, $FAIL warnings"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
