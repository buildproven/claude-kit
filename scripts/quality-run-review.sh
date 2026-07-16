#!/usr/bin/env bash
# Provider-neutral, revision-bound blocking review.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MANIFEST=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --manifest=*) MANIFEST="${1#*=}"; shift ;;
    *) echo "quality-run-review: unknown argument '$1'" >&2; exit 1 ;;
  esac
done
[ -n "$MANIFEST" ] || { echo "quality-run-review: --manifest is required" >&2; exit 1; }

bash "$SCRIPT_DIR/quality-load-root.sh" --manifest "$MANIFEST" >/dev/null || exit 1
field() { node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" "$1"; }
GIT_ROOT="$(field repo.realpath)"
BS_QUALITY_INVOCATION_ID="$(field invocationId)"
BASE_SHA="$(field revisions.baseSha)"
RESOLVED_BASE="$(field revisions.baseRef)"
TIER="$(field risk.tier)"
CODEX_DEPTH="$(field risk.codexDepth)"
CODEX_ROUNDS="$(field risk.codexRounds)"
BS_QUALITY_PRIMARY="$(field provider.primaryOverride)"
BS_QUALITY_FALLBACK="$(field provider.fallbackOverride)"
BS_QUALITY_PROVIDER_CONFIG="$(field provider.config)"
export BS_QUALITY_PRIMARY BS_QUALITY_FALLBACK BS_QUALITY_PROVIDER_CONFIG
cd "$GIT_ROOT" || exit 1
# shellcheck source=quality-provider-policy.sh
source "$SCRIPT_DIR/quality-provider-policy.sh"
# shellcheck source=quality-review-plan.sh
source "$SCRIPT_DIR/quality-review-plan.sh"

REVIEW_INFO="$(node "$SCRIPT_DIR/quality-invocation.js" review-info "$MANIFEST")" || exit 1
REVIEW_ROUND="$(printf '%s' "$REVIEW_INFO" | jq -r '.round')"
REVIEW_DIFF_BASE="$(printf '%s' "$REVIEW_INFO" | jq -r '.from')"
REVIEWED_HEAD="$(printf '%s' "$REVIEW_INFO" | jq -r '.to')"
REVIEW_OUT="$(printf '%s' "$REVIEW_INFO" | jq -r '.artifactDir')"
[ "$REVIEWED_HEAD" = "$(git rev-parse HEAD)" ] || {
  echo "quality-run-review: manifest HEAD changed before review" >&2
  exit 1
}

mkdir -p "$REVIEW_OUT"
git diff "${REVIEW_DIFF_BASE}..${REVIEWED_HEAD}" > "$REVIEW_OUT/diff.txt"
git diff --name-only "${REVIEW_DIFF_BASE}..${REVIEWED_HEAD}" > "$REVIEW_OUT/files.txt"
git log "${REVIEW_DIFF_BASE}..${REVIEWED_HEAD}" --oneline > "$REVIEW_OUT/log.txt"
node "$SCRIPT_DIR/quality-invocation.js" review-identity "$MANIFEST" \
  > "$REVIEW_OUT/identity.json" || exit 1

structured_provider_exhausted() {
  local evidence="$1"
  [ -s "$evidence" ] || return 1
  jq -e '
    .. | objects |
    select(
      (.status? == 429) or
      (.statusCode? == 429) or
      (.code? | tostring | test("^(429|rate_limit|rate_limit_exceeded|resource_exhausted|quota_exhausted)$"; "i")) or
      (.type? | tostring | test("^(rate_limit|rate_limit_error|resource_exhausted|quota_exhausted)$"; "i"))
    )
  ' "$evidence" >/dev/null 2>&1
}

provider_stderr_exhausted() {
  local evidence="$1"
  structured_provider_exhausted "$evidence" && return 0
  grep -Eiq \
    '(^|[^0-9])429([^0-9]|$)|rate[ -]?limit(ed| exceeded)?|quota (exhausted|exceeded)|usage limit' \
    "$evidence" 2>/dev/null
}

record_provider_exhaustion() {
  printf '%s provider exhausted (structured error metadata)\n' "$1" > "$REVIEW_OUT/provider-exhausted"
}

run_claude_review() {
  local agents_csv rc
  command -v claude >/dev/null 2>&1 || return 2
  claude auth status --json 2>/dev/null | jq -e '.loggedIn == true' >/dev/null 2>&1 || return 2
  agents_csv="$(node "$SCRIPT_DIR/quality-invocation.js" get "$MANIFEST" agents \
    | jq -r 'join(",")')"
  [ -n "$agents_csv" ] || { echo "quality: Claude panel unresolved" >&2; return 1; }
  bash "$SCRIPT_DIR/claude-review-companion.sh" \
    --diff-file "$REVIEW_OUT/diff.txt" \
    --files-file "$REVIEW_OUT/files.txt" \
    --log-file "$REVIEW_OUT/log.txt" \
    --identity-file "$REVIEW_OUT/identity.json" \
    --out-dir "$REVIEW_OUT" \
    --agents "$agents_csv" \
    --timeout "$QUALITY_REVIEW_TIMEOUT"
  rc=$?
  return "$rc"
}

run_codex_review() {
  local bounded normalizer schema prompt_file raw_file normalized_file error_file rc pass pass_timeout
  bounded="$SCRIPT_DIR/quality-run-bounded.sh"
  normalizer="$SCRIPT_DIR/quality-normalize-codex-review.sh"
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
    normalized_file="$REVIEW_OUT/codex-${pass}.normalized.json"
    error_file="$REVIEW_OUT/codex-${pass}.stderr"
    prompt_file="$REVIEW_OUT/codex-${pass}.prompt"
    {
      echo "Independent code-review pass $pass/$QUALITY_REVIEW_PASSES. Tier: $QUALITY_REVIEW_TIER. $QUALITY_REVIEW_FOCUS"
      echo "Repository/revision identity (must match every finding):"
      cat "$REVIEW_OUT/identity.json"
      echo "Review ONLY the supplied commit delta. Return structured findings with precise file:line evidence."
      echo "Changed files:"; cat "$REVIEW_OUT/files.txt"
      echo "Commit log:"; cat "$REVIEW_OUT/log.txt"
      echo "Diff:"; cat "$REVIEW_OUT/diff.txt"
    } > "$prompt_file"
    bash "$bounded" --timeout "$pass_timeout" -- \
      codex exec --ephemeral -s read-only \
      -c "model_reasoning_effort=\"$QUALITY_REVIEW_DEPTH\"" \
      --output-schema "$schema" -o "$raw_file" - \
      < "$prompt_file" > "$REVIEW_OUT/codex-${pass}.progress" 2>"$error_file"
    rc=$?
    if [ "$rc" -ne 0 ]; then
      if provider_stderr_exhausted "$error_file"; then
        record_provider_exhaustion Codex
        return 75
      fi
      [ "$rc" -eq 124 ] && return 76
      grep -Eiq 'not authenticated|not logged in|login required|setup required' "$error_file" 2>/dev/null && return 2
      return 1
    fi
    if ! bash "$normalizer" "$raw_file" "$normalized_file"; then
      echo "INCONCLUSIVE: Codex output could not be parsed — human review required" >> "$REVIEW_OUT/codex.findings.txt"
      return 4
    fi
    if ! jq -r '
      if (.findings | length) == 0 then "NO FINDINGS. Verdict: \(.verdict). \(.summary)"
      else .findings[] | "\(.severity // "WARNING"): \(.file // "unknown"):\(.line_start // 0) — \(.title // "finding")\n\(.body // "")\nFix: \(.recommendation // "")"
      end' "$normalized_file" >> "$REVIEW_OUT/codex.findings.txt"; then
      echo "INCONCLUSIVE: normalized Codex findings could not be rendered — human review required" >> "$REVIEW_OUT/codex.findings.txt"
      return 4
    fi
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

if { [ "$PROVIDER_RC" -eq 75 ] || [ "$PROVIDER_RC" -eq 2 ] || [ "$PROVIDER_RC" -eq 76 ]; } \
   && [ "$QUALITY_FALLBACK" != none ]; then
  echo "⚠️  [quality] $QUALITY_PRIMARY unavailable/exhausted/bounded; switching to $QUALITY_FALLBACK." >&2
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

DIFF_SHA="$(shasum -a 256 "$REVIEW_OUT/diff.txt" | awk '{print $1}')"
node "$SCRIPT_DIR/quality-invocation.js" inventory "$MANIFEST" \
  --artifact-dir "$REVIEW_OUT" \
  --provider "$REVIEW_PROVIDER" || exit 1
node "$SCRIPT_DIR/quality-invocation.js" record-review "$MANIFEST" \
  --from "$REVIEW_DIFF_BASE" \
  --to "$REVIEWED_HEAD" \
  --provider "$REVIEW_PROVIDER" \
  --primary "$QUALITY_PRIMARY" \
  --fallback "$QUALITY_FALLBACK" \
  --artifact-dir "$REVIEW_OUT" \
  --diff-sha "$DIFF_SHA" || exit 1

echo "REVIEW_OUT=$REVIEW_OUT"
echo "REVIEW_BASE=$RESOLVED_BASE"
echo "REVIEW_DIFF_BASE=$REVIEW_DIFF_BASE"
echo "REVIEW_PROVIDER=$REVIEW_PROVIDER"
