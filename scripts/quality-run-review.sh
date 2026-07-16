#!/usr/bin/env bash
# Step 1.8 provider-neutral blocking review. The configured primary runs first;
# the fallback runs only when the primary is unavailable or account-exhausted.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=quality-provider-policy.sh
source "$SCRIPT_DIR/quality-provider-policy.sh"
# shellcheck source=quality-review-plan.sh
source "$SCRIPT_DIR/quality-review-plan.sh"

REVIEW_BASE=""
for ref in origin/main origin/master main master; do
  if git rev-parse --verify --quiet "${ref}^{commit}" >/dev/null 2>&1; then
    REVIEW_BASE="$ref"; break
  fi
done
[ -n "$REVIEW_BASE" ] || { echo "❌ MERGE BLOCKED: no base ref for review diff" >&2; exit 1; }

# First round reviews the branch. Later rounds review only commits made since
# the last successful review, avoiding repeated spend on unchanged commits.
REVIEW_STATE_FILE="${BS_QUALITY_GOVERNOR_FILE:-${TMPDIR:-/tmp}/bs-quality-governor.json}"
REVIEW_STATE_FILE="${REVIEW_STATE_FILE%.json}-last-reviewed.sha"
REVIEW_DIFF_BASE="$REVIEW_BASE"
if [ -s "$REVIEW_STATE_FILE" ]; then
  LAST_REVIEWED="$(sed -n '1p' "$REVIEW_STATE_FILE")"
  if git rev-parse --verify --quiet "${LAST_REVIEWED}^{commit}" >/dev/null 2>&1 \
     && git merge-base --is-ancestor "$LAST_REVIEWED" HEAD \
     && [ "$LAST_REVIEWED" != "$(git rev-parse HEAD)" ]; then
    REVIEW_DIFF_BASE="$LAST_REVIEWED"
    echo "[quality] re-reviewing new commits only: ${LAST_REVIEWED}..HEAD" >&2
  fi
fi

REVIEW_OUT="$(mktemp -d "${TMPDIR:-/tmp}/bs-quality-review.XXXXXX")"
git diff "${REVIEW_DIFF_BASE}..HEAD" > "$REVIEW_OUT/diff.txt"
git diff --name-only "${REVIEW_DIFF_BASE}..HEAD" > "$REVIEW_OUT/files.txt"
git log "${REVIEW_DIFF_BASE}..HEAD" --oneline > "$REVIEW_OUT/log.txt"

provider_exhausted() {
  grep -Eiq '(^|[^0-9])429([^0-9]|$)|weekly (usage )?limit|usage limit|rate.?limit|quota (exceeded|exhausted)|too many requests' "$1" 2>/dev/null
}

record_provider_exhaustion() {
  local provider="$1"; shift
  local detail=""
  for evidence in "$@"; do
    [ -f "$evidence" ] || continue
    detail="$(grep -Ei 'reset|429|weekly (usage )?limit|usage limit|rate.?limit|quota|try again at' "$evidence" | head -1 | tr '\n' ' ')"
    [ -n "$detail" ] && break
  done
  printf '%s provider exhausted%s\n' "$provider" "${detail:+: $detail}" > "$REVIEW_OUT/provider-exhausted"
}

run_claude_review() {
  local companion agents_file agents_csv rc
  companion="$(bs_quality_find_script claude-review-companion.sh)" || return 2
  command -v claude >/dev/null 2>&1 || return 2
  claude auth status --json 2>/dev/null | jq -e '.loggedIn == true' >/dev/null 2>&1 || return 2
  agents_file="${TMPDIR:-/tmp}/bs-quality-agents-${BS_QUALITY_SESSION_ID:-${CLAUDE_CODE_SESSION_ID:-${CODEX_THREAD_ID:-default}}}.txt"
  agents_csv="$(paste -sd, "$agents_file" 2>/dev/null | sed 's/,*$//')"
  [ -n "$agents_csv" ] || { echo "quality: Claude panel unresolved" >&2; return 1; }
  bash "$companion" \
    --diff-file "$REVIEW_OUT/diff.txt" \
    --files-file "$REVIEW_OUT/files.txt" \
    --log-file "$REVIEW_OUT/log.txt" \
    --out-dir "$REVIEW_OUT" \
    --agents "$agents_csv" \
    --timeout "$QUALITY_REVIEW_TIMEOUT"
  rc=$?
  return "$rc"
}

