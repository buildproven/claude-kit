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
LEVEL="$(field risk.level)"
[ -n "$LEVEL" ] || LEVEL="$(field options.level)"
RESOLVED_BASE="$(field revisions.baseRef)"
cd "$GIT_ROOT" || exit 1

case "$LEVEL" in
  auto)
    SCORE_JSON="$(node "$SCRIPT_DIR/risk-score.js" --json --base "$RESOLVED_BASE")" || exit 1
    RISK_SCORE="$(printf '%s' "$SCORE_JSON" | jq -r '.riskScore')"
    AGENT_TARGET="$(printf '%s' "$SCORE_JSON" | jq -r '.knobs.agents')"
    CODEX_DEPTH="$(printf '%s' "$SCORE_JSON" | jq -r '.knobs.codex')"
    CODEX_ROUNDS="$(printf '%s' "$SCORE_JSON" | jq -r '.knobs.codexRounds')"
    NATURE="$(printf '%s' "$SCORE_JSON" | jq -r '.changeNature')"
    if [ "$RISK_SCORE" -ge 75 ]; then TIER=critical
    elif [ "$RISK_SCORE" -ge 50 ]; then TIER=high
    elif [ "$RISK_SCORE" -ge 20 ]; then TIER=medium
    else TIER=low
    fi
    ;;
  95)
    TIER=high
    RISK_SCORE=""
    AGENT_TARGET=5
    CODEX_DEPTH=high
    CODEX_ROUNDS=1
    NATURE=explicit-level
    ;;
  98)
    TIER=critical
    RISK_SCORE=""
    AGENT_TARGET=9
    CODEX_DEPTH=xhigh
    CODEX_ROUNDS=2
    NATURE=explicit-level
    ;;
  *)
    echo "quality-risk-resolve: invalid requested level '$LEVEL'" >&2
    exit 1
    ;;
esac

node "$SCRIPT_DIR/quality-invocation.js" risk "$MANIFEST" \
  --tier "$TIER" \
  --score "$RISK_SCORE" \
  --agents "$AGENT_TARGET" \
  --codex-depth "$CODEX_DEPTH" \
  --codex-rounds "$CODEX_ROUNDS" \
  --level "$LEVEL" || exit 1

echo "🧭 Risk: ${RISK_SCORE:-explicit}/100 (${NATURE}) → ${AGENT_TARGET} agents, Codex ${CODEX_DEPTH}×${CODEX_ROUNDS} [${TIER}]"
