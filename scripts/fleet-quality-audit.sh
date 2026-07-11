#!/bin/bash
# =============================================================================
# Fleet Quality Audit
# =============================================================================
# Discovers every git repo under ~/Projects (or --dir=PATH) and checks the 8
# quality gates across all of them.
#
# USAGE:
#   bash scripts/fleet-quality-audit.sh           # Full audit
#   bash scripts/fleet-quality-audit.sh --json    # JSON output
#   bash scripts/fleet-quality-audit.sh --brief   # Summary only
# =============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

PROJECTS_DIR="${FLEET_PROJECTS_DIR:-$HOME/Projects}"
JSON_MODE=false
BRIEF_MODE=false

for arg in "$@"; do
  case $arg in
    --json) JSON_MODE=true ;;
    --brief) BRIEF_MODE=true ;;
    --dir=*) PROJECTS_DIR="${arg#--dir=}" ;;
  esac
done

# Discover the fleet: every git repo under PROJECTS_DIR, up to 2 levels deep
# (so both ~/Projects/foo and ~/Projects/group/foo are found).
#
# This used to be a hardcoded list of ONE developer's private repos, which is
# useless to anyone else and leaked their project names. Discovery makes the
# script work for whoever runs it. Override the root with --dir=PATH or
# FLEET_PROJECTS_DIR; opt individual repos out with a .no-fleet-audit marker.
PROJECTS=()
while IFS= read -r gitdir; do
  repo="$(dirname "$gitdir")"
  [ -f "$repo/.no-fleet-audit" ] && continue
  PROJECTS+=("${repo#"$PROJECTS_DIR"/}")
done < <(find "$PROJECTS_DIR" -maxdepth 3 -type d -name .git -not -path '*/node_modules/*' 2>/dev/null | sort)