run_codex_review() {
  local bounded schema prompt_file raw_file error_file rc pass pass_timeout
  bounded="$(bs_quality_find_script quality-run-bounded.sh)" || return 2
  schema="$SCRIPT_DIR/schemas/quality-review-output.schema.json"
  [ -f "$schema" ] || return 2
  command -v codex >/dev/null 2>&1 || return 2
  codex login status 2>&1 | grep -q 'Logged in' || return 2

  : > "$REVIEW_OUT/codex.findings.txt"
  pass_timeout=$((QUALITY_REVIEW_TIMEOUT / QUALITY_REVIEW_PASSES))
  [ "$pass_timeout" -ge 30 ] || pass_timeout=30
  pass=1
  while [ "$pass" -le "$QUALITY_REVIEW_PASSES" ]; do
    raw_file="$REVIEW_OUT/codex-${pass}.json"
    error_file="$REVIEW_OUT/codex-${pass}.stderr"
    prompt_file="$REVIEW_OUT/codex-${pass}.prompt"
    {
      echo "Independent code-review pass $pass/$QUALITY_REVIEW_PASSES. Tier: $QUALITY_REVIEW_TIER. $QUALITY_REVIEW_FOCUS"
      echo "Review ONLY the supplied commit delta. Return structured findings with precise file:line evidence."
      echo "Changed files:"; cat "$REVIEW_OUT/files.txt"
      echo "Commit log:"; cat "$REVIEW_OUT/log.txt"
      echo "Diff:"; cat "$REVIEW_OUT/diff.txt"
    } > "$prompt_file"
    bash "$bounded" --timeout "$pass_timeout" -- codex exec --ephemeral -s read-only \
      -c "model_reasoning_effort=\"$QUALITY_REVIEW_DEPTH\"" \
      --output-schema "$schema" -o "$raw_file" - \
      < "$prompt_file" > "$REVIEW_OUT/codex-${pass}.progress" 2>"$error_file"
    rc=$?
    if [ "$rc" -ne 0 ]; then
      if provider_exhausted "$raw_file" || provider_exhausted "$error_file"; then
        record_provider_exhaustion Codex "$raw_file" "$error_file"
        return 75
      fi
      [ "$rc" -eq 124 ] && return 76
      grep -Eiq 'not authenticated|not logged in|login required|setup required' "$error_file" 2>/dev/null && return 2
      return 1
    fi
    if ! jq -e '.findings | type == "array"' "$raw_file" >/dev/null 2>&1; then
      echo "INCONCLUSIVE: Codex output could not be parsed — human review required" >> "$REVIEW_OUT/codex.findings.txt"
      return 4
    fi
    jq -r '
      if (.findings | length) == 0 then "NO FINDINGS. Verdict: \(.verdict). \(.summary)"
      else .findings[] | "\(.severity // "WARNING"): \(.file // "unknown"):\(.line_start // 0) — \(.title // "finding")\n\(.body // "")\nFix: \(.recommendation // "")"
      end' "$raw_file" >> "$REVIEW_OUT/codex.findings.txt"
    pass=$((pass + 1))
  done
}

run_provider() {
  case "$1" in
    claude) run_claude_review ;;
    codex) run_codex_review ;;
    *) return 2 ;;
  esac
}

