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
HEAD_SHA="$(field revisions.currentHead)"
[ -n "$TIER" ] && [ -n "$AGENT_TARGET" ] || {
  echo "quality-select-agents: risk state is unresolved; run quality-risk-resolve first" >&2
  exit 1
}

PANEL=(code-reviewer silent-failure-hunter security-auditor type-design-analyzer \
       pr-test-analyzer code-simplifier accessibility-tester \
       performance-engineer architect-reviewer)
N="$AGENT_TARGET"
[ "$N" -lt 2 ] && N=2
[ "$N" -gt "${#PANEL[@]}" ] && N="${#PANEL[@]}"
AGENTS=("${PANEL[@]:0:$N}")

if [ "$TIER" = critical ]; then
  # Do NOT hard-block here. The authoritative critical gate is
  # quality-authorize-merge.sh, which is the only place that knows whether the
  # base is server-enforceable (ATOMIC_BASE_FRESHNESS) — the signal Phase 0 uses
  # to decide whether a human break-glass is required or clean review suffices.
  # Blocking at selection time would force a human capability even on
  # unprotectable private repos, defeating the policy. The full critical review
  # panel runs regardless; a pre-existing valid capability is merely noted.
  if node "$SCRIPT_DIR/quality-invocation.js" approval-valid "$MANIFEST"; then
    echo "[quality] Pre-existing break-glass approval verified for exact HEAD $HEAD_SHA"
  else
    echo "[quality] Critical tier: no approval yet — running full critical review; the merge gate decides human-capability need by repo enforceability." >&2
  fi
fi

node "$SCRIPT_DIR/quality-invocation.js" agents "$MANIFEST" "${AGENTS[@]}" || exit 1
echo "[quality] Selected ${#AGENTS[@]} agents for tier=$TIER"
