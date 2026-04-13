#!/bin/bash
# multi-session-guard.sh — Detect multiple Claude Code sessions on the same git repo.
#
# Problem: Two CC tabs on the same repo share .git state. Concurrent git operations
# (checkout, add, commit) collide — commits land on wrong branches, staging gets mixed.
#
# Solution: At session start, check for other active Claude Code processes working
# in the same git repo. Warn if detected. Uses a lock file in .git/ to track sessions.
#
# Hook types: SessionStart (detect + warn), UserPromptSubmit (optional git-op guard)
#
# Environment: CC passes $PWD, $SESSION_ID, $TOOL_INPUT etc.

set -euo pipefail

# Only act in git repos
GIT_ROOT=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null) || exit 0

LOCK_DIR="$GIT_ROOT/.git/claude-sessions"
mkdir -p "$LOCK_DIR"

# Current session identifier (use CC session ID if available, fallback to PID-based)
SESSION_ID="${SESSION_ID:-$$}"
LOCK_FILE="$LOCK_DIR/$SESSION_ID.lock"

# Register this session
echo "$(date +%s) $PWD $$" > "$LOCK_FILE"

# Clean stale locks (sessions that ended without cleanup — older than 12 hours)
NOW=$(date +%s)
for lock in "$LOCK_DIR"/*.lock; do
    [ -f "$lock" ] || continue
    [ "$lock" = "$LOCK_FILE" ] && continue

    LOCK_TS=$(head -1 "$lock" 2>/dev/null | awk '{print $1}')
    if [ -n "$LOCK_TS" ]; then
        AGE=$(( NOW - LOCK_TS ))
        if [ "$AGE" -gt 43200 ]; then
            # Stale lock (>12h) — remove
            rm -f "$lock"
            continue
        fi

        # Check if the process is still alive
        LOCK_PID=$(head -1 "$lock" 2>/dev/null | awk '{print $3}')
        if [ -n "$LOCK_PID" ] && ! kill -0 "$LOCK_PID" 2>/dev/null; then
            # Process dead — stale lock
            rm -f "$lock"
            continue
        fi
    fi
done

# Count other active sessions (excluding ours)
OTHER_SESSIONS=0
OTHER_INFO=""
for lock in "$LOCK_DIR"/*.lock; do
    [ -f "$lock" ] || continue
    [ "$lock" = "$LOCK_FILE" ] && continue
    OTHER_SESSIONS=$((OTHER_SESSIONS + 1))
    LOCK_PID=$(head -1 "$lock" 2>/dev/null | awk '{print $3}')
    OTHER_INFO="PID $LOCK_PID"
done

if [ "$OTHER_SESSIONS" -gt 0 ]; then
    REPO_NAME=$(basename "$GIT_ROOT")
    BRANCH=$(git -C "$GIT_ROOT" branch --show-current 2>/dev/null || echo "unknown")

    cat <<JSON
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "⚠️ MULTI-SESSION COLLISION RISK: ${OTHER_SESSIONS} other CC session(s) active on ${REPO_NAME} (branch: ${BRANCH}, ${OTHER_INFO}). Git operations (checkout, add, commit) will collide. Options: (1) let the other tab finish first, (2) use separate git worktrees, (3) work on different branches and coordinate carefully."
  }
}
JSON
else
    exit 0
fi