REVIEW_PROVIDER="$QUALITY_PRIMARY"
echo "[quality] reviewer policy: primary=$QUALITY_PRIMARY fallback=$QUALITY_FALLBACK" >&2
run_provider "$QUALITY_PRIMARY"
PROVIDER_RC=$?

if { [ "$PROVIDER_RC" -eq 75 ] || [ "$PROVIDER_RC" -eq 2 ] || [ "$PROVIDER_RC" -eq 76 ]; } && [ "$QUALITY_FALLBACK" != none ]; then
  if [ "$PROVIDER_RC" -eq 75 ]; then
    DETAIL="$(cat "$REVIEW_OUT/provider-exhausted" 2>/dev/null || true)"
    echo "⚠️  [quality] $QUALITY_PRIMARY exhausted${DETAIL:+ — $DETAIL}; switching immediately to $QUALITY_FALLBACK." >&2
  elif [ "$PROVIDER_RC" -eq 2 ]; then
    echo "⚠️  [quality] $QUALITY_PRIMARY unavailable; switching immediately to $QUALITY_FALLBACK." >&2
  else
    echo "⚠️  [quality] $QUALITY_PRIMARY exceeded its ${QUALITY_REVIEW_TIMEOUT}s review budget and was cancelled; switching to $QUALITY_FALLBACK." >&2
  fi
  # Preserve failed-primary evidence without feeding its INCONCLUSIVE files
  # into synthesis after the fallback succeeds.
  mkdir -p "$REVIEW_OUT/failed-primary"
  for evidence in "$REVIEW_OUT"/*.findings.txt "$REVIEW_OUT"/*.stderr; do
    [ -e "$evidence" ] && mv "$evidence" "$REVIEW_OUT/failed-primary/"
  done
  REVIEW_PROVIDER="$QUALITY_FALLBACK"
  run_provider "$QUALITY_FALLBACK"
  PROVIDER_RC=$?
fi

if [ "$PROVIDER_RC" -ne 0 ]; then
  case "$PROVIDER_RC" in
    75) echo "❌ MERGE BLOCKED: $REVIEW_PROVIDER account quota exhausted and no usable fallback is configured." >&2 ;;
    2) echo "❌ MERGE BLOCKED: $REVIEW_PROVIDER CLI unavailable and no usable fallback is configured." >&2 ;;
    76) echo "❌ MERGE BLOCKED: $REVIEW_PROVIDER exceeded its bounded review budget and no usable fallback is configured." >&2 ;;
    4) echo "❌ MERGE BLOCKED: every $REVIEW_PROVIDER review was inconclusive." >&2 ;;
    *) echo "❌ MERGE BLOCKED: $REVIEW_PROVIDER review runner failed (rc=$PROVIDER_RC)." >&2 ;;
  esac
  exit 1
fi

printf '%s\n' "$(git rev-parse HEAD)" > "$REVIEW_STATE_FILE"
REVIEWED_HEAD="$(git rev-parse HEAD)"
REVIEWED_BASE="$(git merge-base HEAD "$REVIEW_BASE")"
cat > "${BS_QUALITY_ROOT_FILE%.txt}-reviewstate.env" <<EOF
REVIEWED_HEAD='$REVIEWED_HEAD'
REVIEWED_BASE='$REVIEWED_BASE'
RESOLVED_BASE='$REVIEW_BASE'
REVIEW_PROVIDER='$REVIEW_PROVIDER'
QUALITY_PRIMARY='$QUALITY_PRIMARY'
QUALITY_FALLBACK='$QUALITY_FALLBACK'
EOF
export REVIEW_OUT REVIEW_BASE REVIEW_DIFF_BASE REVIEW_PROVIDER QUALITY_PRIMARY QUALITY_FALLBACK
echo "REVIEW_OUT=$REVIEW_OUT"
echo "REVIEW_BASE=$REVIEW_BASE"
echo "REVIEW_DIFF_BASE=$REVIEW_DIFF_BASE"
echo "REVIEW_PROVIDER=$REVIEW_PROVIDER"
