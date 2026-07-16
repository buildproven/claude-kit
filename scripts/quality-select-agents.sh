#!/usr/bin/env bash
# quality-select-agents.sh — Step 1.8 panel construction for the quality
# skill. Resolves which review agents run this pass from the risk score (or
# tier/level fallback) and persists the panel to a sentinel file, since bash
# arrays do not survive across the quality skill's fenced bash blocks.
#
# Must be `source`d from a context that already has GIT_ROOT, TIER, LEVEL,
# and (optionally) AGENT_TARGET set (see quality-risk-resolve.sh). Sets
# AGENTS (array) and REQUIRE_BREAK_GLASS in the caller's shell, and writes
# the panel to $TMPDIR/bs-quality-agents-<session>.txt.
set -u

# The review panel in PRIORITY ORDER. The risk score selects the first N from
# this list; the always-on floor (first 2) means no change merges with zero
# review (machine-only: there is no human backstop).
# Every name here MUST resolve to a real agent .md (kit agents/ or the
# pr-review-toolkit plugin) — the subprocess review runner marks an
# unresolvable agent INCONCLUSIVE, which blocks --merge. `test-generator` was
# removed 2026-07-01: it has no agent file anywhere and would permanently
# block high/critical merges; pr-test-analyzer covers test quality.
PANEL=(code-reviewer silent-failure-hunter security-auditor type-design-analyzer \
       pr-test-analyzer code-simplifier accessibility-tester \
       performance-engineer architect-reviewer)

if [ -n "${AGENT_TARGET:-}" ]; then
  # Score-driven (primary path). Take the first AGENT_TARGET agents from PANEL.
  N=$AGENT_TARGET
  [ "$N" -lt 2 ] && N=2          # floor: always >=2 (code-reviewer + silent-failure-hunter)
  [ "$N" -gt ${#PANEL[@]} ] && N=${#PANEL[@]}
  AGENTS=("${PANEL[@]:0:$N}")
  [ "$TIER" = critical ] && REQUIRE_BREAK_GLASS=true
  echo "[quality] Running ${#AGENTS[@]} agents — risk score ${RISK_SCORE:-n/a}/100 (label ${TIER:-n/a})"
else
  # Fallback: discrete tier/level selection (no scorer available).
  case "${TIER:-$LEVEL}" in
    low)        AGENTS=(code-reviewer silent-failure-hunter) ;;
    medium)     AGENTS=(code-reviewer silent-failure-hunter type-design-analyzer security-auditor) ;;
    high|95)    AGENTS=(code-reviewer silent-failure-hunter type-design-analyzer security-auditor \
                        pr-test-analyzer) ;;
    critical)   AGENTS=(code-reviewer silent-failure-hunter type-design-analyzer security-auditor \
                        pr-test-analyzer)
                REQUIRE_BREAK_GLASS=true ;;
    98)         AGENTS=(code-reviewer silent-failure-hunter type-design-analyzer security-auditor \
                        pr-test-analyzer code-simplifier accessibility-tester \
                        performance-engineer architect-reviewer) ;;
    *)          echo "❌ Unknown tier/level: ${TIER:-$LEVEL}"; exit 1 ;;
  esac
  echo "[quality] Running ${#AGENTS[@]} agents for tier=${TIER:-n/a} level=${LEVEL:-n/a}"
fi

# Persist the resolved panel to a sentinel so the LATER companion block can
# read it — bash arrays do NOT survive across separate fenced bash blocks.
printf '%s\n' "${AGENTS[@]}" > "${TMPDIR:-/tmp}/bs-quality-agents-${BS_QUALITY_SESSION_ID:-${CLAUDE_CODE_SESSION_ID:-${CODEX_THREAD_ID:-default}}}.txt"

# Break-glass approval (critical tier only): critical-tier changes (per
# harness-config.json:mergePolicy.critical.requiredChecks) require explicit
# human approval before review stamping. The skill cannot self-authorize
# critical merges.
if [ "${REQUIRE_BREAK_GLASS:-false}" = true ]; then
  if [ "${BREAK_GLASS_APPROVED:-}" != true ] && \
     ! git log "${RESOLVED_BASE:-origin/main}..HEAD" --format=%B | grep -q "^Break-Glass-Approval: "; then
    echo "❌ MERGE BLOCKED: critical tier requires explicit break-glass approval."
    echo "   Either set BREAK_GLASS_APPROVED=true in the environment for this run,"
    echo "   or add a 'Break-Glass-Approval: <approver-handle>' trailer to a commit on this branch."
    echo "   See harness-config.json:mergePolicy.critical.requiredChecks."
    exit 1
  fi
  echo "[quality] Break-glass approval verified for critical tier"
fi
