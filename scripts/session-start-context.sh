#!/bin/bash
# SessionStart hook: inject context, repo hygiene check, and SOTA staleness check

SETUP_REPO="${SETUP_REPO:-$HOME/Projects/claude-kit}"
SOTA_HISTORY="$SETUP_REPO/data/sota-history.json"

# --- Repo hygiene: prune local branches and check open PR count ---
HYGIENE_WARNINGS=""

# Only run if inside a git repo
if git rev-parse --git-dir &>/dev/null 2>&1; then
  # Sync remote state
  git fetch --prune --quiet 2>/dev/null || true

  # Delete local branches whose remote tracking branch is gone
  GONE_BRANCHES=$(git branch -vv 2>/dev/null | grep ': gone]' | awk '{print $1}' | tr '\n' ' ')
  if [ -n "$GONE_BRANCHES" ]; then
    echo "$GONE_BRANCHES" | xargs git branch -D 2>/dev/null || true
    HYGIENE_WARNINGS="${HYGIENE_WARNINGS}🧹 Pruned local branches (remote deleted): ${GONE_BRANCHES}. "
  fi

  # Delete local branches already merged into main
  MERGED_BRANCHES=$(git branch --merged main 2>/dev/null | grep -v '^\*\|main\|master' | tr '\n' ' ')
  if [ -n "$MERGED_BRANCHES" ]; then
    echo "$MERGED_BRANCHES" | xargs git branch -d 2>/dev/null || true
    HYGIENE_WARNINGS="${HYGIENE_WARNINGS}🧹 Deleted merged branches: ${MERGED_BRANCHES}. "
  fi

  # Prune stale worktrees
  git worktree prune 2>/dev/null || true

  # Warn if too many local branches (>3 = main + 2 features max)
  BRANCH_COUNT=$(git branch 2>/dev/null | grep -c '.' || echo 0)
  if [ "$BRANCH_COUNT" -gt 3 ]; then
    HYGIENE_WARNINGS="${HYGIENE_WARNINGS}⚠️ ${BRANCH_COUNT} local branches — consider cleaning up. "
  fi

  # Warn if too many open PRs (>2)
  if command -v gh &>/dev/null; then
    REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
    PR_COUNT=$(cd "$REPO_ROOT" && gh pr list --state open --json number --jq 'length' 2>/dev/null || echo 0)
    if [ -n "$PR_COUNT" ] && [ "$PR_COUNT" -gt 2 ]; then
      HYGIENE_WARNINGS="${HYGIENE_WARNINGS}⚠️ ${PR_COUNT} open PRs — merge or close before starting new work. "
    fi
  fi
fi

# Check SOTA staleness
SOTA_WARNING=""
if [ -f "$SOTA_HISTORY" ]; then
  LAST_DATE=$(python3 -c "import json,sys; d=json.load(open('$SOTA_HISTORY')); print(d.get('lastUpdated') or '')" 2>/dev/null)
  if [ -n "$LAST_DATE" ] && [ "$LAST_DATE" != "null" ]; then
    DAYS_AGO=$(python3 -c "
from datetime import datetime, timezone
import sys
s = '$LAST_DATE'.split('T')[0]
try:
    d = datetime.strptime(s, '%Y-%m-%d').replace(tzinfo=timezone.utc)
    print((datetime.now(timezone.utc) - d).days)
except:
    print(0)
" 2>/dev/null)
    if [ -n "$DAYS_AGO" ] && [ "$DAYS_AGO" -gt 7 ]; then
      SOTA_WARNING="⚠️ SOTA last run ${DAYS_AGO} days ago — consider running /bs:sota to check for new CC features."
    fi
  else
    SOTA_WARNING="⚠️ SOTA never run — run /bs:sota to benchmark your Claude Code setup."
  fi
else
  SOTA_WARNING="⚠️ SOTA history missing — run /bs:sota to establish baseline."
fi

# Build context injection
CONTEXT=""
if [ -n "$HYGIENE_WARNINGS" ]; then
  CONTEXT="$HYGIENE_WARNINGS"
fi
if [ -n "$SOTA_WARNING" ]; then
  CONTEXT="${CONTEXT}${SOTA_WARNING}"
fi

if [ -z "$CONTEXT" ]; then
  exit 0
fi

cat <<JSON
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "$CONTEXT"
  }
}
JSON
