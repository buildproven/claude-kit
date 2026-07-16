#!/usr/bin/env bash
# Resolve risk into the authoritative invocation manifest.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MANIFEST=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --manifest=*) MANIFEST="${1#*=}"; shift ;;
    *) echo "quality-risk-resolve: unknown argument '$1'" >&2; exit 1 ;;
  esac
done
[ -n "$MANIFEST" ] || { echo "quality-risk-resolve: --manifest is required" >&2; exit 1; }

bash "$SCRIPT_DIR/quality-load-root.sh" --manifest "$MANIFEST" >/dev/null || exit 1
field() { node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" "$1"; }
GIT_ROOT="$(field repo.realpath)"
if [ "$(field risk.resolved)" = true ]; then
  echo "🧭 Risk: preserving persisted invocation contract for resumed HEAD $(field revisions.currentHead)"
  exit 0
fi
LEVEL="$(field risk.level)"
[ -n "$LEVEL" ] || LEVEL="$(field options.level)"
RESOLVED_BASE="$(field revisions.baseRef)"
cd "$GIT_ROOT" || exit 1

case "$LEVEL" in
  auto) MINIMUM_RISK=0 ;;
  95) MINIMUM_RISK=50 ;;
  98) MINIMUM_RISK=75 ;;
  *)
    echo "quality-risk-resolve: invalid requested level '$LEVEL'" >&2
    exit 1
    ;;
esac

PLAN_JSON="$(node "$SCRIPT_DIR/quality-runtime-plan.js" \
  --base "$RESOLVED_BASE" --minimum-risk "$MINIMUM_RISK")" || exit 1
RISK_SCORE="$(printf '%s' "$PLAN_JSON" | jq -r '.riskScore')"
TIER="$(printf '%s' "$PLAN_JSON" | jq -r '.tier')"
AGENT_TARGET="$(printf '%s' "$PLAN_JSON" | jq -r '.agents')"
CODEX_DEPTH="$(printf '%s' "$PLAN_JSON" | jq -r '.reviewDepth')"
CODEX_ROUNDS="$(printf '%s' "$PLAN_JSON" | jq -r '.reviewPasses')"
NATURE="$(printf '%s' "$PLAN_JSON" | jq -r '.changeNature')"

node "$SCRIPT_DIR/quality-invocation.js" risk "$MANIFEST" \
  --tier "$TIER" \
  --score "$RISK_SCORE" \
  --agents "$AGENT_TARGET" \
  --codex-depth "$CODEX_DEPTH" \
  --codex-rounds "$CODEX_ROUNDS" \
  --workload "$(printf '%s' "$PLAN_JSON" | jq -r '.workload')" \
  --workload-units "$(printf '%s' "$PLAN_JSON" | jq -r '.workloadUnits')" \
  --diff-files "$(printf '%s' "$PLAN_JSON" | jq -r '.diffStats.files')" \
  --diff-lines "$(printf '%s' "$PLAN_JSON" | jq -r '.diffStats.lines')" \
  --campaign-seconds "$(printf '%s' "$PLAN_JSON" | jq -r '.campaignSeconds')" \
  --review-seconds "$(printf '%s' "$PLAN_JSON" | jq -r '.reviewSeconds')" \
  --verification-seconds "$(printf '%s' "$PLAN_JSON" | jq -r '.verificationSeconds')" \
  --gate-seconds "$(printf '%s' "$PLAN_JSON" | jq -r '.gateSeconds')" \
  --max-review-rounds "$(printf '%s' "$PLAN_JSON" | jq -r '.maxReviewRounds')" \
  --max-fix-commits "$(printf '%s' "$PLAN_JSON" | jq -r '.maxFixCommits')" \
  --level "$LEVEL" || exit 1

echo "🧭 Risk: ${RISK_SCORE}/100 (${NATURE}), $(printf '%s' "$PLAN_JSON" | jq -r '"\(.workload): \(.diffStats.files) files/\(.diffStats.lines) lines"') → ${AGENT_TARGET} agents, Codex ${CODEX_DEPTH}×${CODEX_ROUNDS} [${TIER}], $(printf '%s' "$PLAN_JSON" | jq -r '.campaignSeconds')s campaign"
