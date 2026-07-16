#!/usr/bin/env bash
# quality-risk-resolve.sh — Step 0.5 of the quality skill: resolve review
# depth from the kit-native risk scorer (or fall back to a legacy per-repo
# gate, or L95).
#
# Must be `source`d (not invoked) from a context that already has $LEVEL set
# and has sourced quality-load-root.sh — it sets these variables in the
# caller's shell: TIER, RISK_SCORE, AGENT_TARGET, CODEX_DEPTH, CODEX_ROUNDS,
# LEVEL (possibly overwritten to 95 on total fallback).
#
# Resolution order for "how deep should this review be?":
#   1. Kit-native risk score (scripts/risk-score.js) — works in EVERY repo
#      with no per-repo setup; computes a 0-100 score from `git diff` and
#      emits the three depth knobs (agents, codex effort, codex rounds).
#   2. Per-repo risk-policy-gate.js tier (legacy) — only if the scorer is
#      absent but a repo gate exists.
#   3. L95 — last resort if neither is available.
set -u

TIER=""
RISK_SCORE=""
AGENT_TARGET=""
CODEX_DEPTH=""     # skip|medium|high|xhigh
CODEX_ROUNDS=""

if [ "${LEVEL:-auto}" = "auto" ]; then
  RISK_SCORER="$(bs_quality_find_script risk-score.js 2>/dev/null || true)"

  if [ -n "$RISK_SCORER" ]; then
    SCORE_JSON=$(node "$RISK_SCORER" --json 2>/dev/null)
    RISK_SCORE=$(printf '%s' "$SCORE_JSON" | node -e 'try{const r=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(r.riskScore))}catch{}' 2>/dev/null)
    if [ -n "$RISK_SCORE" ]; then
      AGENT_TARGET=$(printf '%s' "$SCORE_JSON" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(r.knobs.agents))')
      CODEX_DEPTH=$(printf '%s' "$SCORE_JSON" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(r.knobs.codex))')
      CODEX_ROUNDS=$(printf '%s' "$SCORE_JSON" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(r.knobs.codexRounds))')
      NATURE=$(printf '%s' "$SCORE_JSON" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(r.changeNature))')
      if [ "$RISK_SCORE" -ge 75 ]; then TIER=critical
      elif [ "$RISK_SCORE" -ge 50 ]; then TIER=high
      elif [ "$RISK_SCORE" -ge 20 ]; then TIER=medium
      else TIER=low; fi
      echo "🧭 Risk score: ${RISK_SCORE}/100 (${NATURE}) → ${AGENT_TARGET} agents, Codex ${CODEX_DEPTH}×${CODEX_ROUNDS} [label: ${TIER}]"
    fi
  fi

  # Fallback 2: legacy per-repo gate tier (only if scorer produced nothing).
  if [ -z "$RISK_SCORE" ] && [ -f "harness-config.json" ] && [ -f "scripts/risk-policy-gate.js" ]; then
    GH_OUT=$(mktemp)
    GITHUB_OUTPUT="$GH_OUT" node scripts/risk-policy-gate.js >/dev/null 2>&1
    if [ $? -eq 0 ]; then
      TIER=$(grep '^effectiveTier=' "$GH_OUT" | cut -d= -f2)
      [ -z "$TIER" ] && TIER=$(grep '^highestRisk=' "$GH_OUT" | cut -d= -f2)
      echo "🧭 (fallback) gate tier: ${TIER}"
    fi
    rm -f "$GH_OUT"
  fi

  # Fallback 3: nothing resolved → L95 (full review, safe default).
  if [ -z "$RISK_SCORE" ] && [ -z "$TIER" ]; then
    echo "[quality] No risk scorer or gate available — falling back to L95 (full review)."
    LEVEL=95
  fi
fi

# Fenced Bash blocks do not share variables. Persist the resolved knobs so the
# later provider runner enforces the scorer's actual effort/round policy.
if [ -n "${BS_QUALITY_ROOT_FILE:-}" ]; then
  cat > "${BS_QUALITY_ROOT_FILE%.txt}-riskstate.env" <<EOF
TIER='${TIER:-}'
RISK_SCORE='${RISK_SCORE:-}'
AGENT_TARGET='${AGENT_TARGET:-}'
CODEX_DEPTH='${CODEX_DEPTH:-}'
CODEX_ROUNDS='${CODEX_ROUNDS:-}'
LEVEL='${LEVEL:-}'
EOF
fi
