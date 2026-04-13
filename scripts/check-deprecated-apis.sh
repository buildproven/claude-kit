#!/usr/bin/env bash
#
# check-deprecated-apis.sh — Scan for deprecated SDK imports, outdated model
# references, and stale API versions. Usable standalone or by /bs:sentry fleet audits.
#
# Usage:
#   ./scripts/check-deprecated-apis.sh [DIR]
#   DIR defaults to the current directory.
#
# Exit codes:
#   0  — no issues found
#   1  — deprecated APIs or models detected

set -euo pipefail

SCAN_DIR="${1:-.}"
ISSUES=0
FINDINGS=""

add_finding() {
  local severity="$1" file="$2" line="$3" msg="$4"
  FINDINGS="${FINDINGS}  [${severity}] ${file}:${line} — ${msg}\n"
  ISSUES=$((ISSUES + 1))
}

FIND_EXCLUDES="-not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/__pycache__/*' -not -path '*/.venv/*' -not -path '*/dist/*' -not -path '*/.claude/*' -not -path '*/build/*'"

# ---------- 1. Deprecated Python imports ----------

while IFS= read -r -d '' pyfile; do
  rel="${pyfile#"$SCAN_DIR"/}"

  # google.generativeai -> google.genai
  while IFS=: read -r num line; do
    [ -z "$num" ] && continue
    add_finding "HIGH" "$rel" "$num" "Deprecated import: google.generativeai (use google.genai)"
  done < <(grep -n 'import google\.generativeai\|from google\.generativeai' "$pyfile" 2>/dev/null || true)

  # model="dall-e-3" in Python
  while IFS=: read -r num line; do
    [ -z "$num" ] && continue
    add_finding "HIGH" "$rel" "$num" "Deprecated model: dall-e-3 (use gpt-image-1.5)"
  done < <(grep -n 'model.*=.*["'"'"']dall-e-3["'"'"']' "$pyfile" 2>/dev/null || true)

done < <(find "$SCAN_DIR" -name '*.py' -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/__pycache__/*' -not -path '*/.venv/*' -not -path '*/dist/*' -not -path '*/.claude/*' -not -path '*/build/*' -print0 2>/dev/null)

# ---------- 2. Outdated model references (all code + config files) ----------

OUTDATED_MODELS=(
  '"imagen-3"|Outdated model: imagen-3 (replaced by imagen-4)'
  '"gemini-2.0-flash-exp"|Outdated model: gemini-2.0-flash-exp (deprecated)'
)

while IFS= read -r -d '' codefile; do
  rel="${codefile#"$SCAN_DIR"/}"

  # Skip lock files and this script
  case "$rel" in
    *uv.lock*|*package-lock*|*node_modules*|*check-deprecated-apis.sh*|*sota-score.js*) continue ;;
  esac

  for entry in "${OUTDATED_MODELS[@]}"; do
    pattern="${entry%%|*}"
    msg="${entry##*|}"
    while IFS=: read -r num line; do
      [ -z "$num" ] && continue
      add_finding "MEDIUM" "$rel" "$num" "$msg"
    done < <(grep -n "$pattern" "$codefile" 2>/dev/null || true)
  done

  # dall-e-3 in non-Python files (Python handled above)
  if [[ ! "$codefile" == *.py ]]; then
    while IFS=: read -r num line; do
      [ -z "$num" ] && continue
      add_finding "MEDIUM" "$rel" "$num" "Outdated model: dall-e-3 (replaced by gpt-image-1.5)"
    done < <(grep -n 'model.*["'"'"']dall-e-3["'"'"']' "$codefile" 2>/dev/null || true)
  fi

done < <(find "$SCAN_DIR" \( -name '*.py' -o -name '*.js' -o -name '*.ts' -o -name '*.json' -o -name '*.md' -o -name '*.yaml' -o -name '*.yml' -o -name '*.sh' \) -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.venv/*' -not -path '*/dist/*' -not -path '*/.claude/*' -not -path '*/build/*' -print0 2>/dev/null)

# ---------- 3. Stale API versions (YYYY-MM or YYYYMM in strings, >12 months old) ----------

CURRENT_YEAR=$(date +%Y)
CURRENT_MONTH=$(date +%m)

while IFS= read -r -d '' codefile; do
  rel="${codefile#"$SCAN_DIR"/}"
  case "$rel" in
    *uv.lock*|*package-lock*|*node_modules*|*check-deprecated-apis.sh*|*sota-score.js*) continue ;;
  esac

  while IFS=: read -r num line; do
    [ -z "$num" ] && continue
    version=$(echo "$line" | grep -oE '["'"'"'][0-9]{4}[-_]?[0-9]{2}([-_][0-9]{2})?["'"'"']' | head -1 || true)
    [ -z "$version" ] && continue
    year=$(echo "$version" | grep -oE '[0-9]{4}' | head -1)
    month=$(echo "$version" | grep -oE '[0-9]{2}' | tail -1)
    [ "$year" -lt 2020 ] 2>/dev/null && continue
    [ "$year" -gt 2030 ] 2>/dev/null && continue
    [ "$month" -lt 1 ] 2>/dev/null && continue
    [ "$month" -gt 12 ] 2>/dev/null && continue
    age_months=$(( (CURRENT_YEAR - year) * 12 + (10#$CURRENT_MONTH - 10#$month) ))
    if [ "$age_months" -gt 12 ]; then
      add_finding "MEDIUM" "$rel" "$num" "Possibly stale API version: ${version} (${age_months} months old)"
    fi
  done < <(grep -nE '["'"'"'][0-9]{4}[-_]?[0-9]{2}([-_][0-9]{2})?["'"'"']' "$codefile" 2>/dev/null || true)

done < <(find "$SCAN_DIR" \( -name '*.py' -o -name '*.js' \) -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.venv/*' -not -path '*/dist/*' -not -path '*/.claude/*' -not -path '*/build/*' -print0 2>/dev/null)

# ---------- Output ----------

echo "=== Deprecated API / SDK Scan ==="
echo "Directory: $(cd "$SCAN_DIR" && pwd)"
echo ""

if [ "$ISSUES" -eq 0 ]; then
  echo "No deprecated APIs, outdated models, or stale versions found."
  echo ""
  echo "Score: 10/10"
  exit 0
else
  echo "Found $ISSUES issue(s):"
  echo ""
  echo -e "$FINDINGS"

  HIGH_COUNT=$(echo -e "$FINDINGS" | grep -c '\[HIGH\]' || true)
  MEDIUM_COUNT=$(echo -e "$FINDINGS" | grep -c '\[MEDIUM\]' || true)
  DEDUCTION=$((HIGH_COUNT * 3 + MEDIUM_COUNT * 1))
  SCORE=$((10 - DEDUCTION))
  [ "$SCORE" -lt 0 ] && SCORE=0

  echo "Score: ${SCORE}/10 (${HIGH_COUNT} high, ${MEDIUM_COUNT} medium)"
  exit 1
fi