if [ ${#PROJECTS[@]} -eq 0 ]; then
  echo "No git repositories found under $PROJECTS_DIR" >&2
  echo "Set FLEET_PROJECTS_DIR or pass --dir=PATH" >&2
  exit 1
fi

# Gate check functions
check_knip() {
  local dir="$1"
  grep -q '"dead-code"' "$dir/package.json" 2>/dev/null
}

check_patterns() {
  local dir="$1"
  grep -q '"pattern-check"' "$dir/package.json" 2>/dev/null
}

check_complexity() {
  local dir="$1"
  # Check for complexity rule in any eslint config
  local found=false
  for cfg in eslint.config.cjs eslint.config.mjs eslint.config.js .eslintrc.json .eslintrc.js .eslintrc.cjs; do
    if [[ -f "$dir/$cfg" ]] && grep -q "complexity" "$dir/$cfg" 2>/dev/null; then
      found=true
      break
    fi
  done
  $found
}

check_imports() {
  local dir="$1"
  # Check for eslint-plugin-n or import verification
  grep -q '"eslint-plugin-n"\|"n/no-missing-import"' "$dir/package.json" 2>/dev/null || \
  grep -qr "n/no-missing" "$dir"/eslint.config.* 2>/dev/null || \
  grep -qr "eslint-plugin-n" "$dir"/eslint.config.* 2>/dev/null
}

check_pre_push() {
  local dir="$1"
  [[ -f "$dir/.husky/pre-push" ]] && [[ -s "$dir/.husky/pre-push" ]]
}

check_pre_commit() {
  local dir="$1"
  [[ -f "$dir/.husky/pre-commit" ]] && [[ -s "$dir/.husky/pre-commit" ]]
}

check_semgrep() {
  local dir="$1"
  [[ -f "$dir/.semgrep/defensive-patterns.yaml" ]] && \
  grep -q '"security:scan"' "$dir/package.json" 2>/dev/null
}

check_license() {
  local dir="$1"
  grep -q '"license:check"\|"license-checker"' "$dir/package.json" 2>/dev/null
}

# Symbols
pass="${GREEN}✓${NC}"
fail="${RED}✗${NC}"
skip="${DIM}-${NC}"

# Run audit
total_projects=0
total_gates=0
total_passing=0
declare -A project_scores

if [[ "$JSON_MODE" == "false" && "$BRIEF_MODE" == "false" ]]; then
  echo ""
  echo -e "${BOLD}Fleet Quality Audit${NC}"
  echo -e "${DIM}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
  echo ""
  printf "%-25s %5s %5s %5s %5s %5s %5s %5s %5s  %s\n" \
    "PROJECT" "KNIP" "PTRN" "CPLX" "IMPT" "PUSH" "CMIT" "SMGP" "LIC" "SCORE"
  printf "%-25s %5s %5s %5s %5s %5s %5s %5s %5s  %s\n" \
    "-------------------------" "-----" "-----" "-----" "-----" "-----" "-----" "-----" "-----" "-----"
fi

json_results=()

for project in "${PROJECTS[@]}"; do
  dir="$PROJECTS_DIR/$project"

  if [[ ! -d "$dir" ]]; then
    if [[ "$BRIEF_MODE" == "false" && "$JSON_MODE" == "false" ]]; then
      printf "%-25s ${DIM}(not found)${NC}\n" "$project"
    fi
    continue
  fi

  if [[ ! -f "$dir/package.json" ]]; then
    if [[ "$BRIEF_MODE" == "false" && "$JSON_MODE" == "false" ]]; then
      printf "%-25s ${DIM}(no package.json)${NC}\n" "$project"
    fi
    continue
  fi

  total_projects=$((total_projects + 1))
  score=0
  gates=8
  total_gates=$((total_gates + gates))

  results=()

  if check_knip "$dir"; then results+=("$pass"); score=$((score + 1)); else results+=("$fail"); fi
  if check_patterns "$dir"; then results+=("$pass"); score=$((score + 1)); else results+=("$fail"); fi
  if check_complexity "$dir"; then results+=("$pass"); score=$((score + 1)); else results+=("$fail"); fi
  if check_imports "$dir"; then results+=("$pass"); score=$((score + 1)); else results+=("$fail"); fi
  if check_pre_push "$dir"; then results+=("$pass"); score=$((score + 1)); else results+=("$fail"); fi
  if check_pre_commit "$dir"; then results+=("$pass"); score=$((score + 1)); else results+=("$fail"); fi
  if check_semgrep "$dir"; then results+=("$pass"); score=$((score + 1)); else results+=("$fail"); fi
  if check_license "$dir"; then results+=("$pass"); score=$((score + 1)); else results+=("$fail"); fi

  total_passing=$((total_passing + score))
  project_scores[$project]=$score

  if [[ "$JSON_MODE" == "false" && "$BRIEF_MODE" == "false" ]]; then
    score_color="$RED"
    if [[ $score -eq 8 ]]; then score_color="$GREEN"
    elif [[ $score -ge 6 ]]; then score_color="$YELLOW"
    fi

    printf "%-25s %b %b %b %b %b %b %b %b  ${score_color}%d/8${NC}\n" \
      "$project" "${results[0]}" "${results[1]}" "${results[2]}" "${results[3]}" \
      "${results[4]}" "${results[5]}" "${results[6]}" "${results[7]}" "$score"
  fi

  if [[ "$JSON_MODE" == "true" ]]; then
    json_results+=("{\"project\":\"$project\",\"knip\":$(check_knip "$dir" && echo true || echo false),\"patterns\":$(check_patterns "$dir" && echo true || echo false),\"complexity\":$(check_complexity "$dir" && echo true || echo false),\"imports\":$(check_imports "$dir" && echo true || echo false),\"pre_push\":$(check_pre_push "$dir" && echo true || echo false),\"pre_commit\":$(check_pre_commit "$dir" && echo true || echo false),\"semgrep\":$(check_semgrep "$dir" && echo true || echo false),\"license\":$(check_license "$dir" && echo true || echo false),\"score\":$score}")
  fi
done

# Summary
perfect=0
for project in "${!project_scores[@]}"; do
  if [[ ${project_scores[$project]} -eq 8 ]]; then
    perfect=$((perfect + 1))
  fi
done

if [[ "$JSON_MODE" == "true" ]]; then
  echo "{"
  echo "  \"timestamp\": \"$(date -u '+%Y-%m-%dT%H:%M:%SZ')\","
  echo "  \"total_projects\": $total_projects,"
  echo "  \"total_gates\": $total_gates,"
  echo "  \"total_passing\": $total_passing,"
  echo "  \"perfect_projects\": $perfect,"
  echo "  \"score\": \"$total_passing/$total_gates\","
  echo "  \"percentage\": $(( total_gates > 0 ? total_passing * 100 / total_gates : 0 )),"
  echo "  \"projects\": ["
  for i in "${!json_results[@]}"; do
    if [[ $i -lt $((${#json_results[@]} - 1)) ]]; then
      echo "    ${json_results[$i]},"
    else
      echo "    ${json_results[$i]}"
    fi
  done
  echo "  ]"
  echo "}"
else
  echo ""
  echo -e "${BOLD}Summary${NC}"
  echo -e "  Projects audited:  $total_projects"
  echo -e "  Perfect (8/8):     ${GREEN}$perfect${NC}/$total_projects"
  echo -e "  Gates passing:     $total_passing/$total_gates ($(( total_gates > 0 ? total_passing * 100 / total_gates : 0 ))%)"
  echo ""

  if [[ $perfect -eq $total_projects ]]; then
    echo -e "  ${GREEN}${BOLD}All projects at 8/8 gates${NC}"
  else
    echo -e "  ${YELLOW}Projects below 8/8:${NC}"
    for project in $(echo "${!project_scores[@]}" | tr ' ' '\n' | sort); do
      if [[ ${project_scores[$project]} -lt 8 ]]; then
        echo -e "    ${RED}${project}${NC}: ${project_scores[$project]}/8"
      fi
    done
  fi
  echo ""
fi
