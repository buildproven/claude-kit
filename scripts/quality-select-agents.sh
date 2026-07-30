#!/usr/bin/env bash
# Select the review panel from the manifest's resolved risk contract.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MANIFEST=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --manifest=*) MANIFEST="${1#*=}"; shift ;;
    *) echo "quality-select-agents: unknown argument '$1'" >&2; exit 1 ;;
  esac
done
[ -n "$MANIFEST" ] || { echo "quality-select-agents: --manifest is required" >&2; exit 1; }

bash "$SCRIPT_DIR/quality-load-root.sh" --manifest "$MANIFEST" >/dev/null || exit 1
field() { node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" "$1"; }
TIER="$(field risk.tier)"
AGENT_TARGET="$(field risk.agentTarget)"
[ -n "$TIER" ] && [ -n "$AGENT_TARGET" ] || {
  echo "quality-select-agents: risk state is unresolved; run quality-risk-resolve first" >&2
  exit 1
}

# The first six positions are all read-only review roles with compatible
# evidence output. code-simplifier is an implementation agent, not a review
# agent, so reserve it for the broader advisory panel rather than selecting it
# for ordinary high-tier review.
PANEL=(code-reviewer silent-failure-hunter security-auditor type-design-analyzer \
       pr-test-analyzer architect-reviewer code-simplifier \
       accessibility-tester performance-engineer)
N="$AGENT_TARGET"
# setRisk owns the 2..9 target invariant. Retain this boundary check so older
# or tampered manifests fail visibly instead of silently truncating coverage.
[ "$N" -le "${#PANEL[@]}" ] || {
  echo "quality-select-agents: resolved target $N exceeds supported ${#PANEL[@]}-agent panel" >&2
  exit 1
}
AGENTS=("${PANEL[@]:0:$N}")
PANEL_INCOMPLETE=false

# A merge-train may deliberately reserve only part of a non-critical Claude
# panel from its shared batch budget. The required panel remains in the risk
# contract; this selected subset is persisted as incomplete and can never
# authorize a merge as if it were the full panel.
if [ -n "${BS_QUALITY_PANEL_AGENTS:-}" ]; then
  case "$BS_QUALITY_PANEL_AGENTS" in
    *[!0-9]*|"")
      echo "quality-select-agents: BS_QUALITY_PANEL_AGENTS must be a positive integer" >&2
      exit 1
      ;;
  esac
  if [ "$BS_QUALITY_PANEL_AGENTS" -lt 2 ] || [ "$BS_QUALITY_PANEL_AGENTS" -gt "$N" ]; then
    echo "quality-select-agents: requested panel must be between 2 and $N agents" >&2
    exit 1
  fi
  if [ "$TIER" = critical ] && [ "$BS_QUALITY_PANEL_AGENTS" -lt "$N" ]; then
    echo "quality-select-agents: critical reviews require the full $N-agent panel" >&2
    exit 1
  fi
  if [ "$BS_QUALITY_PANEL_AGENTS" -lt "$N" ]; then
    AGENTS=("${PANEL[@]:0:$BS_QUALITY_PANEL_AGENTS}")
    PANEL_INCOMPLETE=true
    echo "⚠️  [quality] Deliberately reduced Claude panel: ${#AGENTS[@]}/$N agents (incomplete; cannot authorize merge)." >&2
  fi
fi

MERGE_AUTHORITY="$(field risk.mergeAuthority)"
# Older manifests lack the field and preserve their established manual
# governance behavior. New campaigns always persist one explicit authority.
[ -n "$MERGE_AUTHORITY" ] || MERGE_AUTHORITY=human-required
if [ "$TIER" = critical ] && [ "$MERGE_AUTHORITY" = autonomous ]; then
  echo "[quality] Critical tier: autonomous merge authority; running full critical review." >&2
fi

if [ "$PANEL_INCOMPLETE" = true ]; then
  node "$SCRIPT_DIR/quality-invocation.js" agents "$MANIFEST" "${AGENTS[@]}" --incomplete || exit 1
else
  node "$SCRIPT_DIR/quality-invocation.js" agents "$MANIFEST" "${AGENTS[@]}" || exit 1
fi
echo "[quality] Selected ${#AGENTS[@]}/$N agents for tier=$TIER (incomplete=$PANEL_INCOMPLETE)"
