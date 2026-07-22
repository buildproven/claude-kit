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

PANEL=(code-reviewer silent-failure-hunter security-auditor type-design-analyzer \
       pr-test-analyzer code-simplifier accessibility-tester \
       performance-engineer architect-reviewer)
N="$AGENT_TARGET"
[ "$N" -lt 2 ] && N=2
[ "$N" -gt "${#PANEL[@]}" ] && N="${#PANEL[@]}"
AGENTS=("${PANEL[@]:0:$N}")

MERGE_AUTHORITY="$(field risk.mergeAuthority)"
# Older manifests lack the field and preserve their established manual
# governance behavior. New campaigns always persist one explicit authority.
[ -n "$MERGE_AUTHORITY" ] || MERGE_AUTHORITY=human-required
if [ "$TIER" = critical ] && [ "$MERGE_AUTHORITY" = autonomous ]; then
  echo "[quality] Critical tier: autonomous merge authority; running full critical review." >&2
fi

node "$SCRIPT_DIR/quality-invocation.js" agents "$MANIFEST" "${AGENTS[@]}" || exit 1
echo "[quality] Selected ${#AGENTS[@]} agents for tier=$TIER"
