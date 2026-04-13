#!/bin/bash
# multi-session-cleanup.sh — Remove session lock on Stop event.
# Paired with multi-session-guard.sh (SessionStart).

GIT_ROOT=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null) || exit 0

SESSION_ID="${SESSION_ID:-$$}"
LOCK_FILE="$GIT_ROOT/.git/claude-sessions/$SESSION_ID.lock"

rm -f "$LOCK_FILE" 2>/dev/null
exit 0
