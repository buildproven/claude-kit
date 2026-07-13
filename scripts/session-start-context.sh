#!/bin/bash
# SessionStart hook: inject context, repo hygiene check, and SOTA staleness check

SETUP_REPO="${SETUP_REPO:-$HOME/Projects/claude-kit}"
SOTA_HISTORY="$SETUP_REPO/data/sota-history.json"

# --- Repo hygiene: prune local branches and check open PR count ---
HYGIENE_WARNINGS=""

# Only run if inside a git repo
if git rev-parse --git-dir &>/dev/null 2>&1; then

  # REPORT, NEVER DELETE.
  #
  # This hook fires on EVERY session start, in WHATEVER repo you happen to open.
  # It used to run `git branch -D` on branches whose upstream was gone, and
  # `git branch -d` on merged ones — silently, with no prompt and no opt-out.
  #
  # `-D` is a FORCE delete. If a remote branch was deleted while you still had
  # unpushed local commits, those commits went with it. A toolkit must never
  # destroy a user's work as a side effect of opening a session in their repo.
  #
  # So: surface the same signal, delete nothing. Anyone who genuinely wants the
  # old behavior can opt in explicitly — it stays off by default.
  CLAUDE_KIT_AUTO_PRUNE="${CLAUDE_KIT_AUTO_PRUNE:-0}"

  # Read-only: update remote-tracking refs. Does not touch local branches.
  git fetch --prune --quiet 2>/dev/null || true

  GONE_BRANCHES=$(git branch -vv 2>/dev/null | grep ': gone]' | awk '{print $1}' | tr '\n' ' ')
  if [ -n "$GONE_BRANCHES" ]; then
    if [ "$CLAUDE_KIT_AUTO_PRUNE" = "1" ]; then
      echo "$GONE_BRANCHES" | xargs git branch -D 2>/dev/null || true
      HYGIENE_WARNINGS="${HYGIENE_WARNINGS}🧹 Pruned (CLAUDE_KIT_AUTO_PRUNE=1): ${GONE_BRANCHES}. "
    else
      HYGIENE_WARNINGS="${HYGIENE_WARNINGS}🌿 Branches whose remote is gone: ${GONE_BRANCHES}— review, then \`git branch -D\` if you're sure (they may hold unpushed commits). "
    fi
  fi

  MERGED_BRANCHES=$(git branch --merged main 2>/dev/null | grep -v '^\*\|main\|master' | tr '\n' ' ')
  if [ -n "$MERGED_BRANCHES" ]; then
    if [ "$CLAUDE_KIT_AUTO_PRUNE" = "1" ]; then
      echo "$MERGED_BRANCHES" | xargs git branch -d 2>/dev/null || true
      HYGIENE_WARNINGS="${HYGIENE_WARNINGS}🧹 Deleted merged (CLAUDE_KIT_AUTO_PRUNE=1): ${MERGED_BRANCHES}. "
    else
      HYGIENE_WARNINGS="${HYGIENE_WARNINGS}🌿 Merged into main: ${MERGED_BRANCHES}— safe to \`git branch -d\`. "
    fi
  fi

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
